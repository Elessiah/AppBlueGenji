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
import type { BracketMatch, MatchRefereeName } from "@/lib/shared/types";
import { bracketMatch, matchCaster } from "../helpers/bracket-match";

/**
 * Bandeau de lancement d'une carte de match : ce qu'il dit à tous, et quel
 * bouton il offre à qui.
 */

type Viewer = {
  canManage?: boolean;
  canSchedule?: boolean;
  refereeScheduling?: boolean;
  launchPhase?: boolean;
  viewerUserId?: number | null;
  myTeamId?: number | null;
  castBlock?: CastBlock | null;
  refereeNames?: MatchRefereeName[];
};

function providers(viewer: Viewer, child: ReactNode) {
  return renderToStaticMarkup(
    <ToastProvider>
      <LiveProvider
        canManage={viewer.canManage ?? false}
        canSchedule={viewer.canSchedule ?? false}
        refereeScheduling={viewer.refereeScheduling ?? false}
        launchPhase={viewer.launchPhase ?? true}
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={viewer.viewerUserId ?? 1}
        myTeamId={viewer.myTeamId ?? null}
        castBlock={viewer.castBlock === undefined ? "NOT_CASTER" : viewer.castBlock}
        refereeNames={viewer.refereeNames}
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
  it("annonce le lancement et le décompte des « Prêt »", () => {
    const html = render(lobby({ team1Ready: true }));
    expect(html).toContain("Lancement");
    expect(html).toContain(">1/2<");
  });

  it("compte le caster inscrit parmi les parties attendues, sans le nommer", () => {
    const html = render(lobby({ casters: [matchCaster({ userId: 9, pseudo: "Voix" })] }));
    expect(html).toContain(">0/3<");
    // La carte ne dit plus les casters : la page du match les nomme
    // (`docs/features/MATCH_CARD_LAYOUT.md`).
    expect(html).not.toContain("Voix");
  });

  it("ne dit plus l'hôte, la carte de départ ni l'arbitrage : la page du match les porte", () => {
    const html = render(
      lobby({ hostTeamId: 20, firstMap: "Ilios", refereeAssigned: true, selfManaged: false }),
    );
    expect(html).not.toContain("Équipe hôte");
    expect(html).not.toContain("Bravo");
    expect(html).not.toContain("Ilios");
    expect(html).not.toContain("Arbitre");
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

  it("ne propose pas de caster son propre match, ni un match qu'on caste déjà", () => {
    expect(card(lobby(), { canManage: true, castBlock: null, myTeamId: 10 })).not.toContain('data-action="claimCast"');
    expect(
      card(lobby({ casters: [matchCaster({ userId: 1, pseudo: "Moi" })] }), { canManage: true, castBlock: null }),
    ).not.toContain('data-action="claimCast"');
  });

  it("propose de co-caster un match déjà casté par un autre", () => {
    expect(
      card(lobby({ casters: [matchCaster({ userId: 5, pseudo: "Autre" })] }), { canManage: true, castBlock: null }),
    ).toContain('data-action="claimCast"');
  });

  it("donne au caster sa fenêtre de réglages, et à l'arbitrage le retrait d'un autre caster", () => {
    const mine = lobby({ casters: [matchCaster({ userId: 1, pseudo: "Moi" })] });
    // « Ne plus caster » a quitté la carte : il vit dans « Configurer ma
    // diffusion » (`docs/features/CAST_SETTINGS.md`).
    const own = card(mine, { viewerUserId: 1, canManage: true });
    expect(own).toContain("Configurer ma diffusion");
    expect(own).not.toContain('data-action="releaseCast"');
    expect(card(lobby({ casters: [matchCaster({ userId: 5, pseudo: "Autre" })] }), { canSchedule: true })).toContain(
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

/**
 * L'arbitrage, l'hôte, le premier ban, la carte de départ et les casters ont
 * quitté la carte (`docs/features/MATCH_CARD_LAYOUT.md`) : leur rendu se teste
 * sur la page du match (`match-page-render.test.tsx`). Reste ici ce que la
 * pastille de phase dit encore.
 */
describe("MatchLaunchStrip — décompte des « Prêt »", () => {
  it("MatchLaunchStrip_referee_isNotCountedInReadyTally", () => {
    // Le « Prêt » de l'arbitre désigné n'entre pas dans le décompte public
    // (décision 47) : deux équipes attendues, pas trois.
    const html = render(lobby({ refereeAssigned: true, refereeKey: "k-juge" }));

    expect(html).toContain(">0/2<");
  });
});
