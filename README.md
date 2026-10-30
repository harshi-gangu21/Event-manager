# Gather — Event Management Application

Gather is a full-stack event discovery and ticket-booking application built for the
90-mark hackathon rubric: polished React UI, PostgreSQL, JWT auth, Razorpay payments,
Nodemailer email notifications, and Netlify deployment.

---

## Rubric Coverage

| Rubric item | Where it lives |
|---|---|
| Attractive frontend (15M) | `src/App.jsx` + `src/styles.css` — animated hero, category filters, search, event cards, modals, ticket-stub confirmation |
| Database integration (15M) | PostgreSQL — `server/db.js` creates and seeds `events`, `users`, `orders`, `bookings` tables on startup |
| Signup & SignIn with JWT (15M) | `POST /api/auth/signup` and `/api/auth/login` return signed JWTs (bcrypt-hashed passwords); protected routes verify the `Authorization: Bearer` header |
| Payment implementation (15M) | Razorpay order creation (`POST /api/orders`) + server-side HMAC signature verification (`POST /api/payments/verify`) |
| Notification mail (15M) | Nodemailer sends a styled HTML booking confirmation after successful payment |
| Deployment (15M) | Netlify (frontend, `netlify.toml`) + Render (backend + Postgres, `render.yaml`) |

---

## Architecture

```
event managment/
├── server/
│   ├── index.js          # Express REST API (auth, events, payments, mail)
│   ├── db.js             # PostgreSQL pool + schema init + event seeding
│   ├── initialEvents.js  # Seed catalog of 10 sample events
│   └── data/             # (legacy) unused once Postgres is wired
├── src/
│   ├── App.jsx           # React UI, JWT storage, Razorpay checkout
│   ├── main.jsx
│   └── styles.css
├── .env                  # Local secrets (DB, JWT, Razorpay, SMTP)
├── netlify.toml          # Netlify build + SPA redirects
├── render.yaml           # Render blueprint (API + free Postgres)
└── vite.config.js        # Dev proxy: /api → localhost:4000
```

- **Frontend**: React 19 + Vite. Talks to `/api/*`, which Vite proxies to the API in dev.
  In production, set `VITE_API_BASE` (e.g. `https://gather-api.onrender.com`) so fetches hit the deployed API.
- **Auth**: JWT stored in `localStorage`, sent as `Authorization: Bearer <token>`.
- **Database**: PostgreSQL 14+. Connection via `DATABASE_URL` (production) or discrete
  `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` variables (local).

---

## Local Setup

1. **PostgreSQL** — create the database (tables seed automatically on server start):

   ```sql
   CREATE DATABASE eventmanagment;
   ```

2. **`.env`** at the repo root:

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
   SMTP_FROM=Gather Events <your-email@gmail.com>
   ```

3. **Install & run both services**:

   ```bash
   npm install
   npm run dev        # API on :4000 + Vite on :5173
   ```

   Or separately: `npm run server` and `npm run client`.

4. **Build for production**: `npm run build` → outputs to `dist/`.

---

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Health check (`{ status, database }`) |
| POST | `/api/auth/signup` | — | Create account, returns `{ token, user }` |
| POST | `/api/auth/login` | — | Sign in, returns `{ token, user }` |
| GET | `/api/auth/me` | JWT | Current user from token |
| POST | `/api/auth/logout` | JWT | Client-side token discard |
| GET | `/api/events` | — | Events with live `ticketsSold` counts |
| POST | `/api/orders` | JWT | Create Razorpay order (capacity-checked) |
| POST | `/api/payments/verify` | — | Verify HMAC signature, create booking, send email |
| GET | `/api/bookings` | JWT | Bookings for the signed-in user's email |

---

## Deployment (Netlify + Render)

### Backend on Render (free)
1. Push this repo to GitHub.
2. On [render.com](https://render.com), click **New → Blueprint** and select the repo —
   `render.yaml` provisions a free web service **and** a free PostgreSQL database,
   wires `DATABASE_URL` automatically, and generates a strong `JWT_SECRET`.
3. In the Render dashboard → Environment, fill in `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`, `SMTP_*`, and set `CLIENT_ORIGIN` to your Netlify URL.

### Frontend on Netlify
1. On [netlify.com](https://netlify.com), **Add new site → Import from Git** → pick the repo.
2. Build command `npm run build`, publish directory `dist` (already in `netlify.toml`).
3. Under **Site settings → Environment variables**, add:
   - `VITE_API_BASE` = your Render URL, e.g. `https://gather-api.onrender.com`
4. Deploy. Any push to `main` redeploys automatically.

> **Note:** Render's free tier sleeps after 15 minutes of inactivity — the first
> request after a nap takes ~30s to wake. Hit `/api/health` before demoing.

---

## Demo Flow for Judges

1. Open the site → browse/filter/search events (no login needed to explore).
2. Click **Sign in → Create an account** (JWT issued; watch the token in DevTools → Application → Local Storage).
3. Pick an event → **Get tickets** → choose quantity → **Continue to secure payment**.
4. Pay with Razorpay test card `4111 1111 1111`, any future expiry, any CVV.
5. Confirmation modal shows the booking reference; the SMTP inbox receives the styled ticket email.
6. Refresh — session persists via JWT. `GET /api/bookings` lists purchases.
