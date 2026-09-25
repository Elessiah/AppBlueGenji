import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentProgress } from "@/app/(secured)/tournois/[id]/_components/TournamentProgress";
import { tournamentCard } from "../helpers/tournament-card";
import { tournamentDetail } from "../helpers/tournament-detail";

/**
 * La frise de la fiche lit le vainqueur et le déroulement **sur la carte** de
 * l'instantané : la liste et la fiche ne peuvent pas se contredire.
 */

const PAST = "2026-01-01T10:00:00.000Z";

function finished(champion: { teamId: number; name: string } | null) {
  return tournamentDetail({
    card: tournamentCard({
      state: "FINISHED",
      startVisibilityAt: PAST,
      registrationOpenAt: PAST,
      registrationCloseAt: PAST,
      startAt: PAST,
      champion,
    }),
    // Deux premiers ex æquo : la frise nommait la première trouvée.
    registrations: [
      { teamId: 1, teamName: "Alpha", logoUrl: null, seed: 1, registeredAt: PAST, finalRank: 1 },
      { teamId: 2, teamName: "Beta", logoUrl: null, seed: 2, registeredAt: PAST, finalRank: 1 },
    ],
  });
}

describe("TournamentProgress — vainqueur", () => {
  it("nomme le vainqueur de la carte", () => {
    const markup = renderToStaticMarkup(
      <TournamentProgress detail={finished({ teamId: 2, name: "Beta" })} />,
    );
    expect(markup).toContain("Vainqueur");
    expect(markup).toContain("Beta");
  });

  it("ne choisit pas entre deux premiers ex æquo, comme la liste", () => {
    const markup = renderToStaticMarkup(<TournamentProgress detail={finished(null)} />);
    expect(markup).not.toContain("Vainqueur");
    expect(markup).not.toContain("Alpha");
    expect(markup).toContain("Le tournoi est clos.");
  });
});

describe("TournamentProgress — déroulement", () => {
  it("se règle sur l'avancement porté par la carte", () => {
    const running = (runningProgress: number | null) =>
      renderToStaticMarkup(
        <TournamentProgress
          detail={tournamentDetail({
            card: tournamentCard({
              state: "RUNNING",
              startVisibilityAt: PAST,
              registrationOpenAt: PAST,
              registrationCloseAt: PAST,
              startAt: PAST,
              runningProgress,
            }),
          })}
        />,
      );
    // Sans matchs dans le détail, seule la carte peut faire avancer la barre.
    expect(running(0.5)).not.toBe(running(null));
  });
});
