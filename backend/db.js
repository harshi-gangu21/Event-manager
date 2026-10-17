import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initialEvents } from "./initialEvents.js";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "eventmanagment",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "root",
});

export const query = (text, params) => pool.query(text, params);

export async function initDb() {
  try {
    // 1. Verify connection
    const testResult = await pool.query("SELECT current_database(), current_user");
    console.log(`Connected to PostgreSQL database "${testResult.rows[0].current_database}" as user "${testResult.rows[0].current_user}"`);

    // 2. Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(100) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        date VARCHAR(50) NOT NULL,
        time VARCHAR(50) NOT NULL,
        venue VARCHAR(255) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        capacity INTEGER NOT NULL,
        description TEXT,
        image TEXT,
        accent VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_salt VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY,
        event_id VARCHAR(100) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id VARCHAR(100) PRIMARY KEY,
        order_id VARCHAR(100),
        payment_id VARCHAR(100),
        event_id VARCHAR(100) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        event_name VARCHAR(255) NOT NULL,
        event_date VARCHAR(50) NOT NULL,
        event_time VARCHAR(50) NOT NULL,
        venue VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        attendee_name VARCHAR(255) NOT NULL,
        attendee_email VARCHAR(255) NOT NULL,
        email_status VARCHAR(50) DEFAULT 'pending',
        email_sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 3. Seed initial events if missing
    for (const event of initialEvents) {
      await pool.query(
        `INSERT INTO events (id, title, category, date, time, venue, price, capacity, description, image, accent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           category = EXCLUDED.category,
           date = EXCLUDED.date,
           time = EXCLUDED.time,
           venue = EXCLUDED.venue,
           price = EXCLUDED.price,
           capacity = EXCLUDED.capacity,
           description = EXCLUDED.description,
           image = EXCLUDED.image,
           accent = EXCLUDED.accent`,
        [
          event.id,
          event.title,
          event.category,
          event.date,
          event.time,
          event.venue,
          event.price,
          event.capacity,
          event.description,
          event.image,
          event.accent,
        ]
      );
    }
    console.log("PostgreSQL: Initial events verified and seeded.");

    // 4. Migrate any existing data from store.json if available
    const storeJsonPath = path.resolve(__dirname, "../server/data/store.json");
    if (fs.existsSync(storeJsonPath)) {
      try {
        const storeData = JSON.parse(fs.readFileSync(storeJsonPath, "utf8"));

        // Users migration
        if (Array.isArray(storeData.users)) {
          for (const u of storeData.users) {
            await pool.query(
              `INSERT INTO users (id, name, email, password_salt, password_hash, created_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO NOTHING`,
              [u.id, u.name, u.email, u.passwordSalt, u.passwordHash, u.createdAt || new Date().toISOString()]
            );
          }
        }

        // Bookings migration
        if (Array.isArray(storeData.bookings)) {
          for (const b of storeData.bookings) {
            await pool.query(
              `INSERT INTO bookings (id, order_id, payment_id, event_id, event_name, event_date, event_time, venue, quantity, amount, attendee_name, attendee_email, email_status, email_sent_at, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
               ON CONFLICT (id) DO NOTHING`,
              [
                b.id,
                b.orderId || null,
                b.paymentId || null,
                b.eventId,
                b.eventName,
                b.eventDate,
                b.eventTime,
                b.venue,
                b.quantity,
                b.amount,
                b.attendeeName,
                b.attendeeEmail,
                b.emailStatus || "pending",
                b.emailSentAt ? new Date(b.emailSentAt) : null,
                b.createdAt ? new Date(b.createdAt) : new Date(),
              ]
            );
          }
        }
        console.log("PostgreSQL: Existing store.json data successfully imported.");
      } catch (err) {
        console.warn("Notice: store.json migration skipped:", err.message);
      }
    }
  } catch (error) {
    console.error("PostgreSQL database initialization failed:", error);
    throw error;
  }
}
