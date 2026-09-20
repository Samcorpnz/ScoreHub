import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// @testing-library/jest-dom's own vitest augmentation declares
// `Assertion<T = any>`, which no longer merges with vitest 5's
// `Assertion<R extends void | Promise<void> = void, T = unknown>` — TypeScript
// silently drops it under skipLibCheck, so matchers like toBeInTheDocument
// fail typecheck. Re-declare it with vitest 5's signature; the runtime
// registration is `expect.extend(matchers)` in vitest.setup.ts. Remove once
// jest-dom ships vitest 5-compatible types.
declare module "vitest" {
  interface Assertion<R extends void | Promise<void> = void, T = unknown>
    extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
