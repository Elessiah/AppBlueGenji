import {
  parseGetiPost,
  type GetiDivision,
  type GetiParsedPost,
  type GetiRank,
  type GetiRankRange,
  type GetiRawPost,
  type GetiTier,
} from "@/lib/shared/geti";

/** Identifiants factices (aucun compte réel). */
export const GETI_FAKE_AUTHOR_ID = "100000000000000001";
export const GETI_FAKE_OTHER_ID = "100000000000000002";
export const GETI_FAKE_BOT_ID = "100000000000000090";

/** Message d'un joueur, avec son texte pour seul contenu utile. */
export function getiRawPost(content: string, overrides: Partial<GetiRawPost> = {}): GetiRawPost {
  return {
    content,
    author: { id: GETI_FAKE_AUTHOR_ID, username: "fauxjoueur", discriminator: "0", bot: false },
    ...overrides,
  };
}

/** Relais d'un bot : le texte est dans la description de l'encart. */
export function getiRelayPost(description: string, authorName: string | null = "fauxpseudo"): GetiRawPost {
  return {
    content: "",
    author: { id: GETI_FAKE_BOT_ID, username: "FauxBot", discriminator: "0", bot: true },
    embeds: [{ authorName, description }],
  };
}

/** Annonce analysée à partir de son seul texte. */
export function parseGetiText(content: string): GetiParsedPost {
  return parseGetiPost(getiRawPost(content));
}

export function getiRank(tier: GetiTier, division: GetiDivision): GetiRank {
  return { tier, division };
}

export function getiRange(min: GetiRank, max: GetiRank = min): GetiRankRange {
  return { min, max };
}

/** Annonce analysée complète, vide par défaut : chaque test ne dit que ce qu'il éprouve. */
export function parsedGetiPost(overrides: Partial<GetiParsedPost> = {}): GetiParsedPost {
  return {
    category: "lft",
    authorTag: "fauxjoueur",
    authorId: GETI_FAKE_AUTHOR_ID,
    relayed: false,
    originServer: null,
    text: "",
    ranks: { min: null, max: null, byRole: {} },
    roles: [],
    subRoles: [],
    regions: [],
    platforms: [],
    languages: [],
    availability: { days: [], times: [], timezone: null },
    dates: [],
    levels: [],
    closed: false,
    teamName: null,
    staffRoles: [],
    minAge: null,
    postedAt: null,
    edited: false,
    ...overrides,
  };
}
