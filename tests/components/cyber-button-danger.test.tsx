import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CyberButton } from "@/components/cyber/CyberButton";
import { readSource } from "../helpers/read-source";

/**
 * Variante `danger` de `CyberButton` — le bouton « Se désinscrire » de la fiche
 * d'un tournoi (`docs/features/SELF_WITHDRAWAL.md`) : saumon des erreurs
 * (`--danger`), jamais le rouge du direct ni l'ambre des avertissements.
 */
describe("CyberButton danger", () => {
  it("CyberButton_dangerVariant_appliesDangerClass", () => {
    const html = renderToStaticMarkup(<CyberButton variant="danger">Se désinscrire</CyberButton>);

    expect(html).toContain('class="root danger"');
    expect(html).not.toContain("primary");
  });

  it("CyberButtonCss_dangerVariant_usesDangerTokenNotLiveRedNorAmber", () => {
    const css = readSource("components/cyber/CyberButton.module.css");
    const dangerRule = /\n\.danger \{[^}]*\}/.exec(css)?.[0] ?? "";

    expect(dangerRule).toContain("var(--danger-rgb)");
    expect(css).not.toContain("--amber");
    expect(css).not.toContain("pill-live");
  });
});
