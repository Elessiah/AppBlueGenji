/**
 * EF-16 (ERREUR.txt) : chargement et coût de rendu de la liste `/tournois` —
 * droit staff lu par le serveur, index de visibilité, anneau des pastilles,
 * sélecteur `:has()` borné, squelette interne réduit aux cartes.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthUser } from "@/lib/server/auth";
import { readSource } from "../helpers/read-source";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => "fr" }));
jest.mock("@/components/i18n/locale-navigation", () => ({ LocaleLink: () => null }));
jest.mock("@/app/(secured)/tournois/TournamentsList", () => ({
  __esModule: true,
  default: ({ canManage }: { canManage: boolean }) => <span data-can-manage={String(canManage)} />,
}));

import TournamentsPage from "@/app/(secured)/tournois/page";
import { SecuredLoadingView } from "@/app/(secured)/_shared/SecuredLoadingView";
import { getCurrentUser } from "@/lib/server/auth";

const user = (overrides: Partial<AuthUser>) => ({ id: 4, isAdmin: false, roles: [], ...overrides }) as AuthUser;

async function canManageFor(current: AuthUser | null): Promise<string | null> {
  jest.mocked(getCurrentUser).mockResolvedValue(current);
  const html = renderToStaticMarkup(await TournamentsPage());
  return /data-can-manage="(true|false)"/.exec(html)?.[1] ?? null;
}

describe("page /tournois — droit staff lu sur le serveur", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("un administrateur peut gérer les tournois", async () => {
    expect(await canManageFor(user({ isAdmin: true }))).toBe("true");
  });

  it("un arbitre (permission `tournaments`) peut gérer les tournois", async () => {
    expect(await canManageFor(user({ roles: ["ARBITRE"] }))).toBe("true");
  });

  it("un joueur ne le peut pas", async () => {
    expect(await canManageFor(user({}))).toBe("false");
  });

  it("un rôle d'un autre domaine (community manager) ne le peut pas non plus", async () => {
    expect(await canManageFor(user({ roles: ["COMMUNITY_MANAGER"] }))).toBe("false");
  });

  it("sans session, rien à gérer", async () => {
    expect(await canManageFor(null)).toBe("false");
  });
});

describe("squelette de chargement", () => {
  it("à la navigation, dessine la barre de titre et les cartes", () => {
    const html = renderToStaticMarkup(<SecuredLoadingView label="Chargement" />);
    expect(html).toContain("Chargement");
    // Une barre de titre, une ligne, trois cartes.
    expect(html.match(/<div class="[^"]*"/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("dans la page, qui a déjà son titre : les cartes seules, un seul `role=status`", () => {
    const full = renderToStaticMarkup(<SecuredLoadingView label="Chargement" />);
    const cardsOnly = renderToStaticMarkup(<SecuredLoadingView label="Chargement" cardsOnly />);
    expect(cardsOnly.match(/<div/g)?.length).toBe((full.match(/<div/g)?.length ?? 0) - 2);
    expect(cardsOnly.match(/role="status"/g)).toHaveLength(1);
    expect(cardsOnly).toContain("Chargement");
  });
});

describe("feuilles de style", () => {
  const css = readSource("app/(secured)/tournois/tournois.module.css");

  it("la pastille pulsée anime un anneau en `transform` et `opacity`, jamais `box-shadow`", () => {
    const keyframes = /@keyframes pulseRing \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? "";
    expect(keyframes).toContain("transform: scale(");
    expect(keyframes).toContain("opacity:");
    expect(keyframes).not.toContain("box-shadow");
    expect(css).not.toContain("@keyframes pulseBlue");
    expect(css).not.toContain("@keyframes pulsePink");
    expect(css).not.toMatch(/animation: pulse(Blue|Pink)/);
  });

  it("l'anneau respecte l'état d'animation décoratif et couvre les deux pastilles", () => {
    expect(css).toMatch(/\.cardRibbonRunning \.dot::after,\s*\.cardRibbonOpen \.dot::after \{[^}]*animation: pulseRing 1\.6s infinite;[^}]*animation-play-state: var\(--deco-anim-state\);/);
  });

  it("la pastille « en cours » reste bleue, celle des inscriptions rose", () => {
    expect(css).toMatch(/\.cardRibbonRunning \.dot \{\s*background: var\(--blue-300\);/);
    expect(css).toMatch(/\.cardRibbonOpen \.dot \{\s*background: var\(--pink-400\);/);
  });

  it("la colonne élargie ne dépend plus d'un `:has()` descendant sur la racine de chaque page", () => {
    const globals = readSource("app/globals.css");
    expect(globals).toContain(".page-shell:has(> .page-wide) {");
    expect(globals).not.toMatch(/\.page-shell:has\(\.page-wide\)/);
  });
});

describe("index de visibilité des tournois", () => {
  it("se pose dans le CREATE TABLE (base neuve) et dans l'ALTER tolérant (base existante)", () => {
    const create = readSource("lib/server/database/schema/tournaments.ts");
    const recent = readSource("lib/server/database/recent-schema-changes.ts");
    expect(create).toContain("INDEX idx_bg_tournaments_start_visibility (start_visibility_at),");
    expect(recent).toContain(
      "`ALTER TABLE bg_tournaments ADD INDEX idx_bg_tournaments_start_visibility (start_visibility_at)`",
    );
  });
});

describe("relecture de la liste", () => {
  const list = readSource("app/(secured)/tournois/TournamentsList.tsx");

  it("revalide la liste avec son empreinte plutôt que de la contourner", () => {
    // Revalidation par défaut ; seuls les invisibles (non publiés) passent en
    // `no-store`, une seule lecture.
    expect(list).toContain('cache: "no-cache" | "no-store" = "no-cache",');
    expect(list).toContain("fetch(url, { cache, signal })");
    expect(list.match(/fetchBuckets\([^)]*"no-store"\)/g)).toHaveLength(1);
    expect(list).toContain('fetchBuckets("/api/tournaments?scope=hidden", signal, "no-store")');
  });

  it("n'arme l'archive qu'après la première liste et tant qu'il en faut", () => {
    expect(list).toContain(
      "const wantFinishedArchive = listFetched && needsFinishedArchive(deferredQuery, gameFilter, finishedExpanded);",
    );
    expect(list).not.toContain("setWantFinishedArchive");
  });
});
