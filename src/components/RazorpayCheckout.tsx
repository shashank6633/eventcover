'use client';

/**
 * RazorpayCheckout — thin wrapper around Razorpay's hosted checkout
 * (https://checkout.razorpay.com/v1/checkout.js).
 *
 * Exports a single imperative helper, `openRazorpayCheckout(opts)`, which:
 *   1. Loads the SDK script once (idempotent — re-renders won't add a
 *      second <script> tag), via a module-level promise cache.
 *   2. Constructs the Razorpay options object per their SDK docs.
 *   3. Calls `new window.Razorpay(opts).open()`.
 *   4. Wires `payment.failed` -> onFailure and modal `ondismiss` -> onDismiss.
 *
 * Brand color defaults to #C1551A (EventCover orange).
 *
 * No React UI is rendered by this file — the form component owns the
 * pre-/post-checkout UI states.
 */

const RAZORPAY_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (resp: unknown) => void) => void;
    };
  }
}

export interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailureError {
  code?: string;
  description?: string;
}

export interface RazorpayCheckoutOptions {
  keyId: string;
  orderId: string; // razorpay order_xxx
  amount: number; // paise — display only, actual amount is on the order
  currency: string;
  name: string; // venue / event name
  description?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: Record<string, string>;
  theme?: { color?: string }; // defaults to #C1551A
  onSuccess: (resp: RazorpaySuccessResponse) => void;
  onFailure: (err: RazorpayFailureError) => void;
  onDismiss?: () => void;
}

// Module-level promise so concurrent callers share the same load and we
// never inject the <script> twice.
let sdkLoadPromise: Promise<void> | null = null;

function loadRazorpaySdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay SDK can only load in the browser'));
  }
  if (window.Razorpay) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    // Defensive: if a script tag with the same src is already on the page
    // (e.g. injected by another component), don't add another.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SDK_URL}"]`,
    );
    if (existing) {
      if (window.Razorpay) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Razorpay SDK')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) {
        resolve();
      } else {
        reject(new Error('Razorpay SDK loaded but window.Razorpay is unavailable'));
      }
    };
    script.onerror = () => {
      // Reset cache so a future call can retry.
      sdkLoadPromise = null;
      reject(new Error('Failed to load Razorpay SDK'));
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

interface RazorpayFailedPayload {
  error?: {
    code?: string;
    description?: string;
  };
}

/**
 * Open the Razorpay checkout modal. Resolves once `open()` has been
 * called — the actual success/failure/dismiss callbacks are delivered
 * via the options' handlers, not via the returned promise.
 *
 * Throws if the SDK fails to load (network blocked, ad-blocker, etc).
 */
export async function openRazorpayCheckout(
  opts: RazorpayCheckoutOptions,
): Promise<void> {
  await loadRazorpaySdk();
  if (typeof window === 'undefined' || !window.Razorpay) {
    throw new Error('Razorpay SDK not available');
  }

  const rzpOptions: Record<string, unknown> = {
    key: opts.keyId,
    order_id: opts.orderId,
    amount: opts.amount,
    currency: opts.currency,
    name: opts.name,
    description: opts.description,
    prefill: {
      name: opts.customerName,
      contact: opts.customerPhone,
      email: opts.customerEmail,
    },
    notes: opts.notes || {},
    theme: { color: opts.theme?.color || '#C1551A' },
    handler: (resp: RazorpaySuccessResponse) => {
      opts.onSuccess({
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature,
      });
    },
    modal: {
      ondismiss: () => opts.onDismiss?.(),
      confirm_close: true,
      escape: false,
    },
  };

  const rzp = new window.Razorpay(rzpOptions);
  rzp.on('payment.failed', (resp: unknown) => {
    const payload = (resp || {}) as RazorpayFailedPayload;
    opts.onFailure({
      code: payload.error?.code,
      description: payload.error?.description,
    });
  });
  rzp.open();
}
