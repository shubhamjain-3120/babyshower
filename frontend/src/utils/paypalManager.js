import { createDevLogger } from './devLogger';
import { trackClick } from './analytics';

const logger = createDevLogger('PayPalManager');

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || '';
const PAYPAL_ENABLED = import.meta.env.VITE_PAYPAL_ENABLED === 'true';
const PAYPAL_ENV = (import.meta.env.VITE_PAYPAL_ENV || 'sandbox').toLowerCase();
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

  if (PAYPAL_ENV === 'sandbox') {
    params.set('components', 'buttons');
  }

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
          padding: 28px;
          max-width: 480px;
          width: 100%;
          box-shadow: 0 4px 24px rgba(0,0,0,0.15);
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 22px; color: #621d35;">Complete Payment</h2>
            <button id="paypal-close" style="
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
          <div style="margin-bottom: 20px; padding: 14px; background: #f8f9fa; border-radius: 8px;">
            <div style="font-size: 14px; color: #666; margin-bottom: 4px;">Amount to pay</div>
            <div style="font-size: 26px; font-weight: 600; color: #621d35;">
              ${(userRegion?.displayPrice || '$4.99')} ${currency}
            </div>
          </div>
          <div id="paypal-error-message" style="
            color: #dc3545;
            font-size: 14px;
            margin-bottom: 12px;
            display: none;
          "></div>
          <div id="paypal-buttons"></div>
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

    const buttons = window.paypal.Buttons({
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

    if (!buttons || !buttons.render) {
      logger.error('PayPal Buttons not available');
      errorDiv.textContent = 'PayPal is not available right now.';
      errorDiv.style.display = 'block';
      return;
    }

    buttons.render('#paypal-buttons');
  });
}
