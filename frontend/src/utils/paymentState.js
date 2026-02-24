import { createDevLogger } from "./devLogger";

const logger = createDevLogger("PaymentState");

const PENDING_KEY = "payment_pending";
const COMPLETED_KEY = "payment_completed";

function safeParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.warn("Failed to parse payment state", error?.message || error);
    return null;
  }
}

function loadCompletedStore() {
  const raw = localStorage.getItem(COMPLETED_KEY);
  const parsed = safeParse(raw);
  if (parsed && typeof parsed === "object") {
    return {
      byVenue: parsed.byVenue || {},
      byOrder: parsed.byOrder || {},
    };
  }
  return { byVenue: {}, byOrder: {} };
}

function saveCompletedStore(store) {
  localStorage.setItem(COMPLETED_KEY, JSON.stringify(store));
}

export function setPendingPayment({ orderId, venue, currency, amount, createdAt }) {
  if (!orderId) return;
  const payload = {
    orderId,
    venue: venue || "",
    currency: currency || "USD",
    amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
    createdAt: createdAt || new Date().toISOString(),
  };
  localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
}

export function getPendingPayment() {
  const raw = localStorage.getItem(PENDING_KEY);
  const parsed = safeParse(raw);
  return parsed && parsed.orderId ? parsed : null;
}

export function clearPendingPayment() {
  localStorage.removeItem(PENDING_KEY);
}

export function setPaymentCompleted({ orderId, paymentId, venue, completedAt }) {
  if (!orderId && !venue) return;
  const store = loadCompletedStore();
  const record = {
    orderId: orderId || "",
    paymentId: paymentId || "",
    venue: venue || "",
    completedAt: completedAt || new Date().toISOString(),
  };

  if (record.venue) {
    store.byVenue[record.venue] = record;
  }
  if (record.orderId) {
    store.byOrder[record.orderId] = record;
  }

  saveCompletedStore(store);
}

export function getPaymentCompleted(venue) {
  if (!venue) return null;
  const store = loadCompletedStore();
  return store.byVenue[venue] || null;
}

export function getPaymentCompletedByOrder(orderId) {
  if (!orderId) return null;
  const store = loadCompletedStore();
  return store.byOrder[orderId] || null;
}
