import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER || "postgres"}:${process.env.PGPASSWORD || "root"}@${
      process.env.PGHOST || "localhost"
    }:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "eventmanagment"}`,
});

export async function initDb(seedEvents) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_salt TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      date DATE NOT NULL,
      time TEXT NOT NULL,
      venue TEXT NOT NULL,
      price INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      description TEXT NOT NULL,
      image TEXT NOT NULL,
      accent TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      user_id UUID REFERENCES users(id),
      quantity INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),
      payment_id TEXT NOT NULL,
      event_id TEXT NOT NULL REFERENCES events(id),
      quantity INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      attendee_name TEXT NOT NULL,
      attendee_email TEXT NOT NULL,
      email_status TEXT NOT NULL DEFAULT 'pending',
      email_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT NOT NULL DEFAULT ''`);

  for (const event of seedEvents) {
    await pool.query(
      `INSERT INTO events (id, title, category, date, time, venue, price, capacity, description, image, accent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.title, event.category, event.date, event.time, event.venue,
       event.price, event.capacity, event.description, event.image, event.accent],
    );
  }
}
