import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// La carte entière est rendue avec une sonde à la place du pied d'action
// (`tests/helpers/match-card-actions-probe.ts`).
jest.mock("@/app/(secured)/tournois/[id]/_components/MatchCardActions", () =>
  jest
    .requireActual<typeof import("../helpers/match-card-actions-probe")>("../helpers/match-card-actions-probe")
    .probeModule(),
);

// Lecture des contacts simulée : un rendu statique ne joue aucun effet. La
// page ne doit montrer ce qu'elle lit qu'aux lecteurs à qui elle le demande.
let mockLaunch: MatchLaunchInfo | null = null;
const mockEnabled: boolean[] = [];
jest.mock("@/components/match-launch/MatchContactsDialog", () => ({
  useMatchContacts: (_matchId: number, _card: unknown, enabled = true) => {
    mockEnabled.push(enabled);
    return { state: { kind: "loading" }, launch: enabled ? mockLaunch : null };
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { MatchPage } from "@/app/(secured)/tournois/[id]/_components/MatchPage";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { SpectatorViewProvider } from "@/components/spectator-view";
import { ToastProvider } from "@/components/ui/toast";
import type { LaunchCaster, LaunchSide, MatchLaunchInfo } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch, matchCaster } from "../helpers/bracket-match";
import { tournamentDetail } from "../helpers/tournament-detail";
import { tournamentCard } from "../helpers/tournament-card";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";

type Viewer = "public" | "other" | "player" | "staff" | "caster";

const ALPHA = 10;
const BRAVO = 20;

function match(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return bracketMatch({
    id: 34,
    tournamentId: 12,
    status: "READY",
    roundNumber: 2,
    matchNumber: 3,
    team1Id: ALPHA,
    team2Id: BRAVO,
    team1Name: "Alpha",
    team2Name: "Bravo",
    hostTeamId: BRAVO,
    firstBanTeamId: ALPHA,
    ...overrides,
  });
}

const side = (teamId: number, name: string): LaunchSide => ({
  teamId,
  name,
  logoUrl: null,
  isGhost: false,
  isSolo: false,
  ready: false,
  contacts: [{ userId: teamId + 1, pseudo: `${name}-cap`, discordTag: null, battletag: `${name}#1111`, battletagVerified: true, roles: [] }],
  contactsShown: true,
});

const caster = (overrides: Partial<LaunchCaster> = {}): LaunchCaster => ({
  userId: 900,
  pseudo: "Voix",
  discordTag: null,
  battletag: "Voix#2222",
  battletagVerified: false,
  ready: false,
  contactsShown: true,
  isViewer: false,
  ...overrides,
});

function launch(overrides: Partial<MatchLaunchInfo> = {}): MatchLaunchInfo {
  return {
    matchId: 34,
    tournamentId: 12,
    tournamentName: "Coupe",
    phase: "LOBBY",
    startAt: null,
    lobbyOpenedAt: null,
    autoLaunchAt: null,
    launchedAt: null,
    hostTeamId: BRAVO,
    team1: side(ALPHA, "Alpha"),
    team2: side(BRAVO, "Bravo"),
    casters: [],
    referee: null,
    selfManaged: false,
    viewer: { role: "TEAM1", canDeclareReady: true, isReferee: false, isCaster: false, earlyContacts: true, ready: false },
    ...overrides,
  };
}

function render(page: BracketMatch, viewer: Viewer, frozen = false, locale: "fr" | "en" = "fr"): string {
  const detail = tournamentDetail({ card: tournamentCard({ id: 12, name: "Coupe d'hiver", state: "RUNNING" }), matches: [page] });
  const body: ReactNode = (
    <ToastProvider>
      <LiveProvider
        canManage={viewer === "staff"}
        canSchedule={viewer === "staff"}
        refereeScheduling={false}
        launchPhase
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={viewer === "caster" ? 900 : 1}
        myTeamId={viewer === "player" ? ALPHA : null}
        castBlock="NOT_CASTER"
      >
        <MatchPage
          detail={detail}
          match={page}
          adminResolvable={false}
          scoreLocked={false}
          onOpenAdminModal={() => undefined}
          frozen={frozen}
        />
      </LiveProvider>
    </ToastProvider>
  );
  const tree = viewer === "public" ? <SpectatorViewProvider>{body}</SpectatorViewProvider> : body;
  if (locale === "fr") return renderToStaticMarkup(tree);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentsTextProvider locale="en" messages={tournamentsClientMessages(messagesFor("en"))}>
        <TournamentPageTextProvider locale="en" messages={tournamentPageMessages(messagesFor("en"))}>
          <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(messagesFor("en"))}>
            {tree}
          </TournamentActionsTextProvider>
        </TournamentPageTextProvider>
      </TournamentsTextProvider>
    </AppLocaleProvider>,
  );
}

const visible = (html: string) =>
  html.replaceAll(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll(/\s+/g, " ");

beforeEach(() => {
  mockLaunch = null;
  mockEnabled.length = 0;
});

describe("page d'un match — ce que tout le monde lit", () => {
  it("titre, retour à la fiche, manche et match, hôte à gauche et premier ban", () => {
    const html = render(match({ firstMap: "Tokyo" }), "public");
    expect(html).toContain("<h1");
    expect(visible(html)).toContain("Alpha contre Bravo");
    expect(html).toContain('href="/suivre/tournois/12#match-34"');
    expect(visible(html)).toContain("Manche 2 · Match 3");
    const lobby = visible(html.slice(html.indexOf("La partie")));
    expect(lobby.indexOf("Bravo")).toBeLessThan(lobby.indexOf("Alpha"));
    expect(lobby).toContain("Hôte : crée la partie");
    expect(lobby).toContain("Premier ban");
    expect(lobby).toContain("Tokyo");
  });

  it("première map pas encore choisie, adversaires à venir", () => {
    const html = render(match({ team2Id: null, team2Name: null, hostTeamId: null, firstBanTeamId: null, status: "PENDING" }), "public");
    expect(visible(html)).toContain("Pas encore choisie");
    expect(visible(html)).toContain("Adversaires à venir");
    expect(html).not.toContain("Hôte : crée la partie");
  });

  it("la carte qu'elle reprend ne renvoie pas vers la page elle-même", () => {
    const html = render(match(), "public");
    expect(html).not.toContain("Voir le match");
    expect(html).not.toContain('href="/suivre/tournois/12/matchs/34"');
  });
});

describe("page d'un match — arbitrage × lecteur", () => {
  it("arbitre : « Arbitre désigné » pour tous, sa fiche aux seules parties du match et au staff", () => {
    const referee = { userId: 77, pseudo: "Juge", battletag: "Juge#3333", battletagVerified: true, ready: false, isViewer: false };
    mockLaunch = launch({ referee });
    const page = match({ refereeAssigned: true });
    for (const viewer of ["public", "other"] as const) {
      const html = render(page, viewer);
      expect(visible(html)).toContain("Arbitre désigné");
      expect(html).not.toContain("Juge");
    }
    for (const viewer of ["player", "staff"] as const) {
      const html = render(page, viewer);
      expect(visible(html)).toContain("Arbitre désigné");
      expect(html).toContain("Juge#3333");
      expect(visible(html)).toContain("À inviter dans la partie");
    }
  });

  it("autogestion : l'aide-mémoire pour tous, l'invitation des casters avec un caster", () => {
    const self = match({ selfManaged: true });
    for (const viewer of ["public", "player", "staff"] as const) {
      const html = visible(render(self, viewer));
      expect(html).toContain("Autogestion");
      expect(html).toContain("L'équipe hôte crée la partie.");
      expect(html).toContain("Réglez les paramètres de la partie.");
      expect(html).not.toContain("Invitez les casters du match.");
    }
    const cast = visible(render(match({ selfManaged: true, casters: [matchCaster()] }), "public"));
    expect(cast).toContain("Invitez les casters du match.");
  });

  it("sans décision : avertissement au staff seul, rien aux autres", () => {
    expect(visible(render(match(), "staff"))).toContain("Aucune décision");
    for (const viewer of ["public", "other", "player"] as const) {
      const html = visible(render(match(), viewer));
      expect(html).not.toContain("Aucune décision");
      expect(html).not.toContain("Arbitrage");
    }
  });

  it("match terminé : plus rien à dire de l'arbitrage", () => {
    const html = visible(render(match({ status: "COMPLETED", refereeAssigned: true, winnerTeamId: ALPHA }), "staff"));
    expect(html).not.toContain("Arbitre désigné");
  });
});

describe("page d'un match — streams et casters", () => {
  const streams = [
    { id: 1, liveUrl: "https://twitch.tv/bluegenji", staff: false },
    { id: 2, liveUrl: "https://kick.com/autre_voix", staff: false },
  ];
  const casters = [
    matchCaster({ userId: 900, pseudo: "Voix", streamId: 1 }),
    matchCaster({ userId: 901, pseudo: "Echo", streamId: 1 }),
    matchCaster({ userId: 902, pseudo: "Solo", streamId: 2 }),
  ];
  const cast = (overrides: Partial<BracketMatch> = {}) =>
    match({ streams, casters, liveUrl: "https://twitch.tv/bluegenji", liveTrigger: "MANUAL", liveStartedAt: "2026-01-01T00:00:00.000Z", ...overrides });

  it("tous les liens, chacun avec ses casters, au nom de la chaîne", () => {
    const html = render(cast(), "public");
    const section = html.slice(html.indexOf("Casts"));
    expect(section).toContain('href="https://twitch.tv/bluegenji"');
    expect(section).toContain('href="https://kick.com/autre_voix"');
    expect(visible(section)).toContain("bluegenji");
    expect(visible(section)).toContain("autre_voix");
    expect(visible(section)).toContain("Voix, Echo");
    expect(visible(section)).toContain("Solo");
    expect(visible(html)).toContain("triez les joueurs par rôle");
    // La carte reprise ne garde que le premier lien, sans « +N » vers la page elle-même.
    expect(html).not.toContain("les autres streams de");
  });

  it("sans annonce de cast, les liens sont tus mais les casters restent", () => {
    const html = visible(render(cast({ liveTrigger: null, liveStartedAt: null }), "public"));
    expect(html).toContain("Lien pas encore publié");
    expect(html).toContain("Voix, Echo");
  });

  it("sans caster ni lien : le dit, sans rappel du tri par rôle", () => {
    const html = visible(render(match(), "public"));
    expect(html).toContain("Aucun caster inscrit pour ce match.");
    expect(html).not.toContain("triez les joueurs par rôle");
  });

  it("BattleTags des casters « À inviter — obligatoire » aux parties du match, jamais au public", () => {
    mockLaunch = launch({ casters: [caster()] });
    const page = cast();
    const party = render(page, "player");
    expect(party).toContain("Voix#2222");
    expect(visible(party)).toContain("À inviter — obligatoire");
    expect(visible(party)).toContain("Casters à inviter");
    const pub = render(page, "public");
    expect(pub).not.toContain("Voix#2222");
    expect(visible(pub)).not.toContain("À inviter — obligatoire");
  });

  it("sa propre fiche de caster ne porte pas la note d'invitation", () => {
    mockLaunch = launch({ casters: [caster({ isViewer: true })], viewer: { role: "CASTER", canDeclareReady: true, isReferee: false, isCaster: true, earlyContacts: false, ready: false } });
    const html = visible(render(cast(), "caster"));
    expect(html).not.toContain("À inviter — obligatoire");
  });
});

describe("page d'un match — contacts : qui les demande", () => {
  it("ne lit rien pour le public, un membre sans lien avec le match, ou une fiche figée", () => {
    mockLaunch = launch();
    render(match(), "public");
    render(match(), "other");
    render(match(), "player", true);
    expect(mockEnabled).toEqual([false, false, false]);
  });

  it("les lit pour un joueur du match et le staff, sans reprendre les contacts des équipes (fenêtre « Contacts »)", () => {
    mockLaunch = launch();
    const html = render(match(), "player");
    render(match(), "staff");
    expect(mockEnabled).toEqual([true, true]);
    expect(html).not.toContain("Bravo#1111");
    expect(html).not.toContain("Alpha#1111");
  });

  it("un caster ne les lit que le temps du match", () => {
    const page = match({ casters: [matchCaster({ userId: 900 })] });
    render({ ...page, startAt: "2099-01-01T00:00:00.000Z" }, "caster");
    expect(mockEnabled).toEqual([false]);
  });
});

describe("« Voir le match » sur la carte du plateau", () => {
  function card(page: BracketMatch, spectator = false) {
    const row = (
      <ToastProvider>
        <LiveProvider
          canManage={false}
          canSchedule={false}
          refereeScheduling={false}
          launchPhase
          openConfig={() => undefined}
          openSchedule={() => undefined}
          openReplay={() => undefined}
          viewerUserId={1}
          myTeamId={null}
          castBlock="NOT_CASTER"
        >
          <MatchRow match={page} adminResolvable={false} onOpenAdminModal={() => undefined} scoreLocked={false} roundNumber={2} />
        </LiveProvider>
      </ToastProvider>
    );
    return renderToStaticMarkup(spectator ? <SpectatorViewProvider>{row}</SpectatorViewProvider> : row);
  }

  it("mène à la page du match, dans l'espace du lecteur ; nom accessible qui commence par le texte", () => {
    expect(card(match())).toContain('href="/tournois/12/matchs/34"');
    expect(card(match(), true)).toContain('href="/suivre/tournois/12/matchs/34"');
    expect(card(match())).toContain('aria-label="Voir le match : Alpha contre Bravo"');
  });

  it("tu sur une exemption, présent sur un match en attente d'adversaire", () => {
    expect(card(match({ team2Id: null, team2Name: null, status: "COMPLETED", winnerTeamId: ALPHA }))).not.toContain("Voir le match");
    expect(card(match({ team2Id: null, team2Name: null, status: "PENDING" }))).toContain("Voir le match");
  });

  it("le « +N » des streams suivants mène à la page, le premier lien seul reste sur la carte", () => {
    const html = card(
      match({
        streams: [
          { id: 1, liveUrl: "https://twitch.tv/bluegenji", staff: false },
          { id: 2, liveUrl: "https://twitch.tv/autre", staff: false },
          { id: 3, liveUrl: "https://kick.com/tiers", staff: false },
        ],
        casters: [matchCaster({ streamId: 1 }), matchCaster({ userId: 901, streamId: 2 }), matchCaster({ userId: 902, streamId: 3 })],
        liveUrl: "https://twitch.tv/bluegenji",
        liveTrigger: "MANUAL",
        liveStartedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(html).toContain('href="https://twitch.tv/bluegenji"');
    expect(html).not.toContain('href="https://twitch.tv/autre"');
    expect(html).toContain(">+2<");
    expect(html).toContain('aria-label="+2 : les autres streams de Alpha contre Bravo"');
  });
});

describe("page d'un match — sous /en", () => {
  it("rédige ses blocs en anglais, liens sans préfixe réécrits sous /en", () => {
    const html = visible(render(match({ selfManaged: true, casters: [matchCaster()], streams: [{ id: 1, liveUrl: null, staff: false }], firstMap: "Tokyo" }), "public", false, "en"));
    for (const english of ["Host: creates the game", "First ban", "First map", "Self-managed", "The host team creates the game.", "Invite the match's casters.", "Round 2", "Stream 1", "Link not published yet"]) {
      expect(html).toContain(english);
    }
    for (const french of ["Hôte : crée la partie", "Première map", "Aucun caster", "Lien pas encore publié", "Étapes"]) {
      expect(html).not.toContain(french);
    }
    expect(visible(render(match(), "staff", false, "en"))).toContain("No decision");
  });

  it("match introuvable : rien de la page, la fiche le dit (clés présentes dans les deux langues)", () => {
    const en = messagesFor("en").tournament.matchPage;
    const fr = messagesFor("fr").tournament.matchPage;
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    expect(en.missingTitle).toBe("Match not found");
    expect(fr.missingTitle).toBe("Match introuvable");
  });
});
