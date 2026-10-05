import { describe, expect, it, jest } from "@jest/globals";

// La carte entière est rendue avec une sonde à la place du pied d'action
// (`tests/helpers/match-card-actions-probe.ts`) : le vrai ne monte la liste
// « Plus d'actions » qu'à l'ouverture.
jest.mock("@/app/(secured)/tournois/[id]/_components/MatchCardActions", () =>
  jest
    .requireActual<typeof import("../helpers/match-card-actions-probe")>("../helpers/match-card-actions-probe")
    .probeModule(),
);

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { MatchLaunchStrip } from "@/app/(secured)/tournois/[id]/_components/MatchLaunchStrip";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { ToastProvider } from "@/components/ui/toast";
import { matchLaunchPhase, type CastBlock } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Bandeau de lancement d'une carte de match : ce qu'il dit à tous, et quel
 * bouton il offre à qui.
 */

type Viewer = {
  canManage?: boolean;
  canSchedule?: boolean;
  refereeScheduling?: boolean;
  viewerUserId?: number | null;
  myTeamId?: number | null;
  castBlock?: CastBlock | null;
};

function providers(viewer: Viewer, child: ReactNode) {
  return renderToStaticMarkup(
    <ToastProvider>
      <LiveProvider
        canManage={viewer.canManage ?? false}
        canSchedule={viewer.canSchedule ?? false}
        refereeScheduling={viewer.refereeScheduling ?? false}
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={viewer.viewerUserId ?? 1}
        myTeamId={viewer.myTeamId ?? null}
        castBlock={viewer.castBlock === undefined ? "NOT_CASTER" : viewer.castBlock}
      >
        {child}
      </LiveProvider>
    </ToastProvider>,
  );
}

/** La carte entière, pied d'action compris. */
function card(match: BracketMatch, viewer: Viewer = {}) {
  return providers(
    viewer,
    <MatchRow
      match={match}
      adminResolvable={false}
      onOpenAdminModal={() => undefined}
      scoreLocked={false}
      roundNumber={1}
    />,
  );
}

function render(match: BracketMatch, viewer: Viewer = {}) {
  // La phase vient de la carte (`MatchRow`) : le test la dérive de la même
  // règle, à l'instant du rendu.
  return providers(
    viewer,
    <MatchLaunchStrip
      match={match}
      phase={matchLaunchPhase({ ...match, refereeScheduling: viewer.refereeScheduling ?? false }, Date.now())}
    />,
  );
}

const lobby = (overrides: Partial<BracketMatch> = {}) =>
  bracketMatch({
    id: 42,
    status: "READY",
    team1Id: 10,
    team2Id: 20,
    team1Name: "Alpha",
    team2Name: "Bravo",
    hostTeamId: 10,
    ...overrides,
  });

describe("MatchLaunchStrip — ce que tout le monde lit", () => {
  it("annonce le lancement, le décompte des « Prêt » et l'équipe hôte", () => {
    const html = render(lobby({ team1Ready: true }));
    expect(html).toContain("Lancement");
    expect(html).toContain(">1/2<");
    expect(html).toContain("Équipe hôte : ");
    expect(html).toContain("Alpha");
  });

  it("compte le caster inscrit parmi les parties attendues", () => {
    const html = render(lobby({ casterUserId: 9, casterPseudo: "Voix", casterReady: false }));
    expect(html).toContain(">0/3<");
    expect(html).toContain("Voix");
    expect(html).toContain("attendu");
  });

  it("nomme l'hôte désigné, équipe 2 comprise", () => {
    expect(render(lobby({ hostTeamId: 20 }))).toContain("Bravo");
  });

  it("dit « Lancé » sur un match parti et encore à jouer", () => {
    const html = render(lobby({ launchedAt: "2026-09-24T20:00:00.000Z" }));
    expect(html).toContain("Lancé");
    expect(html).not.toContain("prêts");
  });

  it("ne rend rien sur un match terminé sans caster", () => {
    expect(render(lobby({ status: "COMPLETED" }))).not.toContain('class="strip"');
  });
});

/**
 * Les boutons du lancement vivent dans le pied d'action de la carte
 * (`MatchCardActions`) : ces cas rendent la carte entière (`MatchRow`), pied
 * d'action remplacé par une sonde qui écrit toutes ses actions — chacune se
 * repère à son `data-action`. Le bouton lui-même (motif d'un « Caster »
 * bloqué…) se teste dans `match-card-actions.test.tsx`.
 */
describe("pied d'action — boutons du lancement selon le lecteur", () => {
  it("offre l'ouverture de la modale aux joueurs du match, pas aux autres", () => {
    expect(card(lobby(), { myTeamId: 10 })).toContain("Ouvrir le lancement : Alpha contre Bravo");
    expect(card(lobby(), { myTeamId: 99 })).not.toContain('data-action="openLaunch"');
  });

  it("offre « Caster » à un caster, même sans identité vérifiée", () => {
    expect(card(lobby(), { canManage: true, castBlock: "CASTER_IDENTITY_REQUIRED" })).toContain(
      "Caster ce match : Alpha contre Bravo",
    );
    expect(card(lobby(), { canManage: true, castBlock: null })).toContain('data-action="claimCast"');
  });

  it("ne propose pas de caster son propre match ni un match déjà casté", () => {
    expect(card(lobby(), { canManage: true, castBlock: null, myTeamId: 10 })).not.toContain('data-action="claimCast"');
    expect(card(lobby({ casterUserId: 5, casterPseudo: "Autre" }), { canManage: true, castBlock: null })).not.toContain(
      'data-action="claimCast"',
    );
  });

  it("laisse le caster se retirer, et l'arbitrage retirer un caster", () => {
    const mine = lobby({ casterUserId: 1, casterPseudo: "Moi" });
    expect(card(mine, { viewerUserId: 1 })).toContain("Ne plus caster");
    expect(card(lobby({ casterUserId: 5, casterPseudo: "Autre" }), { canSchedule: true })).toContain(
      "Retirer le caster",
    );
  });

  it("donne à l'arbitrage le changement d'hôte et le lancement forcé", () => {
    const html = card(lobby(), { canSchedule: true });
    expect(html).toContain("Changer l&#x27;équipe hôte : Alpha contre Bravo");
    expect(html).toContain("Forcer le lancement : Alpha contre Bravo");
    const player = card(lobby(), { myTeamId: 10 });
    expect(player).not.toContain('data-action="hostSwap"');
    expect(player).not.toContain('data-action="force"');
  });

  it("ne propose plus de forcer un match déjà lancé", () => {
    expect(card(lobby({ launchedAt: "2026-09-24T20:00:00.000Z" }), { canSchedule: true })).not.toContain(
      'data-action="force"',
    );
  });
});

describe("MatchLaunchStrip — planification par l'arbitrage", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();

  it("annonce « À planifier » sur un match sans date quand l'option est allumée", () => {
    const html = render(lobby(), { refereeScheduling: true });
    expect(html).toContain("À planifier");
    expect(html).toContain('data-phase="TO_PLAN"');
    // Ni lancement, ni « Prêt » : le match attend l'arbitrage.
    expect(html).not.toContain("prêts");
    expect(html).not.toContain("Ouvrir le lancement");
  });

  it("n'offre « Planifier » qu'à l'arbitrage — en action principale", () => {
    const staff = card(lobby(), { refereeScheduling: true, canSchedule: true });
    expect(staff).toContain("Planifier : Alpha contre Bravo");
    // Action principale : la seule visible sans ouvrir « Plus d'actions ».
    expect(staff).toContain('data-action="plan" data-primary="true"');
    expect(card(lobby(), { refereeScheduling: true, canManage: true })).not.toContain('data-action="plan"');
    expect(card(lobby(), { refereeScheduling: true, myTeamId: 10 })).not.toContain('data-action="plan"');
  });

  it("laisse l'arbitrage forcer un match à planifier — forcer vaut planification", () => {
    expect(card(lobby(), { refereeScheduling: true, canSchedule: true })).toContain("Forcer le lancement");
  });

  it("dit « En attente de départ » une fois planifié, avec la date pour les lecteurs d'écran", () => {
    const html = render(lobby({ startAt: future }), { refereeScheduling: true, canSchedule: true });
    expect(html).toContain("En attente de départ");
    expect(html).toContain("début le");
    expect(card(lobby({ startAt: future }), { refereeScheduling: true, canSchedule: true })).not.toContain(
      'data-action="plan"',
    );
  });

  it("dit aussi « En attente de départ » sur un match daté, option éteinte", () => {
    expect(render(lobby({ startAt: future }))).toContain("En attente de départ");
  });

  it("garde le lancement ordinaire sans l'option", () => {
    const html = render(lobby());
    expect(html).not.toContain("À planifier");
    expect(html).toContain("Lancement");
  });
});
