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

/**
 * Fenêtre d'anti-répétition de la modale de recrutement prioritaire : une fois
 * affichée à un utilisateur, elle ne réapparaît pas avant 7 jours (mémorisé côté
 * client par un horodatage `localStorage`). Ne concerne que la modale (`MODAL`) ;
 * la banderole reste fermée pour la seule session courante.
 */
export const RECRUITMENT_MODAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Décide si la modale prioritaire doit s'afficher, à partir de l'horodatage du
 * dernier affichage (`seenAt`, ms epoch ; `null` si jamais vue) et de l'instant
 * courant `now`. Vraie si jamais vue, si l'horodatage est invalide ou situé dans
 * le futur (horloge décalée), ou si au moins `RECRUITMENT_MODAL_INTERVAL_MS` se
 * sont écoulés depuis le dernier affichage.
 */
export function shouldShowRecruitmentModal(seenAt: number | null, now: number): boolean {
  if (seenAt === null || !Number.isFinite(seenAt) || seenAt > now) return true;
  return now - seenAt >= RECRUITMENT_MODAL_INTERVAL_MS;
}

/**
 * Canal de contact mis en avant sur l'annonce. `AUTO` : aucun canal privilégié,
 * tous les tags sont équivalents. Les autres valeurs stylent le tag correspondant
 * en primaire pour guider les intéressés vers le canal préféré du recruteur.
 */
export const RECRUITMENT_CONTACT_CHANNELS = ["AUTO", "DISCORD", "LINK"] as const;
export type RecruitmentContactChannel = (typeof RECRUITMENT_CONTACT_CHANNELS)[number];

export const RECRUITMENT_CONTACT_CHANNEL_LABELS: Record<RecruitmentContactChannel, string> = {
  AUTO: "Automatique (tous les canaux)",
  DISCORD: "Discord en priorité",
  LINK: "Lien de candidature en priorité",
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
  // Contact Discord direct affiché comme « tag » cliquable (pseudo copiable ou
  // lien d'invitation), en complément du lien `contactUrl` (« Postuler »).
  // Auto-rempli depuis le profil du recruteur à la création.
  contactDiscord: string | null;
  // ID Discord numérique (snowflake) permettant un deep-link « Ouvrir dans
  // Discord » (discord.com/users/<id>). Dérivé du profil du recruteur ; conservé
  // uniquement tant que le pseudo n'a pas été remplacé (voir UI).
  contactDiscordId: string | null;
  // Canal mis en avant (stylé en primaire). `AUTO` = aucun privilégié.
  contactPreferred: RecruitmentContactChannel;
  highlight: RecruitmentHighlight;
  active: boolean;
};

/**
 * Valeurs de contact pré-remplies dans le formulaire de création à partir du
 * profil du recruteur connecté. Purement indicatives : l'UI les pré-remplit mais
 * laisse l'édition libre (le recruteur peut vider ou remplacer chaque champ).
 */
export type RecruiterContactDefaults = {
  discord: string | null;
  discordId: string | null;
};

export type RecruitmentAdInput = {
  title: string;
  teamName?: string | null;
  domain?: RecruitmentDomain | string;
  roles?: string | null;
  body?: string | null;
  contactUrl?: string | null;
  contactDiscord?: string | null;
  contactDiscordId?: string | null;
  contactPreferred?: RecruitmentContactChannel | string;
  highlight?: RecruitmentHighlight | string;
  active?: boolean;
};

export const RECRUITMENT_TITLE_MAX = 140;
export const RECRUITMENT_TEAM_MAX = 120;
export const RECRUITMENT_ROLES_MAX = 200;
export const RECRUITMENT_BODY_MAX = 2000;
export const RECRUITMENT_URL_MAX = 2048;
export const RECRUITMENT_DISCORD_MAX = 120;

// Un snowflake Discord est une chaîne de 17 à 20 chiffres ; on tolère 5 à 32 pour
// rester souple sans accepter du texte arbitraire.
const DISCORD_ID_RE = /^\d{5,32}$/;

function isDomain(value: unknown): value is RecruitmentDomain {
  return typeof value === "string" && (RECRUITMENT_DOMAINS as readonly string[]).includes(value);
}

function isHighlight(value: unknown): value is RecruitmentHighlight {
  return typeof value === "string" && (RECRUITMENT_HIGHLIGHTS as readonly string[]).includes(value);
}

function isContactChannel(value: unknown): value is RecruitmentContactChannel {
  return (
    typeof value === "string" && (RECRUITMENT_CONTACT_CHANNELS as readonly string[]).includes(value)
  );
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
        contactDiscord: string | null;
        contactDiscordId: string | null;
        contactPreferred: RecruitmentContactChannel;
        highlight: RecruitmentHighlight;
        active: boolean;
      };
    }
  | { ok: false; error: string };

/**
 * Valide et normalise une annonce de recrutement. Le titre est requis ; le pôle
 * défaut « AUTRE » ; la mise en avant défaut « NONE ». Référent / missions /
 * corps / lien / Discord sont optionnels et ramenés à `null` si vides.
 * Le canal préféré défaut « AUTO » (sinon `INVALID_CONTACT_CHANNEL`). L'ID Discord
 * n'est retenu que s'il ressemble à un snowflake ET qu'un pseudo l'accompagne.
 * `active` défaut `true`. Partagé client/serveur.
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

  let contactPreferred: RecruitmentContactChannel = "AUTO";
  if (
    input.contactPreferred !== undefined &&
    input.contactPreferred !== null &&
    input.contactPreferred !== ""
  ) {
    if (!isContactChannel(input.contactPreferred)) {
      return { ok: false, error: "INVALID_CONTACT_CHANNEL" };
    }
    contactPreferred = input.contactPreferred;
  }

  const teamName = normalizeOptional(input.teamName, RECRUITMENT_TEAM_MAX);
  const roles = normalizeOptional(input.roles, RECRUITMENT_ROLES_MAX);
  const body = normalizeOptional(input.body, RECRUITMENT_BODY_MAX);
  const contactUrl = normalizeOptional(input.contactUrl, RECRUITMENT_URL_MAX);
  const contactDiscord = normalizeOptional(input.contactDiscord, RECRUITMENT_DISCORD_MAX);

  // ID Discord dérivé : on l'ignore silencieusement s'il n'a pas la forme d'un
  // snowflake, et on le neutralise si aucun pseudo Discord ne l'accompagne (il ne
  // servirait à rien seul).
  const rawDiscordId = normalizeOptional(input.contactDiscordId, 32);
  const contactDiscordId =
    rawDiscordId !== null && DISCORD_ID_RE.test(rawDiscordId) && contactDiscord !== null
      ? rawDiscordId
      : null;

  const active = input.active === undefined ? true : Boolean(input.active);

  return {
    ok: true,
    value: {
      title,
      teamName,
      domain,
      roles,
      body,
      contactUrl,
      contactDiscord,
      contactDiscordId,
      contactPreferred,
      highlight,
      active,
    },
  };
}
