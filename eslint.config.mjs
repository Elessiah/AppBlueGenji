import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import sonarjs from "eslint-plugin-sonarjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const SONAR_FILES = ["app/**", "components/**", "lib/**", "tests/**"];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...compat.config({
    extends: ['next'],
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-page-custom-font': 'off',
    },
  }),
  // Règles SonarQube (docs/WORKFLOW.md) : la CI refuse tout nouveau constat.
  { ...sonarjs.configs.recommended, files: SONAR_FILES },
  {
    files: SONAR_FILES,
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15],
      // Points chauds de sécurité côté SonarQube (revus un à un, pas des
      // « issues ») : ESLint ne sait pas marquer un point revu, il crierait
      // à chaque URL `http://` de test, IP de fixture ou `Math.random()` de jeu.
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/super-linear-regex": "off",
      "sonarjs/code-eval": "off",
      "sonarjs/no-os-command-from-path": "off",
      // Doublons de `@typescript-eslint/no-unused-vars`, qui échoue déjà (et
      // lui respecte le préfixe `_` d'un paramètre volontairement ignoré).
      "sonarjs/no-unused-vars": "off",
      "sonarjs/unused-import": "off",
      // S1135 est informatif : il relève le mot-clé de tâche partout, y compris
      // dans le nom du fichier de tâches à la racine du dépôt.
      "sonarjs/todo-tag": "off",
    },
  },
  {
    files: ["tests/**"],
    rules: {
      // Les doubles de test ont besoin de `any`, de `require()` sous
      // `jest.isolateModules`, de `module`/`this` simulés : ces règles
      // `next/typescript` ne visaient pas tests/ avant cette lint.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@next/next/no-assign-module-variable": "off",
      // Un double garde la signature qu'il remplace : `_x` dit « ignoré ».
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // Tests de fumée à valeurs littérales : bruit, la couverture les juge.
      "sonarjs/no-trivial-assertions": "off",
      // Tables de fixtures choisies en ligne, regex qui balaient du source :
      // les découper nuirait à la lecture sans rien protéger.
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/regex-complexity": "off",
    },
  },
]

export default eslintConfig;
