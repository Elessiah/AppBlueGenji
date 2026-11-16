import { describe, expect, it } from "@jest/globals";
import {
  formatProfilelessLookup,
  parseProfilelessLookup,
  PROFILELESS_LOOKUP_MAX,
  PROFILELESS_NAME_MAX,
} from "@/lib/shared/profileless-lookup";

/** Une question de `max` comptes nommés. */
function players(count: number) {
  return { players: Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Joueur${index + 1}` })) };
}

/** D86 : seuls les comptes affichés partent, chacun avec le nom que la page montre. */
describe("parseProfilelessLookup", () => {
  it("parseProfilelessLookup_validPlayers_returnsEntries", () => {
    const body = { players: [{ id: 3, name: "Alpha" }, { id: 8, name: "Beta" }] };

    expect(parseProfilelessLookup(body)).toEqual([{ id: 3, name: "Alpha" }, { id: 8, name: "Beta" }]);
  });

  it("parseProfilelessLookup_duplicateId_keepsFirstNameInOrder", () => {
    const body = { players: [{ id: 8, name: "Beta" }, { id: 3, name: "Alpha" }, { id: 8, name: "Autre" }] };

    expect(parseProfilelessLookup(body)).toEqual([{ id: 8, name: "Beta" }, { id: 3, name: "Alpha" }]);
  });

  it("parseProfilelessLookup_nullBody_returnsNull", () => {
    expect(parseProfilelessLookup(null)).toBeNull();
  });

  it("parseProfilelessLookup_stringBody_returnsNull", () => {
    expect(parseProfilelessLookup("3,8")).toBeNull();
  });

  it("parseProfilelessLookup_playersNotArray_returnsNull", () => {
    expect(parseProfilelessLookup({ players: { id: 3, name: "Alpha" } })).toBeNull();
  });

  it("parseProfilelessLookup_emptyPlayers_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [] })).toBeNull();
  });

  it("parseProfilelessLookup_exactlyMax_returnsAll", () => {
    expect(parseProfilelessLookup(players(PROFILELESS_LOOKUP_MAX))).toHaveLength(PROFILELESS_LOOKUP_MAX);
  });

  it("parseProfilelessLookup_overMax_returnsNull", () => {
    expect(parseProfilelessLookup(players(PROFILELESS_LOOKUP_MAX + 1))).toBeNull();
  });

  it("parseProfilelessLookup_zeroId_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 0, name: "Alpha" }] })).toBeNull();
  });

  it("parseProfilelessLookup_negativeId_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: -1, name: "Alpha" }] })).toBeNull();
  });

  it("parseProfilelessLookup_fractionalId_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 1.5, name: "Alpha" }] })).toBeNull();
  });

  it("parseProfilelessLookup_stringId_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: "3", name: "Alpha" }] })).toBeNull();
  });

  it("parseProfilelessLookup_unsafeIntegerId_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 2 ** 53, name: "Alpha" }] })).toBeNull();
  });

  it("parseProfilelessLookup_entryNotObject_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [3] })).toBeNull();
  });

  it("parseProfilelessLookup_missingName_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 3 }] })).toBeNull();
  });

  it("parseProfilelessLookup_blankName_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 3, name: "   " }] })).toBeNull();
  });

  it("parseProfilelessLookup_nonStringName_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 3, name: 42 }] })).toBeNull();
  });

  it("parseProfilelessLookup_nameAtMax_accepted", () => {
    const name = "a".repeat(PROFILELESS_NAME_MAX);

    expect(parseProfilelessLookup({ players: [{ id: 3, name }] })).toEqual([{ id: 3, name }]);
  });

  it("parseProfilelessLookup_nameOverMax_returnsNull", () => {
    expect(parseProfilelessLookup({ players: [{ id: 3, name: "a".repeat(PROFILELESS_NAME_MAX + 1) }] })).toBeNull();
  });
});

describe("formatProfilelessLookup", () => {
  it("formatProfilelessLookup_entries_wrapsInPlayers", () => {
    expect(formatProfilelessLookup([{ id: 3, name: "Alpha" }])).toEqual({ players: [{ id: 3, name: "Alpha" }] });
  });
});
