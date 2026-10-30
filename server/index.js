import "dotenv/config";
import crypto from "node:crypto";
import { promisify } from "node:util";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import Razorpay from "razorpay";
import { pool, initDb } from "./db.js";
import { initialEvents } from "./initialEvents.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const scrypt = promisify(crypto.scrypt);
const jwtSecret = process.env.JWT_SECRET;
const tokenLifetime = "7d";
const authFailureLimit = 10;
const authFailureWindowMs = 15 * 60 * 1000;
const authFailures = new Map();

if (!jwtSecret) {
  console.error("JWT_SECRET is missing. Add it to .env before starting the server.");
  process.exit(1);
}

await initDb(initialEvents);

const helpers = {
  formatDate: (value) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }),
};

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function getRazorpay() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
}

function getSmtpTransport() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || smtpPort < 1 || smtpPort > 65535) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendBookingEmail(booking) {
  if (booking.email_status === "sent") return;
  const transporter = getSmtpTransport();
  if (!transporter) {
    booking.email_status = "not_configured";
    return;
  }
  booking.email_status = "sending";
  const safe = {
    name: escapeHtml(booking.attendee_name),
    event: escapeHtml(booking.title),
    date: escapeHtml(helpers.formatDate(booking.date)),
    time: escapeHtml(booking.time),
    venue: escapeHtml(booking.venue),
    ref: escapeHtml(booking.id),
  };
  const ticketWord = booking.quantity === 1 ? "ticket" : "tickets";
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: booking.attendee_email,
      subject: `Your tickets for ${booking.title} — Gather`,
      text: `Hi ${booking.attendee_name},\n\nYour booking for ${booking.title} is confirmed.\nWhen: ${helpers.formatDate(booking.date)} at ${booking.time}\nWhere: ${booking.venue}\nTickets: ${booking.quantity} ${ticketWord}\nBooking reference: ${booking.id}\n\nKeep your booking reference handy for check-in.`,
      html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#fbf9f5;font-family:Arial,sans-serif;color:#20201f"><main style="max-width:520px;margin:0 auto;padding:32px;background:#fff;border:1px solid #e9e6df;border-radius:8px"><p style="color:#5a4af4;font-size:12px;font-weight:bold;letter-spacing:2px">GATHER · BOOKING CONFIRMED</p><h1 style="font-size:26px">You're on the list, ${safe.name}.</h1><section style="margin:24px 0;padding:20px;background:#fbf9f5;border-radius:6px"><h2 style="margin:0 0 14px;font-size:19px">${safe.event}</h2><p style="margin:7px 0">${safe.date} · ${safe.time}</p><p style="margin:7px 0">${safe.venue}</p><p style="margin:7px 0">${booking.quantity} ${ticketWord}</p></section><p>Show this booking reference at check-in:</p><p style="padding:13px;background:#f3f1ff;color:#4c3ce5;font-size:18px;font-weight:bold;letter-spacing:2px;text-align:center">${safe.ref}</p></main></body></html>`,
    });
    booking.email_status = "sent";
    booking.email_sent_at = new Date();
  } catch (error) {
    booking.email_status = "failed";
    console.error(`Booking confirmation email failed for ${booking.id}:`, error.message);
  }
  await pool.query(`UPDATE bookings SET email_status = $2, email_sent_at = $3 WHERE id = $1`, [
    booking.id, booking.email_status, booking.email_sent_at ?? null,
  ]);
}

function authenticate(request, response, next) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return response.status(401).json({ error: "Sign in to continue." });
  try {
    request.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return response.status(401).json({ error: "Your session expired. Please sign in again." });
  }
}

function optionalAuth(request, _response, next) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try { request.user = jwt.verify(token, jwtSecret); } catch { /* guest */ }
  }
  next();
}

function isAuthRateLimited(request) {
  const now = Date.now();
  const failures = (authFailures.get(request.ip) ?? []).filter((t) => now - t < authFailureWindowMs);
  authFailures.set(request.ip, failures);
  return failures.length >= authFailureLimit;
}
function recordAuthFailure(request) {
  const failures = authFailures.get(request.ip) ?? [];
  failures.push(Date.now());
  authFailures.set(request.ip, failures);
}
function clearAuthFailures(request) {
  authFailures.delete(request.ip);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}

async function verifyPassword(password, user) {
  if (user.password_hash.startsWith("$2")) {
    return bcrypt.compare(password, user.password_hash);
  }
  const candidate = await scrypt(password, user.password_salt, 64);
  const storedHash = Buffer.from(user.password_hash, "hex");
  return storedHash.length === candidate.length && crypto.timingSafeEqual(storedHash, candidate);
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", database: "connected" });
});

// ---------- Auth (JWT) ----------
app.post("/api/auth/signup", async (request, response) => {
  if (isAuthRateLimited(request)) {
    return response.status(429).json({ error: "Too many attempts. Please wait 15 minutes." });
  }
  const { name, email, password } = request.body ?? {};
  if (
    typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 ||
    typeof email !== "string" || email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" || password.length < 10 || password.length > 128
  ) {
    return response.status(400).json({ error: "Enter your name, a valid email, and a password between 10 and 128 characters." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [normalizedEmail]);
  if (existing.rowCount > 0) {
    return response.status(409).json({ error: "An account with this email already exists. Sign in instead." });
  }
  const { salt, hash } = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (id, name, email, password_salt, password_hash)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email`,
    [crypto.randomUUID(), name.trim(), normalizedEmail, salt, hash],
  );
  const user = rows[0];
  const token = jwt.sign({ sub: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: tokenLifetime });
  clearAuthFailures(request);
  return response.status(201).json({ token, user });
});

app.post("/api/auth/login", async (request, response) => {
  if (isAuthRateLimited(request)) {
    return response.status(429).json({ error: "Too many sign-in attempts. Please wait 15 minutes." });
  }
  const { email, password } = request.body ?? {};
  if (
    typeof email !== "string" || email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" || password.length < 1 || password.length > 128
  ) {
    return response.status(400).json({ error: "Enter a valid email and password." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [normalizedEmail]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user))) {
    recordAuthFailure(request);
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  const token = jwt.sign({ sub: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: tokenLifetime });
  clearAuthFailures(request);
  return response.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get("/api/auth/me", authenticate, (request, response) => {
  response.json({ user: { id: request.user.sub, name: request.user.name, email: request.user.email } });
});

app.post("/api/auth/logout", authenticate, (_request, response) => {
  // JWT is stateless; the client discards the token.
  response.json({ user: null });
});

// ---------- Events ----------
app.get("/api/events", async (_request, response) => {
  const { rows } = await pool.query(`
    SELECT e.id, e.title, e.category, e.date, e.time, e.venue, e.price, e.capacity, e.description, e.image, e.accent,
      COALESCE((
        SELECT SUM(b.quantity) FROM bookings b WHERE b.event_id = e.id
      ), 0) AS "ticketsSold"
    FROM events e ORDER BY e.date ASC`);
  response.json(rows);
});

// ---------- Orders (Razorpay) ----------
app.post("/api/orders", authenticate, async (request, response) => {
  const { eventId, quantity } = request.body ?? {};
  if (typeof eventId !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return response.status(400).json({ error: "Choose an event and a quantity between 1 and 10." });
  }
  const { rows } = await pool.query(`SELECT * FROM events WHERE id = $1`, [eventId]);
  const event = rows[0];
  if (!event) return response.status(404).json({ error: "That event could not be found." });

  const sold = await pool.query(
    `SELECT COALESCE(SUM(quantity),0)::int AS sold FROM bookings WHERE event_id = $1`, [eventId]);
  const reserved = await pool.query(
    `SELECT COALESCE(SUM(quantity),0)::int AS reserved FROM orders
     WHERE event_id = $1 AND status IN ('creating','created') AND created_at > now() - interval '15 minutes'`,
    [eventId]);
  if (sold.rows[0].sold + reserved.rows[0].reserved + quantity > event.capacity) {
    return response.status(409).json({ error: "There are not enough tickets left for that quantity." });
  }

  const razorpay = getRazorpay();
  if (!razorpay) {
    return response.status(503).json({ error: "Payments are not configured. Add your Razorpay test keys." });
  }
  const amount = event.price * quantity * 100;
  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `gather_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      notes: { eventId, quantity: String(quantity) },
    });
    await pool.query(
      `INSERT INTO orders (id, event_id, user_id, quantity, amount, status) VALUES ($1,$2,$3,$4,$5,'created')`,
      [order.id, eventId, request.user.sub, quantity, amount],
    );
    return response.json({
      orderId: order.id, amount: order.amount, currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID, eventName: event.title,
    });
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    return response.status(502).json({ error: "We couldn't start checkout. Please try again." });
  }
});

app.post("/api/payments/verify", async (request, response) => {
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    attendeeName,
    attendeeEmail,
  } = request.body ?? {};

  if (
    typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string" ||
    typeof attendeeName !== "string" || attendeeName.trim().length < 2 || attendeeName.trim().length > 100 ||
    typeof attendeeEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail) || attendeeEmail.length > 254
  ) {
    return response.status(400).json({ error: "Please provide valid payment and attendee details." });
  }

  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = rows[0];
  if (!order) return response.status(400).json({ error: "This checkout order is invalid." });

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return response.status(503).json({ error: "Payment verification is not configured." });

  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "hex"); } catch { return response.status(400).json({ error: "The payment signature is invalid." }); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
    return response.status(400).json({ error: "We couldn't verify this payment. Please contact support." });
  }

  if (order.status === "paid") {
    const existing = await pool.query(`
      SELECT b.*, e.title, e.date, e.time, e.venue FROM bookings b
      JOIN events e ON e.id = b.event_id WHERE b.order_id = $1`, [orderId]);
    if (existing.rows[0]) {
      await sendBookingEmail(existing.rows[0]);
      return response.json({ booking: existing.rows[0] });
    }
  }
  if (order.status !== "created") {
    return response.status(400).json({ error: "This checkout order is invalid or has expired." });
  }

  const sold = await pool.query(
    `SELECT COALESCE(SUM(quantity),0)::int AS sold FROM bookings WHERE event_id = $1`, [order.event_id]);
  const { rows: eventRows } = await pool.query(`SELECT * FROM events WHERE id = $1`, [order.event_id]);
  const event = eventRows[0];
  if (!event) return response.status(404).json({ error: "The event for this payment could not be found." });
  if (sold.rows[0].sold + order.quantity > event.capacity) {
    return response.status(409).json({ error: "Payment was received, but tickets sold out. Please contact support." });
  }

  const bookingId = `GTH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO bookings (id, order_id, payment_id, event_id, quantity, amount, attendee_name, attendee_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [bookingId, orderId, paymentId, order.event_id, order.quantity, order.amount,
      attendeeName.trim(), attendeeEmail.trim().toLowerCase()],
  );
  await pool.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [orderId]);

  const booking = {
    id: bookingId, order_id: orderId, payment_id: paymentId, event_id: order.event_id,
    quantity: order.quantity, amount: order.amount,
    attendee_name: attendeeName.trim(), attendee_email: attendeeEmail.trim().toLowerCase(),
    title: event.title, date: event.date, time: event.time, venue: event.venue,
    email_status: "pending",
  };
  await sendBookingEmail(booking);
  return response.json({ booking });
});

// ---------- Bookings for the signed-in user ----------
app.get("/api/bookings", authenticate, async (request, response) => {
  const { rows } = await pool.query(`
    SELECT b.id, b.quantity, b.amount, b.attendee_name, b.attendee_email, b.email_status, b.created_at,
      e.title, e.date, e.time, e.venue, e.image
    FROM bookings b JOIN events e ON e.id = b.event_id
    WHERE b.attendee_email = $1 ORDER BY b.created_at DESC`,
    [request.user.email]);
  response.json(rows);
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Unhandled request error:", error);
  response.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(port, () => {
  console.log(`Gather API listening on http://localhost:${port}`);
});
