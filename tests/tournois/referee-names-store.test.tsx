import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveProvider, useRefereeNameOf, useViewerRefereesMatch } from "@/app/(secured)/tournois/[id]/_lib/live-context";
import type { BracketMatch, MatchRefereeName } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";
import { readSource } from "../helpers/read-source";

/**
 * Pseudos d'arbitre hors du contexte des contrôles (EF-60) : chaque carte lit
 * sa propre valeur dans un petit magasin (`useSyncExternalStore`), si bien
 * qu'une relecture des pseudos ne redessine que les cartes dont la réponse change.
 */

function Probe({ match }: Readonly<{ match: BracketMatch }>) {
  const name = useRefereeNameOf(match);
  const mine = useViewerRefereesMatch(match);
  return <b>{`${name ?? "Arbitre désigné"}|${mine ? "moi" : "autre"}`}</b>;
}

function render(match: BracketMatch, refereeNames?: MatchRefereeName[]) {
  return renderToStaticMarkup(
    <LiveProvider
      canManage={false}
      canSchedule={false}
      refereeScheduling={false}
      launchPhase
      openConfig={() => undefined}
      openSchedule={() => undefined}
      openReplay={() => undefined}
      viewerUserId={1}
      myTeamId={null}
      castBlock="NOT_CASTER"
      refereeNames={refereeNames}
    >
      <Probe match={match} />
    </LiveProvider>,
  );
}

const SHOWN = bracketMatch({ id: 5, status: "READY", refereeKey: "k5", refereeAssigned: true });

describe("magasin des pseudos d'arbitre", () => {
  it("useRefereeNameOf_namedDesignation_returnsPseudo", () => {
    expect(render(SHOWN, [{ matchId: 5, refereeKey: "k5", pseudo: "Juge" }])).toContain("Juge|autre");
  });

  it("useRefereeNameOf_noNamesProvided_readsDesignatedReferee", () => {
    expect(render(SHOWN)).toContain("Arbitre désigné|autre");
  });

  it("useRefereeNameOf_staleKey_readsDesignatedReferee", () => {
    expect(render(SHOWN, [{ matchId: 5, refereeKey: "ancien", pseudo: "Juge" }])).toContain("Arbitre désigné|autre");
  });

  it("useViewerRefereesMatch_mineEntryWithoutPseudo_recognisesViewer", () => {
    expect(render(SHOWN, [{ matchId: 5, refereeKey: "k5", pseudo: "", mine: true }])).toContain("Arbitre désigné|moi");
  });

  it("LiveProvider_namesChange_pushedToStoreNotControlsContext", () => {
    const source = readSource("app/(secured)/tournois/[id]/_lib/live-context.tsx");

    expect(source).toContain("useIsomorphicLayoutEffect(() => store.set(refereeNames), [store, refereeNames]);");
    expect(source).toMatch(/useSyncExternalStore\(store\.subscribe/);
    expect(source.slice(source.indexOf("type LiveControls"), source.indexOf("const NO_REFEREE_NAMES"))).not.toContain("refereeNames");
  });
});
