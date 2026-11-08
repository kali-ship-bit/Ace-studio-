import "@testing-library/jest-dom/vitest";

// Tests must never read the real local secrets file (`.dev.vars`):
// tests that assume "nothing is set" would pick up a developer's real
// keys, and a failing test could print a live key into test output.
// src/lib/jobs/env.ts honours this flag by returning no dev vars.
process.env["ACE_STUDIO_NO_DEV_VARS"] = "1";

// The API tests simulate a deployment behind a trusted edge proxy by
// sending x-forwarded-for headers (see trustProxyHeaders() in
// src/lib/security/rate-limit.ts): production trusts the proxy, local
// dev does not. Tests run as the trusted case unless a test deletes
// this flag to check the untrusted behaviour.
process.env["TRUST_PROXY"] = "1";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
