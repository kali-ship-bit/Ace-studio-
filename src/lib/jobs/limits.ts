/**
 * Public narration limits (Step 1). Client-safe: no secrets, no node APIs.
 * Safe to import from React components. The server re-exports these from
 * env.ts so there is exactly one source of truth.
 */

/** Max characters per narration request (see env.ts for why: 2,000). */
export const SPEECHIFY_MAX_CHARS_PER_REQUEST = 2000;

/** Speechify free-tier monthly allowance shown in the UI. */
export const SPEECHIFY_FREE_TIER_MONTHLY_CHARS = 500000;
