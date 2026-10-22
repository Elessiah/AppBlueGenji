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
    expect(page).toContain('if (!data.isSelf || !data.profile.overwatchBattletag || data.profile.visibility.overwatch) return null;');
    expect(page).not.toContain("battletagHiddenOther");
  });

  it.each(["fr", "en"])("n'a plus de texte pour un lecteur tiers (%s)", (locale: string) => {
    const messages = JSON.parse(read(`messages/${locale}/players.json`)) as { page: Record<string, string> };
    expect(messages.page.battletagHiddenSelf).toEqual(expect.any(String));
    expect(messages.page.battletagHiddenSelfBadge).toEqual(expect.any(String));
    expect(messages.page).not.toHaveProperty("battletagHiddenOther");
  });

  it("getFullProfile ne garde plus de question de tournoi pour le BattleTag", () => {
    const source = read("lib/server/users/full-profile.ts");
    expect(source).not.toContain("targetInActiveTournament");
  });
});

describe("pastille BattleTag vérifié sur la fiche", () => {
  it("suit `battletagVerified`, jamais le tag affiché", () => {
    const page = read("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain("const battletagVerified = Boolean(data.profile.battletagVerified);");
    expect(page).not.toMatch(/overwatchBattletag\s*&&\s*(data\.profile\.)?battletagVerified/);
  });

  it("se dit au lecteur d'écran avec le champ, une seule fois", () => {
    const page = read("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain('"player-battletag-verified": battletagVerified,');
    expect(page).toContain("aria-describedby={battletagDescribedBy}");
    expect(page).toMatch(/<span id="player-battletag-verified" className="sr-only">\s*\{t\("page\.battletagVerifiedAlt"\)\}/);
    expect(page).toContain('labels={{ alt: "", title: t("page.battletagVerifiedTitle") }}');
  });

  it("ne parle de la pastille au titulaire que si elle est affichée", () => {
    const page = read("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain('return { status: text.t("page.battletagHiddenSelf"), badge: verified };');
    expect(page).toContain('{battletagHint.badge ? <p>{t("page.battletagHiddenSelfBadge")}</p> : null}');
  });

  it("garde la largeur du champ : la pastille est posée dedans", () => {
    const css = read("app/(secured)/joueurs/[id]/player.module.css");
    expect(css).toMatch(/\.taggedBadge \{[^}]*position: absolute;/);
    expect(css).not.toContain(".taggedInputField");
  });

  it.each(["fr", "en"])("a ses textes (%s)", (locale: string) => {
    const messages = JSON.parse(read(`messages/${locale}/players.json`)) as { page: Record<string, string> };
    expect(messages.page.battletagVerifiedAlt).toEqual(expect.any(String));
    expect(messages.page.battletagVerifiedTitle).toEqual(expect.any(String));
  });
});
