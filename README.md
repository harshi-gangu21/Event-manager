# Gather — Event Management Application

Gather is a full-stack event discovery and ticket-booking application with separate **Backend** and **Frontend** services powered by **PostgreSQL**, Express, React (Vite), Razorpay, and Nodemailer.

---

## Architecture Overview

The project is structured into two completely independent services:

```
event managment/
├── backend/                  # Independent Node.js Express + PostgreSQL API
│   ├── .env                  # Backend environment variables (DB, Razorpay, SMTP)
│   ├── db.js                 # PostgreSQL connection pool & schema migrations
│   ├── initialEvents.js      # Seed catalog of events
│   ├── index.js              # Express REST API endpoints
│   └── package.json          # Backend scripts & dependencies (pg, express, etc.)
│
├── frontend/                 # Independent React + Vite frontend application
│   ├── index.html            # Entry HTML
│   ├── vite.config.js        # Vite config with API proxy to port 4000
│   ├── src/
│   │   ├── App.jsx           # Main UI, filtering, modals & Razorpay checkout
│   │   ├── main.jsx          # React DOM entrypoint
│   │   └── styles.css        # Rich styling & animations
│   └── package.json          # Frontend scripts & dependencies (react, vite)
│
├── package.json              # Root orchestrator scripts (optional convenience)
└── README.md                 # Project documentation
```

---

## Requirements

- **Node.js**: 24 or newer
- **PostgreSQL**: Version 14+ (tested on PostgreSQL 18.x)
- **Database**: `eventmanagment` (running on `localhost:5432`)
- **Razorpay**: Test API keys for checkout
- **SMTP**: Email credentials (e.g. Gmail App Password) for booking confirmations

---

## PostgreSQL Setup

1. Start your local PostgreSQL service:
   - Database name: `eventmanagment`
   - Default user: `postgres`
   - Default password: `root` (or update in `backend/.env`)

2. The backend **automatically** connects, initializes tables (`events`, `users`, `sessions`, `orders`, `bookings`), and seeds initial sample events on startup.

---

## Running the Services Separately

### 1. Run Backend Separately
Open a terminal in `backend/`:

```bash
cd backend
npm install
npm run dev
```

The backend API will start at:
👉 **`http://localhost:4000`**

- Health Check: `http://localhost:4000/api/health`
- Events Endpoint: `http://localhost:4000/api/events`

### 2. Run Frontend Separately
Open a second terminal in `frontend/`:

```bash
cd frontend
npm install
npm run dev
```

The frontend will start at:
👉 **`http://localhost:5173`**

Vite automatically proxies all `/api/*` calls from `http://localhost:5173` to `http://localhost:4000`.

---

## Running Both Simultaneously (From Root)

You can also run both services concurrently from the root directory:

```bash
# Install all dependencies across both folders
npm run install:all

# Run both backend and frontend together
npm run dev
```

Individual root helper scripts:
- `npm run dev:backend` — runs only the backend
- `npm run dev:frontend` — runs only the frontend
- `npm run build` — creates the production frontend bundle in `frontend/dist/`

---

## Configuration (`backend/.env`)

Edit `backend/.env` to configure your credentials:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

# PostgreSQL Database Configuration
PGHOST=localhost
PGPORT=5432
PGDATABASE=eventmanagment
PGUSER=postgres
PGPASSWORD=YOUR_DB_PASSWORD

# Razorpay Test Credentials
RAZORPAY_KEY_ID=YOUR_RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_RAZORPAY_KEY_SECRET

# Email (SMTP) Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=YOUR_SMTP_APP_PASSWORD
SMTP_FROM="Gather Events <your-email@example.com>"
```

---

## Database Tables

| Table | Description |
|---|---|
| `events` | Catalog of events (title, category, date, price, capacity, image, etc.) |
| `users` | Registered users with scrypt salted password hashes |
| `sessions` | Active user sessions mapped with secure SHA-256 tokens |
| `orders` | Razorpay order reservations with temporary hold logic |
| `bookings` | Confirmed bookings after server-side Razorpay HMAC signature verification |
