/**
 * Arbre final de BlueGenji Survie sur téléphone (`playoffGhostsShown`) et
 * explication des cases à pourvoir en tête de volet (`BracketSections`).
 */
import { describe, expect, it } from "@jest/globals";
import { playoffGhostsShown } from "@/app/(secured)/tournois/[id]/_lib/endurance-sections";
import type { BracketSlotRef } from "@/app/(secured)/tournois/[id]/_lib/bracket-sections";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";
import { readSource } from "../helpers/read-source";

const slot = (id: number, roundNumber: number): BracketSlotRef => ({ id, roundNumber, matchNumber: 1 });
const GHOSTS: readonly BracketSlotRef[] = [slot(-1, 102), slot(-2, 102), slot(-3, 103)];

describe("playoffGhostsShown", () => {
  it("largeur ordinaire : toutes les cases à pourvoir", () => {
    expect(playoffGhostsShown(GHOSTS, false)).toBe(GHOSTS);
  });

  it("téléphone : les seules cases du prochain tour", () => {
    expect(playoffGhostsShown(GHOSTS, true)).toEqual([slot(-1, 102), slot(-2, 102)]);
  });

  it("téléphone sans case à pourvoir : rien", () => {
    expect(playoffGhostsShown([], true)).toEqual([]);
  });
});

describe("EnduranceView : l'arbre n'annonce qu'un tour sur téléphone", () => {
  const view = readSource("app/(secured)/tournois/[id]/_components/EnduranceView.tsx");

  it("filtre les cases selon la largeur, l'arbre entier au rendu serveur", () => {
    expect(view).toContain("PLAYOFF_TREE_NARROW_QUERY = NARROW_LAYOUT_QUERY;");
    expect(view).toContain("useMediaMatch(PLAYOFF_TREE_NARROW_QUERY) === true");
    expect(view).toContain("playoffGhostsShown(playoffGhosts, narrowTree)");
    expect(view).toContain("ghostSlots={shownPlayoffGhosts}");
  });
});

describe("BracketSections : « Cases à pourvoir » derrière un « i »", () => {
  const sections = readSource("app/(secured)/tournois/[id]/_components/BracketSections.tsx");

  it("le volet qui porte des cases à pourvoir (petite finale comprise) les explique", () => {
    expect(sections).toContain("(sectionGhosts.length > 0 || (sectionThirdPlace !== null && !sectionThirdPlace.match))");
    expect(sections).toContain('<InfoHint id={`${panelId}-ghost-hint`} subject={text.t("bracket.ghostSlots")}>');
    expect(sections).toContain('<p>{text.t("bracket.ghostSlotsHint")}</p>');
  });

  it("textes en français et en anglais", () => {
    expect(frTournament.bracket.ghostSlots).toBe("Cases à pourvoir");
    expect(enTournament.bracket.ghostSlots).toBe("Slots to be filled");
    expect(frTournament.bracket.ghostSlotsHint).toContain("dès que le tour précédent est joué");
    expect(enTournament.bracket.ghostSlotsHint).toContain("as soon as the previous round is played");
  });
});
