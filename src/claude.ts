import Anthropic from '@anthropic-ai/sdk';
import { courseName } from './courses.js';
import type { Candidate } from './match.js';
import type { ParsedReview } from './parse.js';

export interface ClaudeVerdict {
  /** Candidate booking IDs, best first. */
  rankedIds: number[];
  /** Set only when Claude is confident enough to name a single booking. */
  confidentId: number | null;
  /** One line for the Slack reply explaining the call. */
  summary: string;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const SYSTEM = `You disambiguate Get Licensed training bookings against the text of a customer review.

You are given the review and a shortlist of bookings already filtered to the right date window. Your job is ranking, not searching.

Weigh these, in order:
1. Surname agreement, allowing for spelling drift, transliteration, and reviewers who sign off with an initial ("John S" can be "John Smith").
2. Course agreement, including abbreviations (ds = Door Supervisor, cctv = CCTV Operator, cp = Close Protection, sg = Security Guard).
3. Date agreement with any date named in the review.
4. Details in the review body that pin down one booking: a venue, a result, a resit, a trainer.

Set confident_id ONLY when one booking is clearly right and the others are clearly wrong. If two people share a forename and nothing separates them, leave confident_id null and rank them — a human will pick. Never invent a booking ID that is not in the shortlist.

Reply with JSON only, no prose:
{"ranked_ids": [int, ...], "confident_id": int|null, "summary": "one short sentence"}`;

export async function rankWithClaude(
  parsed: ParsedReview,
  candidates: Candidate[],
): Promise<ClaudeVerdict | null> {
  const shortlist = candidates.map((c) => ({
    booking_id: c.booking.id,
    name: `${c.booking.name} ${c.booking.lname}`.trim(),
    course: courseName(c.booking.course_id),
    course_date: c.booking.course_start_date,
    event_id: c.booking.location_id,
    result: c.booking.result ?? null,
    attendance: c.booking.attendance ?? null,
  }));

  const payload = [
    `REVIEW TEXT:\n${parsed.fullText.slice(0, 4000)}`,
    '',
    `PARSED SIGNALS: ${JSON.stringify({
      reviewer_name: parsed.reviewerName,
      trainer_name: parsed.trainerName,
      course_mentioned: parsed.courseLabel,
      date_mentioned: parsed.courseDate,
      rating: parsed.rating,
    })}`,
    '',
    `SHORTLIST (${shortlist.length}):\n${JSON.stringify(shortlist, null, 1)}`,
  ].join('\n');

  const res = await getClient().messages.create({
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5',
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: 'user', content: payload }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return null;

  const parsedJson = JSON.parse(json[0]) as {
    ranked_ids?: unknown;
    confident_id?: unknown;
    summary?: unknown;
  };

  const valid = new Set(candidates.map((c) => c.booking.id));
  const rankedIds = Array.isArray(parsedJson.ranked_ids)
    ? parsedJson.ranked_ids.map(Number).filter((n) => valid.has(n))
    : [];
  const confidentId =
    typeof parsedJson.confident_id === 'number' && valid.has(parsedJson.confident_id)
      ? parsedJson.confident_id
      : null;

  return {
    rankedIds,
    confidentId,
    summary: typeof parsedJson.summary === 'string' ? parsedJson.summary : '',
  };
}
