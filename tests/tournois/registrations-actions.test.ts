import { describe, expect, it } from "@jest/globals";

import { registrationActionsColumn, removalNotice } from "@/app/(secured)/tournois/[id]/_lib/registrations-list";

describe("removalNotice", () => {
  it("rien à dire quand le retrait est ouvert", () => {
    expect(removalNotice(null, null)).toBeNull();
    expect(removalNotice(null, "FINISHED")).toBeNull();
  });

  it("se tait sur un tournoi terminé, que le verrou de l'ordre annonce déjà", () => {
    expect(removalNotice("ENTRANT_REMOVAL_TOURNAMENT_FINISHED", "FINISHED")).toBeNull();
  });

  it("parle quand elle apprend quelque chose", () => {
    expect(removalNotice("ENTRANT_REMOVAL_TOURNAMENT_STARTED", null)).toBe("ENTRANT_REMOVAL_TOURNAMENT_STARTED");
    expect(removalNotice("ENTRANT_REMOVAL_TOURNAMENT_STARTED", "SCORES_ENTERED")).toBe(
      "ENTRANT_REMOVAL_TOURNAMENT_STARTED",
    );
    expect(removalNotice("ENTRANT_REMOVAL_TOURNAMENT_FINISHED", "SCORES_ENTERED")).toBe(
      "ENTRANT_REMOVAL_TOURNAMENT_FINISHED",
    );
  });
});

describe("registrationActionsColumn", () => {
  it.each<[boolean, boolean, ReturnType<typeof registrationActionsColumn>]>([
    [true, true, { grid: "reorderable", label: "Actions" }],
    [true, false, { grid: "reorderable", label: "Ordre" }],
    [false, true, { grid: "withActions", label: "Retrait" }],
    [false, false, { grid: null, label: "Retrait" }],
  ])("réordonnable=%p, retirable=%p", (reorderable, removable, expected) => {
    expect(registrationActionsColumn(reorderable, removable)).toEqual(expected);
  });
});
