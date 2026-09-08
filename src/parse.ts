import { detectCourses } from './courses.js';

export interface SlackEvent {
  type: string;
  subtype?: string;
  channel: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  blocks?: any[];
  attachments?: any[];
}

export interface ParsedReview {
  /** Every scrap of text in the message, flattened. */
  fullText: string;
  bookingId: number | null;
  /** True when the booking ID came from an explicit label or gladmin URL. */
  bookingIdConfident: boolean;
  email: string | null;
  reviewerName: string | null;
  reviewerNameLooksReal: boolean;
  trainerName: string | null;
  courseIds: number[];
  courseLabel: string | null;
  courseDate: string | null;
  rating: number | null;
}

/* -------------------------------------------------------------------------- */
/* Slack payloads bury text in three different places. Flatten all of them.    */
/* -------------------------------------------------------------------------- */

function collectStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    // Only harvest keys that actually carry human-readable copy — otherwise
    // we drag in block IDs, style names and colour hex codes.
    const KEYS = ['text', 'title', 'value', 'pretext', 'fallback', 'author_name', 'title_link', 'alt_text', 'url'];
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (KEYS.includes(k) || Array.isArray(v) || (typeof v === 'object' && v !== null)) {
        collectStrings(v, out, depth + 1);
      }
    }
  }
}

export function flattenSlackText(event: SlackEvent): string {
  const parts: string[] = [];
  if (event.text) parts.push(event.text);
  collectStrings(event.blocks, parts);
  collectStrings(event.attachments, parts);
  // De-duplicate — Slack repeats the same string across fallback/text/blocks.
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const key = p.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Field extraction                                                            */
/* -------------------------------------------------------------------------- */

const GLADMIN_URL = /gladmin\/(?:v2\/)?trainees\/(\d{4,8})\/edit/i;
const LABELLED_ID = /\b(?:booking|order[\s-]?course|trainee|ref(?:erence)?|profile)\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*(\d{5,8})\b/i;
const HASH_ID = /(?:^|\s)#(\d{5,8})\b/;

export function extractBookingId(text: string): { id: number | null; confident: boolean } {
  const url = text.match(GLADMIN_URL);
  if (url) return { id: Number(url[1]), confident: true };

  const labelled = text.match(LABELLED_ID);
  if (labelled) return { id: Number(labelled[1]), confident: true };

  const hashed = text.match(HASH_ID);
  if (hashed) return { id: Number(hashed[1]), confident: true };

  // A bare 6-figure number *might* be a booking ID, but it's just as likely a
  // postcode fragment, an order total or part of a phone number. Flag it as
  // unconfident so the matcher verifies it resolves to a real booking before
  // trusting it.
  const bare = text.match(/\b(6\d{5})\b/);
  if (bare) return { id: Number(bare[1]), confident: false };

  return { id: null, confident: false };
}

export function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (!m) return null;
  const email = m[0].replace(/[.,;>)\]]+$/, '');
  // Ignore the review platform's own addresses.
  if (/(trustpilot|google|noreply|no-reply|slack)\./i.test(email)) return null;
  return email.toLowerCase();
}

/** A capitalised 1-3 token personal name. Case-SENSITIVE on purpose. */
const NAME_CAPTURE = String.raw`([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]*\.?){0,2})`;

const NAME_LABEL = new RegExp(
  String.raw`(?:review(?:er)?|customer|client|name|posted by|author|written by)\s*[:\-–]\s*` + NAME_CAPTURE,
  'u',
);
const NAME_LEADIN = new RegExp(
  String.raw`\b` + NAME_CAPTURE + String.raw`\s+(?:left|posted|wrote|gave|has left|rated)\b`,
  'u',
);
/** "1-star review from X", "2/5 review by X", "⭐⭐ new review from X" */
const NAME_AFTER_REVIEW = new RegExp(
  String.raw`\breview\s+(?:from|by|posted by)\s+` + NAME_CAPTURE,
  'iu',
);

export function extractReviewerName(
  text: string,
  fallbackUsername?: string,
  authorHints: string[] = [],
): string | null {
  // Review-platform bots put the reviewer in `author_name` on the attachment.
  // That's structured data straight from the source — trust it over any regex.
  for (const hint of authorHints) {
    if (looksLikeRealName(hint)) return hint.trim();
  }

  for (const re of [NAME_LABEL, NAME_LEADIN, NAME_AFTER_REVIEW]) {
    const m = text.match(re);
    // NAME_AFTER_REVIEW is case-insensitive so the keyword matches "Review",
    // which means the capture can pick up lowercase noise — validate it.
    if (m?.[1] && looksLikeRealName(m[1])) return m[1].trim();
  }

  // Trustpilot's Slack app sometimes puts the reviewer in the bold first line.
  const bold = text.match(/^\s*\*([^*\n]{2,60})\*/m);
  if (bold && looksLikeRealName(bold[1])) return bold[1].trim();

  if (fallbackUsername && looksLikeRealName(fallbackUsername)) return fallbackUsername.trim();
  return null;
}

/** Pull `author_name` / `title` off Slack attachments and block accessories. */
export function collectAuthorHints(event: SlackEvent): string[] {
  const hints: string[] = [];
  for (const att of event.attachments ?? []) {
    if (typeof att?.author_name === 'string') hints.push(att.author_name);
  }
  for (const block of event.blocks ?? []) {
    for (const el of block?.elements ?? []) {
      if (el?.type === 'plain_text' && typeof el.text === 'string') hints.push(el.text);
    }
  }
  return hints;
}

const NON_NAMES = new Set([
  'anonymous', 'a customer', 'customer', 'guest', 'user', 'client',
  'trustpilot', 'google', 'reviewer', 'private user', 'someone', 'unknown',
  'n/a', 'na', 'test',
]);

/**
 * The brief: only chase a name if it "looks like a valid name and not a
 * nickname". Rejects handles (bigmike92), initialisms, single lowercase
 * tokens, anything with digits, and the platforms' anonymity placeholders.
 */
export function looksLikeRealName(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const name = candidate.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 60) return false;
  if (NON_NAMES.has(name.toLowerCase())) return false;
  if (/\d/.test(name)) return false;
  if (/[_@/\\|]/.test(name)) return false;

  const tokens = name.split(' ');
  if (tokens.length > 3) return false;

  for (const t of tokens) {
    const bare = t.replace(/[.'’-]/g, '');
    if (!bare) return false;
    if (!/^\p{L}+$/u.test(bare)) return false;
    // Every token should be capitalised — "bigmike" and "xxdarkxx" fail here.
    if (bare[0] !== bare[0].toUpperCase()) return false;
  }

  // A lone token is only a usable name if it's a plausible forename length and
  // not obviously a handle (all-caps blocks, no vowels).
  if (tokens.length === 1) {
    const t = tokens[0].replace(/[.'’-]/g, '');
    if (t.length < 3) return false;
    if (!/[aeiouyAEIOUY]/.test(t)) return false;
    if (t === t.toUpperCase() && t.length > 4) return false;
  }
  return true;
}

const TRAINER_KEYWORDS = [
  'trainer', 'instructor', 'tutor', 'teacher', 'assessor',
  'taught by', 'trained by', 'assessed by', 'delivered by',
];
/** Filler that can sit between the keyword and the name. */
const TRAINER_GAP = /^[\s:,\-–]*(?:was|is|named|called|guy|lady|man|woman|,)?[\s:,\-–]*/;
const TRAINER_NAME = new RegExp('^' + NAME_CAPTURE, 'u');

/**
 * Two-stage on purpose. Matching the keyword needs to be case-insensitive
 * ("Trainer Tolga..." at the start of a sentence), but the *name* capture must
 * stay case-sensitive or it swallows the following lowercase words
 * ("trainer was rude" -> "was rude").
 */
export function extractTrainerName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const keyword of TRAINER_KEYWORDS) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(keyword, from);
      if (idx === -1) break;
      from = idx + keyword.length;

      // Must be a whole word.
      const before = idx === 0 ? ' ' : text[idx - 1];
      if (/[\p{L}\d]/u.test(before)) continue;

      const rest = text.slice(from);
      const gap = rest.match(TRAINER_GAP)?.[0] ?? '';
      // A name has to follow fairly closely, not eight words later.
      if (gap.length > 12) continue;

      const nameMatch = rest.slice(gap.length).match(TRAINER_NAME);
      if (nameMatch?.[1] && looksLikeRealName(nameMatch[1])) {
        return nameMatch[1].trim();
      }
    }
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Returns YYYY-MM-DD, or null. `today` anchors relative/year-less dates. */
export function extractCourseDate(text: string, today = new Date()): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 03/09/2026 or 3-9-26 — UK order, day first.
  const numeric = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    let y = Number(numeric[3]);
    if (y < 100) y += 2000;
    if (d <= 31 && m <= 12) return fmt(y, m, d);
  }

  // "3rd September", "September 3", "3 Sept 2026"
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(20\d{2})?/i);
  if (dayFirst) {
    const d = Number(dayFirst[1]);
    const m = MONTHS[dayFirst[2].toLowerCase()];
    const y = dayFirst[3] ? Number(dayFirst[3]) : inferYear(m, today);
    if (d <= 31) return fmt(y, m, d);
  }
  const monthFirst = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})?/i);
  if (monthFirst) {
    const m = MONTHS[monthFirst[1].toLowerCase()];
    const d = Number(monthFirst[2]);
    const y = monthFirst[3] ? Number(monthFirst[3]) : inferYear(m, today);
    if (d <= 31) return fmt(y, m, d);
  }

  if (/\byesterday\b/i.test(text)) return offsetDays(today, -1);
  if (/\btoday\b/i.test(text)) return offsetDays(today, 0);
  return null;
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A year-less date is almost always the most recent occurrence, not a future one. */
function inferYear(month: number, today: Date): number {
  const y = today.getUTCFullYear();
  return month > today.getUTCMonth() + 1 ? y - 1 : y;
}

function offsetDays(from: Date, days: number): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function extractRating(text: string): number | null {
  const stars = (text.match(/[★⭐]/g) ?? []).length;
  if (stars >= 1 && stars <= 5) return stars;
  const m = text.match(/\b([1-5])\s*(?:\/\s*5|star|stars|-star)\b/i);
  return m ? Number(m[1]) : null;
}

/* -------------------------------------------------------------------------- */

export function parseReview(event: SlackEvent, today = new Date()): ParsedReview {
  const fullText = flattenSlackText(event);
  const { id, confident } = extractBookingId(fullText);
  const reviewerName = extractReviewerName(fullText, event.username, collectAuthorHints(event));
  const courses = detectCourses(fullText);

  return {
    fullText,
    bookingId: id,
    bookingIdConfident: confident,
    email: extractEmail(fullText),
    reviewerName,
    reviewerNameLooksReal: looksLikeRealName(reviewerName),
    trainerName: extractTrainerName(fullText),
    courseIds: courses.map((c) => c.course.id),
    courseLabel: courses[0]?.course.name ?? null,
    courseDate: extractCourseDate(fullText, today),
    rating: extractRating(fullText),
  };
}
