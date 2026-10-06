import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import sonarjs from "eslint-plugin-sonarjs";
import noLiteralUiText from "./eslint-rules/no-literal-ui-text.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const SONAR_FILES = ["app/**", "components/**", "lib/**", "tests/**"];

/**
 * Dossiers **traduits** (docs/features/I18N.md) : tout texte d'interface y
 * passe par une clé de traduction, et tout lien interne par `LocaleLink`.
 * La liste s'allonge à chaque lot de migration, dans la PR qui traduit le
 * dossier — en même temps que `lib/shared/i18n-routes.ts`.
 *
 * Lot 1 : la coquille partagée, rendue sur toutes les pages (aucune route
 * ajoutée — elle ne se lit en anglais que sur les routes déjà traduites).
 * `FooterContact` n'y est pas : sa fenêtre d'édition (staff) attend le lot 5.
 */
const I18N_MIGRATED_FILES = [
  "components/i18n/**",
  "app/error.tsx",
  "app/global-error.tsx",
  "app/not-found.tsx",
  "app/regles/**",
  "components/accessibility/**",
  "components/account-menu.tsx",
  "components/arena-nav.tsx",
  "components/arena-shell.tsx",
  "components/cyber/landing/PublicFooter.tsx",
  "components/cyber/landing/PublicHeader.tsx",
  "components/cyber/landing/PublicNavMenu.tsx",
  "components/cyber/landing/PublicPageShell.tsx",
  "components/cyber/landing/SessionPageShell.tsx",
  // Lot 2 — accueil. `EditableCopy`, `SponsorsGrid`, `AboutStats` et
  // `AboutPillars` n'y sont pas : leurs contrôles de staff restent en français
  // (D4), seuls leurs textes visiteurs passent par `landing`.
  "app/page.tsx",
  "components/cyber/CountdownStrip.tsx",
  "components/cyber/Ticker.tsx",
  "components/cyber/landing/AboutSection.tsx",
  "components/cyber/landing/CalendarCard.tsx",
  "components/cyber/landing/DiscordCommunity.tsx",
  "components/cyber/landing/Hero.tsx",
  "components/cyber/landing/JoinCTA.tsx",
  "components/cyber/landing/LeaderCal.tsx",
  "components/cyber/landing/Leaderboard.tsx",
  "components/cyber/landing/LiveCard.tsx",
  "components/cyber/landing/TournamentBoard.tsx",
  "components/error-page/**",
  "components/legal/SiteFooterBar.tsx",
  // Règles (lot 3) — pas `RulesHelpFab`, bouton des pages de tournoi (lot 8a).
  "components/rules/RuleDiagram.tsx",
  "components/rules/RuleText.tsx",
  "components/rules/RulesToc.tsx",
  // Classement (lot 4) — et le bloc de statistiques des fiches, prêt pour le lot 9.
  "app/classement/**",
  "components/stats/**",
  "components/ui/confirm-action-dialog.tsx",
  "components/ui/toast.tsx",
];

/** Composants de toutes les pages dont les liens passent déjà par `LocaleLink`. */
const I18N_LOCALE_LINK_FILES = [
  "components/arena-nav.tsx",
  "components/account-menu.tsx",
  "components/entity-link.tsx",
  "components/recruitment-highlight.tsx",
  "components/accessibility/AccessibilityMenu.tsx",
  "components/cyber/RgpdConsentModal.tsx",
  "components/cyber/landing/PublicFooter.tsx",
  "components/legal/SiteFooterBar.tsx",
  "components/reports/ReportProblemDialog.tsx",
  "components/rules/RulesHelpFab.tsx",
  "components/cyber/landing/PublicHeader.tsx",
  "components/cyber/landing/PublicNavMenu.tsx",
  "components/legal/TermsAcceptanceModal.tsx",
  "components/match-launch/MatchLaunchCenter.tsx",
  "components/privacy/PrivacyChangesModal.tsx",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  ...compat.config({
    extends: ['next'],
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-page-custom-font': 'off',
    },
  }),
  // Confirmations : jamais la boîte système, toujours `ConfirmActionDialog`
  // (`components/ui/confirm-action-dialog.tsx`, docs/features/MODAL_DIALOGS.md).
  {
    files: ["app/**", "components/**", "lib/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Utiliser ConfirmActionDialog (components/ui/confirm-action-dialog)." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Utiliser ConfirmActionDialog (components/ui/confirm-action-dialog)." },
        { object: "globalThis", property: "confirm", message: "Utiliser ConfirmActionDialog (components/ui/confirm-action-dialog)." },
      ],
    },
  },
  // Langues : dans un dossier traduit, ni texte en dur ni `next/link` nu (un
  // lien y perdrait la langue de la page). `locale-navigation.tsx` enveloppe
  // justement `next/link`.
  {
    files: I18N_MIGRATED_FILES,
    plugins: { bluegenji: { rules: { "no-literal-ui-text": noLiteralUiText } } },
    rules: { "bluegenji/no-literal-ui-text": "error" },
  },
  // `next/link` nu interdit dans les dossiers traduits **et** dans les
  // composants rendus sur toutes les pages (mise en page racine, en-têtes) :
  // pas encore traduits, leurs liens gardent déjà la langue de la page — un
  // `next/link` nu ramènerait une page anglaise en français sans recharger
  // `<html lang>` ni les messages.
  {
    files: [...I18N_MIGRATED_FILES, ...I18N_LOCALE_LINK_FILES],
    rules: {
      "no-restricted-imports": [
        "error",
        { name: "next/link", message: "Utiliser LocaleLink (components/i18n/locale-navigation) — docs/features/I18N.md." },
      ],
    },
  },
  {
    files: ["components/i18n/locale-navigation.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
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
