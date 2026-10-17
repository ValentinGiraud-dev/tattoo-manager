import { defineConfig } from "vitest/config";

// Tests unitaires du frontend (logique pure : formats, règles de saisie, navigation).
// Les parcours d'écran sont dans e2e/ (Playwright).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
