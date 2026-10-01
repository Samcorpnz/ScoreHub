/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  testTimeout: 10000,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {}],
    // jose v6 ships ESM-only; Jest's CJS runtime can't load it directly, so
    // transpile it (and only it) to CJS for tests. Runtime is unaffected:
    // Node >= 20.19 handles require(esm) natively in the compiled output.
    "/node_modules/jose/.+\\.js$": ["ts-jest", { tsconfig: { allowJs: true } }],
    // Same story for jsdom's ESM-only transitive dependencies (used by uploads.ts to
    // sanitize SVGs) — without this the SVG sanitization path can't be
    // exercised under Jest at all.
    "/node_modules/(@exodus/bytes|parse5|entities|@asamuzakjp/[^/]+|whatwg-[^/]+|html-encoding-sniffer|data-urls|tr46|w3c-[^/]+|saxes|xml-name-validator|cssstyle|@csstools/[^/]+)/.+\\.m?js$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: ["/node_modules/(?!(jose|@exodus/bytes|parse5|entities|@asamuzakjp/[^/]+|whatwg-[^/]+|html-encoding-sniffer|data-urls|tr46|w3c-[^/]+|saxes|xml-name-validator|cssstyle|@csstools/[^/]+)/)"],
};
