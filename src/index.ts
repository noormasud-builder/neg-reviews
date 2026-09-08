import crypto from 'node:crypto';
import express from 'express';
import { WebClient } from '@slack/web-api';
import { createGLClient, type FullGLClient } from './gl/index.js';
import { formatReply } from './format.js';
import { matchReview } from './match.js';
import { parseReview, type SlackEvent } from './parse.js';

const PORT = Number(process.env.PORT ?? 3000);
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() === 'true';
const CHANNELS = new Set(
  (process.env.SLACK_CHANNEL_IDS ?? '').split(',').map((c) => c.trim()).filter(Boolean),
);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 14);
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES ?? 5);

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
let gl: FullGLClient | null = null;
function glClient(): FullGLClient {
  if (!gl) gl = createGLClient();
  return gl;
}

/* -------------------------------------------------------------------------- */
/* Signature verification — Slack signs the RAW body, so it must not be parsed */
/* before we hash it.                                                          */
/* -------------------------------------------------------------------------- */

function verifySlackSignature(req: express.Request, raw: Buffer): boolean {
  const timestamp = req.header('x-slack-request-timestamp');
  const signature = req.header('x-slack-signature');
  if (!timestamp || !signature || !SIGNING_SECRET) return false;

  // Reject replays older than five minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;

  const hmac = crypto.createHmac('sha256', SIGNING_SECRET);
  hmac.update(`v0:${timestamp}:${raw.toString('utf8')}`);
  const expected = `v0=${hmac.digest('hex')}`;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* -------------------------------------------------------------------------- */

/**
 * Config is checked at boot rather than on first use. The GL client is created
 * lazily, so without this the service would deploy green, pass its health check,
 * and then fail silently on the first real review — the one moment anyone cares
 * about. Better to shout about it on startup and surface it on /health.
 */
function missingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.SLACK_SIGNING_SECRET) missing.push('SLACK_SIGNING_SECRET');
  if (!process.env.SLACK_BOT_TOKEN) missing.push('SLACK_BOT_TOKEN');

  const adapter = (process.env.GL_ADAPTER ?? 'mcp').toLowerCase();
  if (adapter === 'mcp') {
    if (!process.env.GL_MCP_URL) missing.push('GL_MCP_URL');
    if (!process.env.GL_MCP_TOKEN) missing.push('GL_MCP_TOKEN');
  } else if (adapter === 'mysql') {
    for (const k of ['GL_DB_HOST', 'GL_DB_USER', 'GL_DB_PASSWORD', 'GL_DB_NAME']) {
      if (!process.env[k]) missing.push(k);
    }
  } else {
    missing.push(`GL_ADAPTER (got "${adapter}", expected "mcp" or "mysql")`);
  }
  return missing;
}

const MISSING = missingConfig();

const app = express();
app.use(express.raw({ type: 'application/json', limit: '2mb' }));

app.get('/health', (_req, res) => {
  // Still 200 so Railway's health check passes and you can read the diagnosis;
  // configOk is the field to actually look at.
  res.json({
    ok: true,
    configOk: MISSING.length === 0,
    missingConfig: MISSING,
    adapter: process.env.GL_ADAPTER ?? 'mcp',
    dryRun: DRY_RUN,
    channels: [...CHANNELS],
  });
});

/** Slack retries anything it doesn't hear back from within 3s. Dedupe on event_id. */
const handled = new Set<string>();

app.post('/slack/events', (req, res) => {
  const raw = req.body as Buffer;

  if (!verifySlackSignature(req, raw)) {
    res.status(401).send('bad signature');
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).send('bad json');
    return;
  }

  // One-off handshake when you paste the Request URL into Slack.
  if (payload.type === 'url_verification') {
    res.type('text/plain').send(payload.challenge);
    return;
  }

  // Ack immediately — everything below is slow (DB + Claude) and Slack will
  // resend the event if we hold the connection open.
  res.status(200).send();

  if (payload.type !== 'event_callback') return;
  const eventId: string = payload.event_id;
  if (handled.has(eventId)) return;
  handled.add(eventId);
  if (handled.size > 5000) handled.clear();

  const event = payload.event as SlackEvent;
  void handleMessage(event).catch((err) => {
    console.error('[handler] unhandled error', err);
  });
});

async function handleMessage(event: SlackEvent): Promise<void> {
  if (event.type !== 'message') return;
  if (CHANNELS.size && !CHANNELS.has(event.channel)) return;

  // Ignore edits, deletions, joins, and — critically — our own replies.
  const IGNORED_SUBTYPES = new Set([
    'message_changed', 'message_deleted', 'channel_join', 'channel_leave',
    'thread_broadcast', 'bot_message_replied',
  ]);
  if (event.subtype && IGNORED_SUBTYPES.has(event.subtype)) return;
  // Only answer top-level posts, not replies inside a thread.
  if (event.thread_ts && event.thread_ts !== event.ts) return;

  const parsed = parseReview(event);
  console.log('[parsed]', {
    ts: event.ts,
    bookingId: parsed.bookingId,
    reviewer: parsed.reviewerName,
    real: parsed.reviewerNameLooksReal,
    trainer: parsed.trainerName,
    courses: parsed.courseIds,
    date: parsed.courseDate,
  });

  if (MISSING.length) {
    console.error(
      `[handler] REVIEW RECEIVED BUT NOT ANSWERED — missing config: ${MISSING.join(', ')}`,
    );
    return;
  }

  let result;
  try {
    result = await matchReview(parsed, glClient(), {
      lookbackDays: LOOKBACK_DAYS,
      maxCandidates: MAX_CANDIDATES,
    });
  } catch (err) {
    // A lookup failure is worth knowing about in the channel — otherwise the
    // bot just goes quiet and everyone assumes it matched nothing.
    console.error('[handler] lookup failed', err);
    if (!DRY_RUN) {
      await slack.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: ":warning: Couldn't reach the booking database for this one — check the service logs.",
      }).catch(() => {});
    }
    return;
  }

  const text = formatReply(parsed, result);

  if (DRY_RUN) {
    console.log(`[dry-run] would reply in ${event.channel} thread ${event.ts}:\n${text}`);
    return;
  }

  await slack.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}

app.listen(PORT, () => {
  console.log(`who-posted-it listening on :${PORT}`);
  console.log(`  adapter=${process.env.GL_ADAPTER ?? 'mcp'} dryRun=${DRY_RUN} channels=${[...CHANNELS].join(',') || '(all)'}`);
  if (MISSING.length) {
    console.error('');
    console.error('  ' + '!'.repeat(70));
    console.error(`  NOT READY — these environment variables are unset:`);
    for (const m of MISSING) console.error(`    - ${m}`);
    console.error('  Slack events will be received and logged, but no replies will be sent.');
    console.error('  ' + '!'.repeat(70));
    console.error('');
  } else {
    console.log('  config OK — ready to answer reviews');
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await gl?.close().catch(() => {});
    process.exit(0);
  });
}
