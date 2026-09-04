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

// Creates a Stripe Checkout Session for a single ONE-TIME payment of $5.
// mode: "payment" (never "subscription") — this only ever charges $5 once.
// The future $35 is NOT handled here at all; that is billed manually later
// by the site owner from the Stripe Dashboard.
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // one-time payment, not a subscription
      payment_method_types: undefined, // let Stripe auto-show methods based on account/customer settings
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Premium Access — Initial Payment',
              description: 'One-time initial payment. Any additional service is billed separately.',
            },
            unit_amount: 500, // $5.00 in cents
          },
          quantity: 1,
        },
      ],
      // Saves the customer's payment method on the Stripe Customer object so the
      // owner CAN optionally charge $35 later manually from the Dashboard if they
      // choose to. This does NOT create a subscription and does NOT charge anything
      // automatically.
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
