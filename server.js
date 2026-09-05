require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Stripe = require('stripe');

const app = express();

// --- Config -----------------------------------------------------------------
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;
const INITIAL_AMOUNT_USD = Number(process.env.INITIAL_AMOUNT_USD || 5);
const FOLLOWUP_AMOUNT_USD = Number(process.env.FOLLOWUP_AMOUNT_USD || 35);

if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}

if (!Number.isFinite(INITIAL_AMOUNT_USD) || INITIAL_AMOUNT_USD <= 0) {
  console.error('ERROR: INITIAL_AMOUNT_USD must be at least $0.50.');
  process.exit(1);
}

if (!Number.isFinite(FOLLOWUP_AMOUNT_USD) || FOLLOWUP_AMOUNT_USD <= 0) {
  console.error('ERROR: FOLLOWUP_AMOUNT_USD must be a positive number.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

// Stripe webhook must receive the raw request body. Keep this route BEFORE
// express.json(), otherwise Stripe signature verification will fail.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('Webhook received but STRIPE_WEBHOOK_SECRET is not configured.');
    return res.status(500).send('Webhook secret is not configured.');
  }

  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        if (session.mode !== 'payment' || session.payment_status !== 'paid' || !session.customer || !session.payment_intent) {
          break;
        }

        // Retrieve the PaymentIntent with its PaymentMethod so we can make the
        // saved card the Customer's default payment method. This makes later
        // Dashboard invoices and API charges use the same card automatically.
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent, {
          expand: ['payment_method'],
        });

        const paymentMethod = paymentIntent.payment_method;
        if (paymentMethod && typeof paymentMethod !== 'string') {
          await stripe.customers.update(session.customer, {
            invoice_settings: {
              default_payment_method: paymentMethod.id,
            },
            metadata: {
              payment_site: 'premium-service',
              initial_payment_intent: paymentIntent.id,
            },
          });

          console.log(`Customer ${session.customer}: default payment method set to ${paymentMethod.id}`);
        }

        break;
      }

      case 'payment_intent.succeeded':
        console.log(`PaymentIntent succeeded: ${event.data.object.id}`);
        break;

      case 'payment_intent.payment_failed':
        console.warn(`PaymentIntent failed: ${event.data.object.id}`);
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Webhook handler failed.');
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ----------------------------------------------------------------
function parseInitialAmountUsd(rawAmount) {
  // The initial booking amount may be supplied in the payment URL, e.g.
  // /?amount=3. The server validates the value before creating the Stripe
  // Checkout Session. If omitted, the Vercel default is used.
  const parsed = Number(rawAmount);
  if (!Number.isFinite(parsed)) return Math.round(INITIAL_AMOUNT_USD * 100) / 100;
  if (parsed < 0.5 || parsed > 2000) {
    throw new Error('Amount must be between $0.50 and $2,000.00.');
  }
  return Math.round(parsed * 100) / 100;
}

function getPublicBaseUrl(req) {
  // Use the actual hostname used by the customer, so a custom domain on Vercel
  // automatically works without changing the success/cancel URLs.
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  return (PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function usdToCents(amountUsd) {
  return Math.round(amountUsd * 100);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      error: 'ADMIN_TOKEN is not configured on the server.',
    });
  }

  const supplied = req.headers['x-admin-token'];
  if (!supplied || supplied !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  next();
}

// --- Initial $5 Checkout ----------------------------------------------------
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    let amountUsd;
    try {
      amountUsd = parseInitialAmountUsd(req.body && req.body.amount);
    } catch (amountError) {
      return res.status(400).json({ error: amountError.message });
    }
    const amountCents = usdToCents(amountUsd);

    // A real Stripe Customer is created up front. This is the important
    // difference from the previous Guest payment flow.
    const customer = await stripe.customers.create({
      email: req.body && typeof req.body.email === 'string' && req.body.email.trim()
        ? req.body.email.trim()
        : undefined,
      name: req.body && typeof req.body.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : undefined,
      metadata: {
        payment_site: 'premium-service',
      },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      locale: 'auto',
      managed_payments: {
        enabled: false,
      },
      billing_address_collection: 'auto',
      customer_update: {
        name: 'auto',
        address: 'auto',
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Оплата за бронювання',
              description: 'Одноразова оплата за бронювання. Додаткові платежі можливі лише відповідно до погоджених умов послуги.',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        // Save the PaymentMethod on this Stripe Customer for a later
        // merchant-initiated off-session charge.
        setup_future_usage: 'off_session',
        metadata: {
          payment_stage: 'initial',
          customer_id: customer.id,
        },
      },
      metadata: {
        payment_stage: 'initial',
        stripe_customer_id: customer.id,
        followup_amount_cents: String(usdToCents(FOLLOWUP_AMOUNT_USD)),
      },
      success_url: `${getPublicBaseUrl(req)}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getPublicBaseUrl(req)}/cancel.html`,
    });

    res.json({
      url: session.url,
      customerId: customer.id,
    });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: 'Unable to create checkout session.' });
  }
});

// --- Customer information --------------------------------------------------
// Used by the success page and admin page. It does not expose card numbers or
// sensitive payment data.
app.get('/api/session-info', async (req, res) => {
  try {
    const sessionId = String(req.query.session_id || '');
    if (!sessionId || !sessionId.startsWith('cs_')) {
      return res.status(400).json({ error: 'Invalid session_id.' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.payment_method'],
    });

    const customer = session.customer
      ? await stripe.customers.retrieve(session.customer)
      : null;

    res.json({
      paymentStatus: session.payment_status,
      customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      customerName: customer && !customer.deleted ? customer.name : null,
      customerEmail: customer && !customer.deleted ? customer.email : session.customer_details?.email || null,
      paymentIntentId: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null,
      followupAmountUsd: FOLLOWUP_AMOUNT_USD,
      amountUsd: session.amount_total ? session.amount_total / 100 : null,
    });
  } catch (err) {
    console.error('Error retrieving session info:', err);
    res.status(500).json({ error: 'Unable to retrieve payment information.' });
  }
});

// --- Automatic $35 follow-up charge ----------------------------------------
// This is intentionally server-side and protected by ADMIN_TOKEN. The amount
// is fixed by FOLLOWUP_AMOUNT_USD and cannot be changed by the browser.
app.post('/api/charge-followup', requireAdmin, async (req, res) => {
  try {
    const customerId = String(req.body && req.body.customerId || '').trim();
    const reference = String(req.body && req.body.reference || '').trim();

    if (!customerId || !customerId.startsWith('cus_')) {
      return res.status(400).json({ error: 'A valid Stripe Customer ID is required.' });
    }

    if (!reference || reference.length < 4 || reference.length > 100) {
      return res.status(400).json({ error: 'A unique service reference is required.' });
    }

    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return res.status(404).json({ error: 'Stripe Customer was deleted.' });
    }

    let paymentMethodId = customer.invoice_settings && customer.invoice_settings.default_payment_method;

    if (typeof paymentMethodId !== 'string') {
      const methods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      if (!methods.data.length) {
        return res.status(400).json({
          error: 'Не знайдено платіжний метод для цього Customer. Переконайтеся, що початкова оплата успішна та webhook налаштований.',
        });
      }

      paymentMethodId = methods.data[0].id;

      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }

    const amountCents = usdToCents(FOLLOWUP_AMOUNT_USD);
    const safeReference = reference.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70);
    const idempotencyKey = `followup_${customerId}_${safeReference}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Додаткова послуга — $${FOLLOWUP_AMOUNT_USD.toFixed(2)}`,
        metadata: {
          payment_stage: 'followup',
          service_reference: reference,
        },
      },
      { idempotencyKey }
    );

    res.json({
      ok: true,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      amountUsd: FOLLOWUP_AMOUNT_USD,
      customerId,
    });
  } catch (err) {
    console.error('Error charging follow-up:', err);

    // Stripe may return an authentication_required error for cards that cannot
    // complete an off-session charge without the customer present.
    if (err && err.code === 'authentication_required') {
      return res.status(402).json({
        error: 'Банк потребовал подтверждение клиента. Эту карту нельзя списать полностью автоматически.',
        code: 'authentication_required',
        paymentIntentId: err.payment_intent && err.payment_intent.id,
      });
    }

    res.status(500).json({
      error: err && err.message ? err.message : 'Unable to charge follow-up payment.',
      code: err && err.code,
    });
  }
});

// --- Health check -----------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    initialAmountUsd: INITIAL_AMOUNT_USD,
    followupAmountUsd: FOLLOWUP_AMOUNT_USD,
      amountUsd: session.amount_total ? session.amount_total / 100 : null,
    webhookConfigured: Boolean(STRIPE_WEBHOOK_SECRET),
    adminConfigured: Boolean(ADMIN_TOKEN),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  console.log(`Initial payment: $${INITIAL_AMOUNT_USD.toFixed(2)}`);
  console.log(`Follow-up payment: $${FOLLOWUP_AMOUNT_USD.toFixed(2)}`);
});
