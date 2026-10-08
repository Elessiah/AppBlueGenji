/**
 * Lot 8a-2 — la fiche d'un tournoi sous `/en` (consultation) et les réglages
 * `?tournoi=` des règles. Le français reste celui d'avant (rendus figés :
 * `ranking-views-render.test.tsx` ; tables d'origine comparées ci-dessous).
 *
 * Garde principale : rendue sous `/en`, une vue ne laisse aucun texte français
 * **hors** des blocs annoncés `lang="fr"` (gestes du lot 8b, outils du staff).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";

let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/tournaments-service", () => ({ getVisibleTournamentCard: jest.fn() }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/tournois/1",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import DetailLayout, { generateMetadata } from "@/app/(secured)/tournois/[id]/layout";
import { TournamentHeader } from "@/app/(secured)/tournois/[id]/_components/TournamentHeader";
import { TournamentProgress, stageCountdownText } from "@/app/(secured)/tournois/[id]/_components/TournamentProgress";
import { LiveIndicator } from "@/app/(secured)/tournois/[id]/_components/LiveIndicator";
import { TournamentLoading } from "@/app/(secured)/tournois/[id]/_components/TournamentLoading";
import { PhaseTimeline } from "@/app/(secured)/tournois/[id]/_components/PhaseTimeline";
import { PhaseStandingsBlock } from "@/app/(secured)/tournois/[id]/_components/PhaseStandingsBlock";
import { BracketSections } from "@/app/(secured)/tournois/[id]/_components/BracketSections";
import { SwissView } from "@/app/(secured)/tournois/[id]/_components/SwissView";
import { SurvivalView } from "@/app/(secured)/tournois/[id]/_components/SurvivalView";
import { EnduranceView } from "@/app/(secured)/tournois/[id]/_components/EnduranceView";
import { RegistrationsPanel } from "@/app/(secured)/tournois/[id]/_components/RegistrationsPanel";
import { MatchPlanningPanel } from "@/app/(secured)/tournois/[id]/_components/MatchPlanningPanel";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { MapResultList } from "@/app/(secured)/tournois/[id]/_components/MatchMapDetails";
import { FR_VIEWS_TEXT } from "@/app/(secured)/tournois/[id]/_lib/views-text";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { registrationConditionsText } from "@/app/(secured)/tournois/[id]/_lib/header-meta";
import { phaseFormatLabel, phaseStateLabel } from "@/app/(secured)/tournois/[id]/_lib/phases";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { ToastProvider } from "@/components/ui/toast";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { getCurrentUser } from "@/lib/server/auth";
import { authUser } from "../helpers/auth-user";
import { messagesFor } from "@/lib/server/i18n-messages";
import { lowerWinnerPlaceholder, upperLoserPlaceholder, UPPER_FINAL_WINNER_PLACEHOLDER } from "@/lib/shared/bracket-placeholders";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import { isMigratedRoute, localeHref, LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { matchFormatDescription, type MatchFormat } from "@/lib/shared/match-format";
import { LAUNCH_PHASE_LABELS, REFEREE_SCHEDULING_DESCRIPTION } from "@/lib/shared/match-planning";
import { MATCH_SECTION_LABELS } from "@/lib/shared/match-sections";
import { formatMessage } from "@/lib/shared/message-format";
import { messageAt } from "@/lib/shared/scoped-text";
import { registrationFiltersSummary } from "@/lib/shared/registration-filters";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import {
  FR_TOURNAMENT_PAGE_MESSAGES,
  FR_TOURNAMENT_PAGE_TEXT,
  TOURNAMENT_VIEW_PARTS,
  localizedPlaceholder,
  matchFormatDescriptionText,
  pageDateTime,
  tournamentPageMessages,
  tournamentPageText,
} from "@/lib/shared/tournament-page-text";
import { formatStageCountdown, TOURNAMENT_STAGE_META } from "@/lib/shared/tournament-progress";
import { settingsGroupsFrom, localizedTournamentSettingsGroups } from "@/lib/shared/tournament-settings-text";
import { tournamentSettingsGroups, type TournamentSettingsInput } from "@/lib/shared/tournament-settings";
import { tournamentShareDescription } from "@/lib/shared/share-metadata";
import { localizedTournamentShareDescription } from "@/lib/shared/tournament-share-text";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { VIEWER_ALERT_PRIORITY, viewerAlertTitle } from "@/lib/shared/viewer-alerts";
import type {
  BracketMatch,
  EnduranceMeta,
  EnduranceStandingRow,
  SurvivalMeta,
  SwissMeta,
  TournamentPhase,
} from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentDetail } from "../helpers/tournament-detail";

const EN = tournamentPageText("en", tournamentPageMessages(messagesFor("en")));
const noop = () => undefined;

/** Retire les éléments annoncés `lang="fr"` (imbrication comprise). */
function withoutFrenchBlocks(html: string): string {
  let out = html;
  for (;;) {
    const open = /<([a-z][a-z0-9]*)\b[^>]*\blang="fr"[^>]*>/i.exec(out);
    if (!open) return out;
    const tag = open[1];
    const tagPattern = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
    tagPattern.lastIndex = open.index;
    let depth = 0;
    let end = out.length;
    for (let m = tagPattern.exec(out); m; m = tagPattern.exec(out)) {
      if (m[2] === "/") continue;
      depth += m[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    out = out.slice(0, open.index) + out.slice(end);
  }
}

/** Texte lisible et attributs lus (noms accessibles, infobulles, libellés de cellule). */
function readable(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|placeholder|alt|data-label)="([^"]*)"/g)].map((m) => m[1]);
  return `${html.replace(/<[^>]+>/g, " ")} ${attributes.join(" ")}`;
}

// Mots qui trahiraient du français sous `/en` (les noms des fixtures n'en portent pas).
const FRENCH = /\b(Manche|Ronde|Classement|Équipe|Équipes|équipes?|Joueurs?|Inscriptions?|Victoire|Défaite|Nul|Statut|Forfait|Terminée?|Planifié|Lancement|Prochaine|Vainqueur|Championne|Coupe|Barrage|Aucun|Chargement|Retour|Tous|Début|Phase finale|en lice|jouées?|contre|Rang|Qualifiée|Détail|Programmé|En cours|À jour|Hors ligne|Reconnexion)\b/;
const ACCENTED = /[À-ÿ]/;

function expectNoFrench(html: string): void {
  const text = readable(withoutFrenchBlocks(html));
  expect(text).not.toMatch(FRENCH);
  expect(text).not.toMatch(ACCENTED);
}

function inLocale(locale: "fr" | "en", ui: ReactElement, participantType: "TEAM" | "SOLO" = "TEAM"): string {
  const tree = (
    <ToastProvider>
      <EntrantProvider participantType={participantType} soloUserIds={{}} logos={buildEntrantLogoMap([])}>
        {ui}
      </EntrantProvider>
    </ToastProvider>
  );
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

beforeAll(() => {
  jest.useFakeTimers({ now: new Date("2026-05-12T12:00:00.000Z") });
});
afterAll(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  mockLocale = "en";
});

const DATES = {
  startVisibilityAt: "2026-05-01T10:00:00.000Z",
  registrationOpenAt: "2026-05-02T10:00:00.000Z",
  registrationCloseAt: "2026-05-10T10:00:00.000Z",
  startAt: "2026-05-12T10:00:00.000Z",
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function phase(overrides: Partial<TournamentPhase>): TournamentPhase {
  return {
    id: 1,
    position: 1,
    name: null,
    format: "SWISS",
    state: "FINISHED",
    entrants: 8,
    qualifiers: 4,
    qualifierMode: "COUNT",
    qualifierValue: 4,
    swissTotalRounds: 3,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    hasThirdPlaceMatch: false,
    maxRounds: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const swiss: SwissMeta = {
  totalRounds: 3,
  currentRound: 2,
  pointsForWin: 3,
  pointsForDraw: 1,
  pointsForLoss: 0,
  pointsForBye: 3,
  tiebreakers: ["buchholz", "opponent-mwp", "head-to-head"],
  standings: [
    { teamId: 10, teamName: "Alpha", logoUrl: null, seed: 1, points: 6, wins: 2, draws: 0, losses: 0, byes: 1, buchholz: 3, status: "ACTIVE", rank: 1 },
    { teamId: 11, teamName: "Bravo", logoUrl: null, seed: 2, points: 0, wins: 0, draws: 0, losses: 2, byes: 0, buchholz: 3, status: "FORFEIT", rank: 2 },
  ],
};

const survival: SurvivalMeta = {
  roundsBeforeFirstCut: 2,
  roundsPerCut: 1,
  currentRound: 3,
  barrageRounds: 1,
  standings: [
    { teamId: 10, teamName: "Alpha", logoUrl: null, seed: 1, wins: 2, losses: 0, status: "ACTIVE", eliminatedRound: null, rank: 1 },
    { teamId: 11, teamName: "Bravo", logoUrl: null, seed: 2, wins: 1, losses: 1, status: "ACTIVE", eliminatedRound: null, rank: 2 },
    { teamId: 12, teamName: "Charlie", logoUrl: null, seed: 3, wins: 0, losses: 2, status: "ELIMINATED", eliminatedRound: 2, rank: 3 },
  ],
};

function enduranceRow(teamId: number, overrides: Partial<EnduranceStandingRow> = {}): EnduranceStandingRow {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    logoUrl: null,
    seed: teamId,
    points: 7,
    wins: 1,
    losses: 1,
    draws: 1,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: teamId,
    rounds: [
      { round: 1, kind: "POINTS", points: 8, penalty: 0 },
      { round: 2, kind: "POINTS", points: 7, penalty: 1 },
    ],
    penaltyPoints: 1,
    ...overrides,
  };
}

const endurance: EnduranceMeta = {
  startPoints: 9,
  winDelta: 1,
  lossDelta: 1,
  forfeitMaps: 3,
  playoffSize: 4,
  maxRounds: 6,
  currentRound: 2,
  playoffsStarted: false,
  rounds: [1, 2],
  penalties: [
    { id: 1, teamId: 1, teamName: "Team 1", points: 1, round: 2, reason: "Late", authorPseudo: "Ref", createdAt: "2026-05-12T10:30:00.000Z", removable: true },
  ],
  standings: [
    enduranceRow(1),
    enduranceRow(2, { status: "OUT_OF_CONTENTION" }),
    enduranceRow(3, { status: "FORFEIT", rounds: [{ round: 1, kind: "POINTS", points: 8, penalty: 0 }, { round: 2, kind: "FORFEIT", points: null, penalty: 0 }] }),
  ],
};

const roundMatches: BracketMatch[] = [
  bracketMatch({ id: 1, roundNumber: 1, matchNumber: 1, team1Id: 10, team1Name: "Alpha", team2Id: 11, team2Name: "Bravo", team1Score: 2, team2Score: 1, winnerTeamId: 10, status: "COMPLETED" }),
  bracketMatch({ id: 2, roundNumber: 2, matchNumber: 1, team1Id: 10, team1Name: "Alpha", team2Id: null, team2Name: null, team2Placeholder: upperLoserPlaceholder(1, 2) }),
];

// ─── Route, référencement ────────────────────────────────────────────────────

describe("route et référencement", () => {
  it("ouvre la fiche ; la création et l'édition à leur tour (lot 8b-2)", () => {
    expect(isMigratedRoute("/tournois/12")).toBe(true);
    // `creer` n'est pas un identifiant : c'est sa propre entrée qui l'ouvre.
    expect(isMigratedRoute("/tournois/creer")).toBe(true);
    expect(isMigratedRoute("/tournois/12/modifier")).toBe(true);
    expect(isMigratedRoute("/tournois/abc/modifier")).toBe(false);
    expect(localeHref("/tournois/12#match-3", "en")).toBe("/en/tournois/12#match-3");
    expect(localeHref("/tournois/creer", "en")).toBe("/en/tournois/creer");
    // `[slug]` reste un segment quelconque.
    expect(isMigratedRoute("/regles/ronde-suisse")).toBe(true);
  });

  it("reste hors du sitemap (noindex)", () => {
    const paths = localizedSitemapEntries(publicSitemapRoutes()).map((entry) => entry.path);
    expect(paths.some((path) => path.includes("/tournois"))).toBe(false);
  });

  it("métadonnées dans la langue de l'adresse, hreflang réciproques", async () => {
    // Un membre : sans session, la fiche redirige vers /suivre et ne lit pas la carte.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(
      tournamentCard({ id: 12, name: "Cup", state: "REGISTRATION", registeredTeams: 3, maxTeams: 8, ...DATES }),
    );
    const en = await generateMetadata({ params: Promise.resolve({ id: "12" }) });
    expect(en.alternates).toEqual({
      canonical: "/en/tournois/12",
      languages: { fr: "/tournois/12", en: "/en/tournois/12", "x-default": "/tournois/12" },
    });
    expect(en.description).toMatch(/^Registration open · Single elimination · 3\/8 teams entered · Registration until May 10, 2026 at 12:00\.$/);
    expect(JSON.stringify(en.openGraph)).toContain("en_US");
    mockLocale = "fr";
    const fr = await generateMetadata({ params: Promise.resolve({ id: "12" }) });
    expect(fr.description).toBe(tournamentShareDescription(tournamentCard({ id: 12, name: "Cup", state: "REGISTRATION", registeredTeams: 3, maxTeams: 8, ...DATES })));
    expect((fr.openGraph as { url?: string }).url).toBe("/tournois/12");
    mockLocale = "en";
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(null);
    expect((await generateMetadata({ params: Promise.resolve({ id: "12" }) })).title).toBe("Tournament");
    jest.mocked(getCurrentUser).mockResolvedValue(null);
  });

  it("la mise en page ne sérialise que les espaces client, sous /en seulement", async () => {
    const en = await DetailLayout({ children: <TournamentLoading /> });
    const messages = (en.props as { messages?: Record<string, unknown> }).messages;
    expect(messages).toBeDefined();
    for (const serverOnly of ["meta", "settings", "share"]) expect(messages).not.toHaveProperty(serverOnly);
    expect(JSON.stringify(messages).length).toBeLessThan(20_000);
    expect(renderToStaticMarkup(en)).toContain("Loading the tournament…");
    mockLocale = "fr";
    const fr = await DetailLayout({ children: <TournamentLoading /> });
    expect((fr.props as { messages?: unknown }).messages).toBeUndefined();
    expect(renderToStaticMarkup(fr)).toContain("Chargement du tournoi…");
  });
});

// ─── Rendu anglais, format par format ───────────────────────────────────────

describe("rendu anglais — aucun français hors des blocs lang=\"fr\"", () => {
  it.each(["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI", "BG_SURVIE"] as const)("en-tête et frise — %s", (format) => {
    const detail = tournamentDetail({
      card: tournamentCard({ ...DATES, format, state: "RUNNING", matchFormat: { type: "BO", value: 3 }, hasThirdPlaceMatch: format === "SINGLE" }),
      phases: format === "MULTI" ? [phase({ id: 1, state: "FINISHED" }), phase({ id: 2, position: 2, format: "SINGLE", state: "RUNNING" })] : null,
      currentPhaseId: format === "MULTI" ? 2 : null,
      isAdmin: true,
      canRegister: false,
    });
    // L'en-tête lit l'historique du navigateur à son premier rendu (bouton
    // « Retour ») : il n'est jamais rendu côté serveur, le test lui en prête un.
    const browser = globalThis as unknown as { document?: unknown; window?: unknown };
    browser.document = { referrer: "" };
    browser.window = { location: { origin: "http://localhost", pathname: "/en/tournois/1" }, history: { length: 1 } };
    let header: string;
    try {
      header = inLocale(
      "en",
      <TournamentHeader
        detail={detail}
        isLive
        tier="PRIORITY"
        fatal={null}
        frozen={false}
        onRegister={noop}
        onReportIssue={noop}
        onGuestRegister={noop}
        onAdvance={noop}
        onLiveSaved={noop}
        onEditImage={noop}
      />,
      );
    } finally {
      delete browser.document;
      delete browser.window;
    }
    expectNoFrench(header);
    expect(header).toContain("Up to date");
    expect(header).toContain("In progress");
    expect(header).toContain('href="/en/tournois"');
    // Gestes et outils du staff de l'en-tête : anglais depuis le lot 8b
    // (rendu à l'étape des inscriptions : tests/app/tournament-actions-i18n.test.tsx).
    expect(header).not.toContain('lang="fr"');
    expectNoFrench(inLocale("en", <TournamentProgress detail={detail} />));
  });

  it("témoin de flux : Up to date / Reconnecting… / Offline", () => {
    expect(inLocale("en", <LiveIndicator isLive tier="PRIORITY" />)).toContain("Up to date");
    expect(inLocale("en", <LiveIndicator isLive={false} tier="PRIORITY" />)).toContain("Reconnecting…");
    expect(inLocale("en", <LiveIndicator isLive={false} tier="PRIORITY" fatal="UNAUTHORIZED" />)).toContain("Offline");
    expect(inLocale("fr", <LiveIndicator isLive tier="PRIORITY" />)).toContain("À jour");
  });

  it("arbre d'élimination, libellés d'attente traduits au rendu", () => {
    const html = inLocale(
      "en",
      <BracketSections
        bracketType="UPPER"
        bracketLabel="Upper bracket"
        showBracketLabel
        matches={roundMatches}
        allTournamentMatches={roundMatches}
        myTeamId={10}
        adminResolvable={() => false}
        onOpenAdminModal={noop}
        format="DOUBLE"
      />,
    );
    expectNoFrench(html);
    expect(html).toContain("Final");
    expect(html).toContain("Loser of upper bracket match 2, round 1");
  });

  it("ronde suisse", () => {
    const html = inLocale(
      "en",
      <SwissView swiss={swiss} matches={roundMatches} allTournamentMatches={roundMatches} myTeamId={10} isFinished={false} adminResolvable={() => false} onOpenAdminModal={noop} canForfeit={() => true} onForfeit={noop} />,
    );
    expectNoFrench(html);
    expect(html).toContain("Round 2/3 · 1 team in contention");
    expect(html).toContain("On equal points: Buchholz, opponents&#x27; win %, head-to-head.");
    expect(html).toContain("Withdraw");
    expect(html).not.toContain('lang="fr"');
  });

  it("survie par coupes", () => {
    const html = inLocale(
      "en",
      <SurvivalView survival={survival} matches={roundMatches} allTournamentMatches={roundMatches} myTeamId={10} isFinished={false} adminResolvable={() => false} onOpenAdminModal={noop} canForfeit={() => true} onForfeit={noop} />,
    );
    expectNoFrench(html);
    expect(html).toContain("Next cut: round 3");
    expect(html).toContain("⚖ Play-in");
  });

  it.each([false, true])("BlueGenji's Survival (arbitre : %s)", (canPenalize) => {
    const html = inLocale(
      "en",
      <EnduranceView endurance={endurance} matches={[]} canPenalize={canPenalize} onPenalize={noop} onLiftPenalty={noop} canForfeit={() => true} onForfeit={noop} adminResolvable={() => false} onOpenAdminModal={noop} format="BG_SURVIE" />,
    );
    expectNoFrench(html);
    expect(html).toContain("ROUND 2/6 · 1 TEAM IN CONTENTION → 4");
    expect(html).toContain("Out of contention");
    expect(html).toContain("REFEREE PENALTIES");
  });

  it("multi-phases : frise des phases et classement de phase", () => {
    const timeline = inLocale(
      "en",
      <PhaseTimeline phases={[phase({ id: 1 }), phase({ id: 2, position: 2, format: "SINGLE", state: "RUNNING", name: null }), phase({ id: 3, position: 3, state: "SKIPPED" })]} selectedPhaseId={2} currentPhaseId={2} onSelect={noop} />,
    );
    expectNoFrench(timeline);
    expect(timeline).toContain("8 teams → 4 qualify");
    const standings = inLocale("en", <PhaseStandingsBlock standings={[{ teamId: 10, teamName: "Alpha", logoUrl: null, seed: 1, rank: 1, qualified: true }]} />);
    expectNoFrench(standings);
    expect(standings).toContain("Stage standings");
  });

  it("inscrites et planification, vues d'un spectateur et du staff", () => {
    for (const isAdmin of [false, true]) {
      const detail = tournamentDetail({
        card: tournamentCard({ ...DATES, state: "REGISTRATION", refereeScheduling: true }),
        registrations: [
          { teamId: 10, teamName: "Alpha", registeredAt: "2026-05-03T18:30:00.000Z", finalRank: null, seed: 1, logoUrl: null },
        ],
        isAdmin,
      });
      const registrations = inLocale("en", <RegistrationsPanel detail={detail} canAct onChanged={noop} />);
      expectNoFrench(registrations);
      expect(registrations).toContain("Registrations · starting order");
      expectNoFrench(inLocale("en", <MatchPlanningPanel detail={detail} onPlan={noop} frozen={false} />));
    }
  });

  it("carte de match : nul, double forfait, libellés d'attente", () => {
    const draw = bracketMatch({ id: 9, team1Id: 10, team1Name: "Alpha", team2Id: 11, team2Name: "Bravo", team1Score: 1, team2Score: 1, status: "COMPLETED" });
    const html = inLocale("en", <MatchRow match={draw} adminResolvable={false} onOpenAdminModal={noop} scoreLocked={false} roundNumber={1} />);
    expectNoFrench(html);
    const waiting = bracketMatch({ id: 10, team1Id: null, team2Id: null, team1Placeholder: UPPER_FINAL_WINNER_PLACEHOLDER, team2Placeholder: lowerWinnerPlaceholder(2, 1) });
    const pending = inLocale("en", <MatchRow match={waiting} adminResolvable={false} onOpenAdminModal={noop} scoreLocked={false} roundNumber={3} />);
    expect(pending).toContain("Upper bracket winner");
    expect(pending).toContain("Winner of lower bracket match 1, round 2");
  });

  it("chargement", () => {
    expectNoFrench(inLocale("en", <TournamentLoading />));
  });

  it("détail des maps : langue de la page, fenêtres de score comprises (lot 8b)", () => {
    const maps = [{ mapNumber: 1, team1Score: 2, team2Score: 1, replayCode: "ABC123" }];
    const page = inLocale("en", <MapResultList maps={maps} team1Name="Alpha" team2Name="Bravo" label="Match maps" />);
    expect(page).toContain("Won by Alpha");
    expectNoFrench(page);
    expect(inLocale("fr", <MapResultList maps={maps} team1Name="Alpha" team2Name="Bravo" label="Maps" />)).toContain("Gagnée par Alpha");
  });
});

describe("gestes traduits au lot 8b — plus de blocs français sur la fiche", () => {
  const COMPONENTS = "app/(secured)/tournois/[id]/_components";
  const source = (file: string) => readFileSync(join(process.cwd(), COMPONENTS, file), "utf8");

  it("les notifications des gestes suivent la page (useToast), fenêtre d'image comprise", () => {
    for (const file of [
      "AdvanceTournamentDialog.tsx",
      "DeleteTournamentDialog.tsx",
      "EndurancePenaltyDialog.tsx",
      "GhostRegistrationDialog.tsx",
      "IssueReportDialog.tsx",
      "MatchCardActions.tsx",
      "MatchLiveDialog.tsx",
      "MatchReplayDialog.tsx",
      "MatchScheduleDialog.tsx",
      "PlayerScoreDialog.tsx",
      "RegistrationsPanel.tsx",
      "RemoveEntrantDialog.tsx",
      "RollbackRoundDialog.tsx",
      "TournamentImageDialog.tsx",
    ]) {
      const code = source(file);
      expect(`${file}: ${code.includes("useFrenchBlockToast")}`).toBe(`${file}: false`);
      expect(`${file}: ${code.includes("frenchBlockLang")}`).toBe(`${file}: false`);
    }
    const scoreForm = readFileSync(join(process.cwd(), "app/(secured)/tournois/[id]/_hooks/useScoreForm.ts"), "utf8");
    expect(scoreForm).not.toContain("useFrenchBlockToast");
    // Lot 8b-2 : le sélecteur d'image suit la page ; seule la modale de
    // recadrage, commune au site (lot 9), reste française et le redit.
    const picker = readFileSync(join(process.cwd(), "app/(secured)/tournois/_components/TournamentImagePicker.tsx"), "utf8");
    expect(picker).toContain("useImageCropper({ lang: cropLang })");
  });

  it("lien « Modifier » vers l'édition, traduite au lot 8b-2 : même langue, sans hrefLang", () => {
    expect(source("TournamentHeader.tsx")).toContain("<LocaleLink href={`/tournois/${card.id}/modifier`}>");
    expect(isMigratedRoute("/tournois/12/modifier")).toBe(true);
  });

  it("textes de la fiche indexés sur la langue seule (un refresh ne rouvre pas le flux)", () => {
    const provider = readFileSync(join(process.cwd(), "components/i18n/tournament-page-text.tsx"), "utf8");
    expect(provider).toContain("const [value, setValue] = useState(build);");
    expect(provider).toContain("if (value.locale !== locale) setValue(build());");
    const actions = readFileSync(join(process.cwd(), "components/i18n/tournament-actions-text.tsx"), "utf8");
    expect(actions).toContain("if (state.locale !== locale) setState({ locale, value: buildValue(locale, messages) });");
  });

  it("échec définitif du flux : notification dans la langue de la page, comme le témoin", () => {
    const live = readFileSync(join(process.cwd(), "app/(secured)/tournois/[id]/_hooks/useTournamentLive.ts"), "utf8");
    expect(live).toContain("showPageError(t(`live.fatal.${failure}`));");
    expect(live).toContain("showError(mapError((e as Error).message, errorsText));");
  });

  it("menu porté et confirmations : plus de lang forcé, le pied d'action cite le match dans la langue de la page", () => {
    const actions = source("MatchCardActions.tsx");
    expect(actions).not.toMatch(/lang=\{lang\}|contentLang/);
    expect(source("AdminScoreDialog.tsx")).not.toContain("contentLang");
    const row = source("MatchRow.tsx");
    expect(row).toContain("matchLabel={actionMatchLabel}");
    expect(row).toContain("const actionMatchLabel = versusText(text, team1Display, team2Display);");
  });
});

// ─── Le français des messages égale les textes d'origine ───────────────────

describe("français inchangé — les messages égalent les tables d'origine", () => {
  const fr = FR_TOURNAMENT_PAGE_TEXT;

  it("étapes de la frise, états de lancement, sections, planification", () => {
    for (const [key, meta] of Object.entries(TOURNAMENT_STAGE_META)) {
      expect(fr.t(`progress.stages.${key as keyof typeof TOURNAMENT_STAGE_META}.label`)).toBe(meta.label);
      expect(fr.t(`progress.stages.${key as keyof typeof TOURNAMENT_STAGE_META}.hint`)).toBe(meta.hint);
    }
    expect(fr.t("launch.toPlan")).toBe(LAUNCH_PHASE_LABELS.TO_PLAN);
    expect(fr.t("launch.scheduled")).toBe(LAUNCH_PHASE_LABELS.SCHEDULED);
    expect(fr.t("launch.lobby")).toBe(LAUNCH_PHASE_LABELS.LOBBY);
    expect(fr.t("launch.launched")).toBe(LAUNCH_PHASE_LABELS.LAUNCHED);
    for (const [key, label] of Object.entries(MATCH_SECTION_LABELS)) {
      expect(fr.t(`sections.${key as keyof typeof MATCH_SECTION_LABELS}`)).toBe(label);
    }
    expect(fr.t("planning.descriptionOn")).toBe(REFEREE_SCHEDULING_DESCRIPTION);
    expect(phaseFormatLabel("SINGLE")).toBe("Simple élimination");
    expect(phaseStateLabel("FINISHED")).toBe("Terminée");
  });

  it("dates de la fiche : jour sans zéro initial en anglais, inchangé en français", () => {
    const iso = "2026-10-07T18:00:00.000Z";
    const options = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } as const;
    expect(pageDateTime(iso, "en", options)).toMatch(/^Oct 7, 2026/);
    expect(pageDateTime(iso, "fr", options)).toMatch(/^07 oct\. 2026/);
    // Mois en chiffres : le jour garde son zéro (« 03/05 », comme le bandeau du match).
    const numeric = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } as const;
    expect(pageDateTime("2026-03-05T12:00:00.000Z", "en", numeric)).toMatch(/^03\/05/);
  });

  it("pénalité d'endurance : pluriel ICU en anglais", () => {
    expect(EN.t("endurance.penaltyBadgeSr", { points: 1 })).toBe(" (1 point deducted by penalty)");
    expect(EN.t("endurance.penaltyBadgeTitle", { points: 3 })).toBe("3 points deducted by referee penalty");
  });

  it("tournoi devenu inaccessible : formulation neutre (masqué ou supprimé), filtres « all … »", () => {
    expect(EN.t("live.fatal.TOURNAMENT_NOT_FOUND")).toMatch(/^This tournament is no longer available/);
    expect(FR_TOURNAMENT_PAGE_TEXT.t("live.fatal.TOURNAMENT_NOT_FOUND")).toMatch(/^Ce tournoi n'est plus accessible/);
    expect(EN.t("header.filters.discordAll")).toBe("all Discord accounts verified");
    expect(EN.t("header.filters.blizzardAll")).toBe("all Blizzard accounts linked");
  });

  it("compteurs anglais à 1 : singulier (manches prévues, joueurs, maps, cadence)", () => {
    expect(EN.t("endurance.outLegendRounds", { count: 1 })).toBe(" IN THE 1 PLANNED ROUND");
    expect(EN.t("endurance.outLegendRounds", { count: 8 })).toBe(" IN THE 8 PLANNED ROUNDS");
    expect(EN.t("header.filters.minPlayers", { count: 1 })).toBe("1 player minimum");
    expect(EN.t("matchFormat.withMaps", { base: "BO3", maps: 1 })).toBe("BO3 · 1 map");
    expect(EN.t("live.cadenceMinutes", { minutes: 1 })).toBe("at most every 1 minute");
    expect(EN.t("live.cadenceMinutes", { minutes: 5 })).toBe("at most every 5 minutes");
  });

  it("titres d'onglet d'appel : le français égale viewerAlertTitle", () => {
    for (const alert of VIEWER_ALERT_PRIORITY) {
      const message = FR_TOURNAMENT_PAGE_TEXT.t(`live.alerts.${alert}`);
      expect(`${alert}: ${message}`).toBe(`${alert}: ${viewerAlertTitle(alert)}`);
    }
  });

  it("délais, formats de match, conditions d'inscription", () => {
    const now = Date.parse("2026-05-12T12:00:00.000Z");
    for (const minutes of [0.5, 5, 60, 61, 1440, 1500, 3000]) {
      const to = now + minutes * 60_000;
      expect(stageCountdownText(fr, now, to)).toBe(formatStageCountdown(now, to));
    }
    expect(stageCountdownText(EN, now, now + 1500 * 60_000)).toBe("in 1d 1h");
    for (const format of [null, { type: "BO", value: 5 }, { type: "FT", value: 1 }, { type: "BO", value: 2, maxMaps: 2 }] as (MatchFormat | null)[]) {
      expect(matchFormatDescriptionText(fr, format)).toBe(matchFormatDescription(format));
    }
    for (const discordRequirement of ["NONE", "ANY_PLAYER", "ALL_PLAYERS"] as const) {
      for (const blizzardRequirement of ["NONE", "ANY_PLAYER", "ALL_PLAYERS"] as const) {
        for (const solo of [false, true]) {
          const filters = { minPlayers: 5, discordRequirement, blizzardRequirement } as Parameters<typeof registrationFiltersSummary>[0];
          expect(registrationConditionsText(fr, filters, solo)).toBe(registrationFiltersSummary(filters, solo));
        }
      }
    }
  });

  it("réglages des règles (`?tournoi=`), mode par mode", () => {
    const base = (format: TournamentSettingsInput["card"]["format"]): TournamentSettingsInput => ({
      card: tournamentCard({ format, participantType: format === "SWISS" ? "SOLO" : "TEAM", matchFormat: { type: "BO", value: 3 }, survivalRoundsBeforeFirstCut: 2, survivalRoundsPerCut: 1, hasThirdPlaceMatch: true }),
      phases: [phase({ id: 1, name: "Pools" }), phase({ id: 2, position: 2, format: "SURVIVAL", survivalRoundsBeforeFirstCut: 2, survivalRoundsPerCut: 2, qualifierMode: "PERCENT", qualifierValue: 50 }), phase({ id: 3, position: 3, format: "SINGLE", hasThirdPlaceMatch: true })],
      swiss: { totalRounds: 0, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, pointsForBye: 3 },
      endurance: { startPoints: 1, winDelta: 1, lossDelta: 1, playoffSize: 4, maxRounds: null },
      seedingSource: "RANKING",
    });
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI", "BG_SURVIE"] as const) {
      const input = base(format);
      expect(settingsGroupsFrom(input, "fr", messagesFor("fr"))).toEqual(tournamentSettingsGroups(input));
      const en = localizedTournamentSettingsGroups(input, "en", messagesFor("en"));
      expect(JSON.stringify(en)).not.toMatch(ACCENTED);
      expect(en[0].title).toBe("Tournament");
    }
  });

  it("description de partage : français d'origine, anglais rédigé", () => {
    for (const state of ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"] as const) {
      const card = tournamentCard({ ...DATES, state, participantType: state === "RUNNING" ? "SOLO" : "TEAM" });
      expect(localizedTournamentShareDescription(card, "fr", messagesFor("fr"))).toBe(tournamentShareDescription(card));
      expect(localizedTournamentShareDescription(card, "en", messagesFor("en"))).not.toMatch(ACCENTED);
    }
  });

  it("libellés d'attente : français tels quels, anglais rédigés, inconnus inchangés", () => {
    expect(localizedPlaceholder(fr, upperLoserPlaceholder(1, 2))).toBe(upperLoserPlaceholder(1, 2));
    expect(localizedPlaceholder(EN, "Perdant demi-finale 2")).toBe("Semifinal 2 loser");
    expect(localizedPlaceholder(EN, "Texte libre")).toBe("Texte libre");
    expect(localizedPlaceholder(EN, null)).toBeNull();
  });
});

// ─── Formateur réduit ≡ next-intl ───────────────────────────────────────────

describe("tournament — équivalence avec next-intl, message par message", () => {
  function leaves(tree: object, prefix = ""): Array<{ key: string; source: string }> {
    return Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string" ? [{ key: `${prefix}${key}`, source: value }] : leaves(value as object, `${prefix}${key}.`),
    );
  }

  it.each(LOCALES.map((locale) => [locale]))("%s", (locale) => {
    const catalog = messagesFor(locale);
    const messages = leaves({ ...catalog.tournament, ...catalog.tournamentViews });
    expect(messages.length).toBeGreaterThan(300);
    const values = {
      count: 2, entrants: 1, qualifiers: 2, wins: 3, points: 1, total: 2, win: 1,
      played: "1", position: "2", name: "Pools", number: "4", from: "1", to: "3", label: "X", team: "Alpha", team1: "A", team2: "B",
      match: "A vs B", round: "3", slot: "1", link: "Twitch", platform: "Twitch", code: "ABC", date: "May 12", cadence: "every second",
      seconds: "5", minutes: "2", days: "1", hours: "3", base: "BO3", maps: "5", start: "9", loss: "1", forfeit: "3", size: "4",
      prefix: "Alpha · round 1", capital: "x", penalty: "1", every: "every round", list: "a, b", draw: "1", bye: "3", value: "50",
      title: "Round 1", progress: "done", registered: "3", max: "8", day: "May 12, 2026", hour: "20:00",
    };
    for (const { key, source } of messages) {
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      expect(`${key}: ${formatMessage(locale, source, values)}`).toBe(`${key}: ${reference("m", values)}`);
    }
  });
});

describe("performance — le français des vues voyage avec la vue", () => {
  const ID = "app/(secured)/tournois/[id]";
  const read = (file: string) => readFileSync(join(process.cwd(), ID, file), "utf8");

  it("le premier chargement ne porte pas les espaces des vues", () => {
    for (const part of TOURNAMENT_VIEW_PARTS) expect(Object.keys(FR_TOURNAMENT_PAGE_MESSAGES)).not.toContain(part);
    // Hors vue, une clé de vue se rend telle quelle (jamais de page cassée).
    expect(FR_TOURNAMENT_PAGE_TEXT.t("swiss.summary", { round: "1", total: "3", count: 2 })).toBe("swiss.summary");
  });

  it("chaque vue apporte son français, égal au catalogue", () => {
    const fr = messagesFor("fr").tournamentViews;
    expect(FR_VIEWS_TEXT.t("swiss.summary", { round: "1", total: "3", count: 2 })).toBe(
      formatMessage("fr", fr.swiss.summary, { round: "1", total: "3", count: 2 }),
    );
    expect(FR_VIEWS_TEXT.t("survival.everyRound")).toBe(fr.survival.everyRound);
    expect(FR_VIEWS_TEXT.t("endurance.regionDone")).toBe(fr.endurance.regionDone);
    // Une vue lit aussi la clé d'une autre (colonne « Équipe » de l'endurance).
    expect(FR_VIEWS_TEXT.t("swiss.team")).toBe(fr.swiss.team);
    // Le reste de la fiche reste lisible depuis une vue.
    expect(FR_VIEWS_TEXT.t("loading")).toBe(FR_TOURNAMENT_PAGE_TEXT.t("loading"));
  });

  it("toute clé littérale lue par une vue existe dans son texte français", () => {
    const files = [
      "_components/SwissView.tsx",
      "_components/SurvivalView.tsx",
      "_components/EnduranceView.tsx",
      "_components/EnduranceRoundPanels.tsx",
      "_lib/endurance-history.ts",
      "_lib/endurance-sections.ts",
    ];
    const keys = files.flatMap((file) => [...read(file).matchAll(/\bt\("([a-zA-Z.]+)"/g)].map((m) => m[1]));
    expect(keys.length).toBeGreaterThan(50);
    const missing = keys.filter((key) => messageAt({ ...FR_TOURNAMENT_PAGE_MESSAGES, ...messagesFor("fr").tournamentViews }, key) === undefined);
    expect(missing).toEqual([]);
  });

  it("les vues lisent leur texte par useTournamentViewText, la fiche ne les importe qu'à la demande", () => {
    expect(read("_components/SwissView.tsx")).toContain("useTournamentViewText(FR_VIEWS_TEXT)");
    expect(read("_components/SurvivalView.tsx")).toContain("useTournamentViewText(FR_VIEWS_TEXT)");
    expect(read("_components/EnduranceView.tsx")).toContain("useTournamentViewText(FR_VIEWS_TEXT)");
    expect(read("_components/EnduranceRoundPanels.tsx")).toContain("useTournamentViewText(FR_VIEWS_TEXT)");
    const page = read("page.tsx");
    expect(page).not.toContain("_lib/views-text");
    expect(page).not.toContain("tournamentViews.json");
  });
});
