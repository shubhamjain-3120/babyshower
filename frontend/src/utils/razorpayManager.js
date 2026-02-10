import { createDevLogger } from './devLogger';
import { trackClick } from './analytics';

const logger = createDevLogger('RazorpayManager');

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;
const RAZORPAY_ENABLED = import.meta.env.VITE_RAZORPAY_ENABLED === 'true';
const API_URL = import.meta.env.VITE_API_URL || '';

// Check if running on Android app (not web)
function isAndroidApp() {
  return window.Capacitor?.isNativePlatform?.() || false;
}

export function isRazorpayEnabled() {
  return !isAndroidApp() && RAZORPAY_ENABLED;
}

// Load Razorpay SDK dynamically
export async function initializeRazorpay() {
  if (!isRazorpayEnabled()) {
    logger.log('Razorpay not enabled (disabled or Android platform)');
    return;
  }

  if (window.Razorpay) {
    logger.log('Razorpay SDK already loaded');
    return;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => {
      logger.log('Razorpay SDK loaded successfully');
      resolve();
    };
    script.onerror = () => {
      logger.error('Failed to load Razorpay SDK');
      reject(new Error('Failed to load Razorpay SDK'));
    };
    document.body.appendChild(script);
  });
}

// Main purchase function - opens Razorpay modal and handles payment
export async function purchaseVideoDownload(venue, userRegion) {
  if (!window.Razorpay) {
    return { success: false, error: 'Razorpay SDK not loaded' };
  }

  try {
    logger.log('Creating payment order', { venue, region: userRegion });

    // Step 1: Create order via backend with currency info
    const orderRes = await fetch(`${API_URL}/api/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venue,
        currency: userRegion?.currency || 'USD',
        amount: userRegion?.amount || 4.99
      }),
    });

    if (!orderRes.ok) {
      const errorText = await orderRes.text();
      logger.error('Order creation failed', { status: orderRes.status, error: errorText });
      throw new Error(`Failed to create order: ${orderRes.status} - ${errorText}`);
    }

    const orderData = await orderRes.json();
    logger.log('Order response received', orderData);
    if (!orderData.success) {
      throw new Error(orderData.error || 'Order creation failed');
    }

    const { orderId, amount, currency } = orderData;

    logger.log('Order created', { orderId, amount, currency });
    trackClick('payment_initiated', {
      platform: 'razorpay',
      amount: currency === 'INR' ? amount / 100 : amount / 100,
      currency
    });

    // Step 2: Open Razorpay modal
    return new Promise((resolve) => {
      const options = {
        key: RAZORPAY_KEY_ID,
        order_id: orderId,
        amount,
        currency,
        name: 'मारवाड़ी विवाह',
        description: 'Wedding Invite Video Download',
        image: '/assets/app-logo.png',
        handler: async function(response) {
          // Step 3: Verify payment
          logger.log('Payment completed, verifying');

          try {
            const verifyRes = await fetch(`${API_URL}/api/payment/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json();

            if (verifyData.success && verifyData.verified) {
              logger.log('Payment verified successfully');
              trackClick('payment_success', {
                platform: 'razorpay',
                payment_id: response.razorpay_payment_id,
              });
              resolve({
                success: true,
                verificationToken: verifyData.verificationToken,
              });
            } else {
              throw new Error('Payment verification failed');
            }
          } catch (err) {
            logger.error('Verification failed', err);
            trackClick('payment_failed', {
              platform: 'razorpay',
              error: 'verification_failed',
            });
            resolve({
              success: false,
              error: `Verification failed: ${err.message}. Payment ID: ${response.razorpay_payment_id}`,
            });
          }
        },
        modal: {
          ondismiss: function() {
            logger.log('Payment modal closed by user');
            trackClick('payment_cancelled', { platform: 'razorpay' });
            resolve({ success: false, error: 'cancelled' });
          },
        },
        theme: {
          color: '#621d35',
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    });

  } catch (err) {
    logger.error('Purchase flow failed', err);
    trackClick('payment_failed', {
      platform: 'razorpay',
      error: err.message,
    });
    return {
      success: false,
      error: err.message || 'Payment failed. Please try again.',
    };
  }
}
