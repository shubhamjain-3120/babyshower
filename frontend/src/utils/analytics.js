/**
 * Google Analytics 4 (GA4) tracking utilities
 * 
 * Usage:
 * - trackPageView('screen_name', { optional_params })
 * - trackClick('event_name', { optional_params })
 */

/**
 * Track a page/screen view
 * @param {string} pageName - Name of the page/screen being viewed
 * @param {Object} params - Additional parameters to send with the event
 */
export function trackPageView(pageName, params = {}) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_title: pageName,
      ...params
    });
  }
}

/**
 * Track a button click or user action
 * @param {string} eventName - Name of the event (e.g., 'video_download', 'form_submit')
 * @param {Object} params - Additional parameters to send with the event
 */
export function trackClick(eventName, params = {}) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }
}
