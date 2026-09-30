import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchPlanningPanel } from "@/app/(secured)/tournois/[id]/_components/MatchPlanningPanel";
import { ToastProvider } from "@/components/ui/toast";
import type { TournamentDetail, TournamentState } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentDetail } from "../helpers/tournament-detail";

function detailOf(options: {
  enabled: boolean;
  state?: TournamentState;
  isAdmin?: boolean;
  matches?: TournamentDetail["matches"];
}): TournamentDetail {
  return tournamentDetail({
    card: tournamentCard({ id: 7, state: options.state ?? "RUNNING", refereeScheduling: options.enabled }),
    isAdmin: options.isAdmin ?? false,
    matches: options.matches ?? [],
  });
}

const render = (detail: TournamentDetail, frozen = false) =>
  renderToStaticMarkup(
    <ToastProvider>
      <MatchPlanningPanel detail={detail} onPlan={() => undefined} frozen={frozen} />
    </ToastProvider>,
  );

const toPlan = bracketMatch({ id: 1, status: "READY", team1Id: 1, team2Id: 2, team1Name: "Alpha", team2Name: "Bravo" });
const dated = bracketMatch({ id: 2, status: "READY", team1Id: 3, team2Id: 4, startAt: "2099-01-01T10:00:00.000Z" });

describe("MatchPlanningPanel — ce que tout le monde lit", () => {
  it("annonce la règle aux engagés quand l'option est allumée, sans aucun bouton", () => {
    const html = render(detailOf({ enabled: true, matches: [toPlan] }));
    expect(html).toContain("Matchs planifiés par l&#x27;arbitrage");
    expect(html).toContain("À planifier");
    expect(html).not.toContain("<button");
    // Le décompte ne sert qu'à ceux qui peuvent le résorber.
    expect(html).not.toContain("match à planifier");
  });

  it("ne rend rien à un joueur quand l'option est éteinte", () => {
    expect(render(detailOf({ enabled: false }))).not.toContain("<section");
  });
});

describe("MatchPlanningPanel — arbitrage", () => {
  it("compte les matchs à planifier et offre de planifier le prochain", () => {
    const html = render(detailOf({ enabled: true, isAdmin: true, matches: [dated, toPlan] }));
    expect(html).toContain("1 match à planifier");
    expect(html).toContain("Planifier le prochain match : Alpha contre Bravo");
    expect(html).toContain("Désactiver la planification");
    // Libellé d'action qui change : pas d'`aria-pressed`, qui dirait l'inverse.
    expect(html).not.toContain("aria-pressed");
  });

  it("dit quand tout est planifié", () => {
    const html = render(detailOf({ enabled: true, isAdmin: true, matches: [dated] }));
    expect(html).toContain("Tous les matchs jouables ont une date.");
    expect(html).not.toContain("Planifier le prochain");
  });

  it("offre l'activation quand l'option est éteinte, en cours comme avant le coup d'envoi", () => {
    for (const state of ["UPCOMING", "REGISTRATION", "RUNNING"] as const) {
      const html = render(detailOf({ enabled: false, isAdmin: true, state }));
      expect(html).toContain("Activer la planification");
    }
  });

  it("n'offre plus la bascule sur un tournoi terminé", () => {
    expect(render(detailOf({ enabled: false, isAdmin: true, state: "FINISHED" }))).not.toContain("<section");
    const html = render(detailOf({ enabled: true, isAdmin: true, state: "FINISHED" }));
    expect(html).not.toContain("Désactiver la planification");
  });

  it("retire toute action sur un plateau figé", () => {
    const html = render(detailOf({ enabled: true, isAdmin: true, matches: [toPlan] }), true);
    expect(html).not.toContain("<button");
  });
});
