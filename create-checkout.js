// netlify/functions/create-checkout.js
//
// Creates a Stripe Checkout Session from the cart the browser sends up,
// and returns the URL to redirect the customer to.
//
// Requires an environment variable set in the Netlify dashboard:
//   STRIPE_SECRET_KEY = sk_live_...  (or sk_test_... while testing)
//
// Optional env vars:
//   SUCCESS_URL  (defaults to your Webflow site + /order-confirmed)
//   CANCEL_URL   (defaults to your Webflow site + /the-wealth-shelf)
//   ALLOWED_ORIGIN (for CORS — set this to your live Webflow domain once you have it)

const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];

  // Basic validation — every item needs a Stripe price ID and a sane quantity
  const cleanLineItems = lineItems
    .filter((li) => li && typeof li.priceId === 'string' && li.priceId.startsWith('price_'))
    .map((li) => ({
      price: li.priceId,
      quantity: Math.max(1, Math.min(20, parseInt(li.quantity, 10) || 1)),
    }));

  if (cleanLineItems.length === 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'No valid line items provided' }),
    };
  }

  const successUrl =
    process.env.SUCCESS_URL ||
    'https://anas-choice-of-wealth-site.webflow.io/order-confirmed?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl =
    process.env.CANCEL_URL || 'https://anas-choice-of-wealth-site.webflow.io/the-wealth-shelf';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: cleanLineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // eBooks are digital delivery — no shipping address collection needed
      billing_address_collection: 'auto',
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('[create-checkout] Stripe error:', err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Could not start checkout. Please try again.' }),
    };
  }
};
