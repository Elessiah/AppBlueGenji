import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { GhostMatchCard } from "@/app/(secured)/tournois/[id]/_components/GhostMatchCard";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";

function render(props: Parameters<typeof GhostMatchCard>[0]): string {
  return renderToStaticMarkup(
    <EntrantProvider participantType="TEAM" soloUserIds={{}} logos={buildEntrantLogoMap([])}>
      <GhostMatchCard {...props} />
    </EntrantProvider>,
  );
}

describe("GhostMatchCard", () => {
  it("shows TBD on both sides without a known winner", () => {
    const html = render({});
    expect(html.match(/TBD/g)).toHaveLength(2);
    expect(html).not.toContain("href=");
  });

  it("shows a known winner as a team link and keeps TBD for the other side", () => {
    const html = render({ topTeamId: 42, topTeamName: "MS | Karasuno" });
    expect(html).toContain("MS | Karasuno");
    expect(html).toContain('href="/equipes/42');
    expect(html.match(/TBD/g)).toHaveLength(1);
  });

  it("shows both winners when both are known", () => {
    const html = render({ topTeamId: 1, topTeamName: "Alpha", bottomTeamId: 2, bottomTeamName: "Beta" });
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).not.toContain("TBD");
  });
});
