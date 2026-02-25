import mixpanel from 'mixpanel-browser';

/**
 * Analytics tracking utilities - sends to both Mixpanel and Google Analytics 4 (GA4)
 *
 * Usage:
 * - trackPageView('screen_name', { optional_params })
 * - trackClick('event_name', { optional_params })
 */

/**
 * Track a page/screen view in Mixpanel and Google Analytics 4
 * @param {string} pageName - Name of the page/screen being viewed
 * @param {Object} [params={}] - Additional parameters to send with the event
 * @returns {void}
 */
export function trackPageView(pageName, params = {}) {
  // Send to Mixpanel
  try {
    mixpanel.track_pageview();
    mixpanel.track('Page View', {
      page_name: pageName,
      ...params
    });
  } catch (err) {
    console.warn('Mixpanel tracking failed:', err);
  }

  // Send to Google Analytics (if configured)
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_title: pageName,
      ...params
    });
  }

  // Send to Meta Pixel (if configured)
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq('track', 'PageView');
  }
}

/**
 * Track a button click or user action in Mixpanel and Google Analytics 4
 * @param {string} eventName - Name of the event (e.g., 'video_download', 'form_submit')
 * @param {Object} [params={}] - Additional parameters to send with the event
 * @returns {void}
 */
export function trackClick(eventName, params = {}) {
  // Send to Mixpanel
  try {
    mixpanel.track(eventName, params);
  } catch (err) {
    console.warn('Mixpanel tracking failed:', err);
  }

  // Send to Google Analytics (if configured)
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }

  // Send to Meta Pixel (if configured)
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    const standardEvents = new Set([
      'PageView',
      'ViewContent',
      'Search',
      'AddToCart',
      'AddToWishlist',
      'InitiateCheckout',
      'AddPaymentInfo',
      'Purchase',
      'Lead',
      'CompleteRegistration',
      'Contact',
      'CustomizeProduct',
      'Donate',
      'FindLocation',
      'Schedule',
      'StartTrial',
      'SubmitApplication',
      'Subscribe'
    ]);

    if (standardEvents.has(eventName)) {
      window.fbq('track', eventName, params);
    } else {
      window.fbq('trackCustom', eventName, params);
    }
  }
}
