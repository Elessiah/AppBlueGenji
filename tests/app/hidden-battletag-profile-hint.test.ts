/**
 * La fiche d'un joueur ne lit jamais le BattleTag masqué d'un autre : la seule
 * fenêtre qui l'expose est « Contacts » d'un match. L'ancienne indication pour
 * un lecteur tiers (« tu le lis pour jouer ou arbitrer ») ne doit pas revenir.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("indication du BattleTag masqué sur la fiche", () => {
  it("n'est montrée qu'au titulaire", () => {
    const page = read("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain('data.isSelf && data.profile.overwatchBattletag && !data.profile.visibility.overwatch');
    expect(page).not.toContain("battletagHiddenOther");
  });

  it.each(["fr", "en"])("n'a plus de texte pour un lecteur tiers (%s)", (locale: string) => {
    const messages = JSON.parse(read(`messages/${locale}/players.json`)) as { page: Record<string, string> };
    expect(messages.page.battletagHiddenSelf).toEqual(expect.any(String));
    expect(messages.page).not.toHaveProperty("battletagHiddenOther");
  });

  it("getFullProfile ne garde plus de question de tournoi pour le BattleTag", () => {
    const source = read("lib/server/users/full-profile.ts");
    expect(source).not.toContain("targetInActiveTournament");
  });
});
