# Who posted it

Watches `#neg-rev` for incoming Trustpilot / Google review alerts and replies in-thread with the trainee's booking ID and a direct `gladmin` link.

---

## Part 1 — Slack app: `Who posted it`

The app exists and is installed; the bot token and signing secret are in hand. Two things left to check, then two to do after deployment.

### 1. Verify the bot scopes ✅ check this now

**OAuth & Permissions** → *Scopes* → *Bot Token Scopes*. All of these must be present:

| Scope | Why |
|---|---|
| `channels:history` | Read messages posted in `#neg-rev` |
| `chat:write` | Post the reply |
| `users:read` | Resolve the poster's display name |
| `groups:history` | Only if `#neg-rev` is a **private** channel |

Adding a scope after install forces a **reinstall**, and reinstalling **issues a new bot token**. So get the scopes right before you paste `SLACK_BOT_TOKEN` into Railway, or you'll be pasting it twice.

### 2. Turn on Event Subscriptions — *after* the service is deployed

Can't be done earlier: Slack pings the Request URL and waits for the challenge response, so the service has to be live and answering first.

1. **Event Subscriptions** → toggle **On**
2. **Request URL**: `https://<your-railway-domain>/slack/events`
   You should get a green **Verified** within a second or two. If not, see Troubleshooting below.
3. **Subscribe to bot events** → **Add Bot User Event** → `message.channels`
   (add `message.groups` too if `#neg-rev` is private)
4. **Save Changes** → reinstall when prompted → **re-copy the bot token into Railway if it changed**

### 3. Invite the bot to the channel

In Slack, in `#neg-rev`:

```
/invite @Who posted it
```

Without this the app receives nothing, however correct the config looks. This is the single most common reason a working deployment appears dead.

### 4. Rotate the credentials

The token and signing secret were shared over chat during setup. Once the service is confirmed working, rotate both (**OAuth & Permissions → Rotate Tokens**, **Basic Information → Regenerate signing secret**) and update the two Railway variables.

### 5. Turn on Event Subscriptions — *after* the service is deployed

1. **Event Subscriptions** → toggle **On**
2. **Request URL**: `https://<your-railway-domain>/slack/events`
   Slack immediately sends a challenge; you should see a green **Verified**. If not, the service isn't running or the signing secret is wrong.
3. **Subscribe to bot events** → **Add Bot User Event** → `message.channels`
   (add `message.groups` too if `#neg-rev` is private)
4. **Save Changes** → Slack will prompt you to **reinstall the app** — do it.

### 6. Invite the bot to the channel

In Slack, in `#neg-rev`:

```
/invite @Who posted it
```

Without this the app receives nothing, no matter how the config looks.

---

## Part 2 — Push and deploy

### Push to GitHub

The repo is already initialised with a first commit. From the project folder:

```bash
git remote add origin https://github.com/noormasud-builder/neg-reviews.git
git branch -M main
git push -u origin main
```

`.env` is gitignored. Don't force it in — the secrets belong in Railway's Variables tab, nowhere else.

### Deploy on Railway

1. **railway.app** → New Project → **Deploy from GitHub repo** → `noormasud-builder/neg-reviews`
2. Railway detects Node from `package.json` and reads `railway.json`: `npm ci && npm run build`, then `npm start`, with a health check on `/health`.
3. **Variables** → add these:

   | Variable | Value |
   |---|---|
   | `SLACK_SIGNING_SECRET` | from Basic Information |
   | `SLACK_BOT_TOKEN` | the `xoxb-…` token |
   | `SLACK_CHANNEL_IDS` | `C0C13NDGG7J` |
   | `GL_ADAPTER` | `mcp` |
   | `GL_MCP_URL` | *still needed — see Part 3* |
   | `GL_MCP_TOKEN` | *still needed — see Part 3* |
   | `ANTHROPIC_API_KEY` | optional; without it, ranking falls back to local scoring |
   | `DRY_RUN` | `true` |
   | `LOOKBACK_DAYS` | `14` |
   | `MAX_CANDIDATES` | `5` |

4. **Settings → Networking → Generate Domain**. Then hit `https://<domain>/health` — you should get `{"ok":true,...}`. That confirms the service is up before you point Slack at it.
5. Now go do Part 1, step 2.

### Leave `DRY_RUN=true` for the first day

The service does the full lookup and logs the reply it *would* post, without posting. Watch the Railway logs against a few real reviews, then flip to `false` and redeploy.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Slack won't verify the Request URL | Service not running (check `/health`), wrong `SLACK_SIGNING_SECRET`, or the URL is missing `/slack/events` |
| Verified, but no replies | Bot not invited to `#neg-rev`, or `message.channels` not subscribed, or `SLACK_CHANNEL_IDS` doesn't match |
| Logs show `bad signature` on every request | Signing secret mismatch, or a JSON body parser was added ahead of the route — the signature is computed over the **raw** body |
| Replies post twice | Two Railway instances running the same app; scale to one |
| `Missing required env var GL_MCP_URL` on boot | Part 3 isn't done yet |

---

## Part 3 — Data access

The service reads Get Licensed data through a `GLClient` interface with two interchangeable implementations, selected by `GL_ADAPTER`:

| `GL_ADAPTER` | Use | Needs |
|---|---|---|
| `mcp` | Testing now | `GL_MCP_URL`, `GL_MCP_TOKEN` for the existing GL-Assist MCP server |
| `mysql` | Production | Read-only credentials on a replica |

Start on `mcp` because it exists today. Move to `mysql` before this carries real volume — see **DEV-HANDOVER.md** for exactly what to ask the platform team for and why.

Nothing in `src/match.ts`, `src/parse.ts` or `src/format.ts` changes when you switch. That's the point of the split.

---

## How a message gets resolved

In order — the first one that lands wins:

1. **Booking reference in the message.** A `gladmin` URL, `booking id 628241`, `ref: 628241`, or `#628241`. One lookup, done.
   A bare six-figure number is treated as a *guess* and only accepted if the name on that booking agrees with the reviewer.
2. **Email address in the message.** Exact match on `order_courses.email`.
3. **Trainer named** (`trainer Tolga`, `taught by Sarah`). Resolves the trainer, pulls only *their* non-cancelled events in the window, then searches bookings on those events. Narrowed further by course and date when the review mentions them.
4. **Reviewer name**, if it looks like a real name. Searched across the last 14 days, restricted to the course mentioned if there is one. Widens to all courses, then to forename-only, if the narrow searches come back empty.
5. **Nothing usable** → replies saying so and what it would need.

Course abbreviations are mapped in `src/courses.ts` (`ds` → 12, `cctv` → 13, `cp` → 29, `sg` → 44, `ds refresher` → 149, and so on). Bare two-letter codes only match as standalone words, so "kids" doesn't trigger a Door Supervisor search.

**Claude is only called when the deterministic path is genuinely ambiguous** — two or more candidates with no clear winner. Exact reference and email hits never touch the API. If the Claude call fails, the service falls back to its own ranking rather than erroring.

### Deduplication

Duplicate bookings are common in `order_courses` — payment retries create several rows for the same person on the same event. The matcher collapses them on `email + name + location_id` and keeps the highest ID.

---

## Local development

```bash
cp .env.example .env      # fill in what you have
npm install
npm run replay            # offline: sample reviews against fixture data, no network
npm run dev               # live server on :3000
```

`npm run replay` is the fast feedback loop. It runs eleven scenarios — explicit reference, abbreviated surname, misspelt surname, forename-only ambiguity, trainer path, nickname refusal, the "kids" false positive — through the real parser and matcher against real rows captured from the database. Add a case to `scripts/replay.ts` whenever you find a message shape it gets wrong.

To point the harness at live data instead of fixtures, set `GL_ADAPTER=mcp` with real credentials and swap `fixtureClient()` for `createGLClient()` in `scripts/replay.ts`.

---

## Operational notes

- **Slack retries** any event it doesn't get a 200 for within 3 seconds. The service acks first and does the lookup after, and dedupes on `event_id` so a retry can't double-post.
- **Signature verification** uses the raw request body. Don't add a JSON body parser ahead of `/slack/events` or every request will 401.
- **`/health`** returns the active adapter and dry-run state.
- The bot ignores thread replies, message edits, and channel joins — only top-level posts get answered.
