import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCardActions, panelPlacement } from "@/app/(secured)/tournois/[id]/_components/MatchCardActions";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import type { CastBlock } from "@/lib/shared/match-launch";
import {
  groupMatchCardActions,
  matchCardActionList,
  matchCardActionName,
  type MatchCardActionInput,
} from "@/app/(secured)/tournois/[id]/_lib/match-card-actions";
import type { LaunchStripControls } from "@/app/(secured)/tournois/[id]/_lib/launch-strip";
import { ToastProvider } from "@/components/ui/toast";
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

function renderFooter(actions: Partial<MatchCardActionInput>, castBlock: CastBlock | null = null) {
  return renderToStaticMarkup(
    <ToastProvider>
      <LiveProvider
        canManage
        canSchedule
        refereeScheduling={false}
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={1}
        myTeamId={null}
        castBlock={castBlock}
      >
        <MatchCardActions
          match={bracketMatch({ id: 42, team1Id: 10, team2Id: 20, team1Name: "Alpha", team2Name: "Bravo" })}
          phase="LOBBY"
          actions={matchCardActionList({ ...NOTHING, ...actions })}
          matchLabel="Alpha contre Bravo"
          isCaster={false}
          onAir={false}
          onPlayerScore={() => undefined}
          onAdminScore={() => undefined}
          onReport={() => undefined}
        />
      </LiveProvider>
    </ToastProvider>,
  );
}

describe("MatchCardActions — rendu du pied", () => {
  it("ne rend rien sans action", () => {
    // Seules restent les régions d'annonce du `ToastProvider`.
    expect(renderFooter({})).not.toContain("<button");
  });

  it("une action seule : bouton visible, pas de « Plus d'actions »", () => {
    const html = renderFooter({ canReport: true });
    expect(html).toContain('data-action="report"');
    expect(html).toContain('aria-label="Signaler un problème : Alpha contre Bravo"');
    expect(html).not.toContain("aria-expanded");
  });

  it("replié : la principale seule est montée, aucun panneau", () => {
    const html = renderFooter({ adminScoreLabel: "Éditer le score", showSchedule: true, showOnAir: true });
    expect(html).toContain('data-action="adminScore"');
    expect(html).not.toContain('data-action="schedule"');
    expect(html).not.toContain('data-action="onAir"');
    const toggle = /<button[^>]*aria-expanded="false"[^>]*>/.exec(html);
    expect(toggle).not.toBeNull();
    expect(toggle?.[0]).toContain('aria-label="Plus d&#x27;actions : Alpha contre Bravo"');
    // `aria-controls` ne vise le panneau que lorsqu'il existe (ouvert).
    expect(toggle?.[0]).not.toContain("aria-controls");
  });

  it("sans principale : « Plus d'actions » prend la largeur et montre son libellé", () => {
    const html = renderFooter({ showOnAir: true, showLiveConfig: true });
    expect(html).toMatch(/aria-expanded="false"[\s\S]*Plus d&#x27;actions<\/span>/);
    expect(html).not.toContain('class="sr-only">Plus d');
  });

  it("« Caster » bloqué faute d'identité : aria-disabled et motif", () => {
    const blocked = renderFooter({ launch: { ...NO_LAUNCH, showClaim: true } }, "CASTER_IDENTITY_REQUIRED");
    expect(blocked).toMatch(/aria-disabled="true"[^>]*Battle\.net|Battle\.net[^>]*aria-disabled="true"/);
    expect(renderFooter({ launch: { ...NO_LAUNCH, showClaim: true } }, null)).toContain('aria-disabled="false"');
  });
});

describe("panelPlacement — le panneau ouvert reste à l'écran", () => {
  const footer = { top: 300, bottom: 352, left: 100, width: 258 };

  /** Le panneau posé laisse-t-il le pied d'action (top → bottom) découvert ? */
  const clearsFooter = (placed: ReturnType<typeof panelPlacement>, f: typeof footer, height: number) => {
    const shown = Math.min(height, placed.maxHeight);
    return placed.up ? placed.top + shown <= f.top + 4 : placed.top >= f.bottom - 4;
  };

  const view = (height: number, width = 1280) => ({ width, height });

  it("se pose sous le pied, à la largeur de la carte bordure comprise", () => {
    expect(panelPlacement(footer, 200, view(900))).toEqual({
      top: 348,
      left: 99,
      width: 260,
      maxHeight: 544,
      up: false,
    });
  });

  it("passe au-dessus quand la place manque en bas et abonde en haut", () => {
    const low = { ...footer, top: 700, bottom: 752 };
    expect(panelPlacement(low, 200, view(800))).toEqual({ top: 504, left: 99, width: 260, maxHeight: 696, up: true });
  });

  it("trop haut pour la place : borné (la liste défile), jamais hors de l'écran", () => {
    const mid = { ...footer, top: 400, bottom: 452 };
    const placed = panelPlacement(mid, 480, view(700));
    expect(placed).toMatchObject({ up: true, top: 8, maxHeight: 396 });
    expect(clearsFooter(placed, mid, 480)).toBe(true);
  });

  it("ne recouvre jamais le pied d'action, même quand aucun côté ne suffit", () => {
    // Pied à 300–350, panneau de 400 px, fenêtre de 700 px.
    const bar = { ...footer, top: 300, bottom: 350 };
    const placed = panelPlacement(bar, 400, view(700));
    expect(placed).toMatchObject({ up: false, top: 346, maxHeight: 346 });
    expect(clearsFooter(placed, bar, 400)).toBe(true);
    expect(placed.top + Math.min(400, placed.maxHeight)).toBeLessThanOrEqual(700 - 8);
  });

  it("reste dessous quand le haut n'offre pas davantage", () => {
    const high = { ...footer, top: 60, bottom: 112 };
    expect(panelPlacement(high, 200, view(250))).toMatchObject({ up: false, maxHeight: 134 });
  });

  it("reste dans la fenêtre en largeur : carte à demi défilée hors d'une manche", () => {
    // Téléphone de 375 px : carte décalée de 180 px à gauche, puis à droite.
    expect(panelPlacement({ ...footer, left: -180 }, 200, view(800, 375))).toMatchObject({ left: 8, width: 260 });
    expect(panelPlacement({ ...footer, left: 300 }, 200, view(800, 375))).toMatchObject({ left: 107, width: 260 });
    // Fenêtre plus étroite que la carte : le panneau s'y réduit.
    expect(panelPlacement(footer, 200, view(800, 240))).toMatchObject({ left: 8, width: 224 });
  });
});

describe("MatchCardActions — clavier et focus (branchements)", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "MatchCardActions.tsx"),
    "utf8",
  );

  it("le panneau est porté dans document.body, comme les modales", () => {
    expect(source).toMatch(/createPortal\([\s\S]*?document\.body,\s*\)/);
  });

  it("Échap referme et rend le focus au bouton, comme le menu du compte — pied et panneau compris", () => {
    expect(source).toContain("handleMenuEscape(e.key, document.activeElement, menu, toggleRef.current");
    expect(source).toMatch(/rootRef\.current\?\.contains\(node\) \|\| panelRef\.current\?\.contains\(node\)/);
  });

  it("le focus entre dans le panneau à l'ouverture", () => {
    expect(source).toContain('panelRef.current?.querySelector("button")?.focus({ preventScroll: true });');
  });

  it("la tabulation qui sort du pied et du panneau le referme ; par un bout du panneau, rend le focus", () => {
    expect(source).toContain("focusLeftMenu(menu, e.relatedTarget)");
    expect(source).toMatch(
      /\(e\.shiftKey && index === 0\) \|\| \(!e\.shiftKey && index === buttons\.length - 1\)[\s\S]{0,120}setOpen\(false\);\s*toggleRef\.current\?\.focus\(\);/,
    );
  });

  it("écoute la tabulation sur les boutons du panneau, jamais sur son conteneur (élément non interactif)", () => {
    expect(source).toContain("onKeyDown={inMenu ? onPanelKeyDown : undefined}");
    expect(source).toContain("const index = buttons.indexOf(e.currentTarget);");
    const panel = /<div\s+id=\{panelId\}[\s\S]*?>/.exec(source)?.[0] ?? "";
    expect(panel).not.toBe("");
    expect(panel).not.toMatch(/onKey(Down|Up|Press)=/);
  });

  it("une action du menu rend le focus au bouton avant de s'exécuter", () => {
    expect(source).toMatch(/setOpen\(false\);\s*toggleRef\.current\?\.focus\(\);\s*\}\s*handlers\[action\.id\]\(\);/);
  });

  it("un panneau retiré par le flux se referme, et ne revient pas déplié", () => {
    expect(source).toContain("const expanded = open && more.length > 0;");
    expect(source).toContain("if (open && more.length === 0) setOpen(false);");
    expect(source).toContain("aria-expanded={expanded}");
    expect(source).toContain("aria-controls={expanded ? panelId : undefined}");
  });

  it("se referme quand la zone défilante de la carte défile, suit la page sinon", () => {
    expect(source).toMatch(/target\.contains\(rootRef\.current\)\)\s*\{[\s\S]{0,400}?setOpen\(false\);\s*return;/);
    expect(source).toContain('window.addEventListener("scroll", onScroll, true);');
  });

  it("se replace quand la carte bouge sans défilement (ancêtres observés)", () => {
    expect(source).toContain("new ResizeObserver(schedule)");
    expect(source).toMatch(/node = node\.parentElement\)\s*\{\s*resizes\.observe\(node\);/);
    expect(source).toContain("resizes?.disconnect();");
  });

  it("ne monte le panneau qu'à l'ouverture (un plateau compte 254 cartes)", () => {
    expect(source).toMatch(/\{expanded &&\s*createPortal\(/);
  });

  it("le lancement forcé garde sa confirmation", () => {
    expect(source).toContain("force: () => setConfirmForce(true),");
    expect(source).toContain("<ConfirmActionDialog");
  });
});
