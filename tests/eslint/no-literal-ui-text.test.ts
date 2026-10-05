import { describe, expect, it } from "@jest/globals";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";

/**
 * Garde-fou des dossiers traduits (`docs/features/I18N.md`) : aucun texte
 * d'interface en dur. La règle est branchée sur ces dossiers par
 * `eslint.config.mjs` (`I18N_MIGRATED_FILES`).
 */
const rule = require("../../eslint-rules/no-literal-ui-text.cjs");

// Chaque cas s'exécute dans le test qui l'appelle : un cas raté y lève.
RuleTester.describe = (_name: string, run: () => void) => run();
RuleTester.it = (_name: string, run: () => void) => run();

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

describe("bluegenji/no-literal-ui-text", () => {
  it("laisse passer les clés, la ponctuation seule et les attributs non lus", () => {
    const run = () => tester.run("bluegenji/no-literal-ui-text", rule, {
      valid: [
        { code: 'const a = <p>{t("title")}</p>;' },
        { code: 'const a = <span className="sr-only"> — {t("label")}</span>;' },
        { code: "const a = <p>{count} · {total}</p>;" },
        { code: 'const a = <img alt="" src="/x.png" />;' },
        { code: 'const a = <a href="/regles" aria-label={t("rules")} />;' },
        { code: 'const a = <div className="Bonjour" data-x="Texte" />;' },
        { code: "const a = <p>{`${count}`}</p>;" },
        { code: 'const a = <p>{ok ? t("open") : t("closed")}</p>;' },
        { code: 'const a = <p>{isOwner && t("manage")}</p>;' },
        { code: 'const a = <p>{"label" === mode && t("x")}</p>;' },
        { code: 'const a = <p>{value ?? "—"}</p>;' },
        { code: 'const a = <div className={open ? "on" : "off"} />;' },
      ],
      invalid: [],
    });
    expect(run).not.toThrow();
  });

  it("refuse le texte JSX et les attributs lus écrits en dur", () => {
    const run = () => tester.run("bluegenji/no-literal-ui-text", rule, {
      valid: [],
      invalid: [
        { code: "const a = <p>Bonjour</p>;", errors: [{ messageId: "jsxText" }] },
        { code: 'const a = <p>{"Bonjour"}</p>;', errors: [{ messageId: "jsxText" }] },
        { code: "const a = <p>{`Bonjour`}</p>;", errors: [{ messageId: "jsxText" }] },
        { code: 'const a = <button aria-label="Fermer" />;', errors: [{ messageId: "attribute" }] },
        { code: 'const a = <input placeholder={"Rechercher"} />;', errors: [{ messageId: "attribute" }] },
        { code: 'const a = <img alt="Logo" />;', errors: [{ messageId: "attribute" }] },
        { code: 'const a = <X title="Règles" label="Équipe" ariaLabel="Zone" />;', errors: 3 },
        // Les formes les plus courantes d'un texte d'interface, derrière une expression.
        { code: 'const a = <p>{ok ? "Inscrit" : "Fermé"}</p>;', errors: [{ messageId: "jsxText" }] },
        { code: "const a = <p>{isOwner && \"Gérer l'équipe\"}</p>;", errors: [{ messageId: "jsxText" }] },
        { code: 'const a = <p>{name || "Anonyme"}</p>;', errors: [{ messageId: "jsxText" }] },
        { code: 'const a = <p>{"Équipe " + n}</p>;', errors: [{ messageId: "jsxText" }] },
        { code: "const a = <p>{`${n} équipes`}</p>;", errors: [{ messageId: "jsxText" }] },
        { code: 'const a = <button aria-label={open ? "Fermer" : "Ouvrir"} />;', errors: [{ messageId: "attribute" }] },      ],
    });
    expect(run).not.toThrow();
  });
});
