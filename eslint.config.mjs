import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // service_role client may only be imported by server modules.
    files: ["src/app/**", "src/components/**", "src/lib/**", "src/middleware.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/server/privileged/*", "**/server/privileged/*"], message: "service_role client is server-module only (src/server/**)." }] }],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "test-results/**",
      "playwright-report/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "supabase/**",
    ],
  },
];

export default eslintConfig;
