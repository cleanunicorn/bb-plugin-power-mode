import { defineConfig } from "vitest/config";

// Unit tests only; the *.browser.js fixtures run through `npm run test:browser`.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
