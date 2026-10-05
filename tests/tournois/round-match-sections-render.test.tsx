import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { RoundMatchSections } from "@/app/(secured)/tournois/[id]/_components/RoundMatchSections";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

const LAUNCHED = "2026-01-01T00:00:00Z";

function render(matches: BracketMatch[], seeds: Record<number, number> = {}): string {
  return renderToStaticMarkup(
    <EntrantProvider
      participantType="TEAM"
      soloUserIds={{}}
      logos={buildEntrantLogoMap([])}
      seeds={seeds}
    >
      <RoundMatchSections matches={matches}>
        {(list) => (
          <ol>
            {list.map((m) => (
              <li key={m.id}>{`m${m.id}`}</li>
            ))}
          </ol>
        )}
      </RoundMatchSections>
    </EntrantProvider>,
  );
}

describe("RoundMatchSections", () => {
  it("ouvre chaque section par un filet titré et nommé, sans volet", () => {
    const html = render([
      bracketMatch({ id: 1, status: "COMPLETED", team1Id: 1, team2Id: 2 }),
      bracketMatch({ id: 2, status: "READY", team1Id: 1, team2Id: 2, launchedAt: LAUNCHED }),
    ]);
    expect(html.indexOf("En cours")).toBeLessThan(html.indexOf("Terminé"));
    expect(html.match(/data-section=/g)).toHaveLength(2);
    expect(html).toContain(", 1 match");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-expanded");
  });

  it("ordonne une section par tête de série lue du contexte", () => {
    const html = render(
      [
        bracketMatch({ id: 1, status: "READY", team1Id: 3, team2Id: 4, launchedAt: LAUNCHED }),
        bracketMatch({ id: 2, status: "READY", team1Id: 1, team2Id: 2, launchedAt: LAUNCHED }),
      ],
      { 1: 4, 2: 1, 3: 2, 4: 3 },
    );
    expect(html.indexOf("m2")).toBeLessThan(html.indexOf("m1"));
  });

  it("ne rend aucune section sans match", () => {
    expect(render([])).not.toContain("data-section=");
  });
});
