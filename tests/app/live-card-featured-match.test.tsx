import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard } from "@/components/cyber/landing/LiveCard";
import type { LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import type { MatchLiveState } from "@/lib/shared/live-streams";
import type { TournamentCard } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * La carte « en cours » de l'accueil met un match en avant — et doit y mener.
 *
 * Elle ne le faisait pas : le visiteur lisait deux noms d'équipes, puis devait
 * retrouver la manche à la main dans un plateau qui peut compter 127 cartes.
 * Ces cas gardent les trois moitiés du geste : la cible du lien (ancrée sur le
 * match), l'accès au direct (réservé à ce qui est réellement à l'antenne), et
 * l'absence de toute donnée inventée dans la carte.
 */

const ISO = "2026-09-01T18:00:00.000Z";

function tournament(overrides: Partial<TournamentCard> = {}): TournamentCard {
  return tournamentCard({
    id: 7,
    name: "Coupe Genji",
    description: null,
    format: "SINGLE",
    game: "OW",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 8,
    state: "RUNNING",
    startVisibilityAt: ISO,
    registrationOpenAt: ISO,
    registrationCloseAt: ISO,
    startAt: ISO,
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
    ...overrides,
  });
}

function match(overrides: Partial<LandingLiveMatch> = {}): LandingLiveMatch {
  return {
    id: 42,
    team1Name: "Alpha",
    team2Name: "Beta",
    team1Href: "/equipes/1",
    team2Href: "/equipes/2",
    team1LogoUrl: null,
    team2LogoUrl: null,
    team1Score: 1,
    team2Score: 0,
    team1Seed: null,
    team2Seed: null,
    bracket: "UPPER",
    roundLabel: "Quart de finale",
    matchFormat: null,
    liveState: "OFF",
    liveUrl: null,
    launchPhase: "LAUNCHED",
    startAt: null,
    ...overrides,
  };
}

function live(overrides: Partial<LandingLive> = {}): LandingLive {
  return {
    tournament: tournament(),
    currentMatch: match(),
    viewers: 12,
    game: "Overwatch",
    phase: "PHASE ÉLIMINATOIRE",
    stream: null,
    ...overrides,
  };
}

const render = (value: LandingLive | null) =>
  renderToStaticMarkup(<LiveCard live={value} nextUpcomingISO={null} />);

/** Toutes les cibles `href` du rendu, dans l'ordre du DOM. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((found) => found[1]);
}

function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

describe("LiveCard — accès au tournoi du match mis en avant", () => {
  it("mène au tournoi, ancré sur le match", () => {
    // Le chemin vient de `tournamentMatchHref` : c'est lui que relit la fiche du
    // tournoi. Un `#match-…` recopié à la main dériverait sans bruit.
    expect(hrefs(render(live()))).toContain("/tournois/7#match-42");
  });

  it("se réduit au tournoi quand aucun match n'est à montrer", () => {
    const html = render(live({ currentMatch: null }));
    expect(hrefs(html)).toContain("/tournois/7");
    expect(html).not.toContain("#match-");
  });

  it("nomme sa cible pour les lecteurs d'écran", () => {
    // La plaque de lien est transparente et vide : sans intitulé, elle
    // s'annoncerait « lien » et rien d'autre.
    const html = render(live());
    expect(html).toContain('aria-label="Ouvrir Coupe Genji sur le match Alpha contre Beta"');
  });

  it("nomme le tournoi seul quand il n'y a pas de match", () => {
    const html = render(live({ currentMatch: null }));
    expect(html).toContain('aria-label="Ouvrir la fiche du tournoi Coupe Genji"');
  });

  it("laisse les noms des engagés mener à leur propre fiche", () => {
    // Le lien de la carte est une plaque, précisément pour que ces deux liens
    // survivent : un `<a>` dans un `<a>` casserait l'hydratation.
    const list = hrefs(render(live()));
    expect(list).toContain("/equipes/1");
    expect(list).toContain("/equipes/2");
  });

  it("n'ouvre aucun lien quand il n'y a pas de tournoi en cours", () => {
    const html = render(null);
    expect(html).toContain("INFO TOURNOI");
    expect(hrefs(html)).toEqual([]);
  });
});

describe("LiveCard — accès au direct", () => {
  function withStream(liveState: MatchLiveState, liveUrl: string | null) {
    return render(live({ currentMatch: match({ liveState, liveUrl }) }));
  }

  it("propose le direct d'un match à l'antenne", () => {
    const html = withStream("LIVE", "https://twitch.tv/bluegenji");
    expect(hrefs(html)).toContain("https://twitch.tv/bluegenji");
    expect(text(html)).toContain("Regarder sur Twitch");
  });

  it("ouvre le direct dans un nouvel onglet, sans laisser la page en otage", () => {
    const html = withStream("LIVE", "https://twitch.tv/bluegenji");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("nomme la plateforme du lien", () => {
    expect(text(withStream("LIVE", "https://www.youtube.com/@bg"))).toContain(
      "Regarder sur YouTube",
    );
    expect(text(withStream("LIVE", "https://kick.com/bg"))).toContain("Regarder sur Kick");
  });

  it("retombe sur un libellé neutre si la plateforme est inconnue", () => {
    expect(text(withStream("LIVE", "https://exemple.com/live"))).toContain("Regarder le live");
  });

  it("ne propose rien sur un match seulement annoncé comme casté", () => {
    // `SCHEDULED` : la chaîne ne montre pas encore ce match. Même règle que le
    // bouton « Regarder le live » du hero, qui n'apparaît qu'à l'antenne ouverte.
    const html = withStream("SCHEDULED", "https://twitch.tv/bluegenji");
    expect(hrefs(html)).not.toContain("https://twitch.tv/bluegenji");
    expect(text(html)).not.toContain("Regarder");
    // Le bandeau reste : l'information « ce match sera casté » est vraie.
    expect(text(html)).toContain("DIFFUSION ANNONCÉE");
  });

  it("ne propose rien sur un match qui n'est pas casté", () => {
    const html = withStream("OFF", "https://twitch.tv/bluegenji");
    expect(hrefs(html)).not.toContain("https://twitch.tv/bluegenji");
    expect(text(html)).not.toContain("EN DIRECT");
  });

  it("annonce le direct sans bouton quand la chaîne n'est pas publique", () => {
    // Un match peut être casté sans lien saisi : la pastille le dit, il n'y a
    // simplement nulle part où cliquer.
    const html = withStream("LIVE", null);
    expect(text(html)).toContain("En direct");
    expect(html).toContain("pill-live");
    expect(text(html)).not.toContain("Regarder");
  });
});

describe("LiveCard — plus aucune donnée inventée", () => {
  it("n'écrit plus de seed ni de pays en dur", () => {
    const html = text(render(live()));
    expect(html).not.toContain("FR ·");
    expect(html).not.toContain("SEED");
  });

  it("affiche les seeds quand ils sont connus, et seulement ceux-là", () => {
    const html = text(render(live({ currentMatch: match({ team1Seed: 3, team2Seed: null }) })));
    expect(html).toContain("SEED 3");
    expect(html).not.toContain("SEED 4");
  });

  it("n'annonce plus une carte de jeu que le modèle ne porte pas", () => {
    expect(text(render(live()))).not.toContain("CARTE EN COURS");
  });

  it("réserve le rouge à ce qui est réellement à l'antenne", () => {
    // Un match lancé mais non casté : « En cours » en bleu, jamais `pill-live`.
    expect(render(live())).not.toContain("pill-live");
    expect(render(live())).toContain("pill-blue");
  });
});

/** Libellés des pastilles rendues, dans l'ordre du document. */
function pillLabels(html: string): string[] {
  // La pastille rouge porte un point animé (`<span class="dot">`) avant son texte.
  return [...html.matchAll(/<span class="pill[^"]*">((?:<span class="dot"><\/span>)?[^<]*)<\/span>/g)].map((m) =>
    text(m[1]).trim(),
  );
}

describe("LiveCard — état du match et état du tournoi", () => {
  it("annonce un match daté comme en attente, horaire compris, sans le redire ailleurs", () => {
    const html = render(
      live({ currentMatch: match({ launchPhase: "SCHEDULED", startAt: "2099-03-04T19:30:00.000Z" }) }),
    );
    expect(pillLabels(html)).toEqual(["En attente de lancement · 4 mars 2099 · 20:30"]);
    expect(text(html)).not.toContain("Prochain match");
  });

  it("dit « Lancement » quand l'heure du match est venue", () => {
    expect(pillLabels(render(live({ currentMatch: match({ launchPhase: "LOBBY" }) })))).toEqual(["Lancement"]);
  });

  it("dit « En cours » pour un match lancé, « En direct » pour un match à l'antenne", () => {
    expect(pillLabels(render(live()))).toEqual(["En cours"]);
    expect(pillLabels(render(live({ currentMatch: match({ liveState: "LIVE" }) })))).toEqual(["En direct"]);
  });

  it("ne met l'état du tournoi dans aucune pastille", () => {
    const html = render(live());
    expect(text(html)).toContain("TOURNOI EN COURS · ");
    for (const label of pillLabels(html)) expect(label.toUpperCase()).not.toContain("TOURNOI");
    // Sans match mis en avant, la carte n'a aucune pastille d'état.
    const empty = render(live({ currentMatch: null }));
    expect(pillLabels(empty)).toEqual([]);
    expect(text(empty)).toContain("TOURNOI EN COURS · ");
  });

  it("relit l'horloge pour un match daté seulement, par `useClock`", () => {
    // Le passage « En attente » → « Lancement » ne vient que de l'horloge :
    // sans relecture, l'ancien libellé tiendrait jusqu'au sondage (5 min).
    const source = readFileSync(join(process.cwd(), "components/cyber/landing/LiveCard.tsx"), "utf8");
    expect(source).toMatch(/useClock\(LIVE_CARD_CLOCK_MS, live\?\.currentMatch\?\.launchPhase === "SCHEDULED"\)/);
    expect(source).toContain("featuredMatchPill(currentMatch, clock)");
  });
});
