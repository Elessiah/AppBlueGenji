import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarCard } from "@/components/cyber/landing/CalendarCard";
import { TournamentBoard } from "@/components/cyber/landing/TournamentBoard";
import type { LandingCalendarEvent } from "@/lib/shared/landing";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

// Calendrier de la fabrique : inscriptions du 2 au 10 mai, coup d'envoi le 12.
const NOW = new Date("2026-05-05T12:00:00.000Z");

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

function buckets(partial: Partial<TournamentBuckets>): TournamentBuckets {
  return { upcoming: [], registration: [], running: [], finished: [], ...partial };
}

function render(featured: TournamentCard | null, list: TournamentBuckets, miniBracket = [] as { a: string; b: string; sa: number | string; sb: number | string }[]) {
  return renderToStaticMarkup(<TournamentBoard buckets={list} featured={featured} miniBracket={miniBracket} />);
}

/**
 * Texte d'une carte. Le mock des feuilles de style rend le nom de classe tel
 * quel : chaque carte s'ouvre sur `featured` ou `upcoming`, et s'étend jusqu'à
 * la suivante.
 */
function cardText(markup: string, name: string): string {
  const segments = markup.split(/(?=<div class="[^"]*\b(?:featured|upcoming)\b)/);
  const segment = segments.find((part) => part.includes(name));
  if (!segment) throw new Error(`carte « ${name} » absente`);
  return segment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("TournamentBoard", () => {
  it("lit le jeu sur la donnée, jamais sur le nom", () => {
    const rivals = tournamentCard({ id: 2, name: "Coupe du printemps", game: "MR", state: "REGISTRATION" });
    const markup = render(null, buckets({ registration: [rivals] }));

    const text = cardText(markup, "Coupe du printemps");
    expect(text).toContain("Marvel Rivals");
    expect(text).not.toMatch(/overwatch/i);
  });

  it("ne nomme le jeu qu'une fois par carte", () => {
    const featured = tournamentCard({ id: 1, name: "Grande Coupe", game: "OW", state: "REGISTRATION" });
    const other = tournamentCard({ id: 2, name: "Petite Coupe", game: "OW", state: "REGISTRATION" });
    const markup = render(featured, buckets({ registration: [featured, other] }));

    for (const name of ["Grande Coupe", "Petite Coupe"]) {
      expect(cardText(markup, name).match(/overwatch/gi)).toHaveLength(1);
    }
  });

  it("ne propose pas l'inscription sur un tournoi en cours", () => {
    const running = tournamentCard({ id: 3, name: "Coupe lancée", state: "RUNNING", format: "SWISS" });
    const markup = render(null, buckets({ running: [running] }));

    const text = cardText(markup, "Coupe lancée");
    expect(text).not.toContain("S'inscrire");
    expect(text).not.toContain("S&#x27;inscrire");
    expect(text).toContain("Suivre le tournoi");
  });

  it("ne propose pas l'inscription sur un tournoi complet, et le dit", () => {
    const full = tournamentCard({ id: 4, name: "Coupe pleine", state: "REGISTRATION", maxTeams: 8, registeredTeams: 8 });
    const text = cardText(render(null, buckets({ registration: [full] })), "Coupe pleine");

    expect(text).toContain("Complet");
    expect(text).toContain("Voir le tournoi");
    expect(text).not.toMatch(/S(&#x27;|')inscrire/);
  });

  it("propose l'inscription quand il reste une place", () => {
    const open = tournamentCard({ id: 5, name: "Coupe ouverte", state: "REGISTRATION", registeredTeams: 2 });
    const text = cardText(render(null, buckets({ registration: [open] })), "Coupe ouverte");
    expect(text).toMatch(/S(&#x27;|')inscrire/);
    expect(text).toContain("Inscriptions ouvertes");
  });

  it("carte mise en avant : état en français, pastille bleue, pas de bracket vide", () => {
    const featured = tournamentCard({ id: 6, name: "Coupe vedette", state: "REGISTRATION", registeredTeams: 2 });
    const markup = render(featured, buckets({ registration: [featured] }));
    const text = cardText(markup, "Coupe vedette");

    expect(text).not.toContain("REGISTRATION");
    expect(text).not.toContain("BRACKET");
    expect(text).toContain("Simple élimination");
    expect(text).not.toContain("Voir le bracket");
    expect(markup).not.toContain("pill-live");
  });

  it("un tournoi en cours mis en avant reste en bleu", () => {
    const featured = tournamentCard({ id: 7, name: "Coupe en cours", state: "RUNNING", format: "DOUBLE" });
    const markup = render(featured, buckets({ running: [featured] }), [{ a: "Alpha", b: "Bravo", sa: 2, sb: 1 }]);

    expect(markup).not.toContain("pill-live");
    expect(markup).toContain("pill-blue");
    expect(cardText(markup, "Coupe en cours")).toContain("Voir le bracket");
    expect(markup).toContain("Alpha");
  });

  it("n'affiche plus de cash prize fictif", () => {
    const featured = tournamentCard({ id: 8, name: "Coupe A", state: "REGISTRATION" });
    const other = tournamentCard({ id: 9, name: "Coupe B", state: "REGISTRATION" });
    expect(render(featured, buckets({ registration: [featured, other] })).toUpperCase()).not.toContain("CASH PRIZE");
  });

  it("date de début à la minute, sans secondes", () => {
    const other = tournamentCard({ id: 10, name: "Coupe datée", state: "REGISTRATION", startAt: "2026-05-12T18:30:45.000Z" });
    const text = cardText(render(null, buckets({ registration: [other] })), "Coupe datée");

    expect(text).toContain("12 mai · 20:30");
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("CalendarCard", () => {
  it("lit le jeu sur l'événement, jamais sur le nom", () => {
    const event: LandingCalendarEvent = {
      tournamentId: 1,
      name: "Coupe du printemps",
      game: "MR",
      startAt: "2026-05-12T18:30:00.000Z",
      registrationOpenAt: "2026-05-02T10:00:00.000Z",
      registrationCloseAt: "2026-05-10T10:00:00.000Z",
      state: "REGISTRATION",
      maxTeams: 8,
      registeredTeams: 2,
    };
    const markup = renderToStaticMarkup(<CalendarCard events={[event]} />);
    expect(markup).toContain(">MR<");
    expect(markup).not.toContain(">OW<");
  });
});
