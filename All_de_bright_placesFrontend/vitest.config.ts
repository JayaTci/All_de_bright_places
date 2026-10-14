// Runs shared and service unit tests without loading production-only module guards.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, ".."),
  resolve: { alias: {
    "server-only": path.resolve(__dirname, "tests/server-only.ts"),
    "@bright/shared": path.resolve(__dirname, "../All_de_bright_placesShared/index.ts"),
  } },
  test: { environment: "node", include: ["All_de_bright_placesFrontend/tests/**/*.test.ts", "All_de_bright_placesBackend/tests/**/*.test.ts"], clearMocks: true },
});
