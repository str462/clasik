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
      // Collects the customer's name as a first-class field. Email is still required
      // by Stripe Checkout (it's used for the receipt) and can't be removed entirely,
      // but this adds a name field alongside it.
      custom_fields: [
        {
          key: 'customer_name',
          label: { type: 'custom', custom: "Ваше ім'я" },
          type: 'text',
          optional: false,
        },
      ],
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
      // No setup_future_usage here: the card is NOT saved for a later automatic
      // charge. This keeps Checkout to a plain one-time payment, with no "save my
      // info" / Link prompt and no future-payments disclosure on the payment page.
      // Any future amount is collected via a new link/invoice sent separately.
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
