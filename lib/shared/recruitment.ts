/**
 * Pôles de bénévolat de l'association : le recrutement vise le staff (arbitres,
 * casters, dev, com…) plutôt que les joueurs. `AUTRE` sert de valeur par défaut
 * et de fourre-tout pour les missions hors catégories.
 */
export const RECRUITMENT_DOMAINS = [
  "ARBITRAGE",
  "CASTING",
  "DEV",
  "COMMUNICATION",
  "DESIGN",
  "MODERATION",
  "EVENEMENTIEL",
  "ADMIN",
  "AUTRE",
] as const;
export type RecruitmentDomain = (typeof RECRUITMENT_DOMAINS)[number];

export const RECRUITMENT_DOMAIN_LABELS: Record<RecruitmentDomain, string> = {
  ARBITRAGE: "Arbitrage",
  CASTING: "Casting / Commentaire",
  DEV: "Développement",
  COMMUNICATION: "Communication",
  DESIGN: "Design / Graphisme",
  MODERATION: "Modération",
  EVENEMENTIEL: "Événementiel",
  ADMIN: "Administration",
  AUTRE: "Autre",
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
  // Référent / contact de l'annonce (pôle ou personne). Historiquement nommé
  // `teamName` / `team_name` du temps du recrutement de joueurs — conservé tel
  // quel pour éviter une migration, mais l'UI l'affiche comme « Référent ».
  teamName: string | null;
  domain: RecruitmentDomain;
  roles: string | null;
  body: string | null;
  contactUrl: string | null;
  highlight: RecruitmentHighlight;
  active: boolean;
};

export type RecruitmentAdInput = {
  title: string;
  teamName?: string | null;
  domain?: RecruitmentDomain | string;
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

function isDomain(value: unknown): value is RecruitmentDomain {
  return typeof value === "string" && (RECRUITMENT_DOMAINS as readonly string[]).includes(value);
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
        domain: RecruitmentDomain;
        roles: string | null;
        body: string | null;
        contactUrl: string | null;
        highlight: RecruitmentHighlight;
        active: boolean;
      };
    }
  | { ok: false; error: string };

/**
 * Valide et normalise une annonce de recrutement. Le titre est requis ; le pôle
 * défaut « AUTRE » ; la mise en avant défaut « NONE ». Référent / missions /
 * corps / lien sont optionnels et ramenés à `null` si vides. `active` défaut
 * `true`. Partagé client/serveur.
 */
export function validateRecruitmentAdInput(input: RecruitmentAdInput): RecruitmentValidationResult {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "TITLE_REQUIRED" };
  if (title.length > RECRUITMENT_TITLE_MAX) return { ok: false, error: "TITLE_TOO_LONG" };

  let domain: RecruitmentDomain = "AUTRE";
  if (input.domain !== undefined && input.domain !== null && input.domain !== "") {
    if (!isDomain(input.domain)) return { ok: false, error: "INVALID_DOMAIN" };
    domain = input.domain;
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

  return { ok: true, value: { title, teamName, domain, roles, body, contactUrl, highlight, active } };
}
