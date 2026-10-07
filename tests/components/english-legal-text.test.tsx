/**
 * Phrases légales anglaises (lot 7b-1) : les noms français cités « … » sont
 * annoncés `lang="fr"`, le gras `**…**` reste rendu.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { EnglishLegalText } from "@/components/legal/EnglishLegalText";

const html = (text: string) => renderToStaticMarkup(<EnglishLegalText text={text} />);

describe("EnglishLegalText", () => {
  it("annonce chaque citation française lang=fr", () => {
    expect(html("the “Other” category (« Autre ») or “Appeal” (« Contestation »)")).toBe(
      'the “Other” category (<span lang="fr">« Autre »</span>) or “Appeal” (<span lang="fr">« Contestation »</span>)',
    );
  });

  it("garde le gras autour et hors des citations", () => {
    expect(html("**Redress**: the “GDPR” category (« RGPD »), then the **court**.")).toBe(
      '<strong>Redress</strong>: the “GDPR” category (<span lang="fr">« RGPD »</span>), then the <strong>court</strong>.',
    );
  });

  it("laisse intact un texte sans citation", () => {
    expect(html("Plain **text**.")).toBe("Plain <strong>text</strong>.");
    expect(html("")).toBe("");
  });
});
