import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { FinishedCard } from "@/app/(secured)/tournois/cards/FinishedCard";
import { RegistrationCard } from "@/app/(secured)/tournois/cards/RegistrationCard";
import { RunningCard } from "@/app/(secured)/tournois/cards/RunningCard";
import { StateCard } from "@/app/(secured)/tournois/cards/StateCard";
import { UpcomingCard } from "@/app/(secured)/tournois/cards/UpcomingCard";
import {
  CARD_IMAGE_SIZES,
  priorityBannerIds,
  RUNNING_CARD_IMAGE_SIZES,
} from "@/app/(secured)/tournois/cards/card-image";
import type { TournamentImage } from "@/lib/shared/tournament-image";
import type { TournamentCard, TournamentState } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

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
  return tournamentCard({
    id: 7,
    name: "BlueGenji Open",
    registeredTeams: 4,
    state: "REGISTRATION",
    startVisibilityAt: "2026-08-01T10:00:00.000Z",
    registrationOpenAt: "2026-08-05T10:00:00.000Z",
    registrationCloseAt: "2026-08-20T10:00:00.000Z",
    startAt: "2026-08-25T18:00:00.000Z",
    ...overrides,
  });
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

  it("donne à `sizes` la largeur d'affichage, sans la doubler (le navigateur multiplie par la densité)", () => {
    const markup = renderToStaticMarkup(<TournamentImageEmblem image={logo} size={40} />);
    // Un logo de 40 px : le srcset en choisit un de 96w en DPR 2, pas de 256w.
    expect(imgTags(markup)[0]).toContain('sizes="40px"');
    expect(imgTags(markup)[0]).not.toContain('sizes="80px"');
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
    // Le nom figure aussi dans le nom accessible de la plaque de la carte
    // (`aria-label="Voir le tournoi …"`), avant le bandeau : c'est le titre
    // **visible** (`<h3>`), pas la première occurrence du nom, qui doit le suivre.
    expect(markup.indexOf("<img")).toBeLessThan(markup.indexOf("<h3"));
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

  it("le bandeau des cartes d'une section à trois colonnes suit la grille (≈ 400 px), pas 720 px", () => {
    expect(CARD_IMAGE_SIZES).toBe("(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 400px");
    const markup = renderToStaticMarkup(<RegistrationCard t={card({ state: "REGISTRATION", image: cover })} />);
    expect(imgTags(markup)[0]).toContain(`sizes="${CARD_IMAGE_SIZES}"`);
  });

  it("la carte « en cours » garde ses deux colonnes : des `sizes` plus larges", () => {
    const markup = renderToStaticMarkup(<RunningCard t={card({ state: "RUNNING", image: cover })} />);
    expect(imgTags(markup)[0]).toContain(`sizes="${RUNNING_CARD_IMAGE_SIZES}"`);
    expect(RUNNING_CARD_IMAGE_SIZES).toContain("580px");
  });

  it("une carte « en cours » rangée dans une grille à trois colonnes reprend les `sizes` standard", () => {
    const markup = renderToStaticMarkup(<StateCard t={card({ state: "RUNNING", image: cover })} />);
    expect(imgTags(markup)[0]).toContain(`sizes="${CARD_IMAGE_SIZES}"`);
  });

  it.each([
    ["en cours", RunningCard],
    ["inscriptions", RegistrationCard],
    ["terminé", FinishedCard],
  ])("la carte %s est mémoïsée : une frappe dans la recherche ne la redessine pas", (_, Card) => {
    expect((Card as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("l'aiguillage StateCard n'est pas mémoïsé : il ne doit pas figer le visage d'une carte « à venir »", () => {
    expect((StateCard as unknown as { $$typeof?: symbol }).$$typeof).not.toBe(Symbol.for("react.memo"));
  });

  it("la carte « à venir » juge son visage à chaque rendu mais dessine sous `memo`", () => {
    const hour = 3_600_000;
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    const announced = renderToStaticMarkup(
      <UpcomingCard t={card({ state: "UPCOMING", registrationOpenAt: iso(hour), registrationCloseAt: iso(2 * hour) })} />,
    );
    const locked = renderToStaticMarkup(
      <UpcomingCard t={card({ state: "UPCOMING", registrationOpenAt: iso(-2 * hour), registrationCloseAt: iso(-hour) })} />,
    );
    // Le visage dépend de l'heure, calculée hors du `memo` : il change sans que
    // la carte change de référence.
    expect(announced).not.toBe(locked);
    expect(UpcomingCard).not.toHaveProperty("$$typeof");
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

/**
 * Un fichier injoignable (restauration sans images, purge) ne laisse pas une
 * icône d'image cassée : l'image disparaît, comme pour un tournoi qui n'en a
 * pas. `onError` ne se déclenche que dans un navigateur, d'où un contrôle sur
 * la source — le rendu serveur ci-dessus couvre le reste.
 */
describe("image de tournoi — fichier injoignable", () => {
  const source = readFileSync(join(process.cwd(), "components/tournament-image.tsx"), "utf8");

  it("est un composant client, seul à pouvoir écouter l'échec", () => {
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("retombe sur l'absence d'image, bandeau comme pastille, mémorisé par adresse", () => {
    expect(source.match(/onError=\{\(\) => setFailedUrl\(image\.url\)\}/g)).toHaveLength(2);
    expect(source.match(/image\.url === failedUrl\) return null/g)).toHaveLength(2);
  });
});
