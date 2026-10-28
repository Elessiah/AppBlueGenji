import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { infoHintLabel } from "@/lib/shared/info-hint";

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
import { MatchPageScope } from "@/app/(secured)/tournois/[id]/_lib/match-page-context";
import { MatchPage } from "@/app/(secured)/tournois/[id]/_components/MatchPage";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { SpectatorViewProvider } from "@/components/spectator-view";
import { ToastProvider } from "@/components/ui/toast";
import type { LaunchCaster, LaunchSide, MatchLaunchInfo } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { EMPTY_MAP_RULES, type TournamentMapRules } from "@/lib/shared/round-maps";
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

function render(
  page: BracketMatch,
  viewer: Viewer,
  frozen = false,
  locale: "fr" | "en" = "fr",
  mapRules: TournamentMapRules = EMPTY_MAP_RULES,
): string {
  const detail = tournamentDetail({
    card: tournamentCard({ id: 12, name: "Coupe d'hiver", state: "RUNNING" }),
    matches: [page],
    mapRules,
  });
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
          status={<span data-probe="live-status">{frozen ? "Hors ligne" : "À jour"}</span>}
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

  it("retour à la fiche : le style du retour de l'en-tête, libellé « Retour au tournoi », ancré sur la carte du match", () => {
    const html = render(match(), "staff");
    expect(html).toMatch(/<a [^>]*class="back tap-target"[^>]*href="\/tournois\/12#match-34"|<a [^>]*href="\/tournois\/12#match-34"[^>]*class="back tap-target"/);
    expect(visible(html)).toContain("← Retour au tournoi");
    expect(html).not.toContain("<nav");
    expect(visible(render(match(), "public", false, "en"))).toContain("← Back to the tournament");
    expect(render(match(), "public", false, "en")).toContain('href="/en/suivre/tournois/12#match-34"');
  });

  it("le nom du tournoi, qui n'est plus le bouton de retour, ouvre la ligne de situation", () => {
    expect(visible(render(match(), "public"))).toContain("Coupe d'hiver · Manche 2 · Match 3");
  });

  it("première map pas encore choisie, adversaires à venir", () => {
    const html = render(match({ team2Id: null, team2Name: null, hostTeamId: null, firstBanTeamId: null, status: "PENDING" }), "public");
    expect(visible(html)).toContain("Pas encore choisie");
    expect(visible(html)).toContain("Adversaires à venir");
    expect(html).not.toContain("Hôte : crée la partie");
  });

  it("nomme le tableau hors du tableau principal, et porte le témoin du flux", () => {
    expect(visible(render(match({ bracket: "LOWER" }), "public"))).toContain("Tableau perdants · Manche 2 · Match 3");
    expect(visible(render(match(), "public"))).not.toContain("Tableau principal");
    expect(render(match(), "public")).toContain('data-probe="live-status"');
    expect(visible(render(match(), "public", true))).toContain("Hors ligne");
  });

  it("la carte qu'elle reprend ne renvoie pas vers la page elle-même", () => {
    const html = render(match(), "public");
    expect(html).not.toContain("Page du match");
    expect(html).not.toContain('href="/suivre/tournois/12/matchs/34"');
  });
});

describe("page d'un match — cartes du round et bans", () => {
  const rules = (slots: string[][], overrides: Partial<TournamentMapRules> = {}): TournamentMapRules => ({
    ...EMPTY_MAP_RULES,
    rounds: [{ phaseId: 0, bracket: "UPPER", roundNumber: 2, slots }],
    ...overrides,
  });

  it("ordre des bans de la carte 1 et règle des cartes suivantes, sans réglage de cartes", () => {
    const lobby = visible(render(match(), "public"));
    expect(lobby).toContain("Bans de la carte 1 Alpha d'abord, puis Bravo");
    expect(lobby).toContain("L'équipe qui a perdu la carte précédente bannit en premier ; en cas d'égalité");
    expect(lobby).not.toContain("Cartes du tour");
  });

  it("règle du gagnant : le texte des cartes suivantes suit le réglage", () => {
    expect(visible(render(match(), "public", false, "fr", { ...EMPTY_MAP_RULES, nextBan: "WINNER" }))).toContain(
      "L'équipe qui a gagné la carte précédente bannit en premier",
    );
  });

  it("liste imposées et pools au public, choix du perdant à partir de la carte 2", () => {
    const html = render(match({ mapPicks: { "3": "Oasis" } }), "public", false, "fr", rules([["Ilios"], ["Busan", "Nepal"], ["Oasis", "Dorado"]]));
    const text = visible(html);
    expect(text).toContain("Cartes du tour");
    expect(text).toContain("Carte 1 Ilios Imposée");
    expect(text).toContain("Carte 2 À choisir parmi Busan, Nepal Choisie par l'équipe qui a perdu la carte précédente");
    expect(text).toContain("Carte 3 Oasis");
    expect(html).not.toContain("<select");
    expect(text).not.toContain("Paramétrer les cartes du tour");
    expect(text).not.toContain("Réinitialiser le tour");
  });

  it("le staff choisit dans le pool et règle les cartes du round ; la saisie libre de la carte 1 disparaît", () => {
    const html = render(match(), "staff", false, "fr", rules([["Ilios", "Nepal"]]));
    expect(html).toContain("<select");
    expect(visible(html)).toContain("Choisir la carte 1");
    expect(visible(html)).toContain("Paramétrer les cartes du tour");
    expect(html).not.toContain("Enregistrer la carte");
  });

  it("render_roundMapsSet_hidesFirstMapRowThatWouldContradictThem", () => {
    const text = visible(render(match(), "public", false, "fr", rules([["Ilios"]])));
    expect(text).not.toContain("Première map");
    expect(text).not.toContain("Pas encore choisie");
    expect(text).toContain("Carte 1 Ilios Imposée");
  });

  it("render_noRoundMaps_keepsFirstMapRow", () => {
    expect(visible(render(match(), "public", false, "fr", rules([])))).toContain("Pas encore choisie");
  });

  it("render_staffOnConfiguredRound_offersRoundReset", () => {
    expect(visible(render(match(), "staff", false, "fr", rules([["Ilios"]])))).toContain("Réinitialiser le tour");
  });

  it("render_staffOnUnsetRound_hidesRoundReset", () => {
    expect(visible(render(match(), "staff", false, "fr", rules([])))).not.toContain("Réinitialiser le tour");
  });

  it("sans autogestion, une équipe du match lit le pool sans le choisir ; en autogestion, elle choisit", () => {
    const pool = rules([["Ilios", "Nepal"]]);
    expect(render(match(), "player", false, "fr", pool)).not.toContain("<select");
    mockLaunch = launch();
    expect(render(match({ selfManaged: true }), "player", false, "fr", pool)).toContain("<select");
  });

  it("en autogestion, un joueur de roster qui ne déclare pas « Prêt » lit le pool sans le choisir", () => {
    mockLaunch = launch({
      viewer: { role: "TEAM1", canDeclareReady: false, isReferee: false, isCaster: false, earlyContacts: true, ready: false },
    });
    expect(render(match({ selfManaged: true }), "player", false, "fr", rules([["Ilios", "Nepal"]]))).not.toContain("<select");
  });

  it("en anglais", () => {
    const text = visible(render(match(), "staff", false, "en", rules([["Ilios"]])));
    expect(text).toContain("Maps for this round");
    expect(text).toContain("Map 1 Ilios Set");
    expect(text).toContain("Map 1 bans Alpha first, then Bravo");
    expect(text).toContain("Set up this round's maps");
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

  it("l'explication d'une décision attend derrière le « i », jamais en paragraphe", () => {
    const html = render(match({ refereeAssigned: true }), "public");
    expect(html).toContain(`aria-label="${infoHintLabel("fr", "Arbitre désigné").replaceAll("'", "&#x27;")}"`);
    // Le texte vit dans l'explication du « i », après son bouton — plus en paragraphe.
    const hint = html.indexOf(infoHintLabel("fr", "Arbitre désigné").replaceAll("'", "&#x27;"));
    expect(html.indexOf("Un arbitre suit ce match.")).toBeGreaterThan(hint);
    expect(html).not.toContain('<p class="decision">');
    const staff = render(match(), "staff");
    expect(staff).toContain(`aria-label="${infoHintLabel("fr", "Aucune décision").replaceAll("'", "&#x27;")}"`);
    expect(staff).not.toContain('<p class="decision">');
    // L'autogestion suit la même règle : sa phrase est derrière le « i ».
    const self = render(match({ selfManaged: true }), "public");
    expect(self).toContain(`aria-label="${infoHintLabel("fr", "Autogestion").replaceAll("'", "&#x27;")}"`);
    expect(self).not.toContain('<p class="decision">');
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
    expect(visible(section)).toMatch(/Voix\s*,\s*Echo/);
    expect(visible(section)).toContain("Solo");
    // Chaque caster est un nom cliquable (`PlayerLink`) pour un membre, co-cast compris.
    const member = render(cast(), "other");
    for (const id of [900, 901, 902]) expect(member.slice(member.indexOf("Casts"))).toContain(`href="/joueurs/${id}"`);
    expect(visible(html)).toContain("triez les joueurs par rôle");
    // La carte reprise ne garde que le premier lien, sans « +N » vers la page elle-même.
    expect(html).not.toContain("les autres streams de");
  });

  it("sans compte, un caster masqué (identifiant négatif) est nommé sans lien vers /joueurs", () => {
    const hidden = [
      matchCaster({ userId: -1, pseudo: "Voix", streamId: 1 }),
      matchCaster({ userId: -2, pseudo: "Solo", streamId: 2 }),
    ];
    const html = render(cast({ casters: hidden }), "public");
    const section = html.slice(html.indexOf("Casts"));
    expect(section).not.toContain("/joueurs/");
    expect(visible(section)).toContain("Voix");
    expect(visible(section)).toContain("Solo");
  });

  it("sans annonce de cast, les liens sont tus mais les casters restent", () => {
    const html = visible(render(cast({ liveTrigger: null, liveStartedAt: null }), "public"));
    expect(html).toContain("Lien pas encore publié");
    expect(html).toMatch(/Voix\s*,\s*Echo/);
  });

  it("deux liens au même texte se distinguent par leur numéro, texte et nom accessible", () => {
    const html = render(
      cast({
        streams: [
          { id: 1, liveUrl: "https://www.youtube.com/watch?v=aaa", staff: false },
          { id: 2, liveUrl: "https://www.youtube.com/watch?v=bbb", staff: false },
          { id: 3, liveUrl: "https://twitch.tv/bluegenji", staff: false },
        ],
        casters: [matchCaster({ userId: 900, streamId: 1 }), matchCaster({ userId: 901, streamId: 2 }), matchCaster({ userId: 902, streamId: 3 })],
        liveUrl: "https://www.youtube.com/watch?v=aaa",
      }),
      "public",
    );
    const section = html.slice(html.indexOf("Casts"));
    expect(section).toContain(">YouTube 1<");
    expect(section).toContain(">YouTube 2<");
    expect(section).toMatch(/aria-label="YouTube 2[^"]*"/);
    // Un texte unique ne prend pas de numéro.
    expect(section).toContain(">bluegenji<");
  });

  it("garde le premier lien qu'aucun stream visible ne porte, comme la carte", () => {
    const html = render(cast({ streams: [], casters: [], liveUrl: "https://twitch.tv/bluegenji" }), "public");
    const section = html.slice(html.indexOf("Casts"));
    expect(section).toContain('href="https://twitch.tv/bluegenji"');
    expect(visible(section)).not.toContain("Aucun caster inscrit");
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

describe("« Page du match » sur la carte du plateau", () => {
  function card(page: BracketMatch, spectator = false, onPage = false) {
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
          <MatchPageScope value={onPage}>
            <MatchRow match={page} adminResolvable={false} onOpenAdminModal={() => undefined} scoreLocked={false} roundNumber={2} />
          </MatchPageScope>
        </LiveProvider>
      </ToastProvider>
    );
    return renderToStaticMarkup(spectator ? <SpectatorViewProvider>{row}</SpectatorViewProvider> : row);
  }

  it("rejoint les actions de la carte : une entrée du pied, nom accessible qui commence par le texte, plus de lien à part", () => {
    const html = card(match());
    expect(html).toContain('data-action="matchPage" data-primary="true">Page du match : Alpha contre Bravo');
    expect(html).not.toContain("pageLink");
    expect(html).not.toContain("<p");
  });

  it("se tait sous la page du match elle-même", () => {
    expect(card(match(), false, true)).not.toContain('data-action="matchPage"');
  });

  it("tu sur une exemption, présent sur un match en attente d'adversaire", () => {
    expect(card(match({ team2Id: null, team2Name: null, status: "COMPLETED", winnerTeamId: ALPHA }))).not.toContain("Page du match");
    expect(card(match({ team2Id: null, team2Name: null, status: "PENDING" }))).toContain("Page du match");
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
    // Le « +2 » nu dit sa portée aussi à qui voit l'écran : infobulle.
    expect(html).toContain('title="+2 : les autres streams de Alpha contre Bravo"');
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
