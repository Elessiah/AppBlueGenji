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
  { layout: "app/(secured)/equipes/layout.tsx", provider: "components/i18n/team-errors-text-provider.tsx" },
  // Lot 9-2 : le profil pose ses textes et la table des refus d'équipe.
  { layout: "app/(secured)/profil/layout.tsx", provider: "components/i18n/profile-text-provider.tsx" },
  { layout: "app/(secured)/profil/layout.tsx", provider: "components/i18n/team-errors-text-provider.tsx" },
];

describe("fournisseur posé par une mise en page : sans le français", () => {
  it.each(LAYOUT_PROVIDERS)("$layout importe le fournisseur seul", ({ layout, provider }) => {
    const target = `@/${provider.replace(/\.tsx$/, "")}`;
    expect(importsOf(layout)).toContain(target);
    // Ni le module de textes (qui porte le JSON) ni un JSON directement.
    expect(importsOf(layout)).not.toContain(target.replace(/-provider$/, ""));
    expect(importsOf(layout).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
  });

  it.each(LAYOUT_PROVIDERS)("$provider n'importe que l'emplacement", ({ provider }) => {
    // Un `import type` s'efface à la compilation ; tout autre import de valeur
    // que la mécanique ramènerait un module de textes, et son JSON.
    const valueImports = source(provider)
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type "))
      .map((line) => /from\s+"([^"]+)"/.exec(line)?.[1]);
    expect(valueImports).toEqual(["./scoped-text-context"]);
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

describe("cartes des annuaires mémoïsées", () => {
  // La grille se rend à chaque frappe (recherche différée) ; une carte dont
  // l'équipe ou le joueur n'a pas changé de référence ne reformate rien.
  it("TeamCard et PlayerCard sont des composants `memo`", async () => {
    const { TeamCard } = await import("@/app/(secured)/equipes/cards/TeamCard");
    const { PlayerCard } = await import("@/app/(secured)/joueurs/cards/PlayerCard");
    const memoType = Symbol.for("react.memo");
    expect((TeamCard as unknown as { $$typeof: symbol }).$$typeof).toBe(memoType);
    expect((PlayerCard as unknown as { $$typeof: symbol }).$$typeof).toBe(memoType);
  });

  it("le bandeau et le podium aussi, libellés du bandeau gardés", async () => {
    const { Ticker } = await import("@/components/cyber/Ticker");
    const { HighlightStrip } = await import("@/app/(secured)/equipes/cards/HighlightStrip");
    const memoType = Symbol.for("react.memo");
    expect((Ticker as unknown as { $$typeof: symbol }).$$typeof).toBe(memoType);
    expect((HighlightStrip as unknown as { $$typeof: symbol }).$$typeof).toBe(memoType);
    for (const list of ["app/(secured)/equipes/TeamsList.tsx", "app/(secured)/joueurs/PlayersList.tsx"]) {
      expect(source(list)).toContain("<Ticker items={tickerItems} labels={tickerLabels} />");
      expect(source(list)).toMatch(/const tickerItems = useMemo\(/);
      expect(source(list)).toMatch(/const tickerLabels = useMemo\(/);
    }
  });

  it("refus d'équipe : le français du registre, une seule table", async () => {
    const { FR_TEAM_ERRORS_TEXT } = await import("@/app/(secured)/equipes/_lib/team-errors");
    const { useTeamErrorsText } = await import("@/components/i18n/team-errors-text");
    let seen: unknown;
    function Probe() {
      seen = useTeamErrorsText();
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(seen).toBe(FR_TEAM_ERRORS_TEXT);
  });
});
