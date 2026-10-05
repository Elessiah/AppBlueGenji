import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { IssueReportProvider } from "@/app/(secured)/tournois/[id]/_lib/issue-report-context";
import { PlayerScoreProvider } from "@/app/(secured)/tournois/[id]/_lib/player-score-context";
import {
  groupMatchCardActions,
  matchCardActionList,
  matchCardActionName,
  type MatchCardActionInput,
} from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";
import type { LaunchStripControls } from "@/app/(secured)/tournois/[id]/_lib/launch-strip";
import { ToastProvider } from "@/components/ui/toast";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Pied d'action de la carte de match (`docs/features/MATCH_CARD_LAYOUT.md`) :
 * une action principale visible, le reste derrière « Plus d'actions ». Le
 * rangement ne change le public d'aucune action.
 */

const NO_LAUNCH: LaunchStripControls = {
  isCaster: false,
  showOpen: false,
  showClaim: false,
  showRelease: false,
  showPlan: false,
  showForce: false,
  showHost: false,
  showHostSwap: false,
};

const NOTHING: MatchCardActionInput = {
  playerScoreLabel: null,
  launch: NO_LAUNCH,
  inLobby: false,
  adminScoreLabel: null,
  showSchedule: false,
  hasStartAt: false,
  showOnAir: false,
  onAir: false,
  showLiveConfig: false,
  liveConfigured: false,
  showReplay: false,
  hasReplay: false,
  canReport: false,
};

const ids = (input: Partial<MatchCardActionInput>) => matchCardActionList({ ...NOTHING, ...input }).map((a) => a.id);

describe("matchCardActionList — chaque drapeau donne son action, rien de plus", () => {
  it("n'offre rien à un simple spectateur", () => {
    expect(ids({})).toEqual([]);
  });

  it("range toutes les actions dans l'ordre du menu", () => {
    const all = ids({
      playerScoreLabel: "Saisir le score",
      launch: {
        isCaster: true,
        showOpen: true,
        showClaim: true,
        showRelease: true,
        showPlan: true,
        showForce: true,
        showHost: true,
        showHostSwap: true,
      },
      adminScoreLabel: "Éditer le score",
      showSchedule: true,
      showOnAir: true,
      showLiveConfig: true,
      showReplay: true,
      canReport: true,
    });
    expect(all).toEqual([
      "playerScore",
      "openLaunch",
      "plan",
      "adminScore",
      "schedule",
      "force",
      "hostSwap",
      "claimCast",
      "releaseCast",
      "onAir",
      "liveConfig",
      "replay",
      "report",
    ]);
  });

  it("dit le geste selon l'état : date, antenne, diffusion, rediff, caster", () => {
    const labels = (input: Partial<MatchCardActionInput>) =>
      matchCardActionList({ ...NOTHING, ...input }).map((a) => a.label);
    expect(labels({ showSchedule: true })).toEqual(["Programmer une date"]);
    expect(labels({ showSchedule: true, hasStartAt: true })).toEqual(["Modifier la date"]);
    expect(labels({ showOnAir: true })).toEqual(["Lancer le direct"]);
    expect(labels({ showOnAir: true, onAir: true })).toEqual(["Couper le direct"]);
    expect(labels({ showLiveConfig: true })).toEqual(["Diffuser ce match"]);
    expect(labels({ showLiveConfig: true, liveConfigured: true })).toEqual(["Configurer la diffusion"]);
    expect(labels({ showReplay: true })).toEqual(["Ajouter la rediff"]);
    expect(labels({ showReplay: true, hasReplay: true })).toEqual(["Modifier la rediff"]);
    expect(labels({ launch: { ...NO_LAUNCH, showRelease: true } })).toEqual(["Retirer le caster"]);
    expect(labels({ launch: { ...NO_LAUNCH, showRelease: true, isCaster: true } })).toEqual(["Ne plus caster"]);
    expect(labels({ launch: { ...NO_LAUNCH, showOpen: true }, inLobby: true })).toEqual(["Ouvrir le lancement"]);
    expect(labels({ launch: { ...NO_LAUNCH, showOpen: true } })).toEqual(["Infos du match"]);
  });
});

describe("groupMatchCardActions — une principale, le reste au menu", () => {
  const list = (input: Partial<MatchCardActionInput>) => matchCardActionList({ ...NOTHING, ...input });

  it("ne range rien quand il n'y a rien", () => {
    expect(groupMatchCardActions([])).toEqual({ primary: null, more: [] });
  });

  it("garde visible une action seule, quelle qu'elle soit", () => {
    const { primary, more } = groupMatchCardActions(list({ canReport: true }));
    expect(primary?.id).toBe("report");
    expect(more).toEqual([]);
  });

  it("met en avant la saisie du score d'un engagé, le signalement passe au menu", () => {
    const { primary, more } = groupMatchCardActions(
      list({ playerScoreLabel: "Saisir le score", launch: { ...NO_LAUNCH, showOpen: true }, canReport: true }),
    );
    expect(primary?.id).toBe("playerScore");
    expect(more.map((a) => a.id)).toEqual(["openLaunch", "report"]);
  });

  it("met en avant « Planifier » avant le score d'arbitrage", () => {
    const { primary } = groupMatchCardActions(
      list({ launch: { ...NO_LAUNCH, showPlan: true, showForce: true }, adminScoreLabel: "Prononcer un forfait" }),
    );
    expect(primary?.id).toBe("plan");
  });

  it("met en avant le score d'arbitrage d'un match lancé", () => {
    const { primary, more } = groupMatchCardActions(
      list({ adminScoreLabel: "Éditer le score", showSchedule: true, showOnAir: true }),
    );
    expect(primary?.id).toBe("adminScore");
    expect(more.map((a) => a.id)).toEqual(["schedule", "onAir"]);
  });

  it("n'a pas de principale quand seules restent des actions secondaires", () => {
    const { primary, more } = groupMatchCardActions(list({ showOnAir: true, showLiveConfig: true }));
    expect(primary).toBeNull();
    expect(more).toHaveLength(2);
  });

  it("ne perd ni ne double aucune action", () => {
    const actions = list({
      playerScoreLabel: "Saisir le score",
      adminScoreLabel: "Éditer le score",
      showReplay: true,
      canReport: true,
    });
    const { primary, more } = groupMatchCardActions(actions);
    expect([primary, ...more]).toEqual(expect.arrayContaining(actions));
    expect(more).toHaveLength(actions.length - 1);
  });

  it("nomme chaque bouton par son libellé visible, puis le match", () => {
    expect(matchCardActionName("Forcer le lancement", "Alpha contre Bravo")).toBe(
      "Forcer le lancement : Alpha contre Bravo",
    );
  });
});

type Viewer = {
  canManage?: boolean;
  canSchedule?: boolean;
  myTeamId?: number | null;
  canReport?: boolean;
  playerScore?: boolean;
  adminResolvable?: boolean;
  scoreLocked?: boolean;
};

function wrap(viewer: Viewer, child: ReactNode) {
  return renderToStaticMarkup(
    <ToastProvider>
      <LiveProvider
        canManage={viewer.canManage ?? false}
        canSchedule={viewer.canSchedule ?? false}
        refereeScheduling={false}
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={1}
        myTeamId={viewer.myTeamId ?? null}
        castBlock={null}
      >
        <IssueReportProvider canReport={viewer.canReport ?? false} openReport={() => undefined}>
          <PlayerScoreProvider
            canOpen={() => viewer.playerScore ?? false}
            canReportScore={() => true}
            open={() => undefined}
          >
            {child}
          </PlayerScoreProvider>
        </IssueReportProvider>
      </LiveProvider>
    </ToastProvider>,
  );
}

function card(match: BracketMatch, viewer: Viewer = {}) {
  return wrap(
    viewer,
    <MatchRow
      match={match}
      adminResolvable={viewer.adminResolvable ?? false}
      onOpenAdminModal={() => undefined}
      scoreLocked={viewer.scoreLocked ?? false}
      roundNumber={1}
    />,
  );
}

const launched = (overrides: Partial<BracketMatch> = {}) =>
  bracketMatch({
    id: 42,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Name: "Alpha",
    team2Name: "Bravo",
    launchedAt: "2026-09-24T20:00:00.000Z",
    ...overrides,
  });

const played = bracketMatch({
  id: 43,
  status: "COMPLETED",
  team1Id: 10,
  team2Id: 20,
  team1Name: "Alpha",
  team2Name: "Bravo",
  team1Score: 2,
  team2Score: 1,
  winnerTeamId: 10,
  loserTeamId: 20,
});

/** Partie du balisage avant le panneau replié : ce qui est visible d'emblée. */
const visiblePart = (html: string) => {
  const at = html.indexOf('hidden=""');
  return at === -1 ? html : html.slice(0, at);
};

describe("MatchRow — chaque public retrouve ses actions", () => {
  it("spectateur : aucun pied d'action", () => {
    const html = card(launched());
    expect(html).not.toContain("data-action=");
    expect(html).not.toContain("Plus d&#x27;actions");
  });

  it("engagé : saisie du score visible, lancement et signalement au menu", () => {
    const html = card(launched(), { myTeamId: 10, canReport: true, playerScore: true });
    expect(visiblePart(html)).toContain('data-action="playerScore"');
    expect(visiblePart(html)).not.toContain('data-action="report"');
    expect(html).toContain('data-action="openLaunch"');
    expect(html).toContain("Signaler un problème : Alpha contre Bravo");
  });

  it("engagé d'un autre match : ni saisie ni signalement sur cette carte", () => {
    const html = card(launched(), { myTeamId: 99, canReport: true });
    expect(html).not.toContain('data-action="report"');
    expect(html).not.toContain('data-action="playerScore"');
  });

  it("arbitrage : le score en principale, la date et le reste au menu", () => {
    const html = card(launched(), { canSchedule: true, adminResolvable: true });
    expect(visiblePart(html)).toContain("Éditer le score : Alpha contre Bravo");
    expect(html).toContain('data-action="schedule"');
    expect(html).toContain('data-action="hostSwap"');
  });

  it("arbitrage, score verrouillé : plus de bouton de score, le constat reste", () => {
    const html = card(played, { adminResolvable: true, scoreLocked: true });
    expect(html).not.toContain('data-action="adminScore"');
    expect(html).toContain("Score verrouillé");
  });

  it("diffusion : la rediff d'un match joué reste offerte", () => {
    const html = card(played, { canManage: true });
    expect(html).toContain("Ajouter la rediff : Alpha contre Bravo");
  });

  it("« Plus d'actions » : bouton de divulgation fermé, relié à un panneau masqué", () => {
    const html = card(launched(), { canSchedule: true, adminResolvable: true });
    const toggle = /<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>/.exec(html);
    expect(toggle).not.toBeNull();
    expect(toggle?.[0]).toContain('aria-label="Plus d&#x27;actions : Alpha contre Bravo"');
    expect(html).toContain(`id="${toggle?.[1]}"`);
    expect(html).toMatch(new RegExp(`id="${toggle?.[1]}"[^>]*hidden=""`));
  });
});

describe("MatchCardActions — clavier et focus (branchements)", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "MatchCardActions.tsx"),
    "utf8",
  );

  it("Échap referme et rend le focus au bouton, comme le menu du compte", () => {
    expect(source).toContain("handleMenuEscape(e.key, document.activeElement, rootRef.current, toggleRef.current");
  });

  it("la tabulation qui sort du pied le referme", () => {
    expect(source).toContain("focusLeftMenu(rootRef.current, e.relatedTarget)");
  });

  it("une action du menu rend le focus au bouton avant de s'exécuter", () => {
    expect(source).toMatch(/setOpen\(false\);\s*toggleRef\.current\?\.focus\(\);\s*\}\s*handlers\[action\.id\]\(\);/);
  });

  it("le lancement forcé garde sa confirmation", () => {
    expect(source).toContain("force: () => setConfirmForce(true),");
    expect(source).toContain("<ConfirmActionDialog");
  });
});
