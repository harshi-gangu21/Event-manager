# Gather Feature and Navigation Guide

This guide explains how to use the deployed Gather event site, what each visible control does, and what to expect from account, payment, email, and chat features. For code structure, environment variables, and deployment setup, see [README.md](./README.md).

## Page layout

### Announcement bar and header

- **Gather logo** returns to the top of the page.
- **Discover** and **Explore events** take you to the event list.
- **Our thing** takes you to the introductory hero section.
- **Wishlist** turns the saved-event filter on or off. The number beside it is the number of saved event IDs in this browser.
- **Sign in** opens the account dialog. After sign-in, the header shows your first name and **Sign out**.

### Hero and event list

The hero introduces the site and links to the event list. The event section shows live totals, filters, and event cards. If the event API cannot be reached, an error message and **Try again** action appear instead of an empty catalog.

## Discover and filter events

1. Select a category chip: **Creative**, **Music**, **Food & Drink**, **Wellness**, **Community**, **Weddings**, **Birthdays**, **Private Functions**, or **Social Activities**. **All events** clears the category filter.
2. Select a city from the city menu. The available city options are derived from event venues currently returned by the API.
3. Type in the search field to match event title, category, venue, or description. Clearing the text restores the other matching results.
4. Turn on **Wishlist** in the header to show only saved cards. Category, city, text search, and wishlist filters work together.
5. If the current filters have no matches, the page displays a no-results message. Adjust or clear one or more filters.

The search field displays a keyboard shortcut hint, but filtering is currently performed by typing into the field; the hint does not trigger a separate keyboard shortcut.

## Read an event card

Each event card can show:

- Event date, time, title, venue, category, and description.
- A **From** ticket price in Indian rupees.
- A remaining-ticket label when the event is nearly full, or **Sold out** when no tickets remain.
- A capacity fill bar based on tickets sold relative to the event capacity.
- A decorative weather-vibe label derived from the event date. It is not a real weather forecast.
- A heart button to add or remove the event from the local wishlist.
- **Get tickets** to open the booking form. Sold-out events cannot be selected.

The stats strip is populated from the current API event response. Ticket totals represent bookings currently recorded in the database; it is not a live push feed.

## Save events to a wishlist

- Click the heart on a card to save it; click it again to remove it.
- The header's wishlist count updates immediately.
- Click **Wishlist** to filter the event grid to saved events. Click it again to show all matching events.
- Wishlist IDs are saved in this browser's `localStorage` under `gather_wishlist`. They are not synced to an account or another device. Clearing this browser's site data removes them.

## Create an account and sign in

1. Select **Sign in** in the header.
2. Choose **Create an account** to switch to sign-up, or enter your email/password to sign in.
3. Sign-up requires a name, valid email address, and password of at least 10 characters (maximum 128).
4. On success, the browser stores a signed JWT under `gather_jwt` and the header changes to the signed-in state.
5. Select **Sign out** to discard the local token. The API's JWT is stateless; signing out does not delete the user or booking history.

Authentication is required for creating a payment order. Sign in before beginning checkout. The API limits failed sign-in attempts per client IP to 10 in a 15-minute window.

## Book tickets

1. Sign in, then choose **Get tickets** on an event.
2. Enter the attendee name and email address. A signed-in user's name/email are prefilled when available; these can be changed for the attendee.
3. Use **−** and **+** to choose 1–10 tickets, subject to the remaining capacity returned to the page.
4. Review the total. The **Group deal unlocked** message appears for a quantity of 3 or more; it is a celebratory UI message and does not apply a price discount.
5. Select **Continue to secure payment**. The API creates a Razorpay order after checking sold tickets and recent open orders.
6. Complete payment in Razorpay Checkout. If checkout is dismissed or payment fails, the dialog reports the issue and lets you retry.
7. After payment, the site asks the backend to verify Razorpay's signature. A valid verification creates one booking and returns a booking reference.
8. The confirmation view shows the event, date/time, venue, ticket count, booking reference, and email-delivery status. Save the reference for check-in.

The confirmation appears only after payment verification succeeds. If the browser loses connectivity after payment, do not assume the booking failed or immediately make another purchase; retain any Razorpay payment details and contact the site operator to reconcile the payment.

## Booking confirmation email

The backend sends a styled HTML and plain-text confirmation to the attendee email entered during checkout. This requires valid SMTP environment variables on the backend, not in Netlify:

- `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE`
- `SMTP_USER` and `SMTP_PASS`
- `SMTP_FROM`

The confirmation view distinguishes a sent email from a failed or unavailable email. Email failure does not invalidate a successfully verified booking; use the booking reference for check-in. The active API also retries booking emails whose status is not `sent` when the service starts and when an existing paid order is verified again. It does not run a continuously scheduled retry worker.

## Ask Gather event assistant

1. Select the floating **Ask Gather** button in the lower-right corner.
2. Ask about an event name, category, city, date, ticket price, or availability.
3. Submit the message. The widget shows the recent conversation, a thinking indicator, and an error if the service cannot respond.
4. Close and reopen the panel to keep using the current tab's conversation.

The chatbot requires `GROQ_API_KEY` on the backend. Its answers are based on a small set of matching event rows retrieved from the database, and availability may change before checkout. It cannot create, cancel, or change bookings. If no matching event records are found, ask using a more specific event title, category, city, date, or budget.

The chat history is sent to the backend with each new question but is not persisted to an account or database. Avoid entering passwords, payment information, or other sensitive personal details into chat.

## Troubleshooting as a visitor

| What you see | What to try |
|---|---|
| Events do not load | Use **Try again**. If the issue continues, the API may be offline or the deployed API base/CORS configuration may be incorrect. |
| Sign-in says the server cannot be reached | Retry after a moment. On a deployed site, the operator should check the frontend's `VITE_API_BASE` and backend `CLIENT_ORIGIN`. |
| Checkout says sign in is required | Sign in from the header and try **Get tickets** again. |
| Checkout/payment is unavailable | The operator must configure Razorpay keys on the backend. Never send payment credentials through chat or email. |
| Booking is confirmed but no email arrives | Keep the booking reference. The operator should verify SMTP settings and inspect backend logs/email status. |
| Ask Gather says it is not configured | The operator must configure `GROQ_API_KEY` in the backend environment and restart/redeploy the API. |

## For event/site operators

Deployment configuration instructions are maintained in [README.md](./README.md#deployment-guide). In short:

- Groq, SMTP, Razorpay secret, JWT, and database connection values belong on the backend (local ignored `.env` or Render service environment).
- The Netlify frontend only needs `VITE_API_BASE`, set to the Render API origin. It must not contain secrets.
- Render `CLIENT_ORIGIN` must exactly match the deployed Netlify site origin.
- Do not commit `.env`, provider credentials, payment keys, database passwords, or API tokens.
