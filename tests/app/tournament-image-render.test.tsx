import { describe, expect, it } from "@jest/globals";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { FinishedCard } from "@/app/(secured)/tournois/cards/FinishedCard";
import { RegistrationCard } from "@/app/(secured)/tournois/cards/RegistrationCard";
import { RunningCard } from "@/app/(secured)/tournois/cards/RunningCard";
import { UpcomingCard } from "@/app/(secured)/tournois/cards/UpcomingCard";
import { priorityBannerIds } from "@/app/(secured)/tournois/cards/card-image";
import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";
import type { TournamentImage } from "@/lib/shared/tournament-image";
import type { TournamentCard, TournamentState } from "@/lib/shared/types";

/**
 * Rendu de l'image d'un tournoi : une **illustration** devient un bandeau
 * cadré sur son point focal, un **logo** une pastille à côté du nom, et un
 * tournoi **sans image** garde exactement sa carte d'avant — l'image est
 * facultative, son absence ne doit laisser ni case vide ni repli inventé.
 */

const URL = "/api/uploads/tournaments/7-abc.webp";
const cover: TournamentImage = { url: URL, fit: "COVER", focusX: 20, focusY: 75 };
const logo: TournamentImage = { url: URL, fit: "CONTAIN", focusX: 50, focusY: 50 };

const imgTags = (markup: string) => markup.match(/<img\b[^>]*>/g) ?? [];

function card(overrides: Partial<TournamentCard> = {}): TournamentCard {
  return {
    id: 7,
    name: "BlueGenji Open",
    description: null,
    format: "SINGLE",
    game: "OW",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 4,
    state: "REGISTRATION",
    startVisibilityAt: "2026-08-01T10:00:00.000Z",
    registrationOpenAt: "2026-08-05T10:00:00.000Z",
    registrationCloseAt: "2026-08-20T10:00:00.000Z",
    startAt: "2026-08-25T18:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    endurancePlayoffFormat: null,
    registrationFilters: { ...DEFAULT_REGISTRATION_FILTERS },
    liveUrl: null,
    image: null,
    finishedAt: null,
    championName: null,
    ...overrides,
  };
}

describe("TournamentImageBanner", () => {
  it("rend une illustration cadrée sur son point focal, en image décorative", () => {
    const [img] = imgTags(renderToStaticMarkup(<TournamentImageBanner image={cover} sizes="100vw" />));
    expect(img).toBeDefined();
    expect(img).toContain('alt=""');
    expect(img).toMatch(/object-position:20% 75%/);
    // Passé par l'optimiseur de Next : redimensionné, jamais servi tel quel.
    expect(img).toContain(encodeURIComponent(URL));
  });

  it("ne rend rien pour un logo ni sans image", () => {
    expect(renderToStaticMarkup(<TournamentImageBanner image={logo} sizes="100vw" />)).toBe("");
    expect(renderToStaticMarkup(<TournamentImageBanner image={null} sizes="100vw" />)).toBe("");
  });
});

describe("TournamentImageEmblem", () => {
  it("rend un logo entier, à la taille demandée", () => {
    const markup = renderToStaticMarkup(<TournamentImageEmblem image={logo} size={64} />);
    expect(imgTags(markup)).toHaveLength(1);
    expect(markup).toContain("--tournament-emblem-size:64px");
    expect(imgTags(markup)[0]).toContain('alt=""');
  });

  it("ne rend rien pour une illustration ni sans image", () => {
    expect(renderToStaticMarkup(<TournamentImageEmblem image={cover} size={40} />)).toBe("");
    expect(renderToStaticMarkup(<TournamentImageEmblem image={null} size={40} />)).toBe("");
  });
});

describe("cartes de /tournois", () => {
  const cards: [string, ComponentType<{ t: TournamentCard }>, TournamentState][] = [
    ["à venir", UpcomingCard, "UPCOMING"],
    ["inscriptions", RegistrationCard, "REGISTRATION"],
    ["en cours", RunningCard, "RUNNING"],
    ["terminé", FinishedCard, "FINISHED"],
  ];

  it.each(cards)("carte %s : aucune image quand le tournoi n'en a pas", (_, Card, state) => {
    expect(imgTags(renderToStaticMarkup(<Card t={card({ state })} />))).toHaveLength(0);
  });

  it.each(cards)("carte %s : une illustration en bandeau, avant le nom", (_, Card, state) => {
    const markup = renderToStaticMarkup(<Card t={card({ state, image: cover })} />);
    const imgs = imgTags(markup);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatch(/object-position:20% 75%/);
    expect(markup.indexOf("<img")).toBeLessThan(markup.indexOf("BlueGenji Open"));
  });

  it.each(cards)("carte %s : un logo en pastille, sans bandeau", (_, Card, state) => {
    const markup = renderToStaticMarkup(<Card t={card({ state, image: logo })} />);
    const imgs = imgTags(markup);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).not.toContain("object-position");
    expect(markup).toContain("--tournament-emblem-size:40px");
  });

  it("l'image reste dans la carte : aucune seconde ancre", () => {
    const markup = renderToStaticMarkup(<RegistrationCard t={card({ image: cover })} />);
    expect(markup.match(/<a\b/g)).toHaveLength(1);
  });
});

describe("cartes de /tournois — format, état et actions", () => {
  it("traduit chaque format via FORMAT_LABELS, pas seulement DOUBLE", () => {
    // Régression : toute carte d'un format autre que DOUBLE s'annonçait
    // « Élimination simple », Suisse/Survie/BG Survie/Multi compris.
    const swiss = renderToStaticMarkup(<RunningCard t={card({ state: "RUNNING", format: "SWISS" })} />);
    expect(swiss).toContain("Ronde suisse");
    expect(swiss).not.toContain("Élimination simple");

    const survival = renderToStaticMarkup(<UpcomingCard t={card({ state: "UPCOMING", format: "SURVIVAL" })} />);
    expect(survival).toContain("Survie");

    const bgSurvie = renderToStaticMarkup(<RegistrationCard t={card({ state: "REGISTRATION", format: "BG_SURVIE" })} />);
    expect(bgSurvie).toContain("BlueGenji Survie");
  });

  it("carte en cours : ruban bleu, jamais rouge — le rouge est réservé au direct", () => {
    const markup = renderToStaticMarkup(<RunningCard t={card({ state: "RUNNING" })} />);
    expect(markup).not.toContain("cardRibbonLive");
    expect(markup).toContain("cardRibbonRunning");
    expect(markup).not.toContain('data-state="live"');
  });

  it("carte en cours : l'action dépend du format, jamais toujours « Voir bracket »", () => {
    expect(renderToStaticMarkup(<RunningCard t={card({ state: "RUNNING", format: "DOUBLE" })} />)).toContain(
      "Voir le bracket",
    );
    expect(renderToStaticMarkup(<RunningCard t={card({ state: "RUNNING", format: "SURVIVAL" })} />)).toContain(
      "Voir le classement",
    );
  });

  it("carte d'inscriptions : « Complet » sur un plateau plein, sinon une consultation neutre", () => {
    const full = renderToStaticMarkup(
      <RegistrationCard t={card({ state: "REGISTRATION", registeredTeams: 8, maxTeams: 8 })} />,
    );
    expect(full).toContain("Complet");
    expect(full).not.toContain("S&#x27;inscrire");

    const open = renderToStaticMarkup(
      <RegistrationCard t={card({ state: "REGISTRATION", registeredTeams: 4, maxTeams: 8 })} />,
    );
    expect(open).toContain("Voir le tournoi");
  });

  it("carte terminée : nomme la championne et sa date de clôture réelle", () => {
    const markup = renderToStaticMarkup(
      <FinishedCard
        t={card({
          state: "FINISHED",
          startAt: "2026-08-25T18:00:00.000Z",
          finishedAt: "2026-09-02T20:00:00.000Z",
          championName: "Team Alpha",
        })}
      />,
    );
    expect(markup).toContain("Team Alpha");
    // La date affichée est celle de la clôture, pas celle du coup d'envoi.
    expect(markup).toContain("02 sept. 2026");
    expect(markup).not.toContain("25 août 2026");
  });

  it("carte terminée sans championne (finale en double forfait) : un tiret, pas un texte vide", () => {
    const markup = renderToStaticMarkup(
      <FinishedCard t={card({ state: "FINISHED", championName: null })} />,
    );
    expect(markup).toContain("—");
  });

  it("carte à venir : distingue inscriptions pas encore ouvertes et déjà closes", () => {
    const notYetOpen = renderToStaticMarkup(
      <UpcomingCard
        t={card({
          state: "UPCOMING",
          registrationOpenAt: "2099-01-01T00:00:00.000Z",
          registrationCloseAt: "2099-01-10T00:00:00.000Z",
        })}
      />,
    );
    expect(notYetOpen).toContain("Ouverture inscriptions");
    expect(notYetOpen).toContain("Inscriptions bientôt");

    const closed = renderToStaticMarkup(
      <UpcomingCard
        t={card({
          state: "UPCOMING",
          registrationOpenAt: "2020-01-01T00:00:00.000Z",
          registrationCloseAt: "2020-01-10T00:00:00.000Z",
        })}
      />,
    );
    expect(closed).toContain("Clôture inscriptions");
    expect(closed).toContain("Inscriptions closes");
  });
});

describe("priorityBannerIds — bandeaux chargés en priorité", () => {
  it("retient les premiers bandeaux dans l'ordre d'affichage, logos et cartes nues exclus", () => {
    const cards = [
      card({ id: 1, image: null }),
      card({ id: 2, image: logo }),
      card({ id: 3, image: cover }),
      card({ id: 4, image: cover }),
      card({ id: 5, image: cover }),
    ];
    expect([...priorityBannerIds(cards)]).toEqual([3, 4]);
    expect([...priorityBannerIds(cards, 1)]).toEqual([3]);
    expect(priorityBannerIds([card({ image: logo })]).size).toBe(0);
  });

  it("une carte prioritaire charge son bandeau d'emblée, les autres paresseusement", () => {
    const eager = imgTags(renderToStaticMarkup(<RegistrationCard t={card({ image: cover })} priority />))[0];
    const lazy = imgTags(renderToStaticMarkup(<RegistrationCard t={card({ image: cover })} />))[0];
    expect(eager).not.toContain('loading="lazy"');
    expect(lazy).toContain('loading="lazy"');
  });
});
