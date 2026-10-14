// Applies Next.js and TypeScript correctness checks across the application workspace.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: "All_de_bright_placesFrontend/" } }, rules: {
    "@next/next/no-img-element": "off",
  } },
  globalIgnores(["**/.next/**", "**/node_modules/**", "**/next-env.d.ts", "**/coverage/**"]),
]);
