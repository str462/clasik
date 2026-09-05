require('dotenv').config();
const express = require('express');
const path = require('path');
const Stripe = require('stripe');

const app = express();

// --- Config / sanity checks -------------------------------------------------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ------------------------------------------------------------------

// Amount limits (in whole dollars) accepted from the link's ?amount= query param.
// Adjust these if you need a wider/narrower range.
const MIN_AMOUNT_USD = 1;
const MAX_AMOUNT_USD = 2000;
const DEFAULT_AMOUNT_USD = 5;

function parseAmountUsd(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT_USD || amount > MAX_AMOUNT_USD) {
    return DEFAULT_AMOUNT_USD;
  }
  // Round to cents to avoid floating point weirdness.
  return Math.round(amount * 100) / 100;
}

// Creates a Stripe Checkout Session for a single ONE-TIME payment.
// mode: "payment" (never "subscription") — this only ever charges once.
// Any further payment is NOT handled here at all; that is billed manually
// later by the site owner (a fresh link, invoice, or Payment Link).
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const amountUsd = parseAmountUsd(req.body && req.body.amount);
    const amountCents = Math.round(amountUsd * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // one-time payment, not a subscription
      // Let Stripe auto-show payment methods based on your account/customer settings.
      // Ukrainian isn't one of Checkout's supported interface languages yet, so 'auto'
      // is the closest option — it matches the visitor's browser language when possible.
      locale: 'auto',
      // Your Stripe account has Managed Payments enabled by default, which requires
      // an eligible product tax_code (it's meant for digital goods like SaaS, games,
      // e-books, etc.). Since this is a custom service rather than one of those
      // categories, Managed Payments is explicitly disabled for this session so you
      // remain the merchant of record and handle tax/billing yourself as before.
      managed_payments: {
        enabled: false,
      },
      // Email field only (Stripe Checkout always requires it for the receipt —
      // there's no way to swap it for a name-only field on the hosted page).
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Преміум доступ — початковий платіж',
              description: 'Одноразовий початковий платіж. Додаткові послуги оплачуються окремо.',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      // Saves the card to the Customer object so you CAN charge it again later
      // (e.g. the $35 follow-up) from the Dashboard or API, without the customer
      // re-entering their card. This is a one-time payment, not a subscription —
      // nothing is charged automatically. Stripe requires a small-print disclosure
      // near the Pay button whenever a card is saved this way; that text can't be
      // removed, but it's just the one line of copy, not a separate checkbox.
      //
      // NOTE: the separate "Save my information for faster checkout" checkbox seen
      // earlier is Stripe's own Link feature, not something this code turns on —
      // it appears automatically whenever Link is enabled for your account. To turn
      // it off (and avoid the US-phone-number prompt), go to your Stripe Dashboard →
      // Settings → Payment methods → find "Link" → turn it off for this payment
      // method configuration. This does NOT affect Apple Pay/Google Pay, which are
      // separate and stay available.
      payment_intent_data: {
        setup_future_usage: 'off_session',
      },
      success_url: `${PUBLIC_BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_BASE_URL}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: 'Unable to create checkout session.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
});
