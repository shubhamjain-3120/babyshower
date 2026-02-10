import { isIAPEnabled } from './iapManager';
import { isRazorpayEnabled } from './razorpayManager';

// Detect user's region and currency
export function getUserRegion() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = navigator.language || navigator.userLanguage || 'en-US';

    // Check if user is in India
    const isIndia =
      timezone.includes('Kolkata') ||
      timezone.includes('Asia/Calcutta') ||
      locale.toLowerCase().includes('in');

    return {
      isIndia,
      currency: isIndia ? 'INR' : 'USD',
      amount: isIndia ? 49 : 4.99, // INR 49 or USD $4.99
      displayPrice: isIndia ? '₹49' : '$4.99'
    };
  } catch (e) {
    // Default to USD for international
    return {
      isIndia: false,
      currency: 'USD',
      amount: 4.99,
      displayPrice: '$4.99'
    };
  }
}

export function getPaymentPlatform() {
  if (isIAPEnabled()) return 'iap';
  if (isRazorpayEnabled()) return 'razorpay';
  return 'none';
}

export function isPaymentEnabled() {
  return getPaymentPlatform() !== 'none';
}
