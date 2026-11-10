/**
 * Petite finale de BlueGenji Survie : une carte **sous la finale**, dans le
 * volet « Phase finale » — case à pourvoir puis rencontre posée
 * (`docs/features/ENDURANCE_ROUND_PANELS.md`).
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/tournois/1",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { BracketSections } from "@/app/(secured)/tournois/[id]/_components/BracketSections";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import {
  endurancePlayoffGhostSlots,
  endurancePlayoffLinks,
  endurancePlayoffRoundCount,
  endurancePlayoffThirdPlaceSlot,
  PLAYOFF_ROUND_OFFSET,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-sections";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { projectPlayoffGhostEntrants } from "@/lib/shared/bg-survie/playoffs";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";
import "@/tests/helpers/lazy-tournament-texts";

const QUARTERS = PLAYOFF_ROUND_OFFSET;
const SEMIS = PLAYOFF_ROUND_OFFSET + 1;
const FINAL = PLAYOFF_ROUND_OFFSET + 2;

/** Un tour de `count` rencontres prêtes, équipes nommées « M<match> haut / bas ». */
function round(roundNumber: number, count: number): BracketMatch[] {
  return Array.from({ length: count }, (_, index) =>
    bracketMatch({
      id: roundNumber * 10 + index,
      roundNumber,
      matchNumber: index + 1,
      status: "READY",
      team1Id: roundNumber * 100 + index * 2,
      team2Id: roundNumber * 100 + index * 2 + 1,
      team1Name: `M${index + 1} haut`,
      team2Name: `M${index + 1} bas`,
    }),
  );
}

function render(locale: "fr" | "en", ui: ReactElement): string {
  const tree = (
    <ToastProvider>
      <EntrantProvider participantType="TEAM" soloUserIds={{}} logos={buildEntrantLogoMap([])}>
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

/** L'arbre final tel qu'`EnduranceView` le câble, depuis les seules rencontres. */
function playoffTree(decisive: BracketMatch[], thirdPlace: BracketMatch[] = [], locale: "fr" | "en" = "fr"): string {
  const ghosts = endurancePlayoffGhostSlots(decisive);
  const ghostEntrants = projectPlayoffGhostEntrants(decisive, ghosts);
  const links = endurancePlayoffLinks(decisive, ghosts);
  return render(
    locale,
    <BracketSections
      bracketType="UPPER"
      bracketLabel="Play-offs"
      showBracketLabel={false}
      matches={decisive}
      ghostSlots={ghosts}
      ghostEntrants={ghostEntrants}
      thirdPlace={endurancePlayoffThirdPlaceSlot(decisive, thirdPlace, ghosts, ghostEntrants)}
      allTournamentMatches={[...decisive, ...thirdPlace]}
      myTeamId={null}
      adminResolvable={() => false}
      onOpenAdminModal={() => undefined}
      format="BG_SURVIE"
      resolveNextMatchId={(slot) => links.get(slot.id) ?? null}
      plannedRounds={endurancePlayoffRoundCount(decisive)}
    />,
  );
}

describe("petite finale sous la finale", () => {
  it("annonce une case vide « Petite Finale » sous la « Grande Finale » dès les quarts", () => {
    const html = playoffTree(round(QUARTERS, 4));

    expect(html).toContain("Grande Finale");
    expect(html).toContain("Petite Finale");
    expect(html.indexOf("Grande Finale")).toBeLessThan(html.indexOf("Petite Finale"));
    expect(html).not.toContain("Finale 1");
    // Quatre quarts, deux demies, la finale et la petite finale.
    expect(html).toContain("8 matchs");
  });

  it("nomme les deux cartes en anglais sous /en", () => {
    const html = playoffTree(round(QUARTERS, 4), [], "en");

    expect(html).toContain("Grand final");
    expect(html).toContain("Third-place match");
    expect(html).toContain("8 matches");
  });

  it("montre la battue d'une demi-finale close dans la case à pourvoir", () => {
    const [semi1, semi2] = round(SEMIS, 2);
    const closed: BracketMatch = { ...semi1, status: "COMPLETED", winnerTeamId: semi1.team1Id, team1Score: 3, team2Score: 1 };
    const html = playoffTree([closed, semi2]);

    const thirdPlace = html.slice(html.indexOf("Petite Finale"));
    expect(thirdPlace).toContain("M1 bas");
    expect(thirdPlace).toContain(`href="/equipes/${semi1.team2Id}`);
    expect(thirdPlace).not.toContain("M1 haut");
    // Deux demies, la finale et la petite finale.
    expect(html).toContain("4 matchs");
  });

  it("rend la rencontre posée comme une vraie carte, avec son ancre, et garde le compte", () => {
    const posted = bracketMatch({
      id: 990,
      bracket: "THIRD_PLACE",
      roundNumber: FINAL,
      matchNumber: 2,
      status: "READY",
      team1Id: 501,
      team2Id: 502,
      team1Name: "Battue A",
      team2Name: "Battue B",
    });
    const html = playoffTree([...round(SEMIS, 2), ...round(FINAL, 1)], [posted]);

    const thirdPlace = html.slice(html.indexOf("Petite Finale"));
    expect(thirdPlace).toContain(`id="${matchAnchorId(990)}"`);
    expect(thirdPlace).toContain("Battue A");
    expect(thirdPlace).toContain("Battue B");
    expect(html).toContain("4 matchs");
  });

  it("laisse la finale à son libellé d'origine sans petite finale à montrer", () => {
    // Trois quarts : une demi-finale sera une exemption, donc pas de battue.
    const html = playoffTree(round(QUARTERS, 3));

    expect(html).toContain("Finale 1");
    expect(html).not.toContain("Grande Finale");
    expect(html).not.toContain("Petite Finale");
  });
});
