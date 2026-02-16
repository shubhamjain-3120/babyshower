import { createDevLogger } from './devLogger';
import { trackClick } from './analytics';

const logger = createDevLogger('PayPalManager');

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || '';
const PAYPAL_ENABLED = import.meta.env.VITE_PAYPAL_ENABLED === 'true';
const PAYPAL_INTENT = (import.meta.env.VITE_PAYPAL_INTENT || 'capture').toLowerCase();
const API_URL = import.meta.env.VITE_API_URL || '';

// Check if running on Android app (not web)
function isAndroidApp() {
  return window.Capacitor?.isNativePlatform?.() || false;
}

export function isPaypalEnabled() {
  return !isAndroidApp() && PAYPAL_ENABLED && Boolean(PAYPAL_CLIENT_ID);
}

function resolvePaypalCurrency(userRegion) {
  return (userRegion?.currency || 'USD').toUpperCase();
}

let paypalScriptPromise = null;
let paypalScriptCurrency = null;

function buildSdkUrl(currency) {
  const params = new URLSearchParams({
    'client-id': PAYPAL_CLIENT_ID,
    currency: currency || 'USD',
    intent: PAYPAL_INTENT === 'authorize' ? 'authorize' : 'capture',
  });

  params.set('components', 'card-fields');

  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

export async function initializePaypal(currency) {
  if (!isPaypalEnabled()) {
    logger.log('PayPal not enabled (disabled, missing client id, or Android platform)');
    return;
  }

  if (window.paypal && paypalScriptCurrency === currency) {
    logger.log('PayPal SDK already loaded');
    return;
  }

  if (paypalScriptPromise && paypalScriptCurrency === currency) {
    return paypalScriptPromise;
  }

  paypalScriptCurrency = currency;
  paypalScriptPromise = new Promise((resolve, reject) => {
    if (window.paypal) {
      delete window.paypal;
    }

    const script = document.createElement('script');
    script.src = buildSdkUrl(currency);
    script.onload = () => {
      logger.log('PayPal SDK loaded successfully');
      resolve();
    };
    script.onerror = () => {
      logger.error('Failed to load PayPal SDK');
      reject(new Error('Failed to load PayPal SDK'));
    };
    document.body.appendChild(script);
  });

  return paypalScriptPromise;
}

export async function purchaseVideoDownload(venue, userRegion) {
  const currency = resolvePaypalCurrency(userRegion);

  try {
    await initializePaypal(currency);
  } catch (err) {
    logger.error('Failed to initialize PayPal SDK', err);
  }

  if (!window.paypal) {
    return { success: false, error: 'PayPal SDK not loaded' };
  }

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'paypal-modal';
    modal.innerHTML = `
      <div class="paypal-modal-overlay">
        <div class="paypal-modal">
          <div class="paypal-modal-header">
            <div class="paypal-modal-title-wrap">
              <div class="paypal-modal-title">Secure card payment</div>
              <div class="paypal-modal-subtitle">Powered by PayPal</div>
            </div>
            <button id="paypal-close" class="paypal-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="paypal-modal-amount">
            <div class="paypal-modal-amount-label">Amount</div>
            <div class="paypal-modal-amount-value">
              ${(userRegion?.displayPrice || '$4.99')} ${currency}
            </div>
          </div>
          <div class="paypal-modal-logos">
            <span class="paypal-modal-logos-label">Supported cards</span>
            <div class="paypal-card-logos">
              <img class="paypal-card-logo" src="/assets/cards/visa.svg" alt="Visa" />
              <img class="paypal-card-logo" src="/assets/cards/mastercard.svg" alt="Mastercard" />
              <img class="paypal-card-logo" src="/assets/cards/amex.svg" alt="American Express" />
              <img class="paypal-card-logo" src="/assets/cards/discover.svg" alt="Discover" />
            </div>
          </div>
          <div id="paypal-error-message" class="paypal-error-message"></div>
          <div class="paypal-card-fields">
            <div class="paypal-card-field">
              <label class="paypal-card-label">Card number</label>
              <div id="paypal-card-number" class="paypal-card-input"></div>
            </div>
            <div class="paypal-card-grid">
              <div class="paypal-card-field">
                <label class="paypal-card-label">Expiry</label>
                <div id="paypal-card-expiry" class="paypal-card-input"></div>
              </div>
              <div class="paypal-card-field">
                <label class="paypal-card-label">CVV</label>
                <div id="paypal-card-cvv" class="paypal-card-input"></div>
              </div>
            </div>
            <button id="paypal-card-submit" class="paypal-card-submit">Pay now</button>
            <div class="paypal-secure-note">
              <svg class="paypal-secure-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1.5c-3.1 0-5.5 2.4-5.5 5.5v3H5a1 1 0 0 0-1 1v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9a1 1 0 0 0-1-1h-1.5v-3c0-3.1-2.4-5.5-5.5-5.5Zm3.5 8.5h-7v-3a3.5 3.5 0 1 1 7 0v3Z" fill="currentColor"/>
              </svg>
              <span>Secured by PayPal. We do not store card details.</span>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let resolved = false;
    const errorDiv = modal.querySelector('#paypal-error-message');

    const finalize = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        document.body.removeChild(modal);
      } catch {
        // ignore
      }
      resolve(result);
    };

    const closeModal = () => {
      logger.log('PayPal modal closed by user');
      trackClick('payment_cancelled', { platform: 'paypal' });
      finalize({ success: false, error: 'cancelled' });
    };

    modal.querySelector('#paypal-close').addEventListener('click', closeModal);

    if (!window.paypal?.CardFields) {
      logger.error('PayPal CardFields not available');
      errorDiv.textContent = 'PayPal card payments are not available right now.';
      errorDiv.style.display = 'block';
      return;
    }

    const cardFields = window.paypal.CardFields({
      style: {
        input: {
          'font-size': '16px',
          'font-family': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#333',
        },
        '.invalid': { color: '#dc3545' },
        ':focus': { color: '#111' },
      },
      createOrder: async () => {
        try {
          const orderRes = await fetch(`${API_URL}/api/payment/paypal/create-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venue,
              currency,
              amount: userRegion?.amount,
            }),
          });

          const orderData = await orderRes.json();

          if (!orderRes.ok || !orderData.success) {
            throw new Error(orderData.error || 'Failed to create PayPal order');
          }

          trackClick('payment_initiated', {
            platform: 'paypal',
            amount: orderData.amount || userRegion?.amount,
            currency: orderData.currency || currency,
          });

          return orderData.orderId;
        } catch (err) {
          logger.error('PayPal order creation failed', err);
          errorDiv.textContent = err.message || 'Failed to start PayPal checkout.';
          errorDiv.style.display = 'block';
          throw err;
        }
      },
      onApprove: async (data) => {
        try {
          const captureRes = await fetch(`${API_URL}/api/payment/paypal/capture-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID }),
          });

          const captureData = await captureRes.json();

          if (!captureRes.ok || !captureData.success || !captureData.verified) {
            throw new Error(captureData.error || 'PayPal capture failed');
          }

          trackClick('payment_success', {
            platform: 'paypal',
            order_id: data.orderID,
            capture_id: captureData.captureId,
          });

          finalize({
            success: true,
            verificationToken: captureData.verificationToken,
          });
        } catch (err) {
          logger.error('PayPal capture failed', err);
          trackClick('payment_failed', {
            platform: 'paypal',
            error: err.message,
          });
          errorDiv.textContent = err.message || 'Payment failed. Please try again.';
          errorDiv.style.display = 'block';
        }
      },
      onCancel: () => {
        closeModal();
      },
      onError: (err) => {
        logger.error('PayPal SDK error', err);
        trackClick('payment_failed', { platform: 'paypal', error: err?.message || 'paypal_error' });
        errorDiv.textContent = err?.message || 'PayPal error. Please try again.';
        errorDiv.style.display = 'block';
      },
    });

    if (!cardFields) {
      logger.error('PayPal CardFields failed to initialize');
      errorDiv.textContent = 'PayPal card payments are not available right now.';
      errorDiv.style.display = 'block';
      return;
    }

    if (!cardFields.isEligible()) {
      logger.warn('PayPal CardFields not eligible');
      errorDiv.textContent = 'Card payments are not available for this transaction.';
      errorDiv.style.display = 'block';
      const submitButton = modal.querySelector('#paypal-card-submit');
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.style.opacity = '0.6';
        submitButton.style.cursor = 'not-allowed';
      }
      return;
    }

    cardFields.NumberField().render('#paypal-card-number');
    cardFields.ExpiryField().render('#paypal-card-expiry');
    cardFields.CVVField().render('#paypal-card-cvv');

    const submitButton = modal.querySelector('#paypal-card-submit');
    if (submitButton) {
      submitButton.addEventListener('click', async () => {
        errorDiv.style.display = 'none';
        try {
          const state = cardFields.getState();
          if (!state?.isFormValid) {
            errorDiv.textContent = 'Please check your card details and try again.';
            errorDiv.style.display = 'block';
            return;
          }
          submitButton.disabled = true;
          submitButton.textContent = 'Processing...';
          await cardFields.submit();
        } catch (err) {
          logger.error('PayPal CardFields submit failed', err);
          errorDiv.textContent = err?.message || 'Payment failed. Please try again.';
          errorDiv.style.display = 'block';
        } finally {
          submitButton.disabled = false;
          submitButton.textContent = 'Pay now';
        }
      });
    }
  });
}
