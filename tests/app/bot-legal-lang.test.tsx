import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { PRIVACY_POLICY, TERMS_OF_SERVICE, type BilingualDoc } from "@/lib/shared/bot-legal-content";
import { readSource } from "../helpers/read-source";

/** La langue déclarée par chaque `<section>` du rendu. */
const sectionLangs = (html: string) =>
  [...html.matchAll(/<section[^>]*>/g)].map((m) => /lang="([^"]*)"/.exec(m[0])?.[1] ?? null);

describe("BotLegalDoc — langue du contenu (WCAG 3.1.2)", () => {
  it.each<[string, BilingualDoc]>([
    ["Terms of Service", TERMS_OF_SERVICE],
    ["Privacy Policy", PRIVACY_POLICY],
  ])("%s : chaque section déclare la langue affichée", (_name, doc) => {
    const langs = sectionLangs(renderToStaticMarkup(<BotLegalDoc doc={doc} />));
    // Hero + sections du document + hébergeur : aucune n'est oubliée.
    expect(langs).toHaveLength(doc.fr.sections.length + 2);
    expect(new Set(langs)).toEqual(new Set(["fr"]));
  });

  it("déclare la langue à partir de l'état, pas en dur", () => {
    const source = readSource("components/legal/BotLegalDoc.tsx");
    expect(source.match(/<section[^>]*lang=\{lang\}/g)).toHaveLength(3);
  });

  it("écrit chaque bouton du sélecteur dans sa propre langue", () => {
    const html = renderToStaticMarkup(<BotLegalDoc doc={TERMS_OF_SERVICE} />);
    expect(html).toMatch(/<button[^>]*lang="fr"[^>]*>Français<\/button>/);
    expect(html).toMatch(/<button[^>]*lang="en"[^>]*>English<\/button>/);
  });
});
