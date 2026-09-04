// Test-only stub for the "server-only" package, which unconditionally
// throws unless a bundler applies Next.js's "react-server" resolve
// condition (vitest/vite in a plain Node test run does not). Aliased in
// vitest.config.ts so the real safety net still applies in the Next.js
// build/runtime, while tests can still exercise server-only modules
// directly as plain Node code.
export {};
