import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps jsx: "preserve" for Next; tests need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
