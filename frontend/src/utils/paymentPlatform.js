import { isPaypalEnabled } from './paypalManager';

// Detect user's region and currency
export function getUserRegion() {
  return {
    isIndia: false,
    currency: 'USD',
    amount: 4.99,
    displayPrice: '$4.99'
  };
}

export function getPaymentPlatform() {
  return isPaypalEnabled() ? 'paypal' : 'none';
}

export function isPaymentEnabled() {
  return getPaymentPlatform() !== 'none';
}
