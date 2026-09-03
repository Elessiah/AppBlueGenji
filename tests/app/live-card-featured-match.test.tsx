import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard } from "@/components/cyber/landing/LiveCard";
import type { LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import type { MatchLiveState } from "@/lib/shared/live-streams";
import type { TournamentCard } from "@/lib/shared/types";

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
  return {
    id: 7,
    name: "Coupe Genji",
    description: null,
    format: "SINGLE",
    game: "OW2",
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
  };
}

function match(overrides: Partial<LandingLiveMatch> = {}): LandingLiveMatch {
  return {
    id: 42,
    team1Name: "Alpha",
    team2Name: "Beta",
    team1Href: "/equipes/1",
    team2Href: "/equipes/2",
    team1Score: 1,
    team2Score: 0,
    team1Seed: null,
    team2Seed: null,
    bracket: "UPPER",
    roundLabel: "Quart de finale",
    liveState: "OFF",
    liveUrl: null,
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
    // Un match peut être casté sans lien saisi : le bandeau le dit, il n'y a
    // simplement nulle part où cliquer.
    const html = withStream("LIVE", null);
    expect(text(html)).toContain("CE MATCH EST EN DIRECT");
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
    // « EN COURS » est l'**état du tournoi**, pas une diffusion : il se met en
    // bleu (`pill-blue`), sans quoi il se confondait avec le bandeau du match
    // casté, trois lignes plus bas.
    expect(render(live())).not.toContain("pill-live");
    expect(render(live())).toContain("pill-blue");
  });
});
