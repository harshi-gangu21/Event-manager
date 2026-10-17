import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import nodemailer from "nodemailer";
import Razorpay from "razorpay";

const app = express();
const port = Number(process.env.PORT) || 4000;
const directory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(directory, "data");
const dataFile = process.env.GATHER_DATA_FILE || path.join(dataDirectory, "store.json");
const scrypt = promisify(crypto.scrypt);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessionCookieName = "gather_session";
const passwordHashBytes = 64;
const authFailureLimit = 10;
const authFailureWindowMs = 15 * 60 * 1000;
const authFailures = new Map();

const initialEvents = [
  {
    id: "design-after-hours",
    title: "Design After Hours",
    category: "Creative",
    date: "2026-11-06",
    time: "6:30 PM",
    venue: "The Quorum, Mumbai",
    price: 899,
    capacity: 120,
    description: "An easygoing evening of ideas, good company, and conversations with the people shaping what comes next.",
    image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=85",
    accent: "rose",
  },
  {
    id: "sunday-soul-sessions",
    title: "Sunday Soul Sessions",
    category: "Music",
    date: "2026-11-08",
    time: "4:00 PM",
    venue: "Bandra Amphitheatre, Mumbai",
    price: 650,
    capacity: 300,
    description: "Golden-hour live music, a little dancing, and the kind of Sunday you wish lasted longer.",
    image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1000&q=85",
    accent: "violet",
  },
  {
    id: "the-table-together",
    title: "The Table, Together",
    category: "Food & Drink",
    date: "2026-11-12",
    time: "7:00 PM",
    venue: "Little House, Mumbai",
    price: 1200,
    capacity: 40,
    description: "A long-table dinner for curious eaters. Seasonal plates, natural wine, and new friends.",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1000&q=85",
    accent: "amber",
  },
  {
    id: "slow-mornings-club",
    title: "Slow Mornings Club",
    category: "Wellness",
    date: "2026-11-14",
    time: "8:00 AM",
    venue: "Juhu Beach, Mumbai",
    price: 450,
    capacity: 60,
    description: "A gentle beach yoga flow, a deep breath, and coffee with a lovely little community.",
    image: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1000&q=85",
    accent: "green",
  },
  {
    id: "makers-market-weekend",
    title: "Makers Market Weekend",
    category: "Creative",
    date: "2026-11-15",
    time: "11:00 AM",
    venue: "Jio World Drive, Mumbai",
    price: 299,
    capacity: 500,
    description: "Meet independent makers, find something one-of-a-kind, and spend the day doing good things.",
    image: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=1000&q=85",
    accent: "blue",
  },
  {
    id: "city-lights-photo-walk",
    title: "City Lights Photo Walk",
    category: "Community",
    date: "2026-11-19",
    time: "5:30 PM",
    venue: "Gateway of India, Mumbai",
    price: 350,
    capacity: 35,
    description: "See the familiar differently on a relaxed photo walk through the city as the sun goes down.",
    image: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1000&q=85",
    accent: "navy",
  },
  {
    id: "garden-wedding-open-house",
    title: "The Garden Wedding Open House",
    category: "Weddings",
    date: "2026-11-21",
    time: "11:00 AM",
    venue: "Taj Lands End, Mumbai",
    price: 1500,
    capacity: 80,
    description: "Meet local wedding planners, florists, and photographers and gather fresh ideas for your celebration.",
    image: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1000&q=85",
    accent: "wedding",
  },
  {
    id: "birthday-brunch-club",
    title: "The Birthday Brunch Club",
    category: "Birthdays",
    date: "2026-11-22",
    time: "12:00 PM",
    venue: "Olive Bar & Kitchen, Mumbai",
    price: 999,
    capacity: 50,
    description: "Cake, brunch, and new friends at a cheerful birthday table where everyone gets to celebrate.",
    image: "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=1000&q=85",
    accent: "birthday",
  },
  {
    id: "celebrate-together-social",
    title: "Celebrate Together",
    category: "Private Functions",
    date: "2026-11-26",
    time: "6:00 PM",
    venue: "The Terrace, Mumbai",
    price: 1800,
    capacity: 100,
    description: "An evening of live music, great food, and thoughtful details—ideas for your next private celebration.",
    image: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1000&q=85",
    accent: "function",
  },
  {
    id: "neighbourhood-game-night",
    title: "Neighbourhood Game Night",
    category: "Social Activities",
    date: "2026-11-28",
    time: "5:00 PM",
    venue: "The Commons, Mumbai",
    price: 399,
    capacity: 70,
    description: "A friendly, no-pressure evening of board games and conversation. Come solo or bring someone along.",
    image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1000&q=85",
    accent: "social",
  },
];

function readStore() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  if (!fs.existsSync(dataFile)) {
    const seeded = { events: initialEvents, orders: {}, bookings: [], users: [], sessions: {} };
    fs.writeFileSync(dataFile, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const saved = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const needsMigration = !Array.isArray(saved.users) ||
    !saved.sessions ||
    typeof saved.sessions !== "object" ||
    Array.isArray(saved.sessions);
  saved.users = Array.isArray(saved.users) ? saved.users : [];
  saved.sessions = saved.sessions && typeof saved.sessions === "object" && !Array.isArray(saved.sessions)
    ? saved.sessions
    : {};
  const existingIds = new Set(saved.events.map((event) => event.id));
  const newEvents = initialEvents.filter((event) => !existingIds.has(event.id));
  if (newEvents.length > 0 || needsMigration) {
    saved.events.push(...newEvents);
    fs.writeFileSync(dataFile, JSON.stringify(saved, null, 2));
  }
  return saved;
}

let store = readStore();

function saveStore() {
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function getSessionToken(request) {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(sessionCookieName.length + 1));
  } catch {
    return null;
  }
}

function getSessionUser(request) {
  const token = getSessionToken(request);
  if (!token) return null;
  const sessionId = crypto.createHash("sha256").update(token).digest("hex");
  const session = store.sessions[sessionId];
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    delete store.sessions[sessionId];
    saveStore();
    return null;
  }
  return store.users.find((user) => user.id === session.userId) ?? null;
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeMs / 1000}${secure}`,
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

function createSession(user, response) {
  const now = Date.now();
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    if (session.expiresAt <= now) delete store.sessions[sessionId];
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const sessionId = crypto.createHash("sha256").update(token).digest("hex");
  store.sessions[sessionId] = { userId: user.id, expiresAt: now + sessionLifetimeMs };
  saveStore();
  setSessionCookie(response, token);
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, passwordHashBytes);
  return { salt, hash: hash.toString("hex") };
}

async function verifyPassword(password, user) {
  const candidate = await scrypt(password, user.passwordSalt, passwordHashBytes);
  const storedHash = Buffer.from(user.passwordHash, "hex");
  return storedHash.length === candidate.length && crypto.timingSafeEqual(storedHash, candidate);
}

function isAuthRateLimited(request) {
  const now = Date.now();
  const failures = (authFailures.get(request.ip) ?? []).filter((timestamp) => now - timestamp < authFailureWindowMs);
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

function ticketsSold(eventId) {
  return store.bookings
    .filter((booking) => booking.eventId === eventId)
    .reduce((total, booking) => total + booking.quantity, 0);
}

function ticketsReserved(eventId) {
  const now = Date.now();
  return Object.values(store.orders)
    .filter((order) => {
      const age = now - new Date(order.createdAt).getTime();
      return order.eventId === eventId &&
        (order.status === "creating" || order.status === "created") &&
        age >= 0 &&
        age < 15 * 60 * 1000;
    })
    .reduce((total, order) => total + order.quantity, 0);
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
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
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
  return value.replace(/[&<>"']/g, (character) => ({
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
    saveStore();
    return booking;
  }

  booking.emailStatus = "sending";
  saveStore();
  const safeName = escapeHtml(booking.attendeeName);
  const safeEventName = escapeHtml(booking.eventName);
  const safeDate = escapeHtml(new Date(`${booking.eventDate}T12:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }));
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
  } catch (error) {
    booking.emailStatus = "failed";
    console.error(`Booking confirmation email failed for ${booking.id}:`, error);
  }
  saveStore();
  return booking;
}

async function retryPendingBookingEmails() {
  for (const booking of store.bookings) {
    if (booking.emailStatus !== "sent") {
      await sendBookingEmail(booking);
    }
  }
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/auth/me", (request, response) => {
  const user = getSessionUser(request);
  response.json({ user: user ? publicUser(user) : null });
});

app.post("/api/auth/signup", async (request, response) => {
  if (isAuthRateLimited(request)) {
    return response.status(429).json({ error: "Too many account attempts. Please wait 15 minutes and try again." });
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
    return response.status(400).json({ error: "Enter your name, a valid email, and a password between 10 and 128 characters." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (store.users.some((user) => user.email === normalizedEmail)) {
    recordAuthFailure(request);
    return response.status(409).json({ error: "An account with this email already exists. Sign in instead." });
  }

  const passwordCredentials = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: normalizedEmail,
    passwordSalt: passwordCredentials.salt,
    passwordHash: passwordCredentials.hash,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  createSession(user, response);
  clearAuthFailures(request);
  return response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (request, response) => {
  if (isAuthRateLimited(request)) {
    return response.status(429).json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." });
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
  const user = store.users.find((item) => item.email === normalizedEmail);
  if (!user || !(await verifyPassword(password, user))) {
    recordAuthFailure(request);
    return response.status(401).json({ error: "Email or password is incorrect." });
  }

  createSession(user, response);
  clearAuthFailures(request);
  return response.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (request, response) => {
  const token = getSessionToken(request);
  if (token) {
    const sessionId = crypto.createHash("sha256").update(token).digest("hex");
    delete store.sessions[sessionId];
    saveStore();
  }
  clearSessionCookie(response);
  return response.json({ user: null });
});

app.get("/api/events", (_request, response) => {
  const events = store.events.map((event) => ({
    ...event,
    ticketsSold: ticketsSold(event.id),
  }));
  response.json(events);
});

app.post("/api/orders", async (request, response) => {
  const { eventId, quantity } = request.body ?? {};
  if (typeof eventId !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return response.status(400).json({ error: "Choose an event and a quantity between 1 and 10." });
  }

  const event = store.events.find((item) => item.id === eventId);
  if (!event) {
    return response.status(404).json({ error: "That event could not be found." });
  }
  if (ticketsSold(eventId) + ticketsReserved(eventId) + quantity > event.capacity) {
    return response.status(409).json({ error: "There are not enough tickets left for that quantity." });
  }

  const razorpay = getRazorpay();
  if (!razorpay) {
    return response.status(503).json({ error: "Payments are not configured yet. Add your Razorpay test keys to the server .env file." });
  }

  const amount = event.price * quantity * 100;
  const reservationId = `pending_${crypto.randomUUID()}`;
  store.orders[reservationId] = {
    eventId,
    quantity,
    amount,
    status: "creating",
    createdAt: new Date().toISOString(),
  };
  saveStore();

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `gather_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      notes: { eventId, quantity: String(quantity) },
    });
    store.orders[order.id] = { ...store.orders[reservationId], status: "created" };
    delete store.orders[reservationId];
    saveStore();
    return response.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      eventName: event.title,
    });
  } catch (error) {
    delete store.orders[reservationId];
    saveStore();
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

  const order = store.orders[orderId];
  if (!order) {
    return response.status(400).json({ error: "This checkout order is invalid." });
  }
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return response.status(503).json({ error: "Payment verification is not configured on the server." });
  }
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, "hex");
  } catch {
    return response.status(400).json({ error: "The payment signature is invalid." });
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
    return response.status(400).json({ error: "We couldn't verify this payment. Please contact support before trying again." });
  }
  if (order.status === "paid") {
    const existingBooking = store.bookings.find((item) => item.orderId === orderId);
    if (existingBooking) {
      await sendBookingEmail(existingBooking);
      return response.json({ booking: existingBooking });
    }
  }
  if (order.status !== "created") {
    return response.status(400).json({ error: "This checkout order is invalid or has expired." });
  }

  const event = store.events.find((item) => item.id === order.eventId);
  if (!event) {
    return response.status(404).json({ error: "The event for this payment could not be found." });
  }
  const alreadySold = ticketsSold(event.id);
  if (alreadySold + order.quantity > event.capacity) {
    return response.status(409).json({ error: "Payment was received, but ticket availability needs assistance. Please contact support." });
  }

  const booking = {
    id: `GTH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    orderId,
    paymentId,
    eventId: event.id,
    eventName: event.title,
    eventDate: event.date,
    eventTime: event.time,
    venue: event.venue,
    quantity: order.quantity,
    amount: order.amount,
    attendeeName: attendeeName.trim(),
    attendeeEmail: attendeeEmail.trim().toLowerCase(),
    createdAt: new Date().toISOString(),
    emailStatus: "pending",
  };
  order.status = "paid";
  store.bookings.push(booking);
  saveStore();
  await sendBookingEmail(booking);
  return response.json({ booking });
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
  void retryPendingBookingEmails();
});
