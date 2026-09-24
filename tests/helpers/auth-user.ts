import type { AuthUser } from "@/lib/server/auth";
import { emptyDeepStats } from "@/lib/shared/stats";
import type { FullProfileResponse, PublicUserProfile } from "@/lib/shared/types";

/**
 * Un `AuthUser` **complet** — ce que rend `getCurrentUser()` —, surchargé champ
 * par champ.
 *
 * Les tests de route l'écrivaient `{ id: 1, isAdmin: true } as AuthUser`, et
 * leurs mocks le passaient en `as never` : un champ ajouté au type ne se voyait
 * dans aucun. Les rôles suivent `isAdmin` comme dans `resolveRoles` (le rôle
 * `ADMIN` dérive du drapeau) tant que le test ne les donne pas lui-même.
 */
export function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const isAdmin = overrides.isAdmin ?? false;
  return {
    id: 1,
    pseudo: "Joueur",
    avatarUrl: null,
    discordId: null,
    googleSub: null,
    isAdult: true,
    isAdmin,
    roles: isAdmin ? ["ADMIN"] : [],
    ...overrides,
  };
}

/** Un `PublicUserProfile` complet : profil public, tout visible. */
export function publicUserProfile(overrides: Partial<PublicUserProfile> = {}): PublicUserProfile {
  return {
    id: 1,
    pseudo: "Joueur",
    avatarUrl: null,
    overwatchBattletag: null,
    marvelRivalsTag: null,
    isAdult: true,
    visibility: { avatar: true, overwatch: true, marvel: true, major: true, discord: false },
    openToRecruitment: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Une `FullProfileResponse` complète — la fiche de `getFullProfile`. Le profil
 * se surcharge champ par champ, comme par `publicUserProfile()`.
 */
export function fullProfileResponse(
  overrides: Partial<Omit<FullProfileResponse, "profile">> & {
    profile?: Partial<PublicUserProfile>;
  } = {},
): FullProfileResponse {
  const { profile, ...rest } = overrides;
  return {
    profile: publicUserProfile(profile),
    stats: emptyDeepStats(new Date("2026-01-01T00:00:00.000Z")),
    teamsTimeline: [],
    tournaments: [],
    isSelf: true,
    isAdmin: false,
    roles: [],
    displayRoles: [],
    viewerIsAdmin: false,
    ...rest,
  };
}
