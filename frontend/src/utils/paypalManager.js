import { createDevLogger } from './devLogger';
import { trackClick } from './analytics';

const logger = createDevLogger('PayPalManager');

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || '';
const PAYPAL_ENABLED = import.meta.env.VITE_PAYPAL_ENABLED === 'true';
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

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

export async function purchaseVideoDownload(venue, userRegion) {
  const currency = resolvePaypalCurrency(userRegion);
  const amount = userRegion?.amount;
  const fallbackAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const displayPrice = userRegion?.displayPrice || `$${fallbackAmount.toFixed(2)}`;
  const returnBaseUrl = (API_URL || window.location.origin).replace(/\/+$/, '');
  const returnUrl = `${returnBaseUrl}/payment-complete`;
  const cancelUrl = `${returnBaseUrl}/payment-complete?cancel=true`;
  const requestBaseUrl = API_URL || '';

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
              ${displayPrice} ${currency}
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
          <div class="paypal-hosted-status">
            <div id="paypal-hosted-title" class="paypal-hosted-title">Creating secure checkout...</div>
            <div id="paypal-hosted-subtitle" class="paypal-hosted-subtitle">This usually takes a few seconds.</div>
          </div>
          <div id="paypal-hosted-spinner" class="paypal-hosted-spinner" aria-hidden="true"></div>
          <div id="paypal-error-message" class="paypal-error-message"></div>
          <div class="paypal-hosted-actions">
            <button id="paypal-hosted-open" class="paypal-hosted-open" style="display: none;">Open PayPal</button>
            <button id="paypal-hosted-retry" class="paypal-hosted-retry" style="display: none;">Try again</button>
          </div>
          <div class="paypal-secure-note">
            <svg class="paypal-secure-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 1.5c-3.1 0-5.5 2.4-5.5 5.5v3H5a1 1 0 0 0-1 1v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9a1 1 0 0 0-1-1h-1.5v-3c0-3.1-2.4-5.5-5.5-5.5Zm3.5 8.5h-7v-3a3.5 3.5 0 1 1 7 0v3Z" fill="currentColor"/>
            </svg>
            <span>Secured by PayPal. We do not store card details.</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let resolved = false;
    let orderId = null;
    let approveUrl = null;
    let pollTimer = null;
    let pollAttempts = 0;
    let pollInFlight = false;
    const pollIntervalMs = 5000;
    const maxPollAttempts = Math.ceil(120000 / pollIntervalMs);
    const errorDiv = modal.querySelector('#paypal-error-message');
    const statusTitle = modal.querySelector('#paypal-hosted-title');
    const statusSubtitle = modal.querySelector('#paypal-hosted-subtitle');
    const spinner = modal.querySelector('#paypal-hosted-spinner');
    const openButton = modal.querySelector('#paypal-hosted-open');
    const retryButton = modal.querySelector('#paypal-hosted-retry');

    const finalize = (result) => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      try {
        document.body.removeChild(modal);
      } catch {
        // ignore
      }
      resolve(result);
    };

    const setStatus = (title, subtitle) => {
      if (statusTitle) statusTitle.textContent = title;
      if (statusSubtitle) statusSubtitle.textContent = subtitle;
    };

    const showError = (message, showRetry = true, retryMode = 'poll') => {
      if (!errorDiv) return;
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
      if (retryButton) {
        retryButton.dataset.mode = retryMode;
        retryButton.style.display = showRetry ? 'inline-flex' : 'none';
      }
    };

    const clearError = () => {
      if (errorDiv) {
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
      }
      if (retryButton) {
        retryButton.style.display = 'none';
      }
    };

    const closeModal = () => {
      logger.log('PayPal modal closed by user');
      trackClick('payment_cancelled', { platform: 'paypal' });
      finalize({ success: false, error: 'cancelled' });
    };

    modal.querySelector('#paypal-close').addEventListener('click', closeModal);

    const openPaypal = (forceSameTab = false) => {
      if (!approveUrl) return;
      if (forceSameTab) {
        window.location.href = approveUrl;
        return;
      }

      const popup = window.open(approveUrl, '_blank', 'noopener,noreferrer');
      if (!popup) {
        showError(
          'Popup blocked. Please allow popups for this site, then click "Try again".',
          true,
          'open'
        );
      }
    };

    const pollCapture = async () => {
      if (pollInFlight || !orderId) return;
      pollInFlight = true;
      try {
        const captureRes = await fetch(`${requestBaseUrl}/api/payment/paypal/capture-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });

        const captureData = await captureRes.json().catch(() => ({}));

        if (captureRes.ok && captureData?.success && captureData?.verified) {
          trackClick('payment_success', {
            platform: 'paypal',
            order_id: orderId,
            capture_id: captureData.captureId,
          });
          finalize({
            success: true,
            verificationToken: captureData.verificationToken,
          });
          return;
        }
      } catch (err) {
        logger.error('PayPal capture polling failed', err);
      } finally {
        pollInFlight = false;
      }

      pollAttempts += 1;
      if (pollAttempts >= maxPollAttempts) {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (spinner) spinner.style.display = 'none';
        trackClick('payment_failed', { platform: 'paypal', error: 'timeout' });
        showError('We could not confirm your payment yet. If you completed it, click "Try again".', true, 'poll');
      }
    };

    const startPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollAttempts = 0;
      clearError();
      if (spinner) spinner.style.display = 'block';
      pollTimer = setInterval(pollCapture, pollIntervalMs);
      pollCapture();
    };

    const startCreateOrder = async () => {
      clearError();
      setStatus('Creating secure checkout...', 'This usually takes a few seconds.');
      if (spinner) spinner.style.display = 'block';

      try {
        const orderRes = await fetch(`${requestBaseUrl}/api/payment/paypal/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue,
            currency,
            returnUrl,
            cancelUrl,
          }),
        });

        const orderData = await orderRes.json();

        if (!orderRes.ok || !orderData.success || !orderData.orderId) {
          throw new Error(orderData.error || 'Failed to create PayPal order');
        }

        orderId = orderData.orderId;
        approveUrl = orderData.approveUrl;

        trackClick('payment_initiated', {
          platform: 'paypal',
          amount: orderData.amount || amount,
          currency: orderData.currency || currency,
        });

        if (!approveUrl) {
          throw new Error('PayPal checkout link unavailable. Please try again.');
        }

        setStatus(
          'Complete payment in the new tab',
          'If the PayPal tab did not open, click "Open PayPal".'
        );
        if (openButton) {
          openButton.style.display = 'inline-flex';
        }
        openPaypal(false);
        startPolling();
      } catch (err) {
        logger.error('PayPal order creation failed', err);
        if (spinner) spinner.style.display = 'none';
        showError(err?.message || 'Failed to start PayPal checkout.', true, 'create');
        trackClick('payment_failed', { platform: 'paypal', error: err?.message || 'create_order_failed' });
      }
    };

    if (retryButton) {
      retryButton.addEventListener('click', () => {
        const mode = retryButton.dataset.mode || 'poll';
        if (mode === 'create') {
          startCreateOrder();
        } else if (mode === 'open') {
          clearError();
          openPaypal(false);
        } else {
          setStatus('Waiting for approval...', 'We are checking your payment status.');
          startPolling();
        }
      });
    }

    if (openButton) {
      openButton.addEventListener('click', () => {
        clearError();
        openPaypal(false);
      });
    }

    startCreateOrder();
  });
}
