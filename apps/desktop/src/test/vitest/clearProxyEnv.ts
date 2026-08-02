/**
 * Test hermeticity: host shell proxy env vars (http_proxy / HTTPS_PROXY /
 * ALL_PROXY …) must not leak into desktop tests. `outboundFetch` honors proxy
 * env and would route real network instead of the tests' global fetch stubs,
 * making hermetic tests fail (fetch failed / timeouts). Delete them once per
 * test worker so tests are unaffected by the developer's proxy settings.
 * Tests that intentionally exercise proxy env manage their own env in-file.
 */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
] as const;

for (const key of PROXY_ENV_KEYS) {
  delete process.env[key];
}
