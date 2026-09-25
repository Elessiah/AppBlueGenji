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

  it("porte un `<time>` avec une date machine-lisible et un nom accessible", () => {
    expect(html).toContain('<time dateTime="2030-01-01T00:00:00Z"');
    expect(html).toContain('aria-label="Chargement du compte à rebours"');
  });

  it("cache les cases visuelles aux technologies d'assistance", () => {
    const matches = html.match(/aria-hidden="true"/g) ?? [];
    expect(matches.length).toBe(4);
  });
});
