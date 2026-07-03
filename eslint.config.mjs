import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Script helpers (node-only, ad-hoc utilities)
    "scripts/**",
  ]),
  {
    rules: {
      // This repo intentionally uses effects to drive async loads in pages.
      "react-hooks/set-state-in-effect": "off",
      // React Compiler warnings are too noisy for this codebase right now.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]);

export default eslintConfig;
