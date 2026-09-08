import type { Booking, SearchWindow } from './gl/types.js';
import type { FullGLClient } from './gl/index.js';
import type { ParsedReview } from './parse.js';
import { rankWithClaude } from './claude.js';

export type MatchStrategy =
  | 'booking_id'
  | 'email'
  | 'trainer'
  | 'name'
  | 'name_and_course'
  | 'none';

export interface Candidate {
  booking: Booking;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  strategy: MatchStrategy;
  /** Set only when we're confident enough to call it *the* booking. */
  exact: Booking | null;
  candidates: Candidate[];
  /** Human-readable note explaining a miss or an unusual path. */
  note: string | null;
  claudeUsed: boolean;
  claudeSummary: string | null;
}

const DAY = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildWindow(parsed: ParsedReview, lookbackDays: number, today: Date): SearchWindow {
  if (parsed.courseDate) {
    // A named date is a strong signal, but reviewers misremember by a day or
    // two, and multi-day courses are booked against their start date.
    const d = new Date(`${parsed.courseDate}T00:00:00Z`).getTime();
    return { from: isoDay(new Date(d - 3 * DAY)), to: isoDay(new Date(d + 3 * DAY)) };
  }
  return { from: isoDay(new Date(today.getTime() - lookbackDays * DAY)), to: isoDay(today) };
}

/* ---------------------------- name scoring -------------------------------- */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/[^\p{L}]/gu, '');

export function scoreBooking(booking: Booking, parsed: ParsedReview): Candidate {
  const reasons: string[] = [];
  let score = 0;

  const tokens = (parsed.reviewerName ?? '').trim().split(/\s+/).filter(Boolean);
  const rFirst = norm(tokens[0]);
  const rLast = norm(tokens.length > 1 ? tokens[tokens.length - 1] : '');
  const bFirst = norm(booking.name);
  const bLast = norm(booking.lname);

  if (rFirst && bFirst) {
    if (rFirst === bFirst) {
      score += 40;
      reasons.push('first name exact');
    } else if (bFirst.startsWith(rFirst) || rFirst.startsWith(bFirst)) {
      score += 26;
      reasons.push('first name prefix');
    } else if (levenshtein(rFirst, bFirst) <= 1) {
      score += 22;
      reasons.push('first name ~1 char off');
    } else {
      score -= 25;
      reasons.push('first name differs');
    }
  }

  if (rLast && bLast) {
    if (rLast === bLast) {
      score += 35;
      reasons.push('surname exact');
    } else if (rLast.length <= 2 && bLast.startsWith(rLast)) {
      // "John S" against a booking for "John Smith"
      score += 16;
      reasons.push('surname initial matches');
    } else if (bLast.startsWith(rLast) || rLast.startsWith(bLast)) {
      score += 18;
      reasons.push('surname prefix');
    } else if (levenshtein(rLast, bLast) <= 2) {
      score += 14;
      reasons.push('surname close spelling');
    } else {
      score -= 8;
      reasons.push('surname differs');
    }
  } else if (rFirst && !rLast) {
    reasons.push('forename only — surname unverified');
  }

  if (parsed.courseIds.length) {
    if (parsed.courseIds.includes(booking.course_id)) {
      score += 15;
      reasons.push('course matches review');
    } else {
      score -= 10;
      reasons.push('different course to the one mentioned');
    }
  }

  if (parsed.courseDate && booking.course_start_date) {
    const diff = Math.abs(
      new Date(`${booking.course_start_date}T00:00:00Z`).getTime() -
        new Date(`${parsed.courseDate}T00:00:00Z`).getTime(),
    ) / DAY;
    if (diff === 0) {
      score += 20;
      reasons.push('date exact');
    } else if (diff <= 2) {
      score += 10;
      reasons.push(`date within ${diff}d`);
    } else {
      score -= 5;
    }
  }

  if (booking.attendance === 'Attended') {
    score += 5;
    reasons.push('attended');
  }

  return { booking, score, reasons };
}

/**
 * The same person routinely appears 2-3 times on one event (payment retries,
 * re-bookings). Collapse to the newest booking per person-per-event.
 */
export function dedupe(bookings: Booking[]): Booking[] {
  const best = new Map<string, Booking>();
  for (const b of bookings) {
    const key = `${(b.email ?? '').toLowerCase()}|${norm(b.name)}|${norm(b.lname)}|${b.location_id}`;
    const existing = best.get(key);
    if (!existing || b.id > existing.id) best.set(key, b);
  }
  return [...best.values()];
}

/* ------------------------------ the matcher ------------------------------- */

export interface MatchOptions {
  lookbackDays: number;
  maxCandidates: number;
  today?: Date;
  /** Skip the Claude step entirely (used by the offline test harness). */
  disableClaude?: boolean;
}

export async function matchReview(
  parsed: ParsedReview,
  gl: FullGLClient,
  opts: MatchOptions,
): Promise<MatchResult> {
  const today = opts.today ?? new Date();
  const window = buildWindow(parsed, opts.lookbackDays, today);
  const base: MatchResult = {
    strategy: 'none', exact: null, candidates: [],
    note: null, claudeUsed: false, claudeSummary: null,
  };

  /* 1. Explicit booking reference — the whole job in one lookup. */
  if (parsed.bookingId) {
    const booking = await gl.getBookingById(parsed.bookingId);
    if (booking) {
      if (parsed.bookingIdConfident) {
        return { ...base, strategy: 'booking_id', exact: booking };
      }
      // Unlabelled number: only trust it if the name on the booking agrees.
      const scored = scoreBooking(booking, parsed);
      if (!parsed.reviewerNameLooksReal || scored.score >= 35) {
        return {
          ...base, strategy: 'booking_id', exact: booking,
          note: 'Booking ID was inferred from an unlabelled number in the message.',
        };
      }
    }
  }

  /* 2. Email — as good as a reference number and needs no judgement. */
  if (parsed.email) {
    const byEmail = dedupe(await gl.findBookingsByEmail(parsed.email));
    if (byEmail.length === 1) {
      return { ...base, strategy: 'email', exact: byEmail[0] };
    }
    if (byEmail.length > 1) {
      const ranked = byEmail
        .map((b) => scoreBooking(b, parsed))
        .sort((a, b) => b.score - a.score || b.booking.id - a.booking.id);
      return {
        ...base, strategy: 'email',
        exact: ranked[0].booking,
        candidates: ranked.slice(0, opts.maxCandidates),
        note: `${byEmail.length} bookings share this email — showing the most recent match first.`,
      };
    }
  }

  /* 3. Trainer named — search only that trainer's events in the window. */
  let pool: Booking[] = [];
  let strategy: MatchStrategy = 'none';

  if (parsed.trainerName) {
    const trainers = await gl.findTrainersByName(parsed.trainerName);
    if (trainers.length) {
      const eventIds: number[] = [];
      for (const t of trainers.slice(0, 5)) {
        const events = await gl.findEventsByTrainer(t.id, {
          ...window,
          courseIds: parsed.courseIds.length ? parsed.courseIds : undefined,
        });
        eventIds.push(...events.map((e) => e.id));
      }
      if (eventIds.length) {
        pool = await gl.findBookingsOnEvents(
          eventIds,
          parsed.reviewerNameLooksReal ? (parsed.reviewerName ?? undefined) : undefined,
        );
        strategy = 'trainer';
      }
    }
    if (!pool.length) {
      base.note = `No events found in the window for a trainer matching "${parsed.trainerName}".`;
    }
  }

  /* 4. Name search — only for something that reads like a real name. */
  if (!pool.length && parsed.reviewerNameLooksReal && parsed.reviewerName) {
    pool = await gl.findBookingsByName(parsed.reviewerName, {
      ...window,
      courseIds: parsed.courseIds.length ? parsed.courseIds : undefined,
    });
    strategy = parsed.courseIds.length ? 'name_and_course' : 'name';

    // A course-restricted search that comes back empty may just mean the
    // reviewer named the wrong course. Retry once across all courses.
    if (!pool.length && parsed.courseIds.length) {
      pool = await gl.findBookingsByName(parsed.reviewerName, window);
      strategy = 'name';
      if (pool.length) {
        base.note = 'No match on the course mentioned in the review — widened to all courses.';
      }
    }

    // Still nothing, and we searched on two names: the surname the reviewer
    // used may be misspelt, married, transliterated, or simply different to
    // the one on the booking. Fall back to the forename and let scoring sort it.
    const nameTokens = parsed.reviewerName.trim().split(/\s+/);
    if (!pool.length && nameTokens.length > 1) {
      pool = await gl.findBookingsByName(nameTokens[0], {
        ...window,
        courseIds: parsed.courseIds.length ? parsed.courseIds : undefined,
      });
      if (pool.length) {
        base.note = `No booking for "${parsed.reviewerName}" — these match the forename only, so the surname is unverified.`;
      }
    }
  }

  if (!pool.length) {
    return {
      ...base,
      strategy,
      note: base.note ??
        (parsed.reviewerName && !parsed.reviewerNameLooksReal
          ? `"${parsed.reviewerName}" reads like a nickname or handle, so no name search was run.`
          : 'No reference number, email, usable name or trainer found in the message.'),
    };
  }

  const ranked = dedupe(pool)
    .map((b) => scoreBooking(b, parsed))
    .sort((a, b) => b.score - a.score || b.booking.id - a.booking.id);

  // One clear winner: exact name hit, comfortably ahead of the runner-up.
  const top = ranked[0];
  const runnerUp = ranked[1];
  const decisive = top.score >= 60 && (!runnerUp || top.score - runnerUp.score >= 20);

  if (decisive) {
    return { ...base, strategy, exact: top.booking, candidates: ranked.slice(0, opts.maxCandidates) };
  }

  /* 5. Genuinely ambiguous — this is where Claude earns its keep. */
  let claudeUsed = false;
  let claudeSummary: string | null = null;
  let finalRanked = ranked;

  if (!opts.disableClaude && ranked.length > 1 && process.env.ANTHROPIC_API_KEY) {
    try {
      const verdict = await rankWithClaude(parsed, ranked.slice(0, 20));
      if (verdict) {
        claudeUsed = true;
        claudeSummary = verdict.summary;
        const order = new Map(verdict.rankedIds.map((id, i) => [id, i]));
        finalRanked = [...ranked].sort(
          (a, b) => (order.get(a.booking.id) ?? 999) - (order.get(b.booking.id) ?? 999),
        );
        if (verdict.confidentId) {
          const pick = finalRanked.find((c) => c.booking.id === verdict.confidentId);
          if (pick) {
            return {
              strategy, exact: pick.booking,
              candidates: finalRanked.slice(0, opts.maxCandidates),
              note: base.note, claudeUsed, claudeSummary,
            };
          }
        }
      }
    } catch (err) {
      // Claude is an enhancement, never a dependency — fall back to scoring.
      console.error('[match] Claude ranking failed, using deterministic order:', err);
    }
  }

  return {
    strategy, exact: null,
    candidates: finalRanked.slice(0, opts.maxCandidates),
    note: base.note, claudeUsed, claudeSummary,
  };
}
