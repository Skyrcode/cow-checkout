// netlify/functions/stripe-webhook.js
//
// Stripe calls this automatically the instant a payment succeeds.
// It looks up what was bought, and emails the customer their download link(s).
//
// Requires these environment variables in Netlify:
//   STRIPE_SECRET_KEY     (same one used by create-checkout.js)
//   STRIPE_WEBHOOK_SECRET (from Stripe Dashboard → Developers → Webhooks → your endpoint)
//   RESEND_API_KEY        (from resend.com — free account)
//   FROM_EMAIL             e.g. "The Wealth Shelf <hello@yourdomain.com>"
//                          (while testing, "onboarding@resend.dev" works with no domain setup)

const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Maps each Stripe Price ID to the book name + the file the buyer should get.
// FILL IN: once the real PDFs are uploaded to the /files folder in this repo
// and deployed, the URLs below will work as-is (same site, same domain).
// Add the LIVE price IDs here too once Ana creates them in live mode.
const DOWNLOAD_LINKS = {
  'price_1U69oV2KArjSRP5oB8iJAnMG': {
    // TEST — The Choice of Wealth eBook
    name: 'The Choice of Wealth',
    url: 'https://YOUR-NETLIFY-SITE.netlify.app/files/choice-of-wealth.pdf',
  },
  'price_1U6A2v2KArjSRP5orFPu3l52': {
    // TEST — Fraud on Steroids eBook
    name: 'Fraud on Steroids',
    url: 'https://YOUR-NETLIFY-SITE.netlify.app/files/fraud-on-steroids.pdf',
  },
  'price_1U6A9d2KArjSRP5oLna93ZCW': {
    // TEST — Talk Risky to Me eBook
    name: 'Talk Risky to Me',
    url: 'https://YOUR-NETLIFY-SITE.netlify.app/files/talk-risky-to-me.pdf',
  },
  // 'price_LIVE_ID_HERE_1': { name: 'The Choice of Wealth', url: '...' },
  // 'price_LIVE_ID_HERE_2': { name: 'Fraud on Steroids', url: '...' },
  // 'price_LIVE_ID_HERE_3': { name: 'Talk Risky to Me', url: '...' },
};

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[stripe-webhook] signature check failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    // Not a completed payment — nothing to do, but tell Stripe we got it.
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;

  try {
    const customerEmail = session.customer_details && session.customer_details.email;
    if (!customerEmail) {
      console.error('[stripe-webhook] no customer email on session', session.id);
      return { statusCode: 200, body: 'no email on session' };
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });

    const purchasedBooks = lineItems.data
      .map((li) => DOWNLOAD_LINKS[li.price.id])
      .filter(Boolean);

    if (!purchasedBooks.length) {
      console.error('[stripe-webhook] no matching download links for session', session.id);
      return { statusCode: 200, body: 'no matching products' };
    }

    const linksHtml = purchasedBooks
      .map((b) => `<li><a href="${b.url}">${b.name}</a></li>`)
      .join('');

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'The Wealth Shelf <onboarding@resend.dev>',
        to: customerEmail,
        subject: 'Your eBook is ready to download',
        html:
          `<p>Thank you for your purchase! Here ${purchasedBooks.length > 1 ? 'are your download links' : 'is your download link'}:</p>` +
          `<ul>${linksHtml}</ul>` +
          `<p>Enjoy the read.<br/>— The Wealth Shelf</p>`,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error('[stripe-webhook] Resend error:', errText);
      return { statusCode: 500, body: 'email failed to send' };
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[stripe-webhook] unexpected error:', err.message);
    return { statusCode: 500, body: 'error processing order' };
  }
};
