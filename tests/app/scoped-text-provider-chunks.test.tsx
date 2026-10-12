/**
 * Lot 9-1, revue performance — une mise en page serveur qui pose un
 * fournisseur de textes n'embarque pas le français du paquet : il est déjà
 * dans le morceau de la page, et webpack ne met pas en commun un module plus
 * petit que son seuil (le JSON partait deux fois au navigateur).
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createScopedTextContext, createScopedTextSlot, withFrenchFallback } from "@/components/i18n/scoped-text-context";
import { TeamPageTextProvider } from "@/components/i18n/team-page-text-provider";
import { FR_TEAM_PAGE_TEXT, useTeamPageText } from "@/components/i18n/team-page-text";
import { PlayersTextProvider } from "@/components/i18n/players-text-provider";
import { FR_PLAYERS_TEXT, usePlayersText } from "@/components/i18n/players-text";
import enTeam from "@/messages/en/team.json";
import enPlayers from "@/messages/en/players.json";

const ROOT = join(__dirname, "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");
const importsOf = (path: string) => [...source(path).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

const LAYOUT_PROVIDERS = [
  { layout: "app/(secured)/equipes/[id]/layout.tsx", provider: "components/i18n/team-page-text-provider.tsx" },
  { layout: "app/(secured)/joueurs/layout.tsx", provider: "components/i18n/players-text-provider.tsx" },
];

describe("fournisseur posé par une mise en page : sans le français", () => {
  it.each(LAYOUT_PROVIDERS)("$layout importe le fournisseur seul", ({ layout, provider }) => {
    const target = `@/${provider.replace(/\.tsx$/, "")}`;
    expect(importsOf(layout)).toContain(target);
    expect(importsOf(layout).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
  });

  it.each(LAYOUT_PROVIDERS)("$provider n'importe aucun message", ({ provider }) => {
    const text = source(provider);
    expect(importsOf(provider).filter((spec) => spec.includes("messages/"))).toEqual([]);
    // Un `import type` du module de textes s'efface à la compilation ; un
    // import de valeur y ramènerait le JSON.
    for (const line of text.split("\n").filter((l) => /from\s+"\.\/(team-page|players)-text"/.test(l))) {
      expect(line).toMatch(/^import type /);
    }
  });
});

function TeamProbe() {
  return <>{useTeamPageText().t("meta.fallbackTitle")}</>;
}
function PlayersProbe() {
  return <>{usePlayersText().t("meta.title")}</>;
}

describe("emplacement et repli français", () => {
  it("sans fournisseur : le français", () => {
    expect(renderToStaticMarkup(<TeamProbe />)).toBe(FR_TEAM_PAGE_TEXT.t("meta.fallbackTitle"));
    expect(renderToStaticMarkup(<PlayersProbe />)).toBe(FR_PLAYERS_TEXT.t("meta.title"));
  });

  it("fournisseur français sans messages : le français", () => {
    expect(
      renderToStaticMarkup(
        <TeamPageTextProvider locale="fr">
          <TeamProbe />
        </TeamPageTextProvider>,
      ),
    ).toBe(FR_TEAM_PAGE_TEXT.t("meta.fallbackTitle"));
  });

  it("fournisseur anglais : l'anglais", () => {
    expect(
      renderToStaticMarkup(
        <TeamPageTextProvider locale="en" messages={enTeam}>
          <PlayersTextProvider locale="en" messages={enPlayers}>
            <TeamProbe /> / <PlayersProbe />
          </PlayersTextProvider>
        </TeamPageTextProvider>,
      ),
    ).toBe(`${enTeam.meta.fallbackTitle} / ${enPlayers.meta.title}`);
  });

  it("deux emplacements ne se mélangent pas", () => {
    const a = withFrenchFallback(createScopedTextSlot<{ k: string }>(), { k: "A" });
    const b = createScopedTextContext<{ k: string }>({ k: "B" });
    function Probe() {
      return (
        <>
          {a.useText().t("k")}
          {b.useText().t("k")}
        </>
      );
    }
    expect(
      renderToStaticMarkup(
        <a.Provider locale="en" messages={{ k: "a" }}>
          <Probe />
        </a.Provider>,
      ),
    ).toBe("aB");
  });
});
