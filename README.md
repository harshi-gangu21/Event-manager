# Gather — Event Management Application

Gather is a full-stack event discovery & ticket-booking platform. Browse live events,
create an account, pay securely with Razorpay, and get an instant email confirmation —
with PostgreSQL backing every booking.

**Live demo:** Frontend on Netlify · Backend API on Render (free tier)

---

## ✨ Feature Highlights

### Core (hackathon rubric)
| Rubric item | Where it lives |
|---|---|
| **Attractive frontend** (15M) | `src/App.jsx` + `src/styles.css` — animated hero, category filters, search, event cards, modals, ticket-stub confirmation, live stats bar |
| **Database integration** (15M) | PostgreSQL — `server/db.js` auto-creates & seeds `events`, `users`, `orders`, `bookings` on startup |
| **Signup & SignIn** (15M) | `POST /api/auth/signup` + `/api/auth/login`; scrypt-hashed passwords, HMAC session tokens, rate-limited to 10 attempts / 15 min |
| **Payment implementation** (15M) | Razorpay order creation + server-side HMAC signature verification |
| **Notification mail** (15M) | Nodemailer styled HTML booking confirmation + retry queue for failed sends |
| **Deployment** (15M) | Netlify (frontend) + Render (backend + free Postgres) |

### 🆕 Five Creative Extras (to wow the panel)

1. **🔴 Live Stats Strip** — a real-time bar above the event grid showing *live events*, *tickets sold* (pulled straight from the DB), and *cities covered*, with a pulsing "updating live" indicator. Every booking instantly updates the numbers.

2. **♥ Wishlist with Heart Animation** — tap the floating heart on any event card to save it. Hearts pop with a spring animation; a Wishlist toggle in the header (with live count badge) filters the grid to only your saved events. Persists across reloads via `localStorage`.

3. **🌤️ Weather Vibe Chips** — every event card shows a playful weather "vibe" chip (☀️ *Sunny skies likely*, 🌙 *Clear evening ahead*) derived deterministically from the event's date and day-of-week — a tiny detail that makes cards feel alive.

4. **🎉 Group-Deal Nudge + Capacity Fill Bar** — booking 3+ tickets triggers a celebratory "Group deal unlocked" banner inside checkout. Every card also has a purple gradient fill-bar showing what % of capacity is already sold — social proof at a glance.

5. **🎊 Confirmation Confetti** — after a successful payment, the confirmation modal erupts in a burst of multi-colour CSS confetti before settling into the ticket stub. Pure CSS, zero dependencies, pure delight.

Plus city-based filtering (dropdown next to search) and emoji category chips (🎨 Creative, 🎧 Music…) for faster scanning.

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
├── backend/                   # Alternate backend build (sessions + cookies)
│   ├── index.js               # Same endpoints, session-cookie auth, email retry loop
│   ├── db.js                  # Schema init + Razorpay/SMTP helpers
│   ├── initialEvents.js
│   └── .env                   # Backend secrets (gitignored)
│
├── src/                       # Frontend (Vite + React 19)
│   ├── App.jsx                # All UI, filtering, wishlist, Razorpay checkout
│   ├── main.jsx
│   └── styles.css             # Design system + animations
│
├── index.html                 # Vite entry (fonts, meta)
├── netlify.toml               # Netlify build + /api proxy to Render
├── render.yaml                # Render Blueprint: web service + free Postgres
├── vite.config.js             # Dev proxy /api → localhost:4000
├── .env                       # Root secrets (gitignored)
├── .env.example               # Template
└── package.json               # Root scripts (dev both, build, preview)
```

### Two identical-API backends?

- **`server/`** — the one Render deploys. JWT-in-`localStorage` auth. Simpler for cross-origin Netlify→Render calls.
- **`backend/`** — session-cookie variant with an email retry-on-boot loop. Run it locally if you prefer cookies.

Both expose the same REST surface, so the frontend works with either.

---

## Requirements

- **Node.js** 20+
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

### 2. Environment — `.env` at repo root
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
```
(See `.env.example` for the template.)

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
| **Rate limiting** | Per-IP sliding window (10 failures / 15 min) on signup & login. |
| **`GET /api/health`** | `{ status, database }` — used by Render health checks. |
| **`POST /api/auth/signup`** | Validates name/email/password (min 10 chars), bcrypt-hashes (cost 12), inserts user, returns signed JWT. |
| **`POST /api/auth/login`** | Verifies bcrypt hash with `timingSafeEqual`, returns JWT (7-day expiry). |
| **`GET /api/events`** | Events + live `ticketsSold` (SUM over bookings) via correlated subquery. |
| **`POST /api/orders`** | Capacity check = sold + reserved(15-min window) + requested ≤ capacity. Creates Razorpay order, persists it, returns `{ orderId, amount, keyId, eventName }`. |
| **`POST /api/payments/verify`** | Recomputes HMAC-SHA256 of `order_id|payment_id` with the key secret, compares in constant time. On match: inserts booking, marks order paid, fires confirmation email. Idempotent — replays return the existing booking. |
| **`GET /api/bookings`** | Signed-in user's bookings (matched by attendee email), newest first. |
| **Error handler** | Catches malformed JSON → 400; anything else → logged + generic 500. |

### `server/db.js` — schema & connection
- Connection string from `DATABASE_URL` (production) **or** discrete `PG*` vars (local).
- `initDb()` runs `CREATE TABLE IF NOT EXISTS` for `events`, `users`, `orders`, `bookings`, then upserts the 10 seed events.

### `src/App.jsx` — single-file frontend
| Component | Responsibility |
|---|---|
| `EventCard` | Card UI: image, category tag + emoji, "Only N left" / "Sold out" ribbon, wishlist heart, fill bar, vibe chip, price, book button. |
| `BookingModal` | Quantity picker (1–10, capped by remaining), attendee details, group-deal banner, opens Razorpay checkout. |
| `AuthModal` | Login/Signup toggle; on success stores JWT in `localStorage`. |
| `Confirmation` | Confetti burst + ticket stub (event, date, venue, qty, booking ref) + email-status note. |
| `App` | State hub: events, filters (category / city / search / wishlist-only), live stats, auth, booking flow. All fetches go through `apiUrl()` which prepends `VITE_API_BASE` in production (empty in dev — Vite proxies). |

### `src/styles.css` — the design system
CSS variables (`--ink`, `--paper`, `--purple`…), Manrope + DM Sans, keyframe animations (`appear`, `spin`, `pulse`, `heartpop`, `confetti-fall`, `livepulse`) and three responsive breakpoints (1450px / 1000px / 700px).

---

## Deployment Guide

### Backend → Render (free)
1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint** → select the repo.
3. `render.yaml` auto-provisions:
   - Web service `gather-api` (Node, free plan, `node server/index.js`)
   - PostgreSQL `gather-db` (free plan), wired into `DATABASE_URL`
   - Auto-generated `JWT_SECRET`
4. In the dashboard → **Environment**, fill in:
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - `CLIENT_ORIGIN` → your Netlify URL (e.g. `https://your-site.netlify.app`)
5. Deploy. Health check hits `/api/health`.

### Frontend → Netlify (free)
1. On [netlify.com](https://netlify.com): **Add new site → Import from Git** → pick the repo.
2. `netlify.toml` already sets build command (`npm run build`), publish dir (`dist`), Node 20.
3. **Site settings → Environment variables**, add:
   - `API_BASE_URL` = your Render URL, e.g. `https://gather-api-xxxx.onrender.com`
     (the `netlify.toml` redirect proxies `/api/*` → `$API_BASE_URL/api/*`, so no CORS headaches)
4. Deploy. Any push to `main` auto-redeploys.

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
1. **Browse** — open the site. No login needed. Filter by category chips, city dropdown, or search box (⌘K to focus).
2. **Save for later** — tap the ♡ on any card. Toggle **Wishlist** in the header to see only those.
3. **Check the vibe** — every card shows a capacity fill-bar and a weather-vibe chip.
4. **Book** — click **Get tickets** → pick quantity (group-deal banner appears at 3+) → enter name & email → **Continue to secure payment**.
5. **Pay** — Razorpay checkout opens. Test card: `4111 1111 1111 1111`, any future expiry, any CVV.
6. **Celebrate** — confetti! Your ticket stub shows the booking reference `GTH-XXXXXXXX`. A confirmation email lands in your inbox (or the modal tells you if email isn't configured — the reference still works for check-in).
7. **Sign in / Sign up** — password min 10 chars. After signup you're automatically signed in; refresh keeps you logged in (JWT in localStorage, 7-day expiry).
8. **My bookings** — signed-in users see their purchase history via `GET /api/bookings`.

### For the demo panel (5-minute script)
1. Open the site → point out the **live stats strip** and pulsing "updating live" dot.
2. Filter by a category → show the emoji chips and **city dropdown**.
3. Heart two events → toggle **Wishlist** → hearts filter the grid.
4. Book 3+ tickets → highlight the **group-deal banner** and **fill bar**.
5. Pay with the test card → **confetti** + ticket stub + email arriving live.
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

---

## Security Notes
- Passwords: bcrypt (cost 12), never stored or logged in plain text.
- Payments: HMAC-SHA256 verified server-side with `timingSafeEqual` — a forged signature can't create a booking.
- Rate limiting: 10 failed auth attempts per IP per 15 minutes.
- Capacity: oversell-safe — sold + reserved + requested checked atomically before every order & verification.
- Secrets: `.env` / `backend/.env` gitignored; Render injects them at deploy time.
- Idempotency: re-verifying a paid order returns the original booking, never double-books.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `404` on `/api/auth/signup` from the deployed site | Netlify env var `API_BASE_URL` missing/wrong — set it to your Render URL (no trailing slash) and redeploy. |
| `JWT_SECRET is missing` on boot | Add `JWT_SECRET` to `.env` (Render: auto-generated by Blueprint). |
| `foreign key constraint ... incompatible types` | Old tables from a previous schema exist. Drop & recreate: `DROP TABLE bookings, orders, sessions, users, events CASCADE;` then restart the server. |
| Razorpay 503 "Payments are not configured" | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` not set in the server env. |
| Emails not arriving | Check `SMTP_*` vars; Gmail requires an App Password (not your login password). Modal will say "not configured" if unset. |
| First request slow on Render | Free tier cold start (~30 s). Warm up with `/api/health` before the demo. |

---

## Tech Stack
**Frontend:** React 19, Vite 8, hand-rolled CSS (no UI kit)
**Backend:** Node 20, Express 5, Razorpay SDK, Nodemailer, bcryptjs, jsonwebtoken
**Database:** PostgreSQL 14+
**Infra:** Netlify (static frontend + API proxy), Render (API + managed Postgres)

---

*Made for the moments that matter.* ✳
