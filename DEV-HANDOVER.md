# Dev handover — production data access

**Audience:** the Get Licensed platform team.
**Ask:** replace the MCP adapter with direct read-only database access before this service carries real volume.

---

## What the service needs

Four tables, `SELECT` only:

| Table | Columns used |
|---|---|
| `order_courses` | `id, name, lname, email, telephone, course_id, location_id, course_start_date, trainer_id, result, attendance` |
| `locations` | `id, course_id, start_date, trainer_id, take_exam_trainer_id, venue_id, cancellation_date` |
| `trainers` | `id, first_name, last_name, status, deleted` |
| `courses` | `id, course_name` (only if you want the catalogue read live rather than from `src/courses.ts`) |

Suggested grant, against a **replica** rather than the primary:

```sql
CREATE USER 'gl_review_bot'@'%' IDENTIFIED BY '<generated>';
GRANT SELECT (id, name, lname, email, telephone, course_id, location_id,
              course_start_date, trainer_id, result, attendance)
  ON getlicensed.order_courses TO 'gl_review_bot'@'%';
GRANT SELECT (id, course_id, start_date, trainer_id, take_exam_trainer_id,
              venue_id, cancellation_date)
  ON getlicensed.locations TO 'gl_review_bot'@'%';
GRANT SELECT (id, first_name, last_name, status, deleted)
  ON getlicensed.trainers TO 'gl_review_bot'@'%';
GRANT SELECT (id, course_name) ON getlicensed.courses TO 'gl_review_bot'@'%';
```

Then set on Railway:

```
GL_ADAPTER=mysql
GL_DB_HOST=…
GL_DB_PORT=3306
GL_DB_USER=gl_review_bot
GL_DB_PASSWORD=…
GL_DB_NAME=…
```

Railway egress IPs need allowlisting — Railway → Settings → Networking lists them. Nothing else in the codebase changes; the adapter is already written and type-checked (`src/gl/mysql.ts`).

---

## Why not just leave it on the MCP server

The GL-Assist MCP server is built for an LLM to query conversationally. Three properties make it a poor fit for a service:

1. **Hard 100-row cap per call.** A common forename over a fortnight exceeds that — "Mohammed" alone returned 41 bookings in the window on 8 Sep 2026, and busier names will page.
2. **No `IN (...)` on filters.** The trainer path needs "bookings across these 5 events". With MCP that's five sequential round trips per review; with SQL it's one query. The MCP adapter caps this fan-out at 25 events to stop a single review firing a hundred requests.
3. **Fixed filter vocabulary.** There's no way to express "surname starts with H" or "either `trainer_id` or `take_exam_trainer_id` matches", both of which the matcher wants. The MySQL adapter does both.

None of this blocks testing. It blocks running it hands-off at volume.

---

## Queries the service will actually run

Worst case per review, on the mysql adapter: **three queries**. Typical case (reference number or email present): **one**.

```sql
-- 1. reference number path
SELECT … FROM order_courses WHERE id = ? LIMIT 1;

-- 2. email path
SELECT … FROM order_courses WHERE email = ? ORDER BY id DESC LIMIT 50;

-- 3. name path
SELECT … FROM order_courses
WHERE course_start_date BETWEEN ? AND ?
  AND (name LIKE ? OR lname LIKE ? OR CONCAT(name,' ',lname) LIKE ?)
  AND course_id IN (…)
ORDER BY course_start_date DESC, id DESC LIMIT 100;

-- 4. trainer path (two queries)
SELECT id, course_id, start_date, trainer_id, venue_id FROM locations
WHERE (trainer_id = ? OR take_exam_trainer_id = ?)
  AND start_date BETWEEN ? AND ? AND cancellation_date IS NULL LIMIT 100;

SELECT … FROM order_courses WHERE location_id IN (…) LIMIT 200;
```

### Indexes worth checking

The name query is the only one that could hurt. It filters on `course_start_date` and does a prefix `LIKE` on `name` / `lname`. If `order_courses` has no index on `course_start_date`, add one — it bounds the scan to ~3,300 rows for a fortnight instead of 436,000.

```sql
-- verify first
SHOW INDEX FROM order_courses WHERE Column_name IN ('course_start_date','email','location_id');
```

`email` and `location_id` should already be indexed; confirm rather than assume.

---

## Security notes

- Credentials live in Railway environment variables, never in the repo.
- The pool is created with `-MULTI_STATEMENTS` so a malformed input can't chain a second statement, and every query is parameterised.
- The service reads customer names and email addresses and posts **names and booking IDs** into Slack. It never posts email addresses, phone numbers or addresses into the channel — worth confirming that matches your data-handling position before go-live.
- Read replica strongly preferred: a runaway name search then can't affect booking traffic.

---

## Alternative, if direct DB access is refused

Expose one authenticated endpoint on the Laravel app and write a third adapter (~60 lines, mirroring `src/gl/mysql.ts`):

```
POST /api/internal/booking-lookup
Authorization: Bearer <service token>

{ "mode": "name",
  "query": "Raynard Hayes",
  "from": "2026-08-25", "to": "2026-09-08",
  "course_ids": [12] }

→ { "bookings": [ { id, name, lname, email, course_id,
                    location_id, course_start_date, result, attendance } ] }
```

Modes needed: `id`, `email`, `name`, `trainer_events`, `bookings_on_events`. Same five operations as the `GLClient` interface in `src/gl/types.ts` — that file is the contract.
