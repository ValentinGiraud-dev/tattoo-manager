import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules", ".agents", ".claude", ".cursor"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Dette : trois écrans font setLoading(true) dans un effet. À corriger, puis repasser en "error".
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Utiliser useConfirm() (src/components/confirm-dialog.tsx)." },
        { name: "alert", message: "Afficher l'erreur dans l'écran, pas dans une alerte." },
        { name: "prompt", message: "Utiliser useConfirm() avec un champ motif." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Utiliser useConfirm()." },
        { object: "window", property: "alert", message: "Afficher l'erreur dans l'écran." },
        {
          object: "window",
          property: "prompt",
          message: "Utiliser useConfirm() avec un champ motif.",
        },
      ],
    },
  },
);
