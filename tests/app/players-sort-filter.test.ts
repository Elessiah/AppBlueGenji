import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// Tri par date de création et filtre « sans équipe » de `/joueurs` : la logique
// vit dans le client component, on la lit au niveau source (comme annuaire-labels).
const playersList = read("app/(secured)/joueurs/PlayersList.tsx");
const frPlayers = JSON.parse(read("messages/fr/players.json")) as typeof import("@/messages/fr/players.json");
const enPlayers = JSON.parse(read("messages/en/players.json")) as typeof import("@/messages/fr/players.json");

describe("Annuaire joueurs — tri par date de création", () => {
  it("expose l'option « created » et trie les plus récents d'abord", () => {
    expect(playersList).toContain('type SortKey = "pseudo" | "tournaments" | "created";');
    expect(playersList).toContain('(["pseudo", "tournaments", "created"] as const)');
    expect(playersList).toContain('if (sort === "created") r.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));');
  });

  it("le libellé existe en français et en anglais", () => {
    expect(frPlayers.list.sort.created).toBe("Date de création");
    expect(enPlayers.list.sort.created).toBe("Creation date");
  });

  it("la réinitialisation de la liste suit le tri choisi", () => {
    expect(playersList).toContain("statusFilter, sort, showDeleted]");
  });
});

describe("Annuaire joueurs — filtre « sans équipe uniquement »", () => {
  it("ajoute le statut « unaffiliated » qui ne garde que les joueurs sans équipe", () => {
    expect(playersList).toContain('type StatusFilter = "all" | "free" | "unaffiliated";');
    expect(playersList).toContain('["all", "free", "unaffiliated"] as const');
    expect(playersList).toContain('if (statusFilter === "unaffiliated" && p.team) return false;');
  });

  it("ne dépend pas de l'ouverture au recrutement, contrairement à « free agents »", () => {
    const unaffiliatedLine = playersList.split("\n").find((line) => line.includes('"unaffiliated" && p.team'));
    expect(unaffiliatedLine).toBeDefined();
    expect(unaffiliatedLine).not.toContain("isFreeAgent");
  });

  it("le libellé existe en français et en anglais", () => {
    expect(frPlayers.list.statusFilter.unaffiliated).toBe("SANS ÉQUIPE");
    expect(enPlayers.list.statusFilter.unaffiliated).toBe("NO TEAM");
  });
});
