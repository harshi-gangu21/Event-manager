# Gather — Event Management Application

Gather is a full-stack event discovery & ticket-booking platform. Browse live events,
create an account, pay securely with Razorpay, and get an instant email confirmation —
with PostgreSQL backing every booking.

**Live demo:** Frontend on Netlify · Backend API on Render (free tier)

**Documentation:** [Build, configuration, and deployment guide](#local-setup) · [Feature navigation guide](./FEATURE_GUIDE.md)

---

## ✨ Feature Highlights

### Core (hackathon rubric)
| Rubric item | Where it lives |
|---|---|
| **Attractive frontend** (15M) | `src/App.jsx` + `src/styles.css` — animated hero, category filters, search, event cards, modals, ticket-stub confirmation, live stats bar |
| **Database integration** (15M) | PostgreSQL — `server/db.js` auto-creates & seeds `events`, `users`, `orders`, `bookings` on startup |
| **Signup & SignIn** (15M) | `POST /api/auth/signup` + `/api/auth/login`; salted scrypt password hashes, JWT bearer tokens, rate-limited failed sign-in attempts |
| **Payment implementation** (15M) | Razorpay order creation + server-side HMAC signature verification |
| **Notification mail** (15M) | Nodemailer styled HTML booking confirmation + retry queue for failed sends |
| **Deployment** (15M) | Netlify (frontend) + Render (backend + free Postgres) |

### 🆕 Five Creative Extras (to wow the panel)

1. **🔴 Live Stats Strip** — a bar above the event grid showing events, tickets sold (from the database), and cities covered, with a pulsing "updating live" indicator. It refreshes when the page loads and after a booking in this browser; it is not a push-updated feed.

2. **♥ Wishlist with Heart Animation** — tap the floating heart on any event card to save it. Hearts pop with a spring animation; a Wishlist toggle in the header (with live count badge) filters the grid to only your saved events. Persists across reloads via `localStorage`.

3. **🌤️ Weather Vibe Chips** — every event card shows a playful weather "vibe" chip (☀️ *Sunny skies likely*, 🌙 *Clear evening ahead*) derived deterministically from the event's date and day-of-week — a tiny detail that makes cards feel alive.

4. **🎉 Group-Deal Nudge + Capacity Fill Bar** — booking 3+ tickets triggers a celebratory "Group deal unlocked" banner inside checkout. Every card also has a purple gradient fill-bar showing what % of capacity is already sold — social proof at a glance.

5. **🎊 Confirmation Confetti** — after a successful payment, the confirmation modal erupts in a burst of multi-colour CSS confetti before settling into the ticket stub. Pure CSS, zero dependencies, pure delight.

Plus city-based filtering (dropdown next to search) and emoji category chips (🎨 Creative, 🎧 Music…) for faster scanning.

The floating **Ask Gather** assistant answers event questions using current database listings and the server-side Groq API; it cannot complete bookings for you.

---

## Architecture Overview

```
event managment/
├── server/                    # Production backend (used by Render)
│   ├── index.js               # Express API: auth (JWT), events, Razorpay, Nodemailer
│   ├── db.js                  # pg Pool + schema init + event seeding
│   ├── initialEvents.js       # Seed catalog of 10 curated events
│   └── data/store.json        # (legacy, gitignored)
│
├── backend/                   # Alternate/legacy backend implementation
│   ├── index.js               # Not used by the current deployment
│   ├── db.js
│   ├── initialEvents.js
│   └── .env                   # Backend secrets (gitignored)
│
├── src/                       # Frontend (Vite + React 19)
│   ├── App.jsx                # All UI, filtering, wishlist, Razorpay checkout
│   ├── main.jsx
│   └── styles.css             # Design system + animations
│
├── index.html                 # Vite entry (fonts, meta)
├── netlify.toml               # Netlify build settings + SPA fallback
├── render.yaml                # Render Blueprint: web service + free Postgres
├── vite.config.js             # Dev proxy /api → localhost:4000
├── .env                       # Root secrets (gitignored)
├── .env.example               # Template
└── package.json               # Root scripts (dev both, build, preview)
```

The active backend used by the current deployment is `server/`. The `backend/` folder is an alternate/legacy implementation; the two implementations should not be assumed interchangeable. The scripts and instructions in this guide target `server/`.

---

## Requirements

- **Node.js** 24 or newer (matches `package.json` and deployment settings)
- **PostgreSQL** 14+ running locally (or Render's free managed Postgres in prod)
- **Razorpay** test API keys ([dashboard](https://dashboard.razorpay.com) → Settings → API Keys)
- **SMTP** credentials (e.g. Gmail App Password) for confirmation emails

---

## Local Setup

### 1. PostgreSQL
```sql
CREATE DATABASE eventmanagment;
```
Tables & seed events are created automatically on first server start.

### 2. Environment — `.env` at repository root
If you do not already have a root `.env`, copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`), then fill in local settings. Open the root `.env` in VS Code to edit it. Do not overwrite an existing `.env` if it already contains working local settings. The root `.env` is ignored by Git and must never be committed.
```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

PGHOST=localhost
PGPORT=5432
PGDATABASE=eventmanagment
PGUSER=postgres
PGPASSWORD=your_db_password

JWT_SECRET=any-long-random-string

RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxx

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM="Gather Events <your-email@gmail.com>"

GROQ_API_KEY=your_rotated_groq_api_key
```
(See `.env.example` for the template.)

The Groq key is used only by the backend event assistant. If a key has been pasted into a chat, source file, screenshot, or repository, revoke it at Groq and use a newly generated key. Put the replacement only in the ignored root `.env` locally and in Render's backend environment settings in production. Never use a `VITE_*` variable for a secret.

#### Environment variables: what goes where

| Variable | Local `.env` | Render API service | Netlify frontend | Purpose |
|---|---:|---:|---:|---|
| `PORT` | `4000` | Render configures the listener | — | API listener port |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Required for local PostgreSQL | — | — | Local database connection; ignored when `DATABASE_URL` is set |
| `DATABASE_URL` | Optional | Supplied by the Render Postgres link in `render.yaml` | — | Production database connection |
| `JWT_SECRET` | Required; use a long random value | Generated by the Render Blueprint | — | Signs user access tokens |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Required for payment | Required | — | Payment order creation and signature verification |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Required for email | Required for email | — | Sends booking confirmation mail |
| `GROQ_API_KEY` | Required for chatbot | Required for chatbot | **Never** | Server-side Groq authentication |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Exact deployed Netlify origin | — | CORS allow-list for browser requests to the API |
| `VITE_API_BASE` | Usually unset; Vite proxies `/api` | — | Render API origin, e.g. `https://gather-api-xxxx.onrender.com` | Frontend API base URL; contains no secret |

`SMTP_FROM` should be an address accepted by your mail provider, such as `Gather Events <tickets@example.com>`. For Gmail, create an App Password and use that for `SMTP_PASS`; do not use your normal account password.

### 3. Install & run
```bash
npm install
npm run dev        # API on :4000 + Vite dev server on :5173
```
Or separately:
```bash
npm run server     # API only
npm run client     # Frontend only
```

### 4. Production build
```bash
npm run build      # outputs static bundle to dist/
npm run preview    # serve dist locally
```

---

## Code Structure Explained

### `server/index.js` — the REST API
| Section | What it does |
|---|---|
| **Auth middleware** | `authenticate` verifies the `Authorization: Bearer <jwt>` header, decodes `{ sub, email, name }` onto `request.user`. Invalid → 401. |
| **Rate limiting** | Per-IP window for failed sign-in attempts and a separate per-IP chatbot request limit. |
| **`GET /api/health`** | `{ status, database }` — used by Render health checks. |
| **`POST /api/auth/signup`** | Validates name/email/password (min 10 chars), creates a random salt and scrypt hash, inserts the user, and returns a signed JWT. |
| **`POST /api/auth/login`** | Verifies the stored password hash (supports legacy bcrypt hashes as well as current scrypt hashes), returns a JWT (7-day expiry). |
| **`GET /api/events`** | Events + live `ticketsSold` (SUM over bookings) via correlated subquery. |
| **`POST /api/orders`** | Capacity check = sold + reserved(15-min window) + requested ≤ capacity. Creates Razorpay order, persists it, returns `{ orderId, amount, keyId, eventName }`. |
| **`POST /api/payments/verify`** | Recomputes HMAC-SHA256 of `order_id|payment_id` with the key secret and compares in constant time. On match: inserts the booking, marks the order paid, and attempts the confirmation email. A repeated verification returns the existing booking and retries email when needed. |
| **`GET /api/bookings`** | Signed-in user's bookings (matched by attendee email), newest first. |
| **`POST /api/chat`** | Validates message/history, rate-limits requests, retrieves up to 8 matching events from PostgreSQL, then sends that event subset and recent context to Groq. Returns `{ reply }`. |
| **Error handler** | Catches malformed JSON → 400; unexpected errors are logged server-side and return a generic 500. |

### `server/db.js` — schema & connection
- Connection string from `DATABASE_URL` (production) **or** discrete `PG*` vars (local).
- `initDb()` runs `CREATE TABLE IF NOT EXISTS` for `events`, `users`, `orders`, `bookings`, then upserts the 10 seed events.
- Unsent booking confirmation emails are queried and retried when the API starts; each booking stores `email_status` and `email_sent_at`.

The main persisted fields are:

| Table | Important fields and behavior |
|---|---|
| `users` | UUID `id`, `name`, unique `email`, `password_salt`, `password_hash`, `created_at`. |
| `events` | Text `id`, title/category/date/time/venue, integer price and capacity, description/image/accent. Seed rows are inserted on startup. |
| `orders` | Razorpay order ID, event/user references, quantity, amount in paise, status, and creation time. Recent `creating`/`created` orders count as temporary reservations during availability checks. |
| `bookings` | Unique booking reference and unique order reference, payment ID, event, quantity, amount, attendee name/email, email status and sent time, creation time. |

### Booking, payment, and email sequence

1. The visitor signs in; the frontend stores the JWT in browser `localStorage` under `gather_jwt`.
2. The visitor selects a ticket quantity and enters attendee name/email in `BookingModal`.
3. The frontend calls `POST /api/orders` with the JWT. The API checks already-sold tickets and recent open orders, then creates a Razorpay order and persists it.
4. Razorpay Checkout collects payment. The browser sends the returned order/payment/signature plus attendee details to `POST /api/payments/verify`.
5. The backend validates the payment signature before writing the booking, then attempts a confirmation email using SMTP settings.
6. The response includes booking and email status. The confirmation view always displays the booking reference. On a later API start, rows whose email status is not `sent` are retried.

The database schema is created by `server/db.js`: `users` holds unique emails and password hashes; `events` holds the event catalog and capacity; `orders` records Razorpay orders and reservation state; `bookings` records attendee/payment details and mail delivery state. Seed events are inserted only when their IDs do not already exist. Editing `initialEvents.js` therefore does not overwrite existing catalog rows.

### `src/App.jsx` — single-file frontend
| Component | Responsibility |
|---|---|
| `EventCard` | Card UI: image, category tag + emoji, "Only N left" / "Sold out" ribbon, wishlist heart, fill bar, vibe chip, price, book button. |
| `BookingModal` | Quantity picker (1–10, capped by remaining), attendee details, group-deal banner, opens Razorpay checkout. |
| `AuthModal` | Login/Signup toggle; on success stores JWT in `localStorage`. |
| `Confirmation` | Confetti burst + ticket stub (event, date, venue, qty, booking ref) + email-status note. |
| `App` | State hub: events, filters (category / city / search / wishlist-only), live stats, auth, booking flow. All fetches go through `apiUrl()` which prepends `VITE_API_BASE` in production (empty in dev — Vite proxies). |
| `ChatWidget` | Floating event assistant; sends recent conversation context to `POST /api/chat`. |

### `src/styles.css` — the design system
CSS variables (`--ink`, `--paper`, `--purple`…), Manrope + DM Sans, keyframe animations (`appear`, `spin`, `pulse`, `heartpop`, `confetti-fall`, `livepulse`) and three responsive breakpoints (1450px / 1000px / 700px).

### Frontend and service behavior

- `src/main.jsx` mounts the React application into `#root` and imports the global stylesheet. `index.html` supplies the page title, description, theme color, and Google Fonts links (DM Sans and Manrope).
- `src/App.jsx` owns event loading, derived city options, category/city/search/wishlist filtering, account state, modal state, and the booking confirmation view. Event data comes from `GET /api/events`; UI filters are applied in the browser.
- The booking dialog loads Razorpay Checkout on demand, prefills attendee details, reports payment errors in the dialog, and only displays a confirmed ticket after the backend verification response.
- Local authentication uses a signed bearer token in `localStorage` (`gather_jwt`); wishlist event IDs are separately stored under `gather_wishlist`. Neither is a server-side browser session.
- `src/ChatWidget.jsx` sends a message and up to 10 recent chat messages to the API. Conversation history lives only in the open browser tab and is not saved to the database.
- The chat API rejects oversized/invalid message data and limits requests per client IP in process memory. It extracts terms and common date/month/year/price filters, ranks matching event rows in PostgreSQL, and sends at most 8 relevant event records to Groq. The assistant is instructed to answer only from those records and to direct users to the booking flow; it does not execute bookings.
- Event availability shown to the chatbot accounts for bookings plus recent open orders. Availability may change between the reply and a later checkout.
- The "weather vibe" chip is a playful deterministic label calculated from the event date's weekday; it is not a forecast and does not call a weather service.
- The CSS uses custom properties and CSS animations for the card interactions, modal entrance, payment spinner, confetti, heartbeat, and live-status indicators. Responsive layouts are defined for desktop, tablet, and mobile, with a reduced-motion override.
- Chat inputs are limited to 1,200 characters; the API accepts a bounded recent history and uses up to 10 validated messages for model context. Its in-memory per-IP limiter allows 15 requests per minute per running API process. This limiter is not a shared/distributed quota across multiple server instances.

### Development scripts and build output

| Command | Behavior |
|---|---|
| `npm run dev` | Starts the watched Express API and Vite frontend together; the root `concurrently` process stops both if either process exits. |
| `npm run server` | Starts only `server/index.js`. |
| `npm run client` | Starts only Vite. Its `/api` development proxy targets `http://localhost:4000` unless `API_PROXY_TARGET` is set. |
| `npm run build` | Runs the Vite production build and writes static assets to `dist/`. |
| `npm run preview` | Serves the previously built frontend locally; it does not start the API. |

`package-lock.json` records the installed dependency tree. Commit it alongside `package.json` when dependencies change so CI and hosting install a reproducible dependency set. `dist/`, `node_modules/`, root `.env`, and server data are ignored by Git.

---

## Deployment Guide

### Backend → Render
1. Push this repository to GitHub and connect it to Render.
2. On [render.com](https://render.com), create a Blueprint from this repository or update the existing Blueprint.
3. `render.yaml` provisions/configures:
   - Web service `gather-api` (Node, free plan, `node server/index.js`)
   - PostgreSQL `gather-db` (free plan), wired into `DATABASE_URL`
   - Auto-generated `JWT_SECRET`
4. Open the `gather-api` service → **Environment** and add/update:
   - `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from Razorpay (use test keys while testing)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` from your mail provider
   - `GROQ_API_KEY` from Groq (create a new key if the previous one was exposed)
   - `CLIENT_ORIGIN` set to the exact deployed Netlify origin, with no path or trailing slash
5. If the Blueprint linked correctly, `DATABASE_URL` is supplied by Render Postgres and `JWT_SECRET` is generated. Confirm both appear in the service Environment page; do not copy local `.env` values into the repository.
6. Save changes and redeploy/restart the API. Render's health check calls `/api/health`.
7. Future Git pushes update the service only if automatic deploys are enabled. Pushing code does not copy your local `.env` into Render.

### Frontend → Netlify (free)
1. On [netlify.com](https://netlify.com): **Add new site → Import from Git** → pick the repo.
2. `netlify.toml` sets the build command (`npm run build`), publish directory (`dist`), Node 24, and SPA fallback.
3. Open **Site configuration → Environment variables** and add `VITE_API_BASE` with the Render API origin only, e.g. `https://gather-api-xxxx.onrender.com` (no trailing slash and no `/api` suffix).
4. Trigger a new deploy so Vite embeds the API base in the frontend build.
5. Future Git pushes can trigger automatic Netlify builds when Git deployment is enabled. A changed environment variable still needs a new build/deploy.

The current frontend reads `VITE_API_BASE` in `src/App.jsx` and makes direct cross-origin calls to Render. Render's `CLIENT_ORIGIN` must allow the Netlify site origin. Do not use the obsolete `API_BASE_URL` redirect approach; the current `netlify.toml` does not proxy API calls.

> **⚠️ Render free tier sleeps** after ~15 min idle — first request takes ~30s to wake.
> Hit `/api/health` in a tab before demoing.

### Verifying the deployment works
```bash
curl https://YOUR-RENDER-URL/api/health
# → {"status":"ok","database":"connected"}

curl https://YOUR-RENDER-URL/api/events
# → [ ...10 seeded events... ]
```
Then in the browser: sign up → book → pay with Razorpay test card → confirmation + email.

---

## User Guide

### For visitors
1. **Browse** — open the site. No login needed. Filter by category chips, city dropdown, or search box.
2. **Save for later** — tap the ♡ on any card. Toggle **Wishlist** in the header to see only those.
3. **Check the vibe** — every card shows a capacity fill bar and a decorative weekday-based vibe label (not a weather forecast).
4. **Sign in / Sign up** — sign in before checkout. New passwords must be at least 10 characters. After successful authentication, the browser keeps a 7-day JWT in localStorage.
5. **Book** — click **Get tickets** → pick quantity (group-deal message appears at 3+, with no discount) → enter attendee name and email → **Continue to secure payment**.
6. **Pay** — Razorpay checkout opens. In Razorpay test mode, use a test payment method from the Razorpay dashboard, not a live payment card.
7. **Celebrate** — confetti! Your ticket stub shows the booking reference. A confirmation email is sent when SMTP is configured; the reference remains valid even when email delivery fails.
8. **Booking history** — the backend exposes `GET /api/bookings` for the signed-in user's history; there is not currently a booking-history panel in the website UI.

### For the demo panel (5-minute script)
1. Open the site → point out the **live stats strip** and pulsing "updating live" dot.
2. Filter by a category → show the emoji chips and **city dropdown**.
3. Heart two events → toggle **Wishlist** → hearts filter the grid.
4. Book 3+ tickets → highlight the **group-deal banner** and **fill bar**.
5. Complete a Razorpay test payment using test-mode credentials from the Razorpay dashboard → **confetti** + ticket stub + confirmation email (when SMTP is configured).
6. Refresh → still signed in. Show DevTools → Application → Local Storage → `gather_jwt`.
7. Wrap up: "Every number on that stats bar came straight from Postgres."

---

## API Endpoints Reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Health check (`{ status, database }`) |
| POST | `/api/auth/signup` | — | Create account → `{ token, user }` |
| POST | `/api/auth/login` | — | Sign in → `{ token, user }` |
| GET | `/api/auth/me` | JWT | Current user from token |
| POST | `/api/auth/logout` | JWT | Client-side token discard |
| GET | `/api/events` | — | Events with live `ticketsSold` |
| POST | `/api/orders` | JWT | Razorpay order (capacity-checked) |
| POST | `/api/payments/verify` | — | Verify HMAC, create booking, send email |
| GET | `/api/bookings` | JWT | Signed-in user's bookings |
| POST | `/api/chat` | — | Answer event questions using current listings |

The API accepts JSON request bodies (limited to 20 KB). Authentication-protected endpoints receive `Authorization: Bearer <JWT>`. The frontend receives the public Razorpay key ID as part of order creation; the Razorpay secret, SMTP password, JWT signing secret, and Groq key remain server-side.

---

## Security Notes
- Passwords: new registrations use random-salt scrypt hashes; legacy bcrypt hashes remain verifiable. Passwords are never stored or logged in plain text.
- Payments: HMAC-SHA256 verified server-side with `timingSafeEqual` — a forged signature can't create a booking.
- Rate limiting: failed sign-in attempts are limited per IP; chatbot requests have a separate in-memory limit.
- Capacity: checks sold tickets plus recent open reservations before order creation, then rechecks sold tickets during payment verification.
- Secrets: `.env` / `backend/.env` gitignored; Render injects them at deploy time.
- Chatbot: Groq API key stays on the server; chat requests are rate-limited and event facts come from current database records.
- Idempotency: re-verifying a paid order returns the original booking, never double-books.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| API calls fail from the deployed site | Set Netlify `VITE_API_BASE` to the Render API origin, set Render `CLIENT_ORIGIN` to the exact Netlify origin, then redeploy both services. |
| `JWT_SECRET is missing` on boot | Add `JWT_SECRET` to `.env` (Render: auto-generated by Blueprint). |
| `foreign key constraint ... incompatible types` | Old tables from a previous schema exist. Drop & recreate: `DROP TABLE bookings, orders, sessions, users, events CASCADE;` then restart the server. |
| Razorpay 503 "Payments are not configured" | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` not set in the server env. |
| Emails not arriving | Check `SMTP_*` vars; Gmail requires an App Password (not your login password). Modal will say "not configured" if unset. |
| Event assistant is not configured | Set `GROQ_API_KEY` in the local root `.env` or Render API service environment; keep the key server-side and restart/redeploy. |
| First request slow on Render | Free tier cold start (~30 s). Warm up with `/api/health` before the demo. |

---

## Tech Stack
**Frontend:** React 19, Vite 8, hand-rolled CSS (no UI kit)
**Backend:** Node 24+, Express 5, Razorpay SDK, Nodemailer, OpenAI-compatible SDK for Groq, bcryptjs, jsonwebtoken
**Database:** PostgreSQL 14+
**Infra:** Netlify (static frontend), Render (API + managed Postgres)

---

*Made for the moments that matter.* ✳
