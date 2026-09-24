import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchLaunchStrip } from "@/app/(secured)/tournois/[id]/_components/MatchLaunchStrip";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import { ToastProvider } from "@/components/ui/toast";
import type { CastBlock } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Bandeau de lancement d'une carte de match : ce qu'il dit à tous, et quel
 * bouton il offre à qui.
 */

type Viewer = {
  canManage?: boolean;
  canSchedule?: boolean;
  viewerUserId?: number | null;
  myTeamId?: number | null;
  castBlock?: CastBlock | null;
};

function render(match: BracketMatch, viewer: Viewer = {}) {
  return renderToStaticMarkup(
    <ToastProvider>
      <LiveProvider
        canManage={viewer.canManage ?? false}
        canSchedule={viewer.canSchedule ?? false}
        openConfig={() => undefined}
        openSchedule={() => undefined}
        openReplay={() => undefined}
        viewerUserId={viewer.viewerUserId ?? 1}
        myTeamId={viewer.myTeamId ?? null}
        castBlock={viewer.castBlock === undefined ? "NOT_CASTER" : viewer.castBlock}
      >
        <MatchLaunchStrip match={match} />
      </LiveProvider>
    </ToastProvider>,
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

describe("MatchLaunchStrip — boutons selon le lecteur", () => {
  it("offre l'ouverture de la modale aux joueurs du match, pas aux autres", () => {
    expect(render(lobby(), { myTeamId: 10 })).toContain("Ouvrir le lancement");
    expect(render(lobby(), { myTeamId: 99 })).not.toContain("Ouvrir le lancement");
  });

  it("offre « Caster » à un caster, même sans identité vérifiée — le bouton dit ce qui manque", () => {
    const blocked = render(lobby(), { canManage: true, castBlock: "CASTER_IDENTITY_REQUIRED" });
    expect(blocked).toContain("🎙 Caster");
    expect(blocked).toContain('aria-disabled="true"');
    expect(blocked).toContain("Battle.net");

    const allowed = render(lobby(), { canManage: true, castBlock: null });
    expect(allowed).toContain('aria-disabled="false"');
  });

  it("ne propose pas de caster son propre match ni un match déjà casté", () => {
    expect(render(lobby(), { canManage: true, castBlock: null, myTeamId: 10 })).not.toContain("🎙 Caster");
    expect(render(lobby({ casterUserId: 5, casterPseudo: "Autre" }), { canManage: true, castBlock: null })).not.toContain(
      "🎙 Caster",
    );
  });

  it("laisse le caster se retirer, et l'arbitrage retirer un caster", () => {
    const mine = lobby({ casterUserId: 1, casterPseudo: "Moi" });
    expect(render(mine, { viewerUserId: 1 })).toContain("Ne plus caster");
    expect(render(lobby({ casterUserId: 5, casterPseudo: "Autre" }), { canSchedule: true })).toContain(
      "Retirer caster",
    );
  });

  it("donne à l'arbitrage le changement d'hôte et le lancement forcé", () => {
    const html = render(lobby(), { canSchedule: true });
    expect(html).toContain("⇄ Hôte");
    expect(html).toContain("▶ Forcer");
    const player = render(lobby(), { myTeamId: 10 });
    expect(player).not.toContain("⇄ Hôte");
    expect(player).not.toContain("▶ Forcer");
  });

  it("ne propose plus de forcer un match déjà lancé", () => {
    expect(render(lobby({ launchedAt: "2026-09-24T20:00:00.000Z" }), { canSchedule: true })).not.toContain(
      "▶ Forcer",
    );
  });
});
