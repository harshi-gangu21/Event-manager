import "dotenv/config";
import crypto from "node:crypto";
import { promisify } from "node:util";
import cors from "cors";
import express from "express";
import nodemailer from "nodemailer";
import Razorpay from "razorpay";
import { pool, query, initDb } from "./db.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const scrypt = promisify(crypto.scrypt);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessionCookieName = "gather_session";
const passwordHashBytes = 64;
const authFailureLimit = 10;
const authFailureWindowMs = 15 * 60 * 1000;
const authFailures = new Map();

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function getSessionToken(request) {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(sessionCookieName.length + 1));
  } catch {
    return null;
  }
}

async function getSessionUser(request) {
  const token = getSessionToken(request);
  if (!token) return null;
  const sessionId = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();

  const res = await query(
    `SELECT u.id, u.name, u.email, s.expires_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.session_id = $1`,
    [sessionId]
  );

  if (res.rowCount === 0) return null;
  const session = res.rows[0];
  if (Number(session.expires_at) <= now) {
    await query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
    return null;
  }
  return { id: session.id, name: session.name, email: session.email };
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${
      sessionLifetimeMs / 1000
    }${secure}`
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

async function createSession(user, response) {
  const now = Date.now();
  // Clear expired sessions
  await query("DELETE FROM sessions WHERE expires_at <= $1", [now]);

  const token = crypto.randomBytes(32).toString("base64url");
  const sessionId = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = now + sessionLifetimeMs;

  await query(
    `INSERT INTO sessions (session_id, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [sessionId, user.id, expiresAt]
  );

  setSessionCookie(response, token);
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, passwordHashBytes);
  return { salt, hash: hash.toString("hex") };
}

async function verifyPassword(password, user) {
  const candidate = await scrypt(password, user.password_salt, passwordHashBytes);
  const storedHash = Buffer.from(user.password_hash, "hex");
  return storedHash.length === candidate.length && crypto.timingSafeEqual(storedHash, candidate);
}

function isAuthRateLimited(request) {
  const now = Date.now();
  const failures = (authFailures.get(request.ip) ?? []).filter(
    (timestamp) => now - timestamp < authFailureWindowMs
  );
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

async function getTicketsSold(eventId) {
  const res = await query(
    "SELECT COALESCE(SUM(quantity), 0)::int AS count FROM bookings WHERE event_id = $1",
    [eventId]
  );
  return res.rows[0].count;
}

async function getTicketsReserved(eventId) {
  const res = await query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS count
     FROM orders
     WHERE event_id = $1
       AND status IN ('creating', 'created')
       AND created_at > NOW() - INTERVAL '15 minutes'`,
    [eventId]
  );
  return res.rows[0].count;
}

function getRazorpay() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return null;
  }
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
}

function getSmtpTransport() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  if (
    !SMTP_HOST ||
    !SMTP_USER ||
    !SMTP_PASS ||
    !SMTP_FROM ||
    !Number.isInteger(smtpPort) ||
    smtpPort < 1 ||
    smtpPort > 65535
  ) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sendBookingEmail(booking) {
  if (booking.emailStatus === "sent") return booking;

  const transporter = getSmtpTransport();
  if (!transporter) {
    booking.emailStatus = "not_configured";
    await query("UPDATE bookings SET email_status = $1 WHERE id = $2", ["not_configured", booking.id]);
    return booking;
  }

  booking.emailStatus = "sending";
  await query("UPDATE bookings SET email_status = $1 WHERE id = $2", ["sending", booking.id]);

  const safeName = escapeHtml(booking.attendeeName);
  const safeEventName = escapeHtml(booking.eventName);
  const safeDate = escapeHtml(
    new Date(`${booking.eventDate}T12:00:00`).toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );
  const safeTime = escapeHtml(booking.eventTime);
  const safeVenue = escapeHtml(booking.venue);
  const safeReference = escapeHtml(booking.id);
  const ticketWord = booking.quantity === 1 ? "ticket" : "tickets";

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: booking.attendeeEmail,
      subject: `Your tickets for ${booking.eventName} — Gather`,
      text: [
        `Hi ${booking.attendeeName},`,
        "",
        `Your booking for ${booking.eventName} is confirmed.`,
        `When: ${safeDate} at ${booking.eventTime}`,
        `Where: ${booking.venue}`,
        `Tickets: ${booking.quantity} ${ticketWord}`,
        `Booking reference: ${booking.id}`,
        "",
        "Keep your booking reference handy for check-in.",
      ].join("\n"),
      html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#fbf9f5;font-family:Arial,sans-serif;color:#20201f"><main style="max-width:520px;margin:0 auto;padding:32px;background:#fff;border:1px solid #e9e6df;border-radius:8px"><p style="color:#5a4af4;font-size:12px;font-weight:bold;letter-spacing:2px">GATHER · BOOKING CONFIRMED</p><h1 style="font-size:26px">You're on the list, ${safeName}.</h1><p>Your payment is confirmed. Here are your event details:</p><section style="margin:24px 0;padding:20px;background:#fbf9f5;border-radius:6px"><h2 style="margin:0 0 14px;font-size:19px">${safeEventName}</h2><p style="margin:7px 0">${safeDate} · ${safeTime}</p><p style="margin:7px 0">${safeVenue}</p><p style="margin:7px 0">${booking.quantity} ${ticketWord}</p></section><p>Show this booking reference at check-in:</p><p style="padding:13px;background:#f3f1ff;color:#4c3ce5;font-size:18px;font-weight:bold;letter-spacing:2px;text-align:center">${safeReference}</p><p style="color:#77756e;font-size:12px">Thanks for gathering with us.</p></main></body></html>`,
    });
    booking.emailStatus = "sent";
    booking.emailSentAt = new Date().toISOString();
    await query(
      "UPDATE bookings SET email_status = 'sent', email_sent_at = NOW() WHERE id = $1",
      [booking.id]
    );
  } catch (error) {
    booking.emailStatus = "failed";
    await query("UPDATE bookings SET email_status = 'failed' WHERE id = $1", [booking.id]);
    console.error(`Booking confirmation email failed for ${booking.id}:`, error.message);
  }
  return booking;
}

async function retryPendingBookingEmails() {
  try {
    const res = await query(
      "SELECT * FROM bookings WHERE email_status != 'sent' ORDER BY created_at ASC"
    );
    for (const row of res.rows) {
      const booking = {
        id: row.id,
        orderId: row.order_id,
        paymentId: row.payment_id,
        eventId: row.event_id,
        eventName: row.event_name,
        eventDate: row.event_date,
        eventTime: row.event_time,
        venue: row.venue,
        quantity: row.quantity,
        amount: Number(row.amount),
        attendeeName: row.attendee_name,
        attendeeEmail: row.attendee_email,
        emailStatus: row.email_status,
      };
      await sendBookingEmail(booking);
    }
  } catch (err) {
    console.warn("Notice: Pending email retry encountered an issue:", err.message);
  }
}

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "20kb" }));

// 1. Health check
app.get("/api/health", async (_request, response) => {
  try {
    await query("SELECT 1");
    response.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (error) {
    response.status(500).json({ status: "error", message: error.message });
  }
});

// 2. Auth: Get Current User
app.get("/api/auth/me", async (request, response) => {
  try {
    const user = await getSessionUser(request);
    response.json({ user: user ? publicUser(user) : null });
  } catch (error) {
    console.error("Auth check error:", error);
    response.json({ user: null });
  }
});

// 3. Auth: Signup
app.post("/api/auth/signup", async (request, response) => {
  if (isAuthRateLimited(request)) {
    return response.status(429).json({
      error: "Too many account attempts. Please wait 15 minutes and try again.",
    });
  }
  const { name, email, password } = request.body ?? {};
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 100 ||
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 128
  ) {
    recordAuthFailure(request);
    return response.status(400).json({
      error: "Enter your name, a valid email, and a password between 10 and 128 characters.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rowCount > 0) {
      recordAuthFailure(request);
      return response.status(409).json({
        error: "An account with this email already exists. Sign in instead.",
      });
    }

    const passwordCredentials = await hashPassword(password);
    const userId = crypto.randomUUID();

    const insertResult = await query(
      `INSERT INTO users (id, name, email, password_salt, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email`,
      [userId, name.trim(), normalizedEmail, passwordCredentials.salt, passwordCredentials.hash]
    );

    const user = insertResult.rows[0];
    await createSession(user, response);
    clearAuthFailures(request);
    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    console.error("Signup error:", error);
    return response.status(500).json({ error: "Failed to create account. Please try again." });
  }
});

// 4. Auth: Login
app.post("/api/auth/login", async (request, response) => {
  if (isAuthRateLimited(request)) {
    return response.status(429).json({
      error: "Too many sign-in attempts. Please wait 15 minutes and try again.",
    });
  }
  const { email, password } = request.body ?? {};
  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 128
  ) {
    recordAuthFailure(request);
    return response.status(400).json({ error: "Enter a valid email and password." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const res = await query(
      "SELECT id, name, email, password_salt, password_hash FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (res.rowCount === 0) {
      recordAuthFailure(request);
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    const user = res.rows[0];
    const passwordValid = await verifyPassword(password, user);
    if (!passwordValid) {
      recordAuthFailure(request);
      return response.status(401).json({ error: "Email or password is incorrect." });
    }

    await createSession(user, response);
    clearAuthFailures(request);
    return response.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    return response.status(500).json({ error: "Sign in failed. Please try again." });
  }
});

// 5. Auth: Logout
app.post("/api/auth/logout", async (request, response) => {
  const token = getSessionToken(request);
  if (token) {
    const sessionId = crypto.createHash("sha256").update(token).digest("hex");
    await query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
  }
  clearSessionCookie(response);
  return response.json({ user: null });
});

// 6. Get All Events with real-time tickets sold
app.get("/api/events", async (_request, response) => {
  try {
    const res = await query(`
      SELECT
        e.id,
        e.title,
        e.category,
        e.date,
        e.time,
        e.venue,
        e.price::float AS price,
        e.capacity,
        e.description,
        e.image,
        e.accent,
        COALESCE(SUM(b.quantity), 0)::int AS "ticketsSold"
      FROM events e
      LEFT JOIN bookings b ON e.id = b.event_id
      GROUP BY e.id
      ORDER BY e.date ASC
    `);
    response.json(res.rows);
  } catch (error) {
    console.error("Failed to load events:", error);
    response.status(500).json({ error: "Could not retrieve events" });
  }
});

// 7. Create Checkout Order
app.post("/api/orders", async (request, response) => {
  const { eventId, quantity } = request.body ?? {};
  if (typeof eventId !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return response.status(400).json({ error: "Choose an event and a quantity between 1 and 10." });
  }

  try {
    const eventRes = await query("SELECT * FROM events WHERE id = $1", [eventId]);
    if (eventRes.rowCount === 0) {
      return response.status(404).json({ error: "That event could not be found." });
    }
    const event = eventRes.rows[0];

    const sold = await getTicketsSold(eventId);
    const reserved = await getTicketsReserved(eventId);

    if (sold + reserved + quantity > event.capacity) {
      return response.status(409).json({ error: "There are not enough tickets left for that quantity." });
    }

    const razorpay = getRazorpay();
    if (!razorpay) {
      return response.status(503).json({
        error: "Payments are not configured yet. Add your Razorpay test keys to the server .env file.",
      });
    }

    const amount = Math.round(Number(event.price) * quantity * 100);
    const reservationId = `pending_${crypto.randomUUID()}`;

    // Record pending reservation in PostgreSQL
    await query(
      `INSERT INTO orders (id, event_id, quantity, amount, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [reservationId, eventId, quantity, amount, "creating"]
    );

    try {
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `gather_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
        notes: { eventId, quantity: String(quantity) },
      });

      // Update reservation with actual Razorpay order ID and 'created' status
      await query(
        `UPDATE orders
         SET id = $1, status = 'created'
         WHERE id = $2`,
        [order.id, reservationId]
      );

      return response.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        eventName: event.title,
      });
    } catch (razorError) {
      await query("DELETE FROM orders WHERE id = $1", [reservationId]);
      console.error("Razorpay order creation failed:", razorError);
      return response.status(502).json({ error: "We couldn't start checkout. Please try again." });
    }
  } catch (error) {
    console.error("Order processing error:", error);
    return response.status(500).json({ error: "Something went wrong while creating your order." });
  }
});

// 8. Verify Payment & Save Booking
app.post("/api/payments/verify", async (request, response) => {
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    attendeeName,
    attendeeEmail,
  } = request.body ?? {};

  if (
    typeof orderId !== "string" ||
    typeof paymentId !== "string" ||
    typeof signature !== "string" ||
    typeof attendeeName !== "string" ||
    attendeeName.trim().length < 2 ||
    attendeeName.trim().length > 100 ||
    typeof attendeeEmail !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail) ||
    attendeeEmail.length > 254
  ) {
    return response.status(400).json({ error: "Please provide valid payment and attendee details." });
  }

  try {
    const orderRes = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (orderRes.rowCount === 0) {
      return response.status(400).json({ error: "This checkout order is invalid." });
    }
    const order = orderRes.rows[0];

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return response.status(503).json({ error: "Payment verification is not configured on the server." });
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest();

    let supplied;
    try {
      supplied = Buffer.from(signature, "hex");
    } catch {
      return response.status(400).json({ error: "The payment signature is invalid." });
    }

    if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
      return response.status(400).json({
        error: "We couldn't verify this payment. Please contact support before trying again.",
      });
    }

    if (order.status === "paid") {
      const existingRes = await query("SELECT * FROM bookings WHERE order_id = $1", [orderId]);
      if (existingRes.rowCount > 0) {
        const row = existingRes.rows[0];
        const existingBooking = {
          id: row.id,
          orderId: row.order_id,
          paymentId: row.payment_id,
          eventId: row.event_id,
          eventName: row.event_name,
          eventDate: row.event_date,
          eventTime: row.event_time,
          venue: row.venue,
          quantity: row.quantity,
          amount: Number(row.amount),
          attendeeName: row.attendee_name,
          attendeeEmail: row.attendee_email,
          emailStatus: row.email_status,
        };
        await sendBookingEmail(existingBooking);
        return response.json({ booking: existingBooking });
      }
    }

    if (order.status !== "created") {
      return response.status(400).json({ error: "This checkout order is invalid or has expired." });
    }

    const eventRes = await query("SELECT * FROM events WHERE id = $1", [order.event_id]);
    if (eventRes.rowCount === 0) {
      return response.status(404).json({ error: "The event for this payment could not be found." });
    }
    const event = eventRes.rows[0];

    const alreadySold = await getTicketsSold(event.id);
    if (alreadySold + order.quantity > event.capacity) {
      return response.status(409).json({
        error: "Payment was received, but ticket availability needs assistance. Please contact support.",
      });
    }

    const bookingId = `GTH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const booking = {
      id: bookingId,
      orderId,
      paymentId,
      eventId: event.id,
      eventName: event.title,
      eventDate: event.date,
      eventTime: event.time,
      venue: event.venue,
      quantity: order.quantity,
      amount: Number(order.amount),
      attendeeName: attendeeName.trim(),
      attendeeEmail: attendeeEmail.trim().toLowerCase(),
      createdAt: new Date().toISOString(),
      emailStatus: "pending",
    };

    // Save booking into PostgreSQL and update order status
    await query(
      `INSERT INTO bookings (id, order_id, payment_id, event_id, event_name, event_date, event_time, venue, quantity, amount, attendee_name, attendee_email, email_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        booking.id,
        booking.orderId,
        booking.paymentId,
        booking.eventId,
        booking.eventName,
        booking.eventDate,
        booking.eventTime,
        booking.venue,
        booking.quantity,
        booking.amount,
        booking.attendeeName,
        booking.attendeeEmail,
        booking.emailStatus,
      ]
    );

    await query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);

    // Send confirmation email asynchronously
    void sendBookingEmail(booking);

    return response.json({ booking });
  } catch (error) {
    console.error("Payment verification error:", error);
    return response.status(500).json({ error: "Payment verification failed." });
  }
});

// Error handling
app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Unhandled request error:", error);
  response.status(500).json({ error: "Something went wrong. Please try again." });
});

// Start Server
async function startServer() {
  try {
    await initDb();
    app.listen(port, () => {
      console.log(`Gather API listening on http://localhost:${port}`);
      void retryPendingBookingEmails();
    });
  } catch (error) {
    console.error("Server startup aborted due to DB error:", error);
    process.exit(1);
  }
}

startServer();
