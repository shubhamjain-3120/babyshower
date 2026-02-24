import { createDevLogger } from './devLogger';
import { trackClick } from './analytics';
import { clearPendingPayment, setPaymentCompleted, setPendingPayment } from './paymentState';

const logger = createDevLogger('RazorpayManager');

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || '';
const RAZORPAY_ENABLED = import.meta.env.VITE_RAZORPAY_ENABLED === 'true';
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

let razorpayScriptPromise = null;

// Check if running on Android app (not web)
function isAndroidApp() {
  return window.Capacitor?.isNativePlatform?.() || false;
}

export function isRazorpayEnabled() {
  return !isAndroidApp() && RAZORPAY_ENABLED && Boolean(RAZORPAY_KEY_ID);
}

function ensureRazorpayScript() {
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

export async function purchaseVideoDownload(venue, userRegion) {
  const currency = (userRegion?.currency || 'USD').toUpperCase();
  const requestBaseUrl = API_URL || '';

  let orderData;
  try {
    const orderRes = await fetch(`${requestBaseUrl}/api/payment/razorpay/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue, currency }),
    });
    orderData = await orderRes.json();

    if (!orderRes.ok || !orderData?.success || !orderData?.orderId) {
      throw new Error(orderData?.error || 'Failed to create Razorpay order');
    }
  } catch (err) {
    logger.error('Razorpay order creation failed', err);
    return { success: false, error: err?.message || 'Failed to start Razorpay checkout.' };
  }

  const orderId = orderData.orderId;
  const amountMajor = Number(orderData.amount || userRegion?.amount || 0);
  const amountMinor = Math.round(amountMajor * 100);
  const resolvedCurrency = (orderData.currency || currency || 'USD').toUpperCase();

  trackClick('payment_initiated', {
    platform: 'razorpay',
    amount: amountMajor,
    currency: resolvedCurrency,
  });

  setPendingPayment({
    orderId,
    venue,
    currency: resolvedCurrency,
    amount: amountMajor,
    createdAt: new Date().toISOString(),
  });

  try {
    await ensureRazorpayScript();
  } catch (err) {
    logger.error('Razorpay SDK load failed', err);
    return { success: false, error: err?.message || 'Failed to load Razorpay.' };
  }

  return new Promise((resolve) => {
    let resolved = false;

    const finalize = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const handleSuccess = async (response) => {
      try {
        const verifyRes = await fetch(`${requestBaseUrl}/api/payment/razorpay/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: response?.razorpay_order_id,
            paymentId: response?.razorpay_payment_id,
            signature: response?.razorpay_signature,
            venue,
          }),
        });
        const verifyData = await verifyRes.json().catch(() => ({}));

        if (verifyRes.ok && verifyData?.success && verifyData?.verified) {
          trackClick('payment_success', {
            platform: 'razorpay',
            order_id: response?.razorpay_order_id,
            payment_id: response?.razorpay_payment_id,
          });
          clearPendingPayment();
          setPaymentCompleted({
            orderId: response?.razorpay_order_id,
            paymentId: response?.razorpay_payment_id,
            venue,
            completedAt: new Date().toISOString(),
          });
          finalize({
            success: true,
            verificationToken: verifyData?.verificationToken || null,
            orderId: response?.razorpay_order_id,
            paymentId: response?.razorpay_payment_id,
          });
          return;
        }

        throw new Error(verifyData?.error || 'Payment verification failed');
      } catch (err) {
        logger.error('Razorpay verification failed', err);
        trackClick('payment_failed', { platform: 'razorpay', error: err?.message || 'verify_failed' });
        finalize({ success: false, error: err?.message || 'Payment verification failed.' });
      }
    };

    const options = {
      key: RAZORPAY_KEY_ID,
      order_id: orderId,
      amount: amountMinor,
      currency: resolvedCurrency,
      name: 'Bunny Invites',
      description: 'Baby shower invite download',
      notes: venue ? { venue } : undefined,
      handler: handleSuccess,
      modal: {
        ondismiss: () => {
          logger.log('Razorpay modal closed by user');
          clearPendingPayment();
          trackClick('payment_cancelled', { platform: 'razorpay' });
          finalize({ success: false, error: 'cancelled' });
        },
      },
    };

    try {
      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', (response) => {
        const message =
          response?.error?.description || response?.error?.reason || 'payment_failed';
        logger.error('Razorpay payment failed', response?.error || response);
        clearPendingPayment();
        trackClick('payment_failed', { platform: 'razorpay', error: message });
        finalize({ success: false, error: message });
      });
      razorpay.open();
    } catch (err) {
      logger.error('Razorpay checkout error', err);
      clearPendingPayment();
      finalize({ success: false, error: err?.message || 'Razorpay checkout failed.' });
    }
  });
}
