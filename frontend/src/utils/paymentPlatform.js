import { isRazorpayEnabled } from './razorpayManager';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export function formatCurrency(amount, currency) {
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    const rounded = safeAmount.toFixed(2);
    return currency === 'USD' ? `$${rounded}` : `${rounded} ${currency || 'USD'}`;
  }
}

// Detect user's region and currency
export async function getUserRegion(venue) {
  const currency = 'USD';
  const requestBaseUrl = API_URL || window.location.origin;
  const params = venue ? `?venue=${encodeURIComponent(venue)}` : '';

  try {
    const res = await fetch(`${requestBaseUrl}/api/pricing${params}`);
    if (!res.ok) {
      throw new Error(`Pricing request failed (${res.status})`);
    }
    const data = await res.json();
    const amount = Number(data?.amount);
    const resolvedAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    return {
      isIndia: false,
      currency: data?.currency || currency,
      amount: resolvedAmount,
      displayPrice: formatCurrency(resolvedAmount, data?.currency || currency),
    };
  } catch (error) {
    return {
      isIndia: false,
      currency,
      amount: 0,
      displayPrice: formatCurrency(0, currency),
      error,
    };
  }
}

export function getPaymentPlatform() {
  return isRazorpayEnabled() ? 'razorpay' : 'none';
}

export function isPaymentEnabled() {
  return getPaymentPlatform() !== 'none';
}
