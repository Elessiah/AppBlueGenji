export const RECRUITMENT_GAMES = ["OW2", "MR", "ANY"] as const;
export type RecruitmentGame = (typeof RECRUITMENT_GAMES)[number];

export const RECRUITMENT_GAME_LABELS: Record<RecruitmentGame, string> = {
  OW2: "Overwatch 2",
  MR: "Marvel Rivals",
  ANY: "Tous jeux",
};

/**
 * Mode de mise en avant d'une annonce urgente :
 * - `NONE` : annonce visible uniquement sur la page recrutement.
 * - `BANNER` : banderole discrète affichée en haut du site.
 * - `MODAL` : fenêtre modale affichée à l'arrivée du visiteur.
 */
export const RECRUITMENT_HIGHLIGHTS = ["NONE", "BANNER", "MODAL"] as const;
export type RecruitmentHighlight = (typeof RECRUITMENT_HIGHLIGHTS)[number];

export const RECRUITMENT_HIGHLIGHT_LABELS: Record<RecruitmentHighlight, string> = {
  NONE: "Aucune (page uniquement)",
  BANNER: "Banderole discrète",
  MODAL: "Modale à l'arrivée",
};

export type RecruitmentAd = {
  id: number;
  title: string;
  teamName: string | null;
  game: RecruitmentGame;
  roles: string | null;
  body: string | null;
  contactUrl: string | null;
  highlight: RecruitmentHighlight;
  active: boolean;
};

export type RecruitmentAdInput = {
  title: string;
  teamName?: string | null;
  game?: RecruitmentGame | string;
  roles?: string | null;
  body?: string | null;
  contactUrl?: string | null;
  highlight?: RecruitmentHighlight | string;
  active?: boolean;
};

export const RECRUITMENT_TITLE_MAX = 140;
export const RECRUITMENT_TEAM_MAX = 120;
export const RECRUITMENT_ROLES_MAX = 200;
export const RECRUITMENT_BODY_MAX = 2000;
export const RECRUITMENT_URL_MAX = 2048;

function isGame(value: unknown): value is RecruitmentGame {
  return typeof value === "string" && (RECRUITMENT_GAMES as readonly string[]).includes(value);
}

function isHighlight(value: unknown): value is RecruitmentHighlight {
  return typeof value === "string" && (RECRUITMENT_HIGHLIGHTS as readonly string[]).includes(value);
}

function normalizeOptional(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export type RecruitmentValidationResult =
  | {
      ok: true;
      value: {
        title: string;
        teamName: string | null;
        game: RecruitmentGame;
        roles: string | null;
        body: string | null;
        contactUrl: string | null;
        highlight: RecruitmentHighlight;
        active: boolean;
      };
    }
  | { ok: false; error: string };

/**
 * Valide et normalise une annonce de recrutement. Le titre est requis ; le jeu
 * défaut « ANY » ; la mise en avant défaut « NONE ». Équipe / rôles / corps /
 * lien sont optionnels et ramenés à `null` si vides. `active` défaut `true`.
 * Partagé client/serveur.
 */
export function validateRecruitmentAdInput(input: RecruitmentAdInput): RecruitmentValidationResult {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "TITLE_REQUIRED" };
  if (title.length > RECRUITMENT_TITLE_MAX) return { ok: false, error: "TITLE_TOO_LONG" };

  let game: RecruitmentGame = "ANY";
  if (input.game !== undefined && input.game !== null && input.game !== "") {
    if (!isGame(input.game)) return { ok: false, error: "INVALID_GAME" };
    game = input.game;
  }

  let highlight: RecruitmentHighlight = "NONE";
  if (input.highlight !== undefined && input.highlight !== null && input.highlight !== "") {
    if (!isHighlight(input.highlight)) return { ok: false, error: "INVALID_HIGHLIGHT" };
    highlight = input.highlight;
  }

  const teamName = normalizeOptional(input.teamName, RECRUITMENT_TEAM_MAX);
  const roles = normalizeOptional(input.roles, RECRUITMENT_ROLES_MAX);
  const body = normalizeOptional(input.body, RECRUITMENT_BODY_MAX);
  const contactUrl = normalizeOptional(input.contactUrl, RECRUITMENT_URL_MAX);
  const active = input.active === undefined ? true : Boolean(input.active);

  return { ok: true, value: { title, teamName, game, roles, body, contactUrl, highlight, active } };
}
