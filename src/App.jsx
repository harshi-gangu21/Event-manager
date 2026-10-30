import { useEffect, useMemo, useState } from "react";

const categories = [
  "All events",
  "Creative",
  "Music",
  "Food & Drink",
  "Wellness",
  "Community",
  "Weddings",
  "Birthdays",
  "Private Functions",
  "Social Activities",
];

function getRequestError(error, fallback) {
  if (error instanceof TypeError) {
    return "Gather can't reach its server. Start it with npm run dev, then reload this page.";
  }
  return error.message || fallback;
}

function formatDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatPrice(price) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(price);
}

const TOKEN_KEY = "gather_jwt";

// In production (Netlify) the API lives on a separate host (Render/Railway).
// Locally, Vite proxies /api to localhost:4000.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function saveToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

function authHeaders() {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Checkout couldn't load. Check your internet connection and try again."));
    document.body.appendChild(script);
  });
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
  if (name === "pin") return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === "close") return <svg {...common}><path d="m18 6-12 12M6 6l12 12" /></svg>;
  if (name === "spark") return <svg {...common}><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>;
  return null;
}

function EventCard({ event, onBook }) {
  const remaining = Math.max(0, event.capacity - event.ticketsSold);
  return (
    <article className="event-card">
      <div className="event-image-wrap">
        <img className="event-image" src={event.image} alt="" loading="lazy" />
        <span className={`category-tag tag-${event.accent}`}>{event.category}</span>
        {remaining <= 10 && remaining > 0 && <span className="few-left">Only {remaining} left</span>}
        {remaining === 0 && <span className="few-left sold-out">Sold out</span>}
      </div>
      <div className="event-content">
        <div className="event-meta"><span>{formatDate(event.date)}</span><span className="meta-dot" />{event.time}</div>
        <h3>{event.title}</h3>
        <p className="event-venue"><Icon name="pin" size={15} />{event.venue}</p>
        <p className="event-description">{event.description}</p>
        <div className="event-footer">
          <div><span className="price-label">From</span><strong>{formatPrice(event.price)}</strong></div>
          <button className="book-button" onClick={() => onBook(event)} disabled={remaining === 0}>
            {remaining === 0 ? "Sold out" : "Get tickets"} <Icon name="arrow" size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function BookingModal({ event, user, onClose, onBookingComplete }) {
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = Math.max(1, event.capacity - event.ticketsSold);

  useEffect(() => {
    const onKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function startCheckout(submitEvent) {
    submitEvent.preventDefault();
    setError("");
    setBusy(true);
    try {
      const orderResponse = await fetch(apiUrl("/api/orders"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ eventId: event.id, quantity }),
      });
      const orderData = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderData.error || "We couldn't start checkout.");

      await loadRazorpay();
      const checkout = new window.Razorpay({
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Gather",
        description: orderData.eventName,
        order_id: orderData.orderId,
        prefill: { name: name.trim(), email: email.trim() },
        theme: { color: "#5a4af4" },
        handler: async (payment) => {
          try {
            const verifyResponse = await fetch(apiUrl("/api/payments/verify"), {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({
                ...payment,
                attendeeName: name,
                attendeeEmail: email,
              }),
            });
            const verifyData = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verifyData.error || "Payment verification failed.");
            onBookingComplete(verifyData.booking);
          } catch (verificationError) {
            setError(getRequestError(verificationError, "Payment verification failed."));
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });
      checkout.on("payment.failed", (failure) => {
        setError(failure.error?.description || "Payment failed. Please try again.");
        setBusy(false);
      });
      checkout.open();
    } catch (checkoutError) {
      setError(getRequestError(checkoutError, "We couldn't start checkout."));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(eventClick) => {
      if (eventClick.target === eventClick.currentTarget && !busy) onClose();
    }}>
      <section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
        <button className="modal-close" onClick={onClose} aria-label="Close booking"><Icon name="close" /></button>
        <div className="modal-image" style={{ backgroundImage: `linear-gradient(0deg, rgba(16,17,29,.35), transparent), url("${event.image}")` }}>
          <span className="category-tag tag-light">{event.category}</span>
        </div>
        <div className="modal-body">
          <div className="event-meta">{formatDate(event.date)} <span className="meta-dot" /> {event.time}</div>
          <h2 id="booking-title">{event.title}</h2>
          <p className="event-venue"><Icon name="pin" size={15} />{event.venue}</p>
          <form onSubmit={startCheckout}>
            <label className="field-label" htmlFor="attendee-name">Your name</label>
            <input id="attendee-name" autoComplete="name" value={name} onChange={(change) => setName(change.target.value)} minLength={2} maxLength={100} required />
            <label className="field-label" htmlFor="attendee-email">Email for your tickets</label>
            <input id="attendee-email" type="email" autoComplete="email" value={email} onChange={(change) => setEmail(change.target.value)} maxLength={254} required />
            <div className="quantity-row">
              <div><span className="field-label">Tickets</span><span className="quantity-hint">Up to 10 per order</span></div>
              <div className="quantity-picker">
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Remove one ticket">−</button>
                <span>{quantity}</span>
                <button type="button" onClick={() => setQuantity((value) => Math.min(10, remaining, value + 1))} aria-label="Add one ticket" disabled={quantity >= remaining}>+</button>
              </div>
            </div>
            <div className="total-row"><span>Total</span><strong>{formatPrice(event.price * quantity)}</strong></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="checkout-button" type="submit" disabled={busy}>
              {busy ? <><span className="spinner" /> Connecting to checkout…</> : <>Continue to secure payment <Icon name="arrow" size={17} /></>}
            </button>
            <p className="secure-note">Secure checkout powered by Razorpay</p>
          </form>
        </div>
      </section>
    </div>
  );
}

function AuthModal({ onClose, onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSignUp = mode === "signup";

  useEffect(() => {
    const onKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function submitAuth(submitEvent) {
    submitEvent.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/auth/${mode}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn't complete sign in.");
      saveToken(data.token);
      onAuthenticated(data.user);
    } catch (authError) {
      setError(getRequestError(authError, "We couldn't complete sign in."));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(clickEvent) => {
      if (clickEvent.target === clickEvent.currentTarget && !busy) onClose();
    }}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close account form"><Icon name="close" /></button>
        <div className="confirmation-icon"><Icon name="spark" size={26} /></div>
        <span className="eyebrow">{isSignUp ? "COME ON IN" : "GOOD TO SEE YOU"}</span>
        <h2 id="auth-title">{isSignUp ? "Create your account." : "Welcome back."}</h2>
        <p className="auth-description">{isSignUp ? "Save your details and make your next booking a little easier." : "Sign in to pick up where you left off."}</p>
        <form onSubmit={submitAuth}>
          {isSignUp && <>
            <label className="field-label" htmlFor="account-name">Your name</label>
            <input id="account-name" autoComplete="name" value={name} onChange={(change) => setName(change.target.value)} minLength={2} maxLength={100} required />
          </>}
          <label className="field-label" htmlFor="account-email">Email address</label>
          <input id="account-email" type="email" autoComplete="email" value={email} onChange={(change) => setEmail(change.target.value)} maxLength={254} required />
          <label className="field-label" htmlFor="account-password">Password</label>
          <input id="account-password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} value={password} onChange={(change) => setPassword(change.target.value)} minLength={isSignUp ? 10 : undefined} maxLength={128} required />
          {isSignUp && <p className="password-hint">Use at least 10 characters.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="checkout-button" type="submit" disabled={busy}>
            {busy ? <><span className="spinner" /> One moment…</> : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="auth-switch">
          {isSignUp ? "Already have an account?" : "New around here?"}{" "}
          <button type="button" onClick={() => switchMode(isSignUp ? "login" : "signup")}>
            {isSignUp ? "Sign in" : "Create an account"}
          </button>
        </p>
        <p className="secure-note">Your password is stored securely and never sent to the browser in plain text.</p>
      </section>
    </div>
  );
}

function Confirmation({ booking, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
        <div className="confirmation-icon"><Icon name="spark" size={28} /></div>
        <span className="eyebrow">YOU'RE ON THE LIST</span>
        <h2 id="confirmation-title">It's happening.</h2>
        <p className="confirmation-copy">Your tickets are booked, {booking.attendeeName.split(" ")[0]}. We've got a feeling you'll love this.</p>
        <div className="ticket-stub">
          <strong>{booking.eventName}</strong>
          <span>{formatDate(booking.eventDate)} · {booking.eventTime}</span>
          <span>{booking.venue}</span>
          <div className="ticket-divider" />
          <div className="ticket-bottom"><span>{booking.quantity} {booking.quantity === 1 ? "ticket" : "tickets"}</span><span>{booking.id}</span></div>
        </div>
        <p className="email-note">
          {booking.emailStatus === "sent"
            ? <>Your ticket confirmation was emailed to <strong>{booking.attendeeEmail}</strong>.</>
            : booking.emailStatus === "failed"
              ? <>Your booking is confirmed, but we couldn't email <strong>{booking.attendeeEmail}</strong>. Please keep your reference <strong>{booking.id}</strong> for check-in.</>
              : <>Your booking is saved for <strong>{booking.attendeeEmail}</strong>. Email notifications are not configured yet; keep your reference <strong>{booking.id}</strong> for check-in.</>}
        </p>
        <button className="checkout-button" onClick={onClose}>Back to exploring <Icon name="arrow" size={17} /></button>
      </section>
    </div>
  );
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [user, setUser] = useState(null);
  const [activeCategory, setActiveCategory] = useState("All events");
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [authNotice, setAuthNotice] = useState("");

  async function fetchEvents() {
    try {
      const response = await fetch(apiUrl("/api/events"));
      if (!response.ok) throw new Error("We couldn't load the events right now.");
      setEvents(await response.json());
      setLoadError("");
    } catch (error) {
      setLoadError(getRequestError(error, "We couldn't load the events right now."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEvents();
    if (!getToken()) {
      setLoading(false);
      return;
    }
    fetch(apiUrl("/api/auth/me"), { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired.");
        const data = await response.json();
        setUser(data.user);
      })
      .catch(() => {
        clearToken();
        setUser(null);
      });
  }, []);

  const filteredEvents = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return events.filter((event) => {
      const matchesCategory = activeCategory === "All events" || event.category === activeCategory;
      const matchesSearch = !searchTerm || `${event.title} ${event.category} ${event.venue} ${event.description}`.toLowerCase().includes(searchTerm);
      return matchesCategory && matchesSearch;
    });
  }, [events, activeCategory, search]);

  function completeBooking(confirmedBooking) {
    setSelectedEvent(null);
    setBooking(confirmedBooking);
    fetchEvents();
  }

  async function signOut() {
    setAuthNotice("");
    try {
      const response = await fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error("We couldn't sign you out. Please try again.");
      clearToken();
      setUser(null);
      setAuthNotice("You have been signed out.");
    } catch (error) {
      setAuthNotice(getRequestError(error, "We couldn't sign you out. Please try again."));
    }
  }

  return (
    <div className="app-shell">
      <div className="announcement"><Icon name="spark" size={15} /> Good things happen when we get together. <a href="#events">Find your people <Icon name="arrow" size={13} /></a></div>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Gather home"><span className="brand-mark"><i /><i /><i /><i /></span>gather<span className="brand-period">.</span></a>
        <nav className="main-nav"><a className="nav-active" href="#events">Discover</a><a href="#about">Our thing</a></nav>
        <div className="account-actions">
          {user
            ? <><span className="account-greeting">Hi, {user.name.split(" ")[0]}</span><button className="account-button sign-out-button" onClick={signOut}>Sign out</button></>
            : <button className="account-button" onClick={() => setShowAuth(true)}>Sign in</button>}
        </div>
        <a className="header-cta" href="#events">Explore events <Icon name="arrow" size={16} /></a>
      </header>
      {authNotice && <div className="account-notice" role="status">{authNotice}</div>}

      <main>
        <section className="hero" id="about">
          <div className="hero-copy">
            <div className="hero-kicker"><span /> YOUR CITY, A LITTLE MORE ALIVE</div>
            <h1>Find your<br /><span>next thing.</span></h1>
            <p>Good people. Great plans. The kind of days you wish you could bottle up. Your next favourite memory is right around the corner.</p>
            <a className="hero-link" href="#events">See what's happening <span><Icon name="arrow" size={17} /></span></a>
            <div className="social-proof"><div className="avatar-stack"><span>R</span><span>A</span><span>M</span><span>S</span></div><p><strong>2,400+</strong> people found their thing this month</p></div>
          </div>
          <div className="hero-art">
            <div className="hero-image"><img src="https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1200&q=90" alt="Friends sharing a meal around a table" /></div>
            <div className="floating-note"><span className="note-spark">✳</span><div><strong>Make room for</strong><br />a little magic.</div></div>
            <div className="hero-sticker">GOOD<br />VIBES<br /><span>ONLY</span></div>
            <div className="hero-image-label"><span className="label-dot" /> REAL PEOPLE. REAL GOOD TIMES.</div>
          </div>
          <div className="hero-side-note">A GOOD TIME IS CLOSER THAN YOU THINK <span>↘</span></div>
        </section>

        <section className="events-section" id="events">
          <div className="section-heading">
            <div><span className="eyebrow">THE GOOD STUFF</span><h2>Plans worth <span>leaving home for.</span></h2></div>
            <p>Handpicked happenings for the<br className="desktop-break" /> curious, the creative, the just-because.</p>
          </div>
          <div className="discovery-tools">
            <div className="category-list" role="tablist" aria-label="Filter events by category">
              {categories.map((category) => <button key={category} role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? "category-filter selected" : "category-filter"} onClick={() => setActiveCategory(category)}>{category}</button>)}
            </div>
            <label className="search-box"><Icon name="search" size={18} /><input aria-label="Search events" placeholder="Find your kind of thing..." value={search} onChange={(change) => setSearch(change.target.value)} /><kbd>⌘ K</kbd></label>
          </div>

          {loadError && <div className="state-message error-state" role="alert">{loadError} <button onClick={fetchEvents}>Try again</button></div>}
          {loading && <div className="state-message">Finding the good stuff<span className="loading-dots">...</span></div>}
          {!loading && !loadError && filteredEvents.length === 0 && <div className="state-message">No plans match that just yet. Try another search.</div>}
          {!loading && !loadError && filteredEvents.length > 0 && <div className="event-grid">{filteredEvents.map((event) => <EventCard key={event.id} event={event} onBook={setSelectedEvent} />)}</div>}
          <div className="more-events"><span>THERE'S ALWAYS SOMETHING GOOD AROUND THE CORNER</span><span className="hand-drawn-arrow">↗</span></div>
        </section>

        <section className="community-banner">
          <div className="community-icon"><Icon name="spark" size={26} /></div>
          <div><span className="eyebrow">A LITTLE MORE TOGETHER</span><h2>Life's better <span>out there.</span></h2><p>Make a plan. Bring a friend. Leave with a story.</p></div>
          <a href="#events" className="community-link">Find your next thing <Icon name="arrow" size={17} /></a>
          <span className="banner-decoration">✳</span>
        </section>
      </main>

      <footer className="site-footer"><a className="brand footer-brand" href="#"><span className="brand-mark"><i /><i /><i /><i /></span>gather<span className="brand-period">.</span></a><span>MADE FOR THE MOMENTS THAT MATTER.</span><span>© 2026 GATHER</span></footer>

      {selectedEvent && <BookingModal event={selectedEvent} user={user} onClose={() => setSelectedEvent(null)} onBookingComplete={completeBooking} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuthenticated={(signedInUser) => {
        setUser(signedInUser);
        setShowAuth(false);
        setAuthNotice(`You're signed in as ${signedInUser.email}.`);
      }} />}
      {booking && <Confirmation booking={booking} onClose={() => setBooking(null)} />}
    </div>
  );
}
