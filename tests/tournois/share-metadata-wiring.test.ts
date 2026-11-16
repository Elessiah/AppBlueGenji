import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/server/auth");
// La fiche est traduite (lot 8a-2) : sa mise en page lit la langue de la
// requête. Le français ici ; l'anglais dans `tournament-page-i18n.test.tsx`.
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => "fr" }));
jest.mock("@/lib/server/tournaments-service");

import { generateMetadata } from "@/app/(secured)/tournois/[id]/layout";
import { tournamentPageMetadata, type TournamentShareLoader } from "@/lib/server/tournament-metadata";
import { tournamentShareVersion, type ShareLeader } from "@/lib/shared/share-embeds";
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
const EMBED_IMAGE = read("lib", "server", "embed-share-image.tsx");
const SPECTATOR_LAYOUT = read("app", "suivre", "tournois", "[id]", "layout.tsx");
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

const params = (id: string) => ({ params: Promise.resolve({ id }) });

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
    // La page d'un match suit la même porte, vers sa page sans compte.
    expect(SECURED_LAYOUT).toContain(
      "redirect(localeHref(`${spectatorPath}${forwardedSearch(requestHeaders.get(SEARCH_HEADER))}`, await requestLocale()));",
    );
    expect(SECURED_LAYOUT).toContain("const pathname = requestHeaders.get(PATHNAME_HEADER);");
    expect(SECURED_LAYOUT).toContain("if (tournamentId !== null) spectatorPath = spectatorTournamentPath(tournamentId);");
    expect(SECURED_LAYOUT).toContain(
      "else if (matchPage !== null) spectatorPath = matchPagePath(matchPage.tournamentId, matchPage.matchId, true);",
    );
  });

  it("ne rend pas les enfants sans session : rien du contenu protégé ne fuit", () => {
    const guard = SECURED_LAYOUT.slice(
      SECURED_LAYOUT.indexOf("if (!user)"),
      SECURED_LAYOUT.indexOf("<SiteShell"),
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

    const meta = await generateMetadata(params("42"));

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

    await generateMetadata(params("42"));

    expect(mockedCard).toHaveBeenCalledWith(42, { canManage: true });
  });

  it("passe un membre sans permission comme un lecteur sans droits", async () => {
    mockedUser.mockResolvedValue(user());
    mockedCard.mockResolvedValue(null);

    await generateMetadata(params("42"));

    expect(mockedCard).toHaveBeenCalledWith(42, { canManage: false });
  });

  it("ne lit pas la carte pour un visiteur sans session : il est redirigé vers /suivre", async () => {
    mockedUser.mockResolvedValue(null);

    const meta = await generateMetadata(params("42"));

    expect(mockedCard).not.toHaveBeenCalled();
    expect(meta.title).toBe("Tournoi");
  });

  it("retombe sur l'encart du site quand le tournoi n'est pas lisible", async () => {
    mockedUser.mockResolvedValue(user());
    mockedCard.mockResolvedValue(null);

    const meta = await generateMetadata(params("42"));

    // Pas d'« accès refusé » : ce serait confirmer l'existence qu'on protège.
    expect(meta.title).toBe("Tournoi");
    // Posé en entier : sinon la carte générique de `/tournois` descendrait ici.
    expect(meta.openGraph).toMatchObject({ title: "BlueGenji Esport" });
    // L'image du site est posée : un `openGraph` de page remplace celui de la racine.
    expect(meta.openGraph).toMatchObject({ images: [{ url: "/og/fr/home.png", width: 1200, height: 630 }] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "BlueGenji Esport" });
    expect(meta.twitter).toMatchObject({ images: [{ url: "/og/fr/home.png" }] });
  });

  it("n'interroge même pas la base sur un identifiant qui n'en est pas un", async () => {
    const meta = await generateMetadata(params("../secrets"));

    expect(mockedCard).not.toHaveBeenCalled();
    expect(meta.title).toBe("Tournoi");
  });

  it("survit à une base injoignable : la fiche affichera son propre message", async () => {
    mockedUser.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(generateMetadata(params("42"))).resolves.toMatchObject({
      title: "Tournoi",
    });
  });
});

describe("route d'image d'un tournoi", () => {
  it("n'a plus d'`opengraph-image` par fiche : l'image vit sous `/og/<langue>/…` (SHARE_EMBEDS.md)", () => {
    expect(existsSync(join(ROOT, ...TOURNAMENT_DIR, "opengraph-image.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "app", "suivre", "tournois", "[id]", "opengraph-image.tsx"))).toBe(false);
  });

  it("ne lit que la réponse publique, n'ayant aucune mise en page au-dessus", () => {
    expect(EMBED_IMAGE).toContain("publicTournamentShareForRequest(target.tournamentId)");
    expect(EMBED_IMAGE).not.toContain("getTournamentDetail");
  });

  it("retombe sur la carte neutre du site plutôt que de rendre une erreur", () => {
    expect(EMBED_IMAGE).toContain(".catch(() => null)");
    expect(EMBED_IMAGE).toContain("if (!view) return neutralImage(locale);");
  });

  it("garde un cache de cinq minutes", () => {
    expect(EMBED_IMAGE).toContain('"public, max-age=300"');
  });

  it("lit le logo sur le disque, jamais par une requête réseau", () => {
    expect(EMBED_IMAGE).toContain("await shareCardLogo()");
    expect(EMBED_IMAGE).not.toMatch(/\bfetch\(/);
  });

  it("annonce la taille attendue d'un aperçu Open Graph", () => {
    expect(EMBED_IMAGE).toContain("...SHARE_CARD_SIZE");
  });
});

describe("empreinte `?v=` de l'image d'un tournoi", () => {
  const LEADER: ShareLeader = { kind: "LEADER", side: { teamId: 3, name: "Bravo", logoUrl: null, solo: false } };

  it("tournamentPageMetadata_copyMatchesCard_versionFromCardAndLeader", async () => {
    const running = card({ state: "RUNNING", registeredTeams: 9 });
    const loadShare: TournamentShareLoader = async () => ({ card: running, share: { leader: LEADER, matches: new Map() } });

    const meta = await tournamentPageMetadata("42", (id) => `/suivre/tournois/${id}`, async () => ({ canManage: false }), async () => running, loadShare);

    expect(meta.openGraph).toMatchObject({
      images: [{ url: `/og/fr/tournament-42.png?v=${tournamentShareVersion(running, LEADER)}` }],
    });
  });

  it("tournamentPageMetadata_copyFromBeforeRename_leaderIgnoredWindowVersion", async () => {
    const renamed = card({ state: "RUNNING", name: "Cup B" });
    const oldCopy = card({ state: "RUNNING", name: "Cup A" });
    const loadShare: TournamentShareLoader = async () => ({ card: oldCopy, share: { leader: LEADER, matches: new Map() } });

    const meta = await tournamentPageMetadata("42", (id) => `/suivre/tournois/${id}`, async () => ({ canManage: false }), async () => renamed, loadShare);
    const image = (meta.openGraph as { images: { url: string; alt: string }[] }).images[0];

    expect(image.url.startsWith(`/og/fr/tournament-42.png?v=${tournamentShareVersion(renamed, null)}.`)).toBe(true);
    expect(image.alt).toBe("Aperçu du tournoi Cup B");
  });

  it("tournamentPageMetadata_shareUnavailable_versionFromPageCard", async () => {
    const meta = await tournamentPageMetadata("42", (id) => `/suivre/tournois/${id}`, async () => ({ canManage: false }), async () => card(), async () => null);

    expect(meta.openGraph).toMatchObject({
      images: [{ url: `/og/fr/tournament-42.png?v=${tournamentShareVersion(card(), null)}`, alt: "Aperçu du tournoi OW Open Cup" }],
    });
  });

  it("tournamentPageMetadata_runningWithoutCopy_versionOfTheWindow", async () => {
    const running = card({ state: "RUNNING" });

    const meta = await tournamentPageMetadata("42", (id) => `/suivre/tournois/${id}`, async () => ({ canManage: false }), async () => running, async () => null);
    const url = (meta.openGraph as { images: { url: string }[] }).images[0].url;

    expect(url.startsWith(`/og/fr/tournament-42.png?v=${tournamentShareVersion(running, null)}.`)).toBe(true);
  });

  it("la page sans compte ne reconstruit jamais la réponse publique pour un robot", () => {
    expect(SPECTATOR_LAYOUT).not.toContain("publicTournamentShareForRequest");
  });

  it("la carte neutre n'est jamais gardée par un robot (refus passager possible)", () => {
    expect(EMBED_IMAGE).toContain('NEUTRAL_CARD_CACHE_CONTROL = "no-store"');
  });
});
