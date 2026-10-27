# NISMCAA Meeting Room

A private members area for NISMCAA volunteers: sign-up with photo, volunteer course, 50-question final test,
administrator approval, unique volunteer ID and downloadable ID card with QR code, public ID check page,
and a Meeting Room (call link, chat, notes, action plan, work logs, head remarks).

**Status: built and tested on a test machine only. NOT deployed anywhere. Nothing here touches nismcaa.com.**
Test data in this folder is fake (`@example.test` e-mails). The only business phone is (470) 739-0021.

* Stack: Node.js 20 or 22, Express 5, SQLite (`better-sqlite3`), server-rendered EJS pages (no front-end framework), mobile friendly.
* **No e-mail service of any kind.** Own sign-in (e-mail as ID + scrypt-hashed password), no Google/OpenAI login.
* Cost: **$0** to build, test and run locally. Hosting costs are in "Deploy on Render" below.

---

## 1. Run it on your computer (free)

```bash
npm install            # or: npm ci
npm start              # http://localhost:3000   (database in ./data_local)
```

On the **first start** the server creates the two administrator accounts **without passwords** and prints two
**one-time claim codes** to the console. They are also saved (mode 600) in `DATA_DIR/ADMIN_CLAIM_CODES.txt`, outside the web folder.
Each administrator opens `/admin/claim`, types their own e-mail, their code and chooses a password.
When both have claimed, the page switches itself off and the code file is deleted. No password is written in the code.

### Settings (environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | port to listen on | 3000 |
| `DATA_DIR` | folder with `meeting_room.sqlite`, claim-code file | `./data_local` |
| `PUBLIC_URL` | public address, used inside ID-card QR codes | the visitor's own address |
| `NODE_ENV` | `production` turns on `Secure` cookies and proxy trust | development |
| `ADMIN_EMAILS` | comma list of the administrator e-mails | `interschoolmusic@gmail.com,abisade@nismcaa.com` |
| `SCRYPT_N` | password-hash cost (tests lower it) | 16384 |

See `.env.example`.

## 2. Tests

```bash
npm test               # node --test test/
```

69 tests, all passing at the time of writing. They cover: sign-up, sign-in, wrong password, hashing (no plain text in the DB),
CSRF, login lockout, session rotation, the pass rule (80% overall AND 9 of 10 on questions 41-50, boundary cases), "pending key"
(nobody can pass without the key), approval, ID uniqueness (IDs are never reused), country lock, privacy of photos and of the waiting list,
the public verify page (shows only name, role, country, validity), chat country isolation, notes privacy, action-plan import (Nigeria's 222 tasks,
per-department counts), behind-schedule flag rules, ID card PNG with a QR code that decodes to the right address, and house rules
(no old phone number, no outside scripts, no outgoing network calls, US spelling in the site's own text).

The test file `test/fixtures/fake_key.json` is a clearly labeled **FAKE** answer key, used only by tests and the demo.
The real database starts with an **empty** key.

## 3. Demo with fake people and screenshots

```bash
npm run demo:seed      # writes ./demo-data (refuses any other folder name)
npm run demo:start     # http://localhost:3500
npm run screenshots    # needs python3 + playwright + chromium; saves PNGs in ./screenshots
```
Demo admin: `interschoolmusic@gmail.com` / `Demo-Admin-Password-1`; demo volunteers use `Demo-Password-123`
(for example `ada.us@example.test`, `chioma.ng@example.test`). They exist only in `demo-data/`.

## 4. How the pieces work

| Folder / file | What it does |
|---|---|
| `server.js` | starts the app |
| `src/config.js` | settings, country and department lists |
| `src/db.js` | database tables, first-start seed, ID counter |
| `src/security.js` | password hashing (scrypt), sessions, CSRF, rate limits |
| `src/access.js` | who may see what (every route checks on the server) |
| `src/content.js` | reads `content/COURSE_TEXT.txt` into course pages and the 50 questions |
| `src/plan.js` | imports `data/ACTION_PLAN_10th_Edition.xlsx`, flag rules, roll-ups |
| `src/idcard.js` | ID card PNG and PDF, QR code |
| `src/routes/*.js` | pages: sign-up/in, course/test, admin, meeting room, action plan |
| `views/` | EJS page templates; `public/` CSS and the small chat script |

Key rules:
* **Pass** = score x 100 >= 80 x 50 (so 40 of 50) **and** at least 9 of the 10 child-protection questions (41-50). Until all 50 answers are in the key, results are "pending" and **nobody can pass**; attempts are saved and graded later with the admin button.
* **Volunteer IDs** look like `NISMCAA-VOL-0001`, come from an auto-increment table and are never reused. The card is valid 1 year; an admin can renew, decline renewal or end it.
* **Photos** are re-encoded to a 600x600 JPEG (metadata removed), stored in the data folder, and served only to the owner and administrators.
* **Flags**: time used = (today - start) / (deadline - start), limited to 0-100%. Points behind = time used - progress. Red = past deadline or 30+ points behind; amber = 15-29 behind; green = Done; "Not flagged" = no dates or On hold. Same rules as the workbook.
* **Chat** is plain text, refreshed every 10 seconds, 5 messages per 10 seconds, admins can delete.
* **Security**: HttpOnly SameSite cookies, CSRF token on every form, 5 failed sign-ins lock that e-mail for 15 minutes, per-address limits on sign-up/sign-in/verify, strict Content-Security-Policy, no outside resources, no analytics, the server makes no outgoing network calls.

## 5. Deploy on Render later (NOT done; needs John's yes)

`render.yaml` is a Render Blueprint. **Do not deploy real volunteers on the free plan.**

| Version | What | Cost |
|---|---|---|
| **Test** (as written in `render.yaml`) | free web service. Sleeps after 15 min idle (about 1 minute to wake). **The disk is temporary: the database and photos are erased on every restart or redeploy.** Fake data only. | **$0** |
| **Real, simple** | web service `starter` (always on) **+ 1 GB persistent disk** for SQLite and photos. Uncomment the `disk:` block, `DATA_DIR=/var/data`. | **about $7 + $0.25 = $7.25 a month** |
| **Real, Postgres** | web `starter` $7 + Postgres $6 | about $13 a month. **Needs a code port first** (below). |

Prices are what Render showed on Oct 27, 2026; check render.com/pricing before upgrading. A disk makes the app a single instance (no scaling), which is fine for this size.
Take the CSV exports (Admin > Dashboard) regularly as your own backup.

Steps when approved: push this folder to a private GitHub repo, Render > New > Blueprint, choose the repo, set `PUBLIC_URL`,
deploy, read the two claim codes from the Render **Logs** (they are also in `/var/data/ADMIN_CLAIM_CODES.txt`), and have John and Abisade claim their accounts right away.
To use `meeting.nismcaa.com`, add the domain in the Render dashboard; Render then shows the exact DNS record to add where the domain is managed. Nothing was changed at nismcaa.com.
The "Back to nismcaa.com" link is already in the header.

### Moving to Postgres
All SQL is in `src/db.js` and `src/routes/*.js`, written in simple SQLite style. A port means: replace `better-sqlite3` with `pg`, make handlers `async`, change `?` placeholders to `$1`, `INTEGER PRIMARY KEY AUTOINCREMENT` to `GENERATED ... AS IDENTITY`, and move photos into the database (bytea) because Render's web disk is not shared. This is a few days of work and is **not done**.

## 6. How admins use it
See **HOW_TO_USE.md** (volunteers and administrators, in plain words). Short version: claim account, enter the answer key (**Admin > Answer key**), check **Waiting for approval**, approve with country and department (the ID is issued), assign heads, set the call link in **Settings**, watch the **Global roll-up**.

## 7. Open items and decisions for John

1. **The answer key is missing.** Until it is entered, nobody can pass. (Admin > Answer key; paste `1:B` lines.)
2. The **course text says "event-specific ID"** in places, which conflicts with the 1-year card in the spec. Text kept exactly as supplied; please decide.
3. The course text keeps the British spellings it was supplied with (e.g. "recognising"). The site's own text is US English.
4. There is **no pledge/code-of-conduct checkbox** at sign-up. Recommended to add one (child safety).
5. **Expired ID blocks Meeting Room access** until renewed (decision I made; easy to change).
6. A volunteer sees only their own work-log entries; the head and admins see all.
7. No "forgot password" e-mail (no e-mail service). An admin resets it and gives a one-time temporary password.
8. People who pick "My country isn't listed" are on an interest list; an admin must assign a supported country before they can take the test.
9. The free Render plan loses data on restart: test only.
10. Only the two seeded administrators exist; changing who they are means setting `ADMIN_EMAILS` before the first start.
