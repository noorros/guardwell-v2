import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noDirectProjectionMutation from "./eslint-rules/no-direct-projection-mutation.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      gw: {
        rules: {
          "no-direct-projection-mutation": noDirectProjectionMutation,
        },
      },
    },
    rules: {
      "gw/no-direct-projection-mutation": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
