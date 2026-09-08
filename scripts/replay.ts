/**
 * Offline test harness. Runs sample review alerts through the real parser and
 * matcher against fixture data. No Slack, no network, no Claude.
 *
 *   npm run replay
 */
import { formatReply } from '../src/format.js';
import { matchReview } from '../src/match.js';
import { parseReview, type SlackEvent } from '../src/parse.js';
import { fixtureClient } from './fixtures.js';

const TODAY = new Date('2026-09-08T12:00:00Z');

interface Case {
  label: string;
  expect: string;
  event: SlackEvent;
}

const msg = (text: string, extra: Partial<SlackEvent> = {}): SlackEvent => ({
  type: 'message', channel: 'C0C13NDGG7J', ts: '1757000000.000100', text, ...extra,
});

const CASES: Case[] = [
  {
    label: 'Trustpilot alert with an explicit booking reference',
    expect: 'exact 628241',
    event: msg('', {
      bot_id: 'B01TRUST',
      username: 'Trustpilot',
      attachments: [{
        fallback: 'New 1-star review',
        author_name: 'Bishnu Gurung',
        title: '⭐ New 1-star review from Bishnu Gurung',
        text: 'Absolute waste of time. Booking ref 628241. The refresher course was rushed and nobody explained the assessment.',
      }],
    }),
  },
  {
    label: 'Google review, full name + course abbreviation, duplicate bookings in DB',
    expect: 'exact 629306 (newest of the two Raynard Hayes rows)',
    event: msg('*Raynard Hayes* left a 2★ review on Google\n\n> Did my DS course on the 7th of September and the room was freezing all day.'),
  },
  {
    label: 'Forename only, course named — genuinely ambiguous',
    expect: 'candidate list, no single exact',
    event: msg('New 1 star review from Mohammed\n\n> The door supervisor training was disorganised, waited two hours to be registered.'),
  },
  {
    label: 'Trainer named + CCTV course',
    expect: 'trainer path, Tolga Beyaz events, CCTV only',
    event: msg('⭐ 2/5 review by Daniel Okonkwo\n\n> Trainer Tolga was reading straight off the slides for the whole CCTV course.'),
  },
  {
    label: 'Nickname handle — should refuse to guess',
    expect: 'no match, explains why',
    event: msg('New 1-star review from bigmike92\n\n> Terrible. Never again.'),
  },
  {
    label: 'Reviewer left their email',
    expect: 'exact 629568 via email',
    event: msg('New 1★ review\nReviewer: Isaac Rocke\nContact: isaacr2@hotmail.com\n\n> Nobody answered my calls after the course.'),
  },
  {
    label: 'Direct gladmin link pasted by a human',
    expect: 'exact 628241 from the URL',
    event: msg('Chasing this one: https://www.get-licensed.co.uk/gladmin/v2/trainees/628241/edit'),
  },
  {
    label: 'Anonymous with no signals at all',
    expect: 'no match',
    event: msg('New 1-star review from Anonymous\n\n> Rubbish service.'),
  },
  {
    label: 'Surname misspelt by the reviewer',
    expect: 'widens to forename, flags surname as unverified',
    event: msg('New 1★ review from Isaac Roque\n\n> Door supervisor course, nobody explained the exam.'),
  },
  {
    label: 'Abbreviated surname — "Raynard H"',
    expect: 'exact 629306 via surname-initial match',
    event: msg('New 2★ review from Raynard H\n\n> DS course on 7 September was freezing.'),
  },
  {
    label: '"ds" must not fire on the word "kids"',
    expect: 'no spurious Door Supervisor course filter',
    event: msg('Review from Anna Dairion\n\n> I had to bring my kids and nobody cared.'),
  },
];

async function main() {
  let pass = 0;
  for (const c of CASES) {
    const gl = fixtureClient();
    const parsed = parseReview(c.event, TODAY);
    const result = await matchReview(parsed, gl, {
      lookbackDays: 14, maxCandidates: 5, today: TODAY, disableClaude: true,
    });

    console.log('\n' + '═'.repeat(78));
    console.log(`▶ ${c.label}`);
    console.log(`  expected: ${c.expect}`);
    console.log('─'.repeat(78));
    console.log('  parsed  :', JSON.stringify({
      reviewer: parsed.reviewerName,
      real: parsed.reviewerNameLooksReal,
      trainer: parsed.trainerName,
      courses: parsed.courseIds,
      date: parsed.courseDate,
      bookingId: parsed.bookingId,
      email: parsed.email,
      rating: parsed.rating,
    }));
    console.log('  strategy:', result.strategy, '| exact:', result.exact?.id ?? '—',
      '| candidates:', result.candidates.length);
    console.log('─'.repeat(78));
    console.log(formatReply(parsed, result).split('\n').map((l) => '  ' + l).join('\n'));
    pass++;
  }
  console.log('\n' + '═'.repeat(78));
  console.log(`${pass} scenarios executed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
