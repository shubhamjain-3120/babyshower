import { createDevLogger } from './devLogger';
import { trackClick } from './analytics';

const logger = createDevLogger('StripeManager');

const STRIPE_ENABLED = import.meta.env.VITE_STRIPE_ENABLED === 'true';
const API_URL = import.meta.env.VITE_API_URL || '';

// Check if running on Android app (not web)
function isAndroidApp() {
  return window.Capacitor?.isNativePlatform?.() || false;
}

export function isStripeEnabled() {
  return !isAndroidApp() && STRIPE_ENABLED;
}

// Check if venue is dev mode (for testing with $0.01 pricing)
function isDevModeVenue(venue) {
  const DEV_MODE_VENUE = 'Hotel Jain Ji Shubham';
  return venue?.trim().toLowerCase() === DEV_MODE_VENUE.toLowerCase();
}

// Load Stripe SDK dynamically
export async function initializeStripe() {
  if (!isStripeEnabled()) {
    logger.log('Stripe not enabled (disabled or Android platform)');
    return;
  }

  if (window.Stripe) {
    logger.log('Stripe SDK already loaded');
    return;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => {
      logger.log('Stripe SDK loaded successfully');
      resolve();
    };
    script.onerror = () => {
      logger.error('Failed to load Stripe SDK');
      reject(new Error('Failed to load Stripe SDK'));
    };
    document.body.appendChild(script);
  });
}

// Main purchase function - opens Stripe payment modal and handles payment
export async function purchaseVideoDownload(venue) {
  if (!window.Stripe) {
    return { success: false, error: 'Stripe SDK not loaded' };
  }

  try {
    logger.log('Fetching Stripe config');

    // Step 1: Get publishable key from backend
    const configRes = await fetch(`${API_URL}/api/config`);
    if (!configRes.ok) {
      throw new Error('Failed to fetch Stripe config');
    }

    const configData = await configRes.json();
    const publishableKey = configData.stripe?.publishableKey;

    if (!publishableKey) {
      throw new Error('Stripe publishable key not configured');
    }

    const stripe = window.Stripe(publishableKey);

    // Step 2: Create payment intent
    logger.log('Creating payment intent', { venue });
    const intentRes = await fetch(`${API_URL}/api/payment/stripe/create-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue }),
    });

    if (!intentRes.ok) {
      throw new Error('Failed to create payment intent');
    }

    const intentData = await intentRes.json();
    if (!intentData.success) {
      throw new Error(intentData.error || 'Payment intent creation failed');
    }

    const { clientSecret, amount } = intentData;

    logger.log('Payment intent created', { amount: amount / 100 });
    trackClick('payment_initiated', {
      platform: 'stripe',
      amount: amount / 100
    });

    // Step 3: Create Stripe Elements
    const elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create('payment');

    // Step 4: Create and show modal with payment form
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.id = 'stripe-modal';
      modal.innerHTML = `
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
        ">
          <div style="
            background: white;
            border-radius: 12px;
            padding: 32px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 4px 24px rgba(0,0,0,0.15);
          ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 24px; color: #621d35;">Complete Payment</h2>
              <button id="stripe-close" style="
                background: none;
                border: none;
                font-size: 28px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
              ">&times;</button>
            </div>
            <div style="margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
              <div style="font-size: 14px; color: #666; margin-bottom: 4px;">Amount to pay</div>
              <div style="font-size: 28px; font-weight: 600; color: #621d35;">
                $${(amount / 100).toFixed(2)} USD
              </div>
            </div>
            <form id="stripe-payment-form">
              <div id="stripe-payment-element" style="margin-bottom: 24px;"></div>
              <div id="stripe-error-message" style="
                color: #dc3545;
                font-size: 14px;
                margin-bottom: 16px;
                display: none;
              "></div>
              <button type="submit" id="stripe-submit" style="
                width: 100%;
                padding: 16px;
                background: #621d35;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
              ">
                Pay Now
              </button>
            </form>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Mount payment element
      paymentElement.mount('#stripe-payment-element');

      // Close handler
      const closeModal = () => {
        paymentElement.destroy();
        document.body.removeChild(modal);
      };

      document.getElementById('stripe-close').addEventListener('click', () => {
        logger.log('Payment modal closed by user');
        trackClick('payment_cancelled', { platform: 'stripe' });
        closeModal();
        resolve({ success: false, error: 'cancelled' });
      });

      // Form submit handler
      document.getElementById('stripe-payment-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('stripe-submit');
        const errorDiv = document.getElementById('stripe-error-message');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
        errorDiv.style.display = 'none';

        try {
          const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: window.location.href,
            },
            redirect: 'if_required',
          });

          if (confirmError) {
            throw new Error(confirmError.message);
          }

          if (paymentIntent.status === 'succeeded') {
            logger.log('Payment succeeded');
            trackClick('payment_success', {
              platform: 'stripe',
              payment_intent_id: paymentIntent.id,
            });

            closeModal();

            // Create verification token (similar to Razorpay)
            const verificationToken = btoa(`${paymentIntent.id}:${Date.now()}`);

            resolve({
              success: true,
              verificationToken,
            });
          } else {
            throw new Error(`Payment status: ${paymentIntent.status}`);
          }
        } catch (err) {
          logger.error('Payment failed', err);
          trackClick('payment_failed', {
            platform: 'stripe',
            error: err.message,
          });

          errorDiv.textContent = err.message || 'Payment failed. Please try again.';
          errorDiv.style.display = 'block';

          submitBtn.disabled = false;
          submitBtn.textContent = 'Pay Now';
        }
      });
    });

  } catch (err) {
    logger.error('Purchase flow failed', err);
    trackClick('payment_failed', {
      platform: 'stripe',
      error: err.message,
    });
    return {
      success: false,
      error: err.message || 'Payment failed. Please try again.',
    };
  }
}
