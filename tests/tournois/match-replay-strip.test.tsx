import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchReplayStrip, canEditReplay } from "@/app/(secured)/tournois/[id]/_components/MatchReplayStrip";
import { LiveProvider } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

/**
 * Bandeau « Rediff disponible » sous un match terminé : visible de tous dès
 * qu'une rediff est posée sur une rencontre jouée, et bouton d'édition réservé
 * à la permission `live`.
 */

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const played = bracketMatch({
  id: 9,
  status: "COMPLETED",
  team1Id: 1,
  team2Id: 2,
  team1Name: "Dragons",
  team2Name: "Lions",
  team1Score: 3,
  team2Score: 1,
  winnerTeamId: 1,
  loserTeamId: 2,
});

function render(match: BracketMatch, canManage = false): string {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <LiveProvider
      canManage={canManage}
      canSchedule={false}
      refereeScheduling={false}
      openConfig={noop}
      openSchedule={noop}
      openReplay={noop}
      viewerUserId={null}
      myTeamId={null}
      castBlock="NOT_CASTER"
    >
      <MatchReplayStrip match={match} />
    </LiveProvider>,
  );
}

describe("MatchReplayStrip — spectateur", () => {
  it("annonce la rediff par un lien vers YouTube, dans un nouvel onglet", () => {
    const html = render({ ...played, replayUrl: VIDEO });

    expect(html).toContain("Rediff disponible");
    expect(html).toContain(`href="${VIDEO.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // Nom accessible commençant par le texte visible (WCAG 2.5.3).
    expect(html).toMatch(/aria-label="Rediff disponible — revoir Dragons contre Lions sur YouTube/);
    expect(html).not.toContain("Rediff</button>");
  });

  it("ne rend rien sans rediff", () => {
    expect(render(played)).toBe("");
  });

  it("ne rend rien sur un match rouvert, même avec un lien en base", () => {
    expect(render({ ...played, status: "READY", replayUrl: VIDEO })).toBe("");
  });
});

/**
 * L'édition de la rediff a rejoint le pied d'action de la carte
 * (`MatchCardActions`) : sa visibilité est `canEditReplay`, son libellé vient
 * de `matchCardActionList` — le bandeau, lui, n'est plus qu'un lien.
 */
describe("rediff — édition par la permission live", () => {
  it("offre l'ajout sur un match terminé sans rediff, et le bandeau reste muet", () => {
    expect(canEditReplay(played, true)).toBe(true);
    expect(render(played, true)).toBe("");
  });

  it("offre la modification d'une rediff posée, à côté du bandeau", () => {
    const withReplay = { ...played, replayUrl: VIDEO };
    expect(canEditReplay(withReplay, true)).toBe(true);
    expect(render(withReplay, true)).toContain("Rediff disponible");
    expect(render(withReplay, true)).not.toContain("<button");
  });

  it("garde l'édition sur un match rouvert qui porte encore un lien, pour le retirer", () => {
    expect(canEditReplay({ ...played, status: "READY", replayUrl: VIDEO }, true)).toBe(true);
  });

  it("ne l'offre pas sans la permission live", () => {
    expect(canEditReplay({ ...played, replayUrl: VIDEO }, false)).toBe(false);
  });

  it.each<[string, Partial<BracketMatch>]>([
    ["un match à venir", { status: "READY" }],
    ["une exemption", { team2Id: null }],
    ["un forfait", { forfeitTeamId: 2 }],
  ])("n'offre rien sur %s", (_label, overrides) => {
    expect(canEditReplay({ ...played, ...overrides }, true)).toBe(false);
    expect(render({ ...played, ...overrides }, true)).toBe("");
  });
});
