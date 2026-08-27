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
// Les annonces de l'association sont longues (missions détaillées, outils,
// modalités de candidature) : la limite d'origine de 2 000 signes tronquait
// silencieusement les descriptions réelles. La colonne est un `TEXT` MySQL
// (65 535 octets), 6 000 signes tiennent donc largement, accents compris.
export const RECRUITMENT_BODY_MAX = 6000;
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

/* ------------------------------------------------------------------ *
 * Aperçu et mise en forme de la description
 * ------------------------------------------------------------------ */

/**
 * Longueur maximale de l'aperçu de description affiché sur une carte
 * d'annonce. Au-delà, la carte n'affiche qu'un extrait et renvoie vers la
 * modale de lecture — sans quoi une annonce détaillée (plusieurs milliers de
 * signes) étire sa carte et déséquilibre toute la grille.
 */
export const RECRUITMENT_BODY_PREVIEW_MAX = 240;

export type RecruitmentBodyPreview = {
  /** Extrait prêt à afficher, terminé par « … » s'il a été coupé. */
  text: string;
  /** Vrai si la description a été tronquée (il reste du texte à lire). */
  truncated: boolean;
};

/**
 * Construit l'aperçu d'une description : les blancs (sauts de ligne, listes,
 * indentations) sont réduits à une espace simple pour tenir en un paragraphe,
 * puis le texte est coupé à `max` signes **sur une frontière de mot** et suffixé
 * d'une ellipse.
 *
 * La coupe recule jusqu'à la dernière espace ; si le mot en cours dépasse à lui
 * seul la moitié de la limite (URL, chaîne sans espace), on tranche net plutôt
 * que de renvoyer un extrait ridiculement court. Pure et partagée : le même
 * extrait est calculé sur la page de recrutement et dans la modale d'accueil.
 */
export function buildRecruitmentPreview(
  body: string | null | undefined,
  max: number = RECRUITMENT_BODY_PREVIEW_MAX,
): RecruitmentBodyPreview {
  if (typeof body !== "string") return { text: "", truncated: false };
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return { text: "", truncated: false };
  const limit = Math.max(1, Math.floor(max));
  if (flat.length <= limit) return { text: flat, truncated: false };

  const hardCut = flat.slice(0, limit);
  const lastSpace = hardCut.lastIndexOf(" ");
  // Frontière de mot conservée seulement si elle ne mange pas plus de la moitié
  // de l'extrait — sinon un mot très long ramènerait l'aperçu à quelques signes.
  const cut = lastSpace > limit / 2 ? hardCut.slice(0, lastSpace) : hardCut;
  // Ponctuation et espaces de fin retirés : « … » suit directement le dernier mot.
  return { text: `${cut.replace(/[\s.,;:!?·—–-]+$/u, "")}…`, truncated: true };
}

/**
 * Bloc de description mis en forme pour la lecture longue. Les annonces sont
 * saisies en texte brut mais suivent toutes la même trame : des intertitres
 * (« Ce que nous offrons : »), des paragraphes et des listes à puces.
 */
export type RecruitmentBodyBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** Longueur au-delà de laquelle une ligne finissant par « : » reste un paragraphe. */
const HEADING_MAX = 80;
// Une puce est un marqueur suivi d'une espace ; le marqueur seul sur sa ligne
// compte aussi (puce vide, ignorée) pour ne pas devenir un paragraphe « - ».
const BULLET_RE = /^[-–—•*](?:\s+(.*))?$/u;

/**
 * Transforme une description en texte brut en blocs affichables (intertitre,
 * paragraphe, liste). Rien n'est interprété comme du Markdown : seules trois
 * conventions d'écriture déjà utilisées par les annonces sont reconnues.
 *
 * - une ligne courte (≤ 80 signes) terminée par « : » devient un **intertitre** ;
 * - une ligne commençant par un tiret, un point médian ou une astérisque devient
 *   un **item de liste**, les items restant groupés même séparés par des lignes
 *   vides (les annonces sont souvent saisies avec une ligne vide entre puces) ;
 * - le reste est un **paragraphe**, les lignes consécutives étant recollées avec
 *   leur saut de ligne (rendu en `pre-line`).
 *
 * Fonction pure : `[]` pour une description vide ou absente.
 */
export function formatRecruitmentBody(body: string | null | undefined): RecruitmentBodyBlock[] {
  if (typeof body !== "string" || !body.trim()) return [];

  const blocks: RecruitmentBodyBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      // Ligne vide : elle termine un paragraphe, mais pas une liste — une puce
      // qui suit reprend la même liste (voir doc ci-dessus).
      flushParagraph();
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      const item = (bullet[1] ?? "").trim();
      flushParagraph();
      // Une puce vide (un tiret seul) n'apporte rien : on l'ignore.
      if (item) list.push(item);
      continue;
    }

    flushList();

    if (line.length <= HEADING_MAX && /[:：]$/u.test(line)) {
      flushParagraph();
      // Le deux-points est retiré : l'intertitre est rendu en eyebrow, où il jurerait.
      blocks.push({ kind: "heading", text: line.replace(/\s*[:：]$/u, "") });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

/* ------------------------------------------------------------------ *
 * Mise en avant : résolution de l'annonce gagnante
 * ------------------------------------------------------------------ */

/** Libellés courts du mode de mise en avant, pour les badges de gestion. */
export const RECRUITMENT_HIGHLIGHT_SHORT_LABELS: Record<RecruitmentHighlight, string> = {
  NONE: "Aucune",
  BANNER: "Banderole",
  MODAL: "Modale",
};

/**
 * Annonce effectivement mise en avant sur le site : la **première** annonce
 * active dont le mode n'est pas `NONE`, dans l'ordre d'affichage fourni.
 *
 * Une seule mise en avant est servie à la fois, quel que soit le nombre
 * d'annonces marquées « Banderole » ou « Modale » — empiler des modales à
 * l'arrivée d'un visiteur serait insupportable. Miroir exact, côté pur, du
 * `LIMIT 1` de `getHighlightedAd()` : c'est ce qui permet à l'interface de
 * gestion de désigner les annonces dont la mise en avant reste lettre morte.
 */
export function selectHighlightedAd<
  T extends { active: boolean; highlight: RecruitmentHighlight },
>(ads: readonly T[]): T | null {
  return ads.find((ad) => ad.active && ad.highlight !== "NONE") ?? null;
}

/**
 * État réel de la mise en avant d'une annonce, du point de vue de la gestion :
 *
 * - `NONE` — l'annonce ne demande aucune mise en avant ;
 * - `LIVE` — c'est elle qui est servie au site ;
 * - `QUEUED` — elle en demande une, mais une annonce plus haute l'a emportée ;
 * - `DRAFT` — elle en demande une mais reste un brouillon, donc jamais publiée.
 */
export type RecruitmentHighlightState = "NONE" | "LIVE" | "QUEUED" | "DRAFT";

/**
 * État de mise en avant de chaque annonce, indexé par id. Sert à dire au staff
 * ce qui est réellement en ligne : une seule mise en avant est servie à la fois,
 * et rien dans le formulaire ne le montrait jusqu'ici — on pouvait cocher
 * « Modale à l'arrivée » sur trois annonces et croire les trois affichées.
 *
 * Les ids en double (jeu de données incohérent) sont résolus par la première
 * occurrence, comme le fait l'affichage.
 */
export function resolveHighlightStates(
  ads: readonly { id: number; active: boolean; highlight: RecruitmentHighlight }[],
): Map<number, RecruitmentHighlightState> {
  const winner = selectHighlightedAd(ads);
  const states = new Map<number, RecruitmentHighlightState>();
  for (const ad of ads) {
    if (states.has(ad.id)) continue;
    if (ad.highlight === "NONE") states.set(ad.id, "NONE");
    else if (!ad.active) states.set(ad.id, "DRAFT");
    else states.set(ad.id, ad === winner ? "LIVE" : "QUEUED");
  }
  return states;
}

/* ------------------------------------------------------------------ *
 * Lien profond vers une annonce
 * ------------------------------------------------------------------ */

/** Ancre (`id` DOM et fragment d'URL) d'une annonce : `annonce-<id>`. */
export function recruitmentAdAnchor(id: number): string {
  return `annonce-${id}`;
}

/**
 * Extrait l'id d'annonce d'un fragment d'URL (`#annonce-12`, `annonce-12`).
 * Renvoie `null` si le fragment ne désigne pas une annonce ou si l'id n'est pas
 * un entier positif — un fragment forgé ne doit jamais ouvrir « l'annonce NaN ».
 */
export function parseRecruitmentAdAnchor(hash: string | null | undefined): number | null {
  if (typeof hash !== "string") return null;
  const match = /^#?annonce-(\d+)$/u.exec(hash.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
