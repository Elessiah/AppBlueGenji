/**
 * Lot 9-1 — `/equipes`, `/equipes/creer`, `/equipes/[id]`, `/joueurs`,
 * `/joueurs/[id]` sous `/en` : annuaires, cartes, création, fiches, refus. Le
 * français reste celui d'avant (rendus de caractérisation : `team-settings-render`,
 * `team-tag-display`… ; table des refus : `team-errors-fr-before-lot9.json`).
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement, ReactNode } from "react";

let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
// Lecteur connecté : sans session, les mises en page ne sérialisent pas l'anglais (`isDocumentLoad`).
jest.mock("@/lib/server/auth", () => ({ ...jest.requireActual<object>("@/lib/server/auth"), getCurrentUser: async () => ({ id: 1 }) }));
// Chargement complet par défaut ; `"0"` : requête du routeur (navigation, `router.refresh()`).
let mockDocument = "1";
jest.mock("next/headers", () => ({ headers: async () => new Headers({ "x-bg-document": mockDocument }) }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/equipes/1",
  useParams: () => ({ id: "5" }),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/app/(secured)/_shared/BgCanvas", () => ({ BgCanvas: () => null }));
let mockPlayer: unknown = null;
jest.mock("@/lib/shared/hooks/useResourceLoader", () => ({
  useResourceLoader: () => ({ status: "ready", data: mockPlayer, error: null, refresh: () => undefined, revalidate: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import TeamsPage, { generateMetadata as teamsPageMetadata } from "@/app/(secured)/equipes/page";
import CreateTeamPage, { generateMetadata as createTeamMetadata } from "@/app/(secured)/equipes/creer/page";
import TeamsLayout from "@/app/(secured)/equipes/layout";
import TeamDetailLayout from "@/app/(secured)/equipes/[id]/layout";
import PlayersPage, { generateMetadata as playersPageMetadata } from "@/app/(secured)/joueurs/page";
import PlayersLayout from "@/app/(secured)/joueurs/layout";
import PlayerDetailLayout from "@/app/(secured)/joueurs/[id]/layout";
import TeamsList from "@/app/(secured)/equipes/TeamsList";
import CreateTeamForm from "@/app/(secured)/equipes/creer/CreateTeamForm";
import PlayersList from "@/app/(secured)/joueurs/PlayersList";
import PlayerDetailPage from "@/app/(secured)/joueurs/[id]/page";
import { TeamCard } from "@/app/(secured)/equipes/cards/TeamCard";
import { HighlightStrip } from "@/app/(secured)/equipes/cards/HighlightStrip";
import { PlayerCard } from "@/app/(secured)/joueurs/cards/PlayerCard";
import { TeamHeader } from "@/app/(secured)/equipes/[id]/_components/TeamHeader";
import { TeamHistory } from "@/app/(secured)/equipes/[id]/_components/TeamHistory";
import { MembersSection } from "@/app/(secured)/equipes/[id]/_components/MembersSection";
import { MembershipActions } from "@/app/(secured)/equipes/[id]/_components/MembershipActions";
import { TeamSettings } from "@/app/(secured)/equipes/[id]/_components/TeamSettings";
import { RolePicker } from "@/app/(secured)/equipes/[id]/_components/RolePicker";
import { ModerationLogoBar } from "@/app/(secured)/equipes/[id]/_components/ModerationLogoBar";
import { rolesErrorMessage } from "@/app/(secured)/joueurs/[id]/_lib/roles-errors";
import { SecuredLoading } from "@/app/(secured)/_shared/SecuredLoading";
import { localizedFinalRank } from "@/app/(secured)/equipes/[id]/_lib/team-history";
import { teamPointsHint } from "@/app/(secured)/equipes/_lib/team-points";
import { membershipErrorMessage, teamErrorMessage, type TeamErrorsText } from "@/app/(secured)/equipes/_lib/team-errors";
import { playerErrorMessage } from "@/app/(secured)/joueurs/_lib/player-errors";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { TeamErrorsTextProvider } from "@/components/i18n/team-errors-text";
import { TeamsTextProvider, FR_TEAMS_TEXT } from "@/components/i18n/teams-text";
import { FR_TEAM_PAGE_TEXT } from "@/components/i18n/team-page-text";
import { TeamPageTextProvider } from "@/components/i18n/team-page-text-provider";
import { PlayersTextProvider } from "@/components/i18n/players-text-provider";
import { StatsPanelI18nProvider } from "@/components/i18n/stats-panel-i18n";
import { messagesFor } from "@/lib/server/i18n-messages";
import { imageUploadErrorMessage } from "@/lib/shared/image-upload-errors";
import { moderationReasonErrorMessage } from "@/lib/shared/logo-quarantine";
import { isMigratedRoute, LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { formatMessage } from "@/lib/shared/message-format";
import { rankingPointsHint, RANKING_POINTS_LABEL, RANKING_UNRANKED_SHORT } from "@/lib/shared/ranking";
import { scopedText } from "@/lib/shared/scoped-text";
import { statsPanelMessages } from "@/lib/shared/stats-text";
import { TEAM_ROLE_LABELS, teamRoleLabel, formatTeamRoles } from "@/lib/shared/team-role-display";
import { teamTagErrorMessage } from "@/lib/shared/team-tag";
import { LOGO_RIGHTS_LABEL, TERMS_CHECKBOX_LABEL } from "@/lib/shared/terms-of-use";
import { PLAYER_ROSTER_STATUS_LABEL } from "@/lib/shared/player-roster-status";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, PLATFORM_ROLES } from "@/lib/shared/permissions";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import type { TeamListItem, TeamRole } from "@/lib/shared/types";
import frTeamErrorsBefore from "../fixtures/team-errors-fr-before-lot9.json";
import { teamDetailResponse } from "../helpers/team-detail";
import { fullProfileResponse, publicUserProfile } from "../helpers/auth-user";

const EN = messagesFor("en");
const EN_TEAM_ERRORS: TeamErrorsText = scopedText("en", EN.teamErrors);

function inEnglish(ui: ReactElement): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <ShellTextProvider locale="en" messages={EN.shell}>
        <TeamErrorsTextProvider locale="en" messages={EN.teamErrors}>
          <TeamsTextProvider locale="en" messages={EN.teams}>
            <TeamPageTextProvider locale="en" messages={EN.team}>
              <PlayersTextProvider locale="en" messages={EN.players}>
                <StatsPanelI18nProvider value={{ locale: "en", messages: statsPanelMessages(EN) }}>{ui}</StatsPanelI18nProvider>
              </PlayersTextProvider>
            </TeamPageTextProvider>
          </TeamsTextProvider>
        </TeamErrorsTextProvider>
      </ShellTextProvider>
    </AppLocaleProvider>,
  );
}

/** Le texte visible et les attributs lus (noms accessibles, infobulles, champs). */
function readable(html: string): string {
  const withoutFrench = html.replace(/<([a-z]+)[^>]*lang="fr"[^>]*>[\s\S]*?<\/\1>/g, " ");
  const attributes = [...withoutFrench.matchAll(/(?:aria-label|title|placeholder|alt|value)="([^"]*)"/g)].map((m) => m[1]);
  const text = withoutFrench.replace(/<[^>]+>/g, " ");
  return `${text} ${attributes.join(" ")}`;
}

// Mots français qui ne doivent plus paraître sous `/en` (les fixtures ne
// portent aucun nom saisi en français).
const FRENCH_WORDS =
  /\b(Équipes?|équipes?|Joueurs?|joueurs?|Voir|Rôles?|Membres|Inviter|Retirer|Annuler|Enregistrer|Statistiques|Historique|Tournois?|Victoires|Défaites|Classement|Chargement|Paramètres|Sigle|Propriétaire|Masqué|Sans|Compte|Rechercher|Trier|Quitter|Demander|Rejoindre|Décliner|Logo de|Forme|Fondée|FONDÉE|Majorité|Informations|Créer|Soutien|Capitaine|Toutes|Tous|Effectif|Pseudo)\b/;
const ACCENTED = /[À-ÖØ-öø-ÿ]/;

function expectEnglish(html: string): void {
  const text = readable(html);
  expect(text).not.toMatch(FRENCH_WORDS);
  expect(text).not.toMatch(ACCENTED);
}

function listTeam(overrides: Partial<TeamListItem> = {}): TeamListItem {
  return {
    id: 4,
    name: "Glaciers",
    tag: "GLC",
    logoUrl: null,
    membersCount: 5,
    createdAt: "2026-03-01T00:00:00.000Z",
    rank: 1,
    points: 1180,
    wins: 9,
    losses: 2,
    form: ["w", "l", "d"],
    games: ["OW", "MR"],
    rosterPreview: [{ userId: 2, pseudo: "Nova", avatarUrl: null }],
    region: "EU",
    isGhost: true,
    ...overrides,
  };
}

const member = (userId: number, pseudo: string, roles: TeamRole[]) => ({
  membershipId: userId,
  userId,
  pseudo,
  avatarUrl: null,
  roles,
  joinedAt: "2026-02-01T00:00:00.000Z",
  isDeleted: false,
});

beforeEach(() => {
  mockLocale = "en";
  mockPlayer = null;
});

describe("liste blanche et métadonnées", () => {
  it("ouvre les cinq routes, `[id]` entier seulement", () => {
    for (const path of ["/equipes", "/equipes/creer", "/equipes/12", "/joueurs", "/joueurs/5"]) {
      expect(isMigratedRoute(path)).toBe(true);
    }
    expect(isMigratedRoute("/equipes/abc")).toBe(false);
    expect(isMigratedRoute("/joueurs/abc")).toBe(false);
  });

  it("reste hors sitemap dans les deux langues (espace connecté)", () => {
    const paths = localizedSitemapEntries(publicSitemapRoutes()).map((entry) => entry.path).join(" ");
    expect(paths).not.toMatch(/equipes|joueurs/);
  });

  it.each([
    ["/equipes", teamsPageMetadata, "Teams", "Équipes"],
    ["/joueurs", playersPageMetadata, "Players", "Joueurs"],
  ] as const)("%s : titre, canonique et hreflang par langue", async (path, metadata, en, fr) => {
    mockLocale = "en";
    const english = await metadata();
    expect(english.title).toBe(en);
    expect(english.alternates).toEqual({
      canonical: `/en${path}`,
      languages: { fr: path, en: `/en${path}`, "x-default": path },
    });
    mockLocale = "fr";
    const french = await metadata();
    expect(french.title).toBe(fr);
    expect(french.alternates).toMatchObject({ canonical: path });
  });

  it("/equipes/creer : titre dans la langue de l'adresse", async () => {
    expect((await createTeamMetadata()).title).toBe("Create a team");
    mockLocale = "fr";
    expect((await createTeamMetadata()).title).toBe("Créer une équipe");
  });

  it("les mises en page ne sérialisent l'anglais que sous `/en`", async () => {
    const child = <span>child</span>;
    for (const layout of [TeamsLayout, TeamDetailLayout, PlayersLayout, PlayerDetailLayout]) {
      mockLocale = "fr";
      const french = (await layout({ children: child })) as ReactElement<{ messages?: unknown; value?: unknown }>;
      expect(french.props.messages ?? french.props.value).toBeUndefined();
      mockLocale = "en";
      const english = (await layout({ children: child })) as ReactElement<{ messages?: unknown; value?: unknown }>;
      expect(english.props.messages ?? english.props.value).toBeDefined();
      // Revue performance du lot 9-2 : jamais dans une réponse du routeur — le client garde le sien.
      mockDocument = "0";
      try {
        const routed = (await layout({ children: child })) as ReactElement<{ messages?: unknown; stats?: unknown }>;
        expect(routed.props.messages).toBeUndefined();
        expect(routed.props.stats).toBeUndefined();
      } finally {
        mockDocument = "1";
      }
    }
    for (const page of [TeamsPage, CreateTeamPage]) {
      mockLocale = "en";
      expect(((await page()) as ReactElement<{ messages?: unknown }>).props.messages).toBe(EN.teams);
      mockLocale = "fr";
      expect(((await page()) as ReactElement<{ messages?: unknown }>).props.messages).toBeUndefined();
    }
    expect(PlayersPage()).toBeDefined();
  });
});

describe("français inchangé", () => {
  it("table des refus égale à celle d'avant le lot, code par code", () => {
    for (const [code, before] of Object.entries(frTeamErrorsBefore.codes)) {
      const expected = before ?? moderationReasonErrorMessage(code);
      expect(`${code}: ${teamErrorMessage(code)}`).toBe(`${code}: ${expected}`);
    }
    expect(teamErrorMessage("SOMETHING_NEW")).toBe(frTeamErrorsBefore.fallback);
    expect(membershipErrorMessage("USER_ALREADY_IN_TEAM")).toBe(frTeamErrorsBefore.selfAlreadyInTeam);
  });

  it("refus du sigle et d'une image : les phrases des registres partagés", () => {
    for (const code of ["TEAM_TAG_TOO_SHORT", "TEAM_TAG_TOO_LONG", "TEAM_TAG_NOT_ALPHANUMERIC", "TEAM_TAG_ALREADY_USED"]) {
      expect(teamErrorMessage(code)).toBe(teamTagErrorMessage(code));
    }
    for (const code of Object.keys(messagesFor("fr").teamErrors.image)) {
      expect(teamErrorMessage(code)).toBe(imageUploadErrorMessage(code));
    }
  });

  it("libellés repris des modules partagés", () => {
    const fr = messagesFor("fr");
    for (const [role, label] of Object.entries(TEAM_ROLE_LABELS)) expect(teamRoleLabel(role as TeamRole)).toBe(label);
    expect(fr.teams.points.label).toBe(RANKING_POINTS_LABEL);
    expect(fr.teams.points.unrankedShort).toBe(RANKING_UNRANKED_SHORT);
    for (const [ranked, points] of [[true, 1000], [false, 1000], [false, 1012]] as const) {
      expect(teamPointsHint(FR_TEAMS_TEXT, ranked, points)).toBe(rankingPointsHint(ranked, points));
    }
    expect(fr.teams.create.logoRights).toBe(LOGO_RIGHTS_LABEL);
    expect(fr.team.settings.logoRights).toBe(LOGO_RIGHTS_LABEL);
    expect(fr.teams.create.terms.startsWith(`${TERMS_CHECKBOX_LABEL} (`)).toBe(true);
    for (const [status, label] of Object.entries(PLAYER_ROSTER_STATUS_LABEL)) {
      expect(fr.players.card.rosterStatus[status as keyof typeof PLAYER_ROSTER_STATUS_LABEL]).toBe(label);
    }
    for (const role of PLATFORM_ROLES) {
      expect(fr.players.platformRoles[role]).toEqual({ label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] });
    }
    expect(fr.teams.ticker.label).toBe(fr.landing.ticker.label);
    expect(fr.teams.ticker.resume).toBe(fr.landing.ticker.resume);
    expect(fr.players.ticker.pause).toBe(fr.landing.ticker.pause);
  });

  it("place finale : « 1er », « 2e »… comme avant", () => {
    for (let rank = 1; rank <= 30; rank++) {
      expect(localizedFinalRank(FR_TEAM_PAGE_TEXT, rank)).toBe(rank === 1 ? "1er" : `${rank}e`);
    }
    expect(localizedFinalRank(FR_TEAM_PAGE_TEXT, null)).toBe("—");
  });

  it("un lecteur français ne voit rien d'anglais sur la liste", () => {
    const html = renderToStaticMarkup(<TeamsList />);
    expect(html).toContain("Équipes <em>inscrites</em>");
    expect(html).toContain("Rechercher une équipe");
    expect(html).toContain("0 équipe<");
  });
});

describe("anglais", () => {
  it("refus : chaque code a sa phrase, bornes comprises, jamais le jeton", () => {
    expect(teamErrorMessage("INVALID_TEAM_NAME", undefined, EN_TEAM_ERRORS)).toBe("The team name must be 3 to 60 characters long.");
    expect(teamErrorMessage("IMAGE_TOO_LARGE", undefined, EN_TEAM_ERRORS)).toBe("Image too large: 5 MB maximum.");
    expect(teamErrorMessage("TEAM_TAG_TOO_LONG", undefined, EN_TEAM_ERRORS)).toBe("The tag can't be longer than 4 characters.");
    expect(teamErrorMessage("WHATEVER", "TEAM_JOIN_FAILED", EN_TEAM_ERRORS)).toBe("The request couldn't be sent.");
    // Réseau coupé (`TypeError`) : l'annuaire dit ce qui a échoué, comme celui des joueurs.
    expect(teamErrorMessage("Failed to fetch", "TEAMS_LOAD_FAILED", EN_TEAM_ERRORS)).toBe("The team list couldn't be loaded.");
    expect(teamErrorMessage("constructor", undefined, EN_TEAM_ERRORS)).toBe("The operation failed.");
    expect(membershipErrorMessage("USER_ALREADY_IN_TEAM", undefined, EN_TEAM_ERRORS)).toBe("You already belong to a team: leave it first.");
    for (const code of Object.keys(frTeamErrorsBefore.codes)) {
      const message = teamErrorMessage(code, undefined, EN_TEAM_ERRORS);
      expect(message).not.toMatch(ACCENTED);
      expect(message).not.toContain(code);
    }
  });

  it("refus des écrans joueurs : une phrase, jamais le code", () => {
    const text = scopedText("en", EN.players);
    expect(playerErrorMessage(text, "PLAYER_NOT_FOUND")).toBe("This player doesn't exist or no longer exists.");
    expect(playerErrorMessage(text, "HTTP_500", "PLAYER_LOAD_FAILED")).toBe("The player's profile couldn't be loaded.");
    expect(playerErrorMessage(text, "fallback")).toBe("The operation failed.");
    // `/joueurs/abc` : un identifiant invalide est un joueur introuvable, pas un échec.
    expect(playerErrorMessage(text, "INVALID_ID", "PLAYER_LOAD_FAILED")).toBe("This player doesn't exist or no longer exists.");
    expect(playerErrorMessage(scopedText("fr", messagesFor("fr").players), "INVALID_ID", "PLAYER_LOAD_FAILED")).toBe(
      "Ce joueur n'existe pas ou n'existe plus.",
    );
  });

  it("rôles d'équipe : HEAL se dit Support (D8)", () => {
    expect(teamRoleLabel("HEAL", "en")).toBe("Support");
    expect(formatTeamRoles(["DPS", "OWNER", "CAPITAINE"], "en")).toBe("Owner, Captain, DPS");
  });

  it("place finale ordinale", () => {
    const text = scopedText("en", EN.team);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((rank) => localizedFinalRank(text, rank))).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st",
    ]);
  });

  it("annuaire des équipes", () => {
    const html = inEnglish(<TeamsList />);
    expect(html).toContain("Registered <em>teams</em>");
    expect(html).toContain('aria-label="Search for a team"');
    expect(html).toContain("ROSTER · Directory updated daily");
    expect(html).toContain('href="/en/equipes/creer"');
    expectEnglish(html);
  });

  it("cartes et podium", () => {
    const teams = [listTeam(), listTeam({ id: 5, rank: 2, isGhost: false }), listTeam({ id: 6, rank: 3, wins: 0, losses: 0, form: [] })];
    const html = inEnglish(
      <>
        <HighlightStrip teams={teams} />
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}
      </>,
    );
    expect(html).toContain('aria-label="Open Glaciers&#x27;s page"');
    expect(html).not.toContain("View Glaciers&#x27;s profile");
    expect(html).toContain("FOUNDED · MAR 2026");
    expect(html).toContain("GHOST");
    expect(html).toContain("No matches");
    expect(html).toContain('href="/en/equipes/4"');
    expectEnglish(html);
  });

  it("création d'une équipe", () => {
    const html = inEnglish(<CreateTeamForm />);
    expect(html).toContain("Create my team");
    expect(html).toContain("read the terms");
    expect(html).toContain('href="/en/conditions-utilisation"');
    expectEnglish(html);
  });

  it("fiche : en-tête, historique, membres, adhésion, paramètres", () => {
    const team = teamDetailResponse({
      team: { id: 4, name: "Glaciers", tag: null, isGhost: true },
      members: [member(1, "Nova", ["OWNER", "HEAL"]), member(2, "Kite", ["MANAGER", "CAPITAINE"])],
      tournaments: [
        { tournamentId: 9, tournamentName: "Winter Cup", state: "FINISHED", finalRank: 2, wins: 3, losses: 1, playedAt: "2026-02-02T00:00:00.000Z" },
      ],
      viewerMembership: "OWNER",
      canManage: true,
      viewerUserId: 1,
    });
    const html = inEnglish(
      <>
        <TeamHeader team={team} />
        <TeamHistory tournaments={team.tournaments} />
        <MembersSection
          teamId={4}
          teamName="Glaciers"
          members={team.members}
          canManage
          viewerUserId={1}
          invitations={[{ id: 3, userId: 8, pseudo: "Orbit", roles: ["DPS"], createdAt: "2026-02-03T00:00:00.000Z" }]}
          onChanged={() => undefined}
          onInvitationsChanged={() => undefined}
        />
        <MembershipActions
          team={{ ...team, viewerMembership: "MEMBER", team: { ...team.team, isGhost: false } }}
          requests={[{ id: 5, userId: 9, pseudo: "Zed", createdAt: "2026-02-04T00:00:00.000Z" }]}
          onChanged={() => undefined}
          onRequestsChanged={() => undefined}
        />
        <TeamSettings team={team} onChanged={() => undefined} />
        <TeamSettings team={{ ...team, managedAsGhost: true }} onChanged={() => undefined} />
        <RolePicker selected={["DPS"]} onChange={() => undefined} />
      </>,
    );
    expect(html).toContain("Tournament history");
    expect(html).toContain("2nd");
    expect(html).toContain("Support");
    expect(html).toContain("Invite a player");
    expect(html).toContain("Pending invitations (1)");
    expect(html).toContain("Join requests (1)");
    expect(html).toContain("Leave the team");
    expect(html).toContain("Destructive actions");
    expect(html).toContain("Offer to a player");
    expect(html).toContain("Initials — this team has no tag yet");
    expectEnglish(html);
  });

  it("fiche : chaque état d'adhésion", () => {
    const base = teamDetailResponse({ team: { id: 4, name: "Glaciers" } });
    const html = inEnglish(
      <>
        <MembershipActions team={{ ...base, viewerInvitation: "INVITED", viewerInvitationId: 3 }} requests={[]} onChanged={() => undefined} onRequestsChanged={() => undefined} />
        <MembershipActions team={{ ...base, viewerInvitation: "REQUESTED", viewerInvitationId: 3 }} requests={[]} onChanged={() => undefined} onRequestsChanged={() => undefined} />
        <MembershipActions team={base} requests={[]} onChanged={() => undefined} onRequestsChanged={() => undefined} />
        <MembershipActions team={{ ...base, team: { ...base.team, isGhost: true } }} requests={[]} onChanged={() => undefined} onRequestsChanged={() => undefined} />
        <MembershipActions
          team={{ ...base, viewerInvitation: "INVITED", viewerInvitationId: 3, team: { ...base.team, isGhost: true } }}
          requests={[]}
          onChanged={() => undefined}
          onRequestsChanged={() => undefined}
        />
        <MembershipActions team={{ ...base, team: { ...base.team, deletedAt: "2026-03-01T00:00:00.000Z" } }} requests={[]} onChanged={() => undefined} onRequestsChanged={() => undefined} />
      </>,
    );
    for (const phrase of ["Join", "Withdraw my request", "Ask to join the team", "Take over the team", "Ghost team", "Team disbanded"]) {
      expect(html).toContain(phrase);
    }
    expectEnglish(html);
  });

  it("la modération reste française, annoncée `lang=\"fr\"` (D4)", () => {
    const team = teamDetailResponse({ team: { id: 4, name: "Glaciers", logoUrl: "/api/uploads/team-logos/a.webp" }, canModerate: true });
    const html = inEnglish(<ModerationLogoBar team={team} onChanged={() => undefined} />);
    expect(html).toMatch(/<fieldset[^>]*lang="fr"/);
    expect(html).toContain("Retirer le logo");
  });

  it("annuaire des joueurs, carte", () => {
    const html = inEnglish(
      <>
        <PlayersList />
        <PlayerCard player={publicUserProfile({ id: 2, pseudo: "Nova", roles: ["HEAL", "CAPITAINE"], team: null })} />
        <PlayerCard player={publicUserProfile({ id: 3, pseudo: "Kite", isDeleted: true })} />
      </>,
    );
    expect(html).toContain("Registered <em>players</em>");
    expect(html).toContain("SUPPORT");
    expect(html).toContain("Deleted account");
    // `/profil` est traduite au lot 9-2 : le lien suit la langue.
    expect(html).toContain('href="/en/profil"');
    expectEnglish(html);
  });

  it("fiche joueur", () => {
    mockPlayer = fullProfileResponse({
      profile: { id: 5, pseudo: "Nova", overwatchBattletag: "Nova#1234", visibility: { avatar: true, overwatch: false, marvel: true, major: true, discord: false }, discordVerified: true },
      isSelf: true,
      displayRoles: ["ARBITRE"],
      teamsTimeline: [{ teamId: 4, teamName: "Glaciers", joinedAt: "2026-01-02T00:00:00.000Z", leftAt: null, roles: ["OWNER", "HEAL"] }],
      tournaments: [{ tournamentId: 9, tournamentName: "Winter Cup", state: "RUNNING", finalRank: null, wins: 1, losses: 0, playedAt: "2026-02-02T00:00:00.000Z" }],
    });
    const html = inEnglish(<PlayerDetailPage />);
    expect(html).toContain('href="/en/equipes/4"');
    expect(html).toContain("Referee");
    expect(html).toContain("Owner, Support");
    expect(html).toContain("In progress");
    expect(html).toContain("Hidden from everyone (the badge, if it comes from a linked Battle.net account, stays visible, without the BattleTag): it can only be read");
    expect(html).toContain("Verified Discord tag");
    expect(html).toContain("Statistics");
    expectEnglish(html);
  });

  it("fiche joueur sans historique : indique les deux états vides", () => {
    mockPlayer = fullProfileResponse({ profile: { pseudo: "Nova" }, teamsTimeline: [], tournaments: [] });
    const html = inEnglish(<PlayerDetailPage />);
    expect(html).toContain("No team memberships yet.");
    expect(html).toContain("No tournaments played yet.");
    expectEnglish(html);
  });

  it("frontière de chargement de l'espace connecté : le libellé lu sur le serveur", async () => {
    mockLocale = "en";
    expect(renderToStaticMarkup(await SecuredLoading())).toContain("Loading…");
    mockLocale = "fr";
    expect(renderToStaticMarkup(await SecuredLoading())).toContain("Chargement…");
    mockLocale = "en";
  });
});

describe("revue UI/UX", () => {
  it("filtres et tris annoncent leur état (`aria-pressed`) et ne soumettent rien", () => {
    for (const html of [inEnglish(<TeamsList />), inEnglish(<PlayersList />)]) {
      const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
      const toggles = buttons.filter((tag) => tag.includes("aria-pressed"));
      expect(toggles.length).toBeGreaterThanOrEqual(5);
      for (const tag of toggles) expect(tag).toContain('type="button"');
      expect(toggles.some((tag) => tag.includes('aria-pressed="true"'))).toBe(true);
    }
  });

  it("compteur de section au singulier dans les deux langues", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      expect(formatMessage(locale, messages.teams.list.sectionCount, { count: 1 })).toBe(locale === "fr" ? "1 ÉQUIPE" : "1 TEAM");
      expect(formatMessage(locale, messages.teams.list.sectionCount, { count: 2 })).toBe(locale === "fr" ? "2 ÉQUIPES" : "2 TEAMS");
      expect(formatMessage(locale, messages.players.list.sectionCount, { count: 1 })).toBe(locale === "fr" ? "1 JOUEUR" : "1 PLAYER");
    }
  });

  it("aucun libellé ne compte sur une espace en bord de message", () => {
    for (const locale of LOCALES) {
      for (const namespace of ["teams", "team", "teamErrors", "teamRoles", "players"] as const) {
        const walk = (tree: object, path: string): void => {
          for (const [key, value] of Object.entries(tree)) {
            if (typeof value === "string") expect(`${path}${key}=${value.trim()}`).toBe(`${path}${key}=${value}`);
            else walk(value as object, `${path}${key}.`);
          }
        };
        walk(messagesFor(locale)[namespace], `${locale}.${namespace}.`);
      }
    }
  });

  it("fiche joueur : place ordinale et bilan comme sur la fiche d'équipe", () => {
    mockPlayer = fullProfileResponse({
      tournaments: [
        { tournamentId: 9, tournamentName: "Winter Cup", state: "FINISHED", finalRank: 3, wins: 3, losses: 1, playedAt: "2026-02-02T00:00:00.000Z" },
        { tournamentId: 10, tournamentName: "Spring Cup", state: "RUNNING", finalRank: null, wins: 0, losses: 0, playedAt: "2026-03-02T00:00:00.000Z" },
      ],
    });
    const html = inEnglish(<PlayerDetailPage />);
    expect(html).toContain(">3rd<");
    expect(html).toContain(">—<");
    expect(html).toContain("3 W – ");
    const team = teamDetailResponse({
      tournaments: [{ tournamentId: 9, tournamentName: "Winter Cup", state: "FINISHED", finalRank: 3, wins: 3, losses: 1, playedAt: "2026-02-02T00:00:00.000Z" }],
    });
    const teamHtml = inEnglish(<TeamHistory tournaments={team.tournaments} />);
    expect(teamHtml).toContain("3rd");
    expect(teamHtml).toContain("3 W – ");
    // Le libellé de cellule (mobile) reste séparé de sa valeur sans espace dans le message.
    expect(teamHtml).toMatch(/Record<\/span> 3 W/);
    expect(teamHtml).toMatch(/Placement<\/span> 3rd/);
  });

  it("forme d'une carte : singulier dit au singulier", () => {
    for (const locale of LOCALES) {
      const source = messagesFor(locale).teams.card.formSpoken;
      expect(formatMessage(locale, source, { count: 1, results: "W" })).toBe(locale === "fr" ? "Dernier match : W" : "Last match: W");
      expect(formatMessage(locale, source, { count: 3, results: "W" })).toBe(
        locale === "fr" ? "3 derniers matchs, du plus récent au plus ancien : W" : "Last 3 matches, most recent first: W",
      );
    }
  });

  it("fiche joueur : « introuvable » dit la même phrase en page et en notification ; colonne « Place » comme l'équipe", () => {
    for (const locale of LOCALES) {
      const { players, team } = messagesFor(locale);
      expect(players.page.notFound).toBe(players.errors.PLAYER_NOT_FOUND);
      expect(players.page.tournamentsColumn.rank).toBe(team.history.column.rank);
    }
  });

  it("fiche d'équipe : un échec de chargement n'est pas « introuvable »", () => {
    for (const locale of LOCALES) {
      const page = messagesFor(locale).team.page;
      expect(page.loadError).not.toBe(page.notFound);
    }
  });

  it("rôles de plateforme : refus en phrase française, jamais le code (D4)", () => {
    expect(rolesErrorMessage("CANNOT_MODIFY_SELF")).toBe("Tu ne peux pas modifier tes propres rôles.");
    expect(rolesErrorMessage("ROLES_UPDATE_FAILED")).toBe("La mise à jour des rôles a échoué.");
    expect(rolesErrorMessage("constructor")).toBe("La mise à jour des rôles a échoué.");
  });

  it("en-tête d'équipe : le taux au format anglais, comme le bloc de statistiques", () => {
    const team = teamDetailResponse({ team: { id: 4, name: "Glaciers" } });
    const html = inEnglish(<TeamHeader team={{ ...team, stats: { ...team.stats, winRate: 0.62 } }} />);
    expect(html).toContain("62%");
    expect(html).not.toMatch(/62\s%/);
    const fr = renderToStaticMarkup(<TeamHeader team={{ ...team, stats: { ...team.stats, winRate: 0.62 } }} />);
    expect(fr).toMatch(/62\s%/);
  });

  it("carte d'équipe : nom accessible propre à une équipe", () => {
    const html = inEnglish(<TeamCard team={listTeam({ name: "Glaciers" })} />);
    expect(html).toContain('aria-label="Open Glaciers&#x27;s page"');
    expect(html).toContain("View Nova&#x27;s profile");
    expect(messagesFor("fr").teams.card.viewTeam).toBe(messagesFor("fr").teams.card.viewProfile);
  });

  it("carte joueur : son équipe se nomme comme une équipe", () => {
    const html = inEnglish(<PlayerCard player={publicUserProfile({ id: 2, pseudo: "Nova", team: { id: 4, name: "Glaciers", colorIndex: 1 } })} />);
    expect(html).toContain('title="Open Glaciers&#x27;s page"');
  });

  it("fiche joueur : un échec de chargement dit sa raison, la même que la notification", () => {
    const loader = jest.requireMock<{ useResourceLoader: unknown }>("@/lib/shared/hooks/useResourceLoader");
    const original = loader.useResourceLoader;
    loader.useResourceLoader = () => ({ status: "error", data: null, error: "UNAUTHORIZED", refresh: () => undefined, revalidate: () => undefined });
    try {
      expect(inEnglish(<PlayerDetailPage />)).toContain("Your session has expired: log in again to continue.");
      expect(renderToStaticMarkup(<PlayerDetailPage />)).toContain("Ta session a expiré : reconnecte-toi pour continuer.");
    } finally {
      loader.useResourceLoader = original;
    }
  });

  it("fiche joueur en français sans historique : indique les deux états vides", () => {
    mockLocale = "fr";
    mockPlayer = fullProfileResponse({ profile: { pseudo: "Nova" }, teamsTimeline: [], tournaments: [] });
    const html = renderToStaticMarkup(<PlayerDetailPage />);
    expect(html).toContain("Aucune appartenance à une équipe pour le moment.");
    expect(html).toContain("Aucun tournoi joué pour le moment.");
    mockLocale = "en";
  });

  it("fiche joueur en français : « 3e », « 3 V – 1 D »", () => {
    mockLocale = "fr";
    mockPlayer = fullProfileResponse({
      tournaments: [{ tournamentId: 9, tournamentName: "Coupe", state: "FINISHED", finalRank: 3, wins: 3, losses: 1, playedAt: "2026-02-02T00:00:00.000Z" }],
    });
    const html = renderToStaticMarkup(<PlayerDetailPage />);
    expect(html).toContain(">3e<");
    expect(html).toContain("3 V – ");
  });
});

describe("équivalence avec next-intl, message par message", () => {
  function leaves(tree: object, prefix = ""): Array<{ key: string; source: string }> {
    return Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string" ? [{ key: `${prefix}${key}`, source: value }] : leaves(value as object, `${prefix}${key}.`),
    );
  }

  it.each(LOCALES.flatMap((locale) => (["teams", "team", "teamErrors", "teamRoles", "players"] as const).map((ns) => [locale, ns] as const)))(
    "%s · %s",
    (locale, namespace) => {
      for (const { key, source } of leaves(messagesFor(locale)[namespace])) {
        if (source.includes("<")) continue; // balises : rendu riche, vérifié sur les écrans
        const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
        for (const count of [0, 1, 2]) {
          const values = { count, hidden: count + 1, step: 1, name: "Glaciers", pseudo: "Nova", team: "Glaciers", min: 3, max: 60, base: 1000, floor: 100, date: "May 12", results: "win", rank: 2, file: "a.png", reason: "x", wins: 1, losses: 2 };
          expect(`${key}: ${formatMessage(locale, source, values)}`).toBe(`${key}: ${reference("m", values)}`);
        }
      }
    },
  );
});
