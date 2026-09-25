import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CountdownStrip } from "@/components/cyber/CountdownStrip";

/**
 * `useClock` ne se résout qu'après montage (effet React) : un rendu à la
 * chaîne, comme le premier rendu serveur, le laisse à `null` — exactement
 * l'état qu'il fallait couvrir (voir ERREUR.txt, entrées CountdownStrip).
 */
describe("CountdownStrip avant hydratation", () => {
  const html = renderToStaticMarkup(
    <CountdownStrip targetISO="2030-01-01T00:00:00Z" label="PROCHAIN TOURNOI · Test" />,
  );

  it("n'affiche jamais « 00 » comme si le tournoi démarrait", () => {
    expect(html).not.toContain("00</div>");
    expect(html).toContain("--</div>");
  });

  it("distingue le repli par une classe de couleur dédiée, posée sur les « -- »", () => {
    const matches = html.match(/class="[^"]*valPending[^"]*">--<\/div>/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it("porte la phrase en contenu réel, jamais en `aria-label` (rôle `time` = Name Prohibited)", () => {
    expect(html).toContain('<time dateTime="2030-01-01T00:00:00Z">');
    expect(html).toContain('<span class="sr-only">Chargement du compte à rebours</span>');
    expect(html).not.toContain('aria-label="Chargement du compte à rebours"');
  });

  it("cache le bloc visuel aux technologies d'assistance, en une seule fois", () => {
    const matches = html.match(/aria-hidden="true"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
