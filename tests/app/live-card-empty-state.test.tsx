import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard } from "@/components/cyber/landing/LiveCard";

/**
 * Carte sans tournoi en cours : le message annonçait un complément qui ne se
 * construisait pas avec « dans » (« dans bientôt », « dans aujourd'hui »).
 * Chaque cas rend désormais sa phrase entière.
 */

const NOW = new Date("2026-05-05T12:00:00.000Z");

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

function render(nextUpcomingISO: string | null | undefined) {
  return renderToStaticMarkup(<LiveCard live={null} nextUpcomingISO={nextUpcomingISO} />);
}

describe("LiveCard — message sans tournoi en cours", () => {
  it("sans aucun tournoi à venir", () => {
    const html = render(null);
    expect(html).toContain("Aucun tournoi en cours, et rien n&#x27;est encore programmé.");
    expect(html).not.toContain("dans bientôt");
  });

  it("un tournoi qui démarre à l'instant même", () => {
    const html = render(NOW.toISOString());
    expect(html).toContain("Le prochain démarre aujourd&#x27;hui.");
    expect(html).not.toContain("dans aujourd");
  });

  it("un tournoi qui démarre dans 24 heures", () => {
    const html = render("2026-05-06T12:00:00.000Z");
    expect(html).toContain("Le prochain démarre dans 1 jour.");
    expect(html).not.toContain("1 jours");
  });

  it("un tournoi qui démarre dans plusieurs jours", () => {
    const html = render("2026-05-10T12:00:00.000Z");
    expect(html).toContain("Le prochain démarre dans 5 jours.");
  });
});
