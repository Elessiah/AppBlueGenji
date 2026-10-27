/**
 * Page d'un match (`docs/features/MATCH_PAGE.md`) : 404 quand le match n'est
 * pas du tournoi ou que le tournoi n'est pas visible pour le lecteur (règle de
 * la fiche), encart du lien partagé — seules la base et la session sont simulées.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let mockLocale: "fr" | "en" = "fr";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/tournaments-service", () => ({ getVisibleTournamentCard: jest.fn() }));
jest.mock("@/lib/server/database", () => ({ withConnection: jest.fn() }));
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { getMatchPagePosition, matchPageExists, matchPageMetadata } from "@/lib/server/match-page";
import MemberLayout, { generateMetadata as memberMetadata } from "@/app/(secured)/tournois/[id]/matchs/[matchId]/layout";
import SpectatorLayout, { generateMetadata as spectatorMetadata } from "@/app/suivre/tournois/[id]/matchs/[matchId]/layout";
import { connectionMock, fakeConnection } from "../helpers/sql-double";
import { authUser } from "../helpers/auth-user";
import { tournamentCard } from "../helpers/tournament-card";
import { isMigratedRoute } from "@/lib/shared/locales";

const connection = connectionMock();
const card = jest.mocked(getVisibleTournamentCard);
const user = jest.mocked(getCurrentUser);

/** Le match 34 est la manche 2, match 3 du tournoi 12 ; tout autre couple est absent. */
function seedPosition() {
  connection.query.mockImplementation(async (_sql, params) => {
    const [matchId, tournamentId] = params as number[];
    return [matchId === 34 && tournamentId === 12 ? [{ round_number: 2, match_number: 3 }] : []];
  });
}

const params = (id: string, matchId: string) => ({ params: Promise.resolve({ id, matchId }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = "fr";
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
  seedPosition();
  card.mockResolvedValue(tournamentCard({ id: 12, name: "Coupe d'hiver" }));
  user.mockResolvedValue(null);
});

describe("getMatchPagePosition", () => {
  it("lit la manche et le numéro par clé primaire, dans ce tournoi seulement", async () => {
    await expect(getMatchPagePosition(12, 34)).resolves.toEqual({ roundNumber: 2, matchNumber: 3 });
    expect(connection.query).toHaveBeenCalledWith(
      "SELECT round_number, match_number FROM bg_matches WHERE id = ? AND tournament_id = ? LIMIT 1",
      [34, 12],
    );
    await expect(getMatchPagePosition(13, 34)).resolves.toBeNull();
  });
});

describe("matchPageExists", () => {
  it("vrai pour un match du tournoi visible", async () => {
    await expect(matchPageExists("12", "34", { canManage: false })).resolves.toBe(true);
    expect(card).toHaveBeenCalledWith(12, { canManage: false });
  });

  it("faux pour un match d'un autre tournoi, un tournoi invisible (non publié) ou des identifiants invalides", async () => {
    await expect(matchPageExists("12", "35", { canManage: false })).resolves.toBe(false);
    card.mockResolvedValueOnce(null);
    await expect(matchPageExists("12", "34", { canManage: false })).resolves.toBe(false);
    for (const [tid, mid] of [["0", "34"], ["12", "-1"], ["abc", "34"], ["12", "1.5"]]) {
      await expect(matchPageExists(tid, mid, { canManage: true })).resolves.toBe(false);
    }
  });

  it("une base injoignable n'est pas un 404", async () => {
    card.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(matchPageExists("12", "34", { canManage: false })).resolves.toBe("unavailable");
    connection.query.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(matchPageExists("12", "34", { canManage: false })).resolves.toBe("unavailable");
  });
});

describe("mise en page connectée", () => {
  it("404 pour un membre quand le match n'est pas du tournoi, ou le tournoi pas visible", async () => {
    user.mockResolvedValue(authUser({ id: 7 }));
    await expect(MemberLayout({ children: "page", ...params("12", "35") })).rejects.toThrow("NEXT_NOT_FOUND");
    card.mockResolvedValueOnce(null);
    await expect(MemberLayout({ children: "page", ...params("12", "34") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it("rend la page d'un match existant, avec les droits du staff pour un administrateur", async () => {
    user.mockResolvedValue(authUser({ id: 7, isAdmin: true }));
    await expect(MemberLayout({ children: "page", ...params("12", "34") })).resolves.toBe("page");
    expect(card).toHaveBeenCalledWith(12, { canManage: true });
  });

  it("base injoignable : la page s'affiche et dira son erreur ; sans session, rien n'est lu", async () => {
    user.mockResolvedValue(authUser({ id: 7 }));
    card.mockRejectedValueOnce(new Error("down"));
    await expect(MemberLayout({ children: "page", ...params("12", "34") })).resolves.toBe("page");
    user.mockResolvedValue(null);
    card.mockClear();
    await expect(MemberLayout({ children: "page", ...params("12", "35") })).resolves.toBe("page");
    expect(card).not.toHaveBeenCalled();
  });
});

describe("mise en page sans compte", () => {
  it("404 pour un visiteur quand le match n'existe pas ou que le tournoi n'est pas publié", async () => {
    await expect(SpectatorLayout({ children: "page", ...params("12", "35") })).rejects.toThrow("NEXT_NOT_FOUND");
    card.mockResolvedValueOnce(null);
    await expect(SpectatorLayout({ children: "page", ...params("12", "34") })).rejects.toThrow("NEXT_NOT_FOUND");
    // Sans compte, jamais les droits du staff.
    expect(card).toHaveBeenCalledWith(12, { canManage: false });
  });

  it("rend la page d'un match publié ; un membre connecté est renvoyé plus haut (fiche sans compte)", async () => {
    await expect(SpectatorLayout({ children: "page", ...params("12", "34") })).resolves.toBe("page");
    user.mockResolvedValue(authUser({ id: 7 }));
    card.mockClear();
    await expect(SpectatorLayout({ children: "page", ...params("12", "35") })).resolves.toBe("page");
    expect(card).not.toHaveBeenCalled();
  });
});

describe("encart du lien partagé", () => {
  it("préfixe le titre du tournoi par la manche et le match, adresse canonique sur la page du match", async () => {
    user.mockResolvedValue(authUser({ id: 7 }));
    const metadata = await memberMetadata(params("12", "34"));
    expect(metadata.title).toEqual({ absolute: expect.stringMatching(/^Manche 2 · Match 3 — .*Coupe d'hiver/) });
    expect(metadata.alternates?.canonical).toBe("/tournois/12/matchs/34");
    expect((metadata.openGraph as { title?: string }).title).toMatch(/^Manche 2 · Match 3 — /);
  });

  it("sous /en, en anglais ; sans compte, page sans compte et noindex", async () => {
    mockLocale = "en";
    const metadata = await spectatorMetadata(params("12", "34"));
    expect(metadata.title).toEqual({ absolute: expect.stringMatching(/^Round 2 · Match 3 — /) });
    expect(metadata.alternates?.canonical).toBe("/en/suivre/tournois/12/matchs/34");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("match introuvable ou base en panne : l'encart du tournoi, sans préfixe", async () => {
    const missing = await matchPageMetadata("12", "35", true, async () => ({ canManage: false }));
    expect(missing.title).toEqual({ absolute: expect.not.stringMatching(/^Manche/) });
    expect(missing.alternates?.canonical).toBe("/suivre/tournois/12/matchs/35");
    connection.query.mockRejectedValueOnce(new Error("down"));
    const down = await matchPageMetadata("12", "34", true, async () => ({ canManage: false }));
    expect(down.title).toEqual({ absolute: expect.not.stringMatching(/^Manche/) });
  });

  it("tournoi invisible, droits refusés ou identifiant de match invalide : l'encart du site", async () => {
    card.mockResolvedValueOnce(null);
    expect((await matchPageMetadata("12", "34", false, async () => ({ canManage: false }))).alternates).toBeUndefined();
    expect((await matchPageMetadata("12", "34", false, async () => null)).alternates).toBeUndefined();
    const failing = await matchPageMetadata("12", "34", false, async () => {
      throw new Error("session");
    });
    expect(failing.alternates).toBeUndefined();
    const badMatch = await matchPageMetadata("12", "x", false, async () => ({ canManage: false }));
    expect(badMatch.alternates?.canonical).toBe("/tournois/12");
    expect(connection.query).not.toHaveBeenCalledWith(expect.anything(), ["x", 12]);
  });
});

describe("version anglaise", () => {
  it("les deux pages de match sont servies sous /en, identifiants entiers seulement", () => {
    expect(isMigratedRoute("/tournois/12/matchs/34")).toBe(true);
    expect(isMigratedRoute("/suivre/tournois/12/matchs/34")).toBe(true);
    expect(isMigratedRoute("/tournois/12/matchs/abc")).toBe(false);
    expect(isMigratedRoute("/tournois/12/matchs")).toBe(false);
  });
});
