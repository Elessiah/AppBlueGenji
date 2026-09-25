import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { FinishedCard } from "@/app/(secured)/tournois/cards/FinishedCard";
import { RegistrationCard } from "@/app/(secured)/tournois/cards/RegistrationCard";
import { RunningCard } from "@/app/(secured)/tournois/cards/RunningCard";
import { UpcomingCard } from "@/app/(secured)/tournois/cards/UpcomingCard";
import { FORMAT_LABELS } from "@/lib/shared/tournament-labels";
import type { TournamentCard, TournamentFormat } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * Cartes de `/tournois` : chacune dit ce qu'on vient y chercher, une fois, et
 * rien de faux — ni un format deviné, ni un « En cours » répété, ni une
 * inscription promise à qui ne peut pas s'inscrire.
 */

/** Texte visible d'un rendu, balises retirées. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const FORMATS = Object.keys(FORMAT_LABELS) as TournamentFormat[];

describe("libellé du format", () => {
  const cards: [string, (t: TournamentCard) => string][] = [
    ["en cours", (t) => renderToStaticMarkup(<RunningCard t={{ ...t, state: "RUNNING" }} />)],
    ["inscriptions", (t) => renderToStaticMarkup(<RegistrationCard t={{ ...t, state: "REGISTRATION" }} />)],
    ["à venir", (t) => renderToStaticMarkup(<UpcomingCard t={{ ...t, state: "UPCOMING" }} />)],
    ["terminé", (t) => renderToStaticMarkup(<FinishedCard t={{ ...t, state: "FINISHED" }} />)],
  ];

  it.each(cards)("carte %s : le vrai format, une seule fois", (_label, render) => {
    for (const format of FORMATS) {
      const shown = text(render(tournamentCard({ format })));
      expect(count(shown, FORMAT_LABELS[format])).toBe(1);
      if (format !== "SINGLE") expect(shown).not.toContain("Élimination simple");
    }
  });

  it.each(cards)("carte %s : le format des matchs à la place du doublon", (_label, render) => {
    const shown = text(render(tournamentCard({ matchFormat: { type: "BO", value: 5 } })));
    expect(shown).toContain("Matchs");
    expect(shown).toContain("BO5");
  });
});

describe("RunningCard", () => {
  const running = (overrides: Partial<TournamentCard> = {}) =>
    tournamentCard({ state: "RUNNING", ...overrides });

  it("ne dit « En cours » qu'une fois, et garde la description", () => {
    const shown = text(
      renderToStaticMarkup(<RunningCard t={running({ description: "Saison 3, poule A" })} />),
    );
    expect(count(shown.toLowerCase(), "en cours")).toBe(1);
    expect(shown).toContain("Saison 3, poule A");
    expect(shown).not.toMatch(/Statut|État/);
  });

  it("n'habille pas de rouge un tournoi qui n'est pas à l'antenne", () => {
    const markup = renderToStaticMarkup(<RunningCard t={running()} />);
    expect(markup).toContain('data-state="running"');
    expect(markup).not.toContain('data-state="live"');
    expect(markup).not.toMatch(/cardRibbonLive/);
  });

  it("annonce son déroulement et en peint la jauge", () => {
    const markup = renderToStaticMarkup(<RunningCard t={running({ runningProgress: 0.576 })} />);
    expect(text(markup)).toMatch(/Déroulement 57 %/);
    expect(markup).toContain("width:57%");
  });

  it("tait un déroulement inconnu, sans jauge vide", () => {
    const markup = renderToStaticMarkup(<RunningCard t={running({ runningProgress: null })} />);
    expect(text(markup)).toMatch(/Déroulement —/);
    expect(markup).not.toMatch(/width:\d+%/);
  });

  it("ne promet un bracket qu'aux formats qui en ont un", () => {
    const single = text(renderToStaticMarkup(<RunningCard t={running({ format: "SINGLE" })} />));
    const swiss = text(renderToStaticMarkup(<RunningCard t={running({ format: "SWISS" })} />));
    expect(single).toContain("Voir le bracket");
    expect(swiss).toContain("Voir le classement");
    expect(swiss).not.toContain("bracket");
  });

  it("ne pose plus de style de grille sans effet sur l'article", () => {
    expect(renderToStaticMarkup(<RunningCard t={running()} />)).not.toContain("grid-column");
  });
});

describe("RegistrationCard", () => {
  it("n'invite plus à s'inscrire depuis la liste", () => {
    const shown = text(
      renderToStaticMarkup(
        <RegistrationCard t={tournamentCard({ state: "REGISTRATION", registeredTeams: 3 })} />,
      ),
    );
    expect(shown).not.toMatch(/S'inscrire/);
    expect(shown).toContain("Voir le tournoi");
    expect(shown).toMatch(/Remplissage 37 %/);
  });

  it("dit « Complet » sur un plateau plein", () => {
    const shown = text(
      renderToStaticMarkup(
        <RegistrationCard
          t={tournamentCard({ state: "REGISTRATION", registeredTeams: 8, maxTeams: 8 })}
        />,
      ),
    );
    expect(shown).toMatch(/Remplissage Complet/);
    expect(shown).not.toContain("100 %");
  });
});

describe("UpcomingCard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const upcoming = tournamentCard({
    state: "UPCOMING",
    startVisibilityAt: "2026-05-01T10:00:00.000Z",
    registrationOpenAt: "2026-05-02T10:00:00.000Z",
    registrationCloseAt: "2026-05-10T10:00:00.000Z",
    startAt: "2026-05-12T10:00:00.000Z",
  });

  it("annonce l'ouverture d'inscriptions à venir", () => {
    jest.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const shown = text(renderToStaticMarkup(<UpcomingCard t={upcoming} />));
    expect(shown).toContain("À venir");
    expect(shown).toContain("Ouverture inscriptions");
    expect(shown).toContain("Inscriptions bientôt");
  });

  it("dit closes des inscriptions closes, sans date d'ouverture passée", () => {
    jest.setSystemTime(new Date("2026-05-11T12:00:00.000Z"));
    const shown = text(renderToStaticMarkup(<UpcomingCard t={upcoming} />));
    expect(shown).toContain("Inscriptions closes");
    expect(shown).toContain("En attente du coup d'envoi");
    expect(shown).not.toContain("Inscriptions bientôt");
    expect(shown).not.toContain("Ouverture inscriptions");
  });
});

describe("FinishedCard", () => {
  const finished = (overrides: Partial<TournamentCard> = {}) =>
    tournamentCard({
      state: "FINISHED",
      startAt: "2026-05-12T10:00:00.000Z",
      finishedAt: "2026-06-03T21:00:00.000Z",
      ...overrides,
    });

  it("est datée de sa clôture, pas de son coup d'envoi", () => {
    const shown = text(renderToStaticMarkup(<FinishedCard t={finished()} />));
    expect(shown).toMatch(/Terminé · 03 juin 2026/);
  });

  it("retombe sur le coup d'envoi faute de date de clôture", () => {
    const shown = text(renderToStaticMarkup(<FinishedCard t={finished({ finishedAt: null })} />));
    expect(shown).toMatch(/Terminé · 12 mai 2026/);
  });

  it("nomme le vainqueur, et ne dit « Terminé » qu'une fois", () => {
    const shown = text(
      renderToStaticMarkup(<FinishedCard t={finished({ champion: { teamId: 4, name: "Nova" } })} />),
    );
    expect(shown).toMatch(/Vainqueur .*Nova/);
    expect(count(shown, "Terminé")).toBe(1);
  });

  it("n'invente pas de vainqueur", () => {
    const shown = text(renderToStaticMarkup(<FinishedCard t={finished({ champion: null })} />));
    expect(shown).toMatch(/Vainqueur —/);
  });

  it("se ternit sans opacité, que les textes gardent leur contraste", () => {
    const markup = renderToStaticMarkup(<FinishedCard t={finished()} />);
    expect(markup).toContain('data-state="done"');
    expect(markup).not.toMatch(/cardDone|opacity/);
  });
});

describe("nom accessible de la carte", () => {
  const cards: [string, (t: TournamentCard) => string][] = [
    ["en cours", (t) => renderToStaticMarkup(<RunningCard t={{ ...t, state: "RUNNING" }} />)],
    ["inscriptions", (t) => renderToStaticMarkup(<RegistrationCard t={{ ...t, state: "REGISTRATION" }} />)],
    ["à venir", (t) => renderToStaticMarkup(<UpcomingCard t={{ ...t, state: "UPCOMING" }} />)],
    ["terminé", (t) => renderToStaticMarkup(<FinishedCard t={{ ...t, state: "FINISHED" }} />)],
  ];

  it.each(cards)(
    "carte %s : le lien de la carte se limite au titre, jamais à tout son texte",
    (_label, render) => {
      const markup = render(
        tournamentCard({ name: "Cyber Cup", description: "Une description assez longue pour compter" }),
      );
      // Un seul lien : la plaque transparente qui couvre la carte (pas un
      // `<a>` enveloppant tout le texte, ni un second lien à l'intérieur).
      expect(count(markup, "<a ")).toBe(1);
      const link = markup.match(/<a [^>]*>/)?.[0] ?? "";
      expect(link).toContain('href="/tournois/');
      expect(link).toContain('aria-label="Voir le tournoi Cyber Cup"');
      // Un lien vide : son texte visible ne recoupe pas le titre, la
      // description ou le ruban — sinon le nom accessible concatènerait de
      // nouveau tout le texte de la carte.
      expect(markup).toMatch(/<a [^>]*><\/a>/);
    },
  );
});
