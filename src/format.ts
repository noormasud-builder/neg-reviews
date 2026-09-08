import { courseName } from './courses.js';
import type { Booking } from './gl/types.js';
import type { MatchResult } from './match.js';
import type { ParsedReview } from './parse.js';

const BASE = () =>
  process.env.GLADMIN_BASE_URL ?? 'https://www.get-licensed.co.uk/gladmin/v2/trainees';

export function bookingUrl(id: number): string {
  return `${BASE()}/${id}/edit`;
}

function prettyDate(iso: string | null | undefined): string {
  if (!iso || iso.startsWith('0000')) return 'date unknown';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function line(b: Booking): string {
  const name = `${b.name ?? ''} ${b.lname ?? ''}`.trim() || 'Name missing';
  const bits = [name, courseName(b.course_id), prettyDate(b.course_start_date)];
  if (b.result && b.result !== 'Awaiting Result') bits.push(b.result);
  return `<${bookingUrl(b.id)}|${b.id}> — ${bits.join(' · ')}`;
}

const STRATEGY_LABEL: Record<string, string> = {
  booking_id: 'matched on the reference number in the message',
  email: 'matched on the reviewer’s email address',
  trainer: 'searched this trainer’s events only',
  name: 'searched by name across the last fortnight',
  name_and_course: 'searched by name within the course mentioned',
  none: 'no search was possible',
};

export function formatReply(parsed: ParsedReview, result: MatchResult): string {
  const lines: string[] = [];

  if (result.exact) {
    lines.push(`*Booking:* ${line(result.exact)}`);
    const extras = [STRATEGY_LABEL[result.strategy]];
    if (result.claudeSummary) extras.push(result.claudeSummary);
    lines.push(`_${extras.filter(Boolean).join(' · ')}_`);

    const others = result.candidates.filter((c) => c.booking.id !== result.exact!.id);
    if (others.length) {
      lines.push('');
      lines.push(`Other possibilities: ${others.map((c) => `<${bookingUrl(c.booking.id)}|${c.booking.id}>`).join(' · ')}`);
    }
    if (result.note) lines.push(`\n:warning: ${result.note}`);
    return lines.join('\n');
  }

  if (result.candidates.length) {
    lines.push(`*${result.candidates.length} possible booking${result.candidates.length === 1 ? '' : 's'}* — couldn’t narrow to one, please pick:`);
    lines.push('');
    result.candidates.forEach((c, i) => {
      lines.push(`${i + 1}. ${line(c.booking)}`);
      if (c.reasons.length) lines.push(`    _${c.reasons.slice(0, 3).join(', ')}_`);
    });
    lines.push('');
    const why = [STRATEGY_LABEL[result.strategy]];
    if (result.claudeSummary) why.push(result.claudeSummary);
    lines.push(`_${why.filter(Boolean).join(' · ')}_`);
    if (result.note) lines.push(`:warning: ${result.note}`);
    return lines.join('\n');
  }

  lines.push('*No booking found.*');
  if (result.note) lines.push(result.note);

  const missing: string[] = [];
  if (!parsed.reviewerNameLooksReal) missing.push('a usable customer name');
  if (!parsed.email) missing.push('an email address');
  if (!parsed.bookingId) missing.push('a booking reference');
  if (missing.length) {
    lines.push(`\nTo find this one I’d need ${missing.join(', or ')}.`);
  }
  return lines.join('\n');
}
