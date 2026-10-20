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
];

/** Les modules de textes (qui portent le JSON français) : jamais importés par une mise en page ni par les portes. */
const TEXT_MODULES = ["@/components/i18n/team-page-text", "@/components/i18n/players-text", "@/components/i18n/team-errors-text", "@/lib/shared/stats-text"];

describe("fournisseur posé par une mise en page : sans le français", () => {
  it.each(LAYOUT_PROVIDERS)("$layout passe par la porte de l'anglais, sans texte", ({ layout }) => {
    // Revue performance du lot 9-2 : le fournisseur est posé par `english-gates.tsx`
    // (anglais au chargement complet seulement, morceau à part sinon).
    expect(importsOf(layout)).toContain("@/components/i18n/english-gates");
    for (const text of TEXT_MODULES.filter((spec) => spec !== "@/lib/shared/stats-text")) expect(importsOf(layout)).not.toContain(text);
    expect(importsOf(layout).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
  });

  it("english-gates.tsx : les fournisseurs seuls, ni texte ni JSON", () => {
    const gates = "components/i18n/english-gates.tsx";
    const values = source(gates)
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type "))
      .map((line) => /from\s+"([^"]+)"/.exec(line)?.[1] ?? "");
    for (const provider of LAYOUT_PROVIDERS) expect(values).toContain(`./${provider.provider.split("/").pop()!.replace(/\.tsx$/, "")}`);
    for (const text of TEXT_MODULES) expect(values).not.toContain(text.replace("@/components/i18n/", "./"));
    expect(values.filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
  });

  it.each(LAYOUT_PROVIDERS)("$provider n'importe que l'emplacement", ({ provider }) => {
    // Un `import type` s'efface à la compilation ; tout autre import de valeur
    // que la mécanique ramènerait un module de textes, et son JSON.
    const valueImports = source(provider)
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type "))
      .map((line) => /from\s+"([^"]+)"/.exec(line)?.[1]);
    // La mécanique, et le chargeur partagé de l'anglais qu'il amorce (revue de performance du lot 9-2) — modules sans texte.
    expect(valueImports.every((spec) => /(^|\/)(scoped-text-context|english-loaders|english-loaders-account)$/.test(spec ?? ""))).toBe(true);
    expect(valueImports.some((spec) => /scoped-text-context$/.test(spec ?? ""))).toBe(true);
  });
});

describe("profil : fournisseurs sans français, anglais une seule fois", () => {
  const PROVIDERS = [
    "components/i18n/profile-text-provider.tsx",
    "components/i18n/team-errors-text-provider.tsx",
    "components/notifications/push-text-provider.tsx",
  ];

  it("la mise en page n'importe que les fournisseurs, sans texte", () => {
    const layout = "app/(secured)/profil/layout.tsx";
    expect(importsOf(layout)).toContain("@/components/i18n/profile-text-providers");
    expect(importsOf(layout).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
  });

  it("ProfileTextProviders : aucun JSON, anglais par les chargeurs partagés", () => {
    const module = "components/i18n/profile-text-providers.tsx";
    expect(importsOf(module).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
    for (const provider of PROVIDERS) {
      const name = provider.split("/").pop()!.replace(/\.tsx$/, "");
      expect(importsOf(module).some((spec) => spec.endsWith(name))).toBe(true);
    }
    // Chaque espace pour soi : un échec n'emporte pas les deux autres en français.
    for (const loader of ["englishProfile", "englishTeamErrors", "englishPush"]) {
      expect(source(module)).toContain(`useEnglishMessagesAt(locale, ${loader}, messages?.`);
    }
    // Au pied de chaque page, le module des chargeurs reste sans crochet ni préchargement.
    expect(source("components/i18n/english-loaders.ts")).not.toMatch(/useState|useEffect|quietPreload/);
    // Les chargeurs : aucun JSON importé d'office, un `import()` par espace ; au pied de
    // chaque page (`english-loaders.ts`), seuls ceux des écrans publics.
    const loaders = "components/i18n/english-loaders.ts";
    const account = "components/i18n/english-loaders-account.ts";
    const dynamic = (path: string) => [...source(path).matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const path of [loaders, account]) expect(importsOf(path).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
    expect(dynamic(loaders)).toEqual(["@/messages/en/reports.json", "@/messages/en/imageCrop.json"]);
    // `profile` dans son module (la fenêtre des conditions, chaque page, le précharge seul), réexporté : une instance.
    expect(dynamic("components/i18n/english-loader-profile.ts")).toEqual(["@/messages/en/profile.json"]);
    expect(importsOf("components/i18n/english-loader-profile.ts").filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
    expect(source(account)).toContain('export { englishProfile } from "./english-loader-profile";');
    expect(dynamic(account)).toEqual([
      "@/messages/en/teamErrors.json",
      "@/messages/en/push.json",
      "@/messages/en/teams.json",
      "@/messages/en/team.json",
      "@/messages/en/players.json",
      "./stats-panel-en",
    ]);
    // Rien sur le serveur : un module y est partagé entre requêtes.
    expect(source(loaders)).toContain("if (inBrowser() && locale === \"en\" && messages) loader.prime(messages);");
  });

  it("la page d'un signalement : mise en page sans texte", () => {
    const layout = "app/(secured)/signalements/[id]/layout.tsx";
    expect(importsOf(layout)).toContain("@/components/reports/concerned-reports-text");
    expect(importsOf(layout).filter((spec) => spec.startsWith("@/messages/"))).toEqual([]);
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
