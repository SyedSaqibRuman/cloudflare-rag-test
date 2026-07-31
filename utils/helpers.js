// --------------------------
// 🔹 Shared Utilities
// Consolidates duplicated helpers from ingest.js, vectorize.js,
// services/wp.js, and services/cloudflare_embeddings.js
// --------------------------

/**
 * Split an array into chunks of a given size.
 * @param {Array} arr
 * @param {number} size
 * @returns {Array<Array>}
 */
export function chunkArray(arr, size = 100) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

/**
 * Promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------
// 🔹 Abort Helpers
// --------------------------

/**
 * Custom error thrown when a job is aborted via signal.
 * Never retried — always propagates immediately.
 */
export class AbortError extends Error {
  constructor(msg = "Job was stopped.") {
    super(msg);
    this.name = "AbortError";
  }
}

/**
 * Throw AbortError if the signal is already aborted.
 * @param {AbortSignal|null} signal
 */
export function checkAbort(signal) {
  if (signal?.aborted) throw new AbortError();
}

// --------------------------
// 🔹 Retry with optional abort signal
// --------------------------

/**
 * Retry an async function up to `retries` times with a delay between attempts.
 *
 * - AbortError is never retried; it propagates immediately.
 * - The delay is interruptible: if `signal` fires during the wait,
 *   the promise rejects right away instead of sleeping.
 * - On final failure, the last error is thrown.
 *
 * @param {Function} fn          - Async function to retry
 * @param {number}   [retries=3] - Number of remaining retries after the first attempt
 * @param {number}   [delay=500] - Milliseconds to wait between retries
 * @param {AbortSignal|null} [signal=null] - Optional abort signal
 * @returns {Promise<any>}       - Result of fn() on success
 */
export async function retry(fn, retries = 3, delay = 500, signal = null) {
  checkAbort(signal);
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AbortError) throw err;
    if (retries === 0) throw err;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new AbortError());
        },
        { once: true }
      );
    });
    return retry(fn, retries - 1, delay, signal);
  }
}
