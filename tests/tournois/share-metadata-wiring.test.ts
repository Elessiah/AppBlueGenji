import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/server/auth");
// La fiche est traduite (lot 8a-2) : sa mise en page lit la langue de la
// requête. Le français ici ; l'anglais dans `tournament-page-i18n.test.tsx`.
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => "fr" }));
jest.mock("@/lib/server/tournaments-service");

import { generateMetadata } from "@/app/(secured)/tournois/[id]/layout";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import type { AuthUser } from "@/lib/server/auth";
import type { TournamentCard } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";
import { authUser } from "../helpers/auth-user";

/**
 * L'aperçu d'un lien de tournoi, du côté du câblage.
 *
 * La rédaction est testée à part (`tests/lib/shared/share-metadata.test.ts`).
 * Ce qui se vérifie ici, ce sont les trois jonctions qui, si elles lâchent,
 * font échouer la fonctionnalité en silence — le lien mènerait simplement à un
 * encart générique, sans erreur nulle part :
 *
 * 1. la garde de l'espace sécurisé ne redirige plus (sans quoi aucun `<head>`
 *    n'est jamais servi à un robot d'aperçu) ;
 * 2. la fiche passe par la porte de visibilité — sa lecture légère, la carte
 *    seule, et non l'instantané entier ;
 * 3. la route d'image, servie **hors** des mises en page, refait ce contrôle
 *    pour son compte.
 */

const ROOT = join(__dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const TOURNAMENT_DIR = ["app", "(secured)", "tournois", "[id]"];
const SECURED_LAYOUT = read("app", "(secured)", "layout.tsx");
const AUTH_GATE = read("app", "(secured)", "_shared", "AuthGate.tsx");
const OG_ROUTE = read(...TOURNAMENT_DIR, "opengraph-image.tsx");
const AUTH = read("lib", "server", "auth.ts");

const mockedUser = jest.mocked(getCurrentUser);
const mockedCard = jest.mocked(getVisibleTournamentCard);

function card(overrides: Partial<TournamentCard> = {}): TournamentCard {
  return tournamentCard({
    id: 42,
    name: "OW Open Cup",
    description: null,
    format: "SINGLE",
    game: "OW",
    participantType: "TEAM",
    maxTeams: 16,
    registeredTeams: 5,
    state: "REGISTRATION",
    startVisibilityAt: "2026-08-01T10:00:00.000Z",
    registrationOpenAt: "2026-08-05T10:00:00.000Z",
    registrationCloseAt: "2026-08-20T18:00:00.000Z",
    startAt: "2026-08-25T18:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    liveUrl: null,
    ...overrides,
  });
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return authUser({ id: 7, pseudo: "Nova", ...overrides });
}

const params = (id: string) => ({ params: Promise.resolve({ id }), children: null });

afterEach(() => {
  jest.resetAllMocks();
});

describe("garde de l'espace sécurisé", () => {
  it("rend une carte au lieu de rediriger : un 307 vers /connexion n'a pas de <head>", () => {
    expect(SECURED_LAYOUT).toContain("getCurrentUser");
    expect(SECURED_LAYOUT).toContain("<AuthGate text={authGate} />");
    expect(SECURED_LAYOUT).not.toMatch(/redirect\([^)]*connexion/);
  });

  it("ne redirige que la fiche d'un tournoi, vers sa page sans compte qui porte le même encart", () => {
    // Seule redirection de la garde : la page d'arrivée a son propre <head>
    // (`app/suivre/tournois/[id]/layout.tsx`), le robot d'aperçu y voit le tournoi.
    expect(SECURED_LAYOUT.match(/redirect\(/g)).toHaveLength(1);
    expect(SECURED_LAYOUT).toContain(
      "redirect(localeHref(`${spectatorTournamentPath(tournamentId)}${redirectSearch(requestHeaders)}`, await requestLocale()));",
    );
    expect(SECURED_LAYOUT).toContain("tournamentIdFromMemberPath(requestHeaders.get(PATHNAME_HEADER))");
  });

  it("ne rend pas les enfants sans session : rien du contenu protégé ne fuit", () => {
    const guard = SECURED_LAYOUT.slice(
      SECURED_LAYOUT.indexOf("if (!user)"),
      SECURED_LAYOUT.indexOf("<ArenaShell"),
    );
    expect(guard).not.toContain("{children}");
  });

  it("conserve la destination, que la page de connexion sait relire", () => {
    expect(AUTH_GATE).toContain("usePathname()");
    expect(AUTH_GATE).toContain("/connexion?redirect=");
    expect(AUTH_GATE).toContain("encodeURIComponent(destination)");
  });

  it("déclare le noindex que le 307 assurait de lui-même", () => {
    expect(SECURED_LAYOUT).toContain("robots: { index: false, follow: false }");
  });

  it("retire `requireCurrentUser`, dont c'était l'unique appelant", () => {
    // Une fonction qui redirige vers /connexion ne décrirait plus le site.
    expect(AUTH).not.toContain("requireCurrentUser");
  });
});

describe("generateMetadata de la fiche", () => {
  it("rédige l'encart depuis la carte visible", async () => {
    mockedUser.mockResolvedValue(user());
    mockedCard.mockResolvedValue(card());

    const meta = await generateMetadata(params("42") as never);

    expect(meta.title).toEqual({ absolute: "OW Open Cup · Overwatch" });
    expect(meta.openGraph?.title).toBe("OW Open Cup · Overwatch");
    expect(meta.openGraph?.url).toBe("/tournois/42");
    // `twitter` est une union dont seule une branche porte `card`.
    expect((meta.twitter as { card?: string } | null | undefined)?.card).toBe("summary_large_image");
    expect(String(meta.description)).toContain("Inscriptions ouvertes");
  });

  it("passe la permission `tournaments` du lecteur à la porte de visibilité", async () => {
    mockedUser.mockResolvedValue(user({ isAdmin: true }));
    mockedCard.mockResolvedValue(card());

    await generateMetadata(params("42") as never);

    expect(mockedCard).toHaveBeenCalledWith(42, { canManage: true });
  });

  it("passe un membre sans permission comme un lecteur sans droits", async () => {
    mockedUser.mockResolvedValue(user());
    mockedCard.mockResolvedValue(null);

    await generateMetadata(params("42") as never);

    expect(mockedCard).toHaveBeenCalledWith(42, { canManage: false });
  });

  it("ne lit pas la carte pour un visiteur sans session : il est redirigé vers /suivre", async () => {
    mockedUser.mockResolvedValue(null);

    const meta = await generateMetadata(params("42") as never);

    expect(mockedCard).not.toHaveBeenCalled();
    expect(meta.title).toBe("Tournoi");
  });

  it("retombe sur l'encart du site quand le tournoi n'est pas lisible", async () => {
    mockedUser.mockResolvedValue(user());
    mockedCard.mockResolvedValue(null);

    const meta = await generateMetadata(params("42") as never);

    // Pas d'« accès refusé » : ce serait confirmer l'existence qu'on protège.
    expect(meta.title).toBe("Tournoi");
    // Posé en entier : sinon la carte générique de `/tournois` descendrait ici.
    expect(meta.openGraph).toMatchObject({ title: "BlueGenji Esport" });
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "BlueGenji Esport" });
    expect(meta.twitter).not.toHaveProperty("images");
  });

  it("n'interroge même pas la base sur un identifiant qui n'en est pas un", async () => {
    const meta = await generateMetadata(params("../secrets") as never);

    expect(mockedCard).not.toHaveBeenCalled();
    expect(meta.title).toBe("Tournoi");
  });

  it("survit à une base injoignable : la fiche affichera son propre message", async () => {
    mockedUser.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(generateMetadata(params("42") as never)).resolves.toMatchObject({
      title: "Tournoi",
    });
  });
});

describe("route d'image d'un tournoi", () => {
  it("refait le contrôle de visibilité, n'ayant aucune mise en page au-dessus", () => {
    expect(OG_ROUTE).toContain("getVisibleTournamentCard(tournamentId)");
  });

  it("retombe sur la carte du site plutôt que de rendre une erreur", () => {
    // Une image d'erreur ferait un encart cassé ; une 404 laisserait Discord
    // afficher un encart sans image.
    expect(OG_ROUTE).toContain("catch(() => null)");
    expect(OG_ROUTE).toContain("if (!card)");
    expect(OG_ROUTE).toContain("<ShareCard {...SITE_SHARE_CARD} logoSrc={logoSrc} />");
  });

  it("garde la même revalidation de cinq minutes", () => {
    expect(OG_ROUTE).toContain("export const revalidate = 300");
  });

  it("lit le logo sur le disque, jamais par une requête réseau", () => {
    expect(OG_ROUTE).toContain("await shareCardLogo()");
    expect(OG_ROUTE).not.toMatch(/\bfetch\(/);
  });

  it("annonce la taille attendue d'un aperçu Open Graph", () => {
    expect(OG_ROUTE).toContain("export const size = SHARE_CARD_SIZE");
    expect(OG_ROUTE).toContain("export const contentType = SHARE_CARD_CONTENT_TYPE");
  });
});
