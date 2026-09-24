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
 * Statut d'importance d'une annonce. Il décide à lui seul **où** l'annonce se
 * montre, et remplace l'ancien mode de mise en avant (`NONE` / `BANNER` /
 * `MODAL`), qui ne servait qu'**une** annonce à la fois : on pouvait cocher
 * « Modale à l'arrivée » sur trois annonces, deux restaient lettre morte, et
 * l'ordre de la liste — qui mélangeait urgentes et facultatives — décidait
 * laquelle passait.
 *
 * - `PRIORITY` (« Prioritaire ») : pastille clignotante « Urgente », modale à
 *   l'arrivée **et** banderole. Plusieurs prioritaires se partagent **une**
 *   modale, qui se feuillette ; empiler des modales serait insupportable.
 * - `IMPORTANT` (« Importante ») : banderole seulement, sans pastille.
 * - `OPTIONAL` (« Facultative ») : ni modale ni banderole, rangée à part sous
 *   « Autres recrutements » sur la page.
 *
 * L'ordre du tableau **est** l'ordre d'affichage des groupes : une prioritaire
 * passe toujours devant une importante, quel que soit leur rang dans la liste.
 */
export const RECRUITMENT_PRIORITIES = ["PRIORITY", "IMPORTANT", "OPTIONAL"] as const;
export type RecruitmentPriority = (typeof RECRUITMENT_PRIORITIES)[number];

export const RECRUITMENT_PRIORITY_LABELS: Record<RecruitmentPriority, string> = {
  PRIORITY: "Prioritaire",
  IMPORTANT: "Importante",
  OPTIONAL: "Facultative",
};

/** Ce que chaque statut fait de l'annonce, en une phrase — aide du formulaire et bulle du badge. */
export const RECRUITMENT_PRIORITY_DESCRIPTIONS: Record<RecruitmentPriority, string> = {
  PRIORITY: "Pastille « Urgente », modale à l'arrivée sur le site et banderole.",
  IMPORTANT: "Défile dans la banderole, sans pastille « Urgente ».",
  OPTIONAL: "Page recrutement seulement, dans « Autres recrutements ».",
};

/** Où une annonce **publiée** se montre. La table est la règle ; rien ne la redit ailleurs. */
export type RecruitmentExposure = {
  /** Pastille clignotante « Urgente ». */
  urgent: boolean;
  /** Modale à l'arrivée sur le site. */
  modal: boolean;
  /** Banderole discrète en tête de page. */
  banner: boolean;
  /** Liste principale de `/recrutement` (sinon « Autres recrutements »). */
  featured: boolean;
};

export const RECRUITMENT_PRIORITY_EXPOSURE: Record<RecruitmentPriority, RecruitmentExposure> = {
  PRIORITY: { urgent: true, modal: true, banner: true, featured: true },
  IMPORTANT: { urgent: false, modal: false, banner: true, featured: true },
  OPTIONAL: { urgent: false, modal: false, banner: false, featured: false },
};

/** Rang d'affichage d'un statut : 0 pour le plus important. */
export function recruitmentPriorityRank(priority: RecruitmentPriority): number {
  return RECRUITMENT_PRIORITIES.indexOf(priority);
}

/**
 * Fenêtre d'anti-répétition de la modale d'arrivée : une prioritaire montrée à
 * un visiteur ne lui est pas remontrée avant 7 jours — la durée du cookie
 * ({@link RECRUITMENT_MODAL_COOKIE_MAX_AGE}) *est* cette fenêtre. La banderole,
 * elle, se tait le temps de la visite.
 */
export const RECRUITMENT_MODAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cookies de la mise en avant, et pourquoi ce n'est plus `localStorage`.
 *
 * La modale etait peinte **par du JavaScript** : le composant montait, lisait
 * `localStorage`, puis decidait. Elle arrivait donc apres l'hydratation, et
 * comme c'est le plus gros bloc de l'accueil sur mobile, elle en **etait** le
 * LCP — 4,4 s, dont 3,8 s de seul delai de rendu. Aucun reglage du composant ne
 * pouvait y changer quoi que ce soit : ce qui est peint tard est peint tard.
 *
 * La seule issue est de la rendre dans le **HTML initial**, ce qui suppose que
 * le serveur sache qui l'a deja ecartee — d'ou un cookie, seul etat de
 * navigateur qu'une requete transporte. Le `localStorage` ne pouvait pas le
 * faire : il ne quitte jamais l'onglet.
 *
 * La valeur est la **liste des identifiants** des annonces montrées (`12.15`) —
 * pour la modale, les seules pages réellement affichées —, et il n'y a pas
 * d'horodatage a cote : la peremption du cookie *est* la fenetre. Une annonce
 * absente de la liste (ajoutée depuis, ou jamais feuilletée) fait donc
 * reparaître la modale, ouverte sur elle.
 */
export const RECRUITMENT_MODAL_COOKIE = "bg_recr_modal";

/** Meme contrat, mais cookie de session : la banderole ne se tait que le temps de la visite. */
export const RECRUITMENT_BANNER_COOKIE = "bg_recr_banner";

/** Séparateur des identifiants dans la valeur d'un cookie : permis dans un cookie, absent d'un entier. */
const SEEN_SEPARATOR = ".";

/**
 * Identifiants portés par un cookie de mise en avant. Tout ce qui n'est pas un
 * entier positif est ignoré : une valeur forgée ou abîmée ne peut rien taire
 * d'autre que ce qu'elle nomme exactement. Une valeur à un seul identifiant
 * (`"42"`, la forme d'avant les statuts) se lit telle quelle.
 */
export function parseRecruitmentSeen(cookieValue: string | undefined): Set<number> {
  const seen = new Set<number>();
  if (typeof cookieValue !== "string") return seen;
  for (const part of cookieValue.split(SEEN_SEPARATOR)) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const id = Number(trimmed);
    if (Number.isSafeInteger(id) && id > 0) seen.add(id);
  }
  return seen;
}

/** Valeur du cookie pour un jeu d'annonces montrées. */
export function serializeRecruitmentSeen(ids: readonly number[]): string {
  return ids.join(SEEN_SEPARATOR);
}

/**
 * Les annonces ont-elles **toutes** déjà été écartées par ce visiteur ?
 *
 * Une seule absente du cookie suffit à répondre `false` : dans le doute on
 * **affiche**, une mise en avant tue à tort ne se rattrape pas. Une liste vide
 * n'a rien à montrer : elle rend `true`.
 *
 * @param cookieValue Valeur brute du cookie, ou `undefined` s'il est absent.
 * @param adIds Identifiants des annonces actuellement mises en avant.
 */
export function recruitmentDismissed(cookieValue: string | undefined, adIds: readonly number[]): boolean {
  const seen = parseRecruitmentSeen(cookieValue);
  return adIds.every((id) => seen.has(id));
}

/**
 * Parmi les annonces mises en avant, celles que le cookie dit déjà vues, dans
 * l'ordre reçu. C'est la seule lecture du cookie de la modale : la page
 * d'ouverture s'en déduit ({@link recruitmentModalStart}), et la modale les
 * garde pour vues en réécrivant son cookie, qui ne porte ainsi que des
 * annonces encore en ligne.
 */
export function recruitmentSeenAmong(
  cookieValue: string | undefined,
  adIds: readonly number[],
): number[] {
  const seen = parseRecruitmentSeen(cookieValue);
  return adIds.filter((id) => seen.has(id));
}

/**
 * Page d'ouverture de la modale d'arrivée, ou `null` si elle doit se taire.
 *
 * La modale s'ouvre sur la **première annonce jamais vue** : un visiteur qui a
 * déjà lu les deux premières prioritaires et revient pour une troisième doit
 * tomber sur celle-ci, pas relire les autres. Toutes restent feuilletables.
 */
export function recruitmentModalStart(
  adIds: readonly number[],
  seenIds: readonly number[],
): number | null {
  const seen = new Set(seenIds);
  const index = adIds.findIndex((id) => !seen.has(id));
  return index < 0 ? null : index;
}

/**
 * Duree de vie du cookie de la modale, en secondes.
 *
 * Tiree de {@link RECRUITMENT_MODAL_INTERVAL_MS} plutot que reecrite : deux
 * nombres a tenir d'accord auraient diverge, et la fenetre de 7 jours est la
 * meme notion des deux cotes.
 */
export const RECRUITMENT_MODAL_COOKIE_MAX_AGE = Math.floor(RECRUITMENT_MODAL_INTERVAL_MS / 1000);

/**
 * Durée d'affichage d'une annonce dans la banderole avant la suivante. Sept
 * secondes : de quoi lire un titre et son pôle. Au-delà de cinq secondes,
 * WCAG 2.2.2 exige un moyen de pause — la banderole en porte un.
 */
export const RECRUITMENT_BANNER_ROTATION_MS = 7_000;

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
  // Statut d'importance : où l'annonce se montre (voir `RECRUITMENT_PRIORITY_EXPOSURE`).
  priority: RecruitmentPriority;
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
  priority?: RecruitmentPriority | string;
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

function isPriority(value: unknown): value is RecruitmentPriority {
  return typeof value === "string" && (RECRUITMENT_PRIORITIES as readonly string[]).includes(value);
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
        priority: RecruitmentPriority;
        active: boolean;
      };
    }
  | { ok: false; error: string };

/**
 * Valide et normalise une annonce de recrutement. Le titre est requis ; le pôle
 * défaut « AUTRE » ; le statut défaut « OPTIONAL » (facultative). Référent / missions /
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

  // Défaut « facultative » : une annonce ne s'impose à tous les visiteurs que
  // si quelqu'un l'a demandé.
  let priority: RecruitmentPriority = "OPTIONAL";
  if (input.priority !== undefined && input.priority !== null && input.priority !== "") {
    if (!isPriority(input.priority)) return { ok: false, error: "INVALID_PRIORITY" };
    priority = input.priority;
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
      priority,
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
 * Statuts : ordre, groupes et mise en avant
 * ------------------------------------------------------------------ */

type Prioritized = { priority: RecruitmentPriority };

/**
 * Range les annonces par statut, **sans rien changer à l'ordre à l'intérieur
 * d'un statut** (tri stable) : la base les rend dans l'ordre d'affichage, ce
 * tri n'y ajoute que la règle « une prioritaire passe devant une importante ».
 * Écrit ici plutôt qu'en `ORDER BY` : la page, la gestion et la mise en avant
 * le partagent, et deux tris auraient fini par diverger.
 */
export function sortRecruitmentAds<T extends Prioritized>(ads: readonly T[]): T[] {
  return ads
    .map((ad, index) => ({ ad, index }))
    .sort(
      (a, b) =>
        recruitmentPriorityRank(a.ad.priority) - recruitmentPriorityRank(b.ad.priority) ||
        a.index - b.index,
    )
    .map(({ ad }) => ad);
}

/**
 * Sépare la liste principale (« Recrutement en cours » : prioritaires puis
 * importantes) des « Autres recrutements » (facultatives), en gardant l'ordre
 * reçu. Simple partage, sans tri : la liste qu'on lui passe est déjà rangée
 * ({@link sortRecruitmentAds} au chargement, {@link placeRecruitmentAd} à
 * chaque écriture), et la trier de nouveau à chaque rendu ne ferait que redire
 * cet invariant.
 */
export function splitRecruitmentAds<T extends Prioritized>(
  ads: readonly T[],
): { featured: T[]; others: T[] } {
  const featured: T[] = [];
  const others: T[] = [];
  for (const ad of ads) {
    (RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].featured ? featured : others).push(ad);
  }
  return { featured, others };
}

/** Ce que le site met en avant : la modale d'arrivée et la banderole. */
export type RecruitmentSpotlight<T> = {
  /** Prioritaires publiées, dans l'ordre d'affichage — les pages de la modale. */
  modal: T[];
  /** Prioritaires puis importantes publiées — ce qui défile dans la banderole. */
  banner: T[];
};

/**
 * Annonces mises en avant sur le site : **toutes** les annonces publiées dont
 * le statut le demande, et non plus la première — c'est ce qui rend le statut
 * vrai tel qu'il est montré au staff : une prioritaire est dans la modale, sans
 * condition de rang. Les brouillons n'y sont jamais.
 */
export function selectRecruitmentSpotlight<T extends Prioritized & { active: boolean }>(
  ads: readonly T[],
): RecruitmentSpotlight<T> {
  const published = sortRecruitmentAds(ads).filter((ad) => ad.active);
  return {
    modal: published.filter((ad) => RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].modal),
    banner: published.filter((ad) => RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].banner),
  };
}

/**
 * Un déplacement d'un cran est-il permis ? Seulement **dans son statut** :
 * l'ordre se règle à l'intérieur d'un groupe, jamais d'un groupe à l'autre —
 * c'est le statut qui fait passer une annonce devant une autre, pas une flèche.
 * La liste est supposée triée ({@link sortRecruitmentAds}).
 */
export function canMoveRecruitmentAd(
  ads: readonly Prioritized[],
  index: number,
  direction: -1 | 1,
): boolean {
  const target = index + direction;
  if (index < 0 || index >= ads.length || target < 0 || target >= ads.length) return false;
  return ads[index].priority === ads[target].priority;
}

/**
 * Un nouvel ordre mélange-t-il les statuts ? Vrai dès qu'une annonce y précède
 * une annonce d'un statut plus important qu'elle. Les identifiants inconnus
 * sont ignorés (une annonce supprimée entre-temps n'a plus de statut à tenir).
 * Le serveur le refuse : l'interface ne le propose pas, et un ordre qui
 * l'affirmerait serait défait au prochain affichage par le tri par statut.
 */
export function recruitmentOrderMixesPriorities(
  ids: readonly number[],
  priorityById: ReadonlyMap<number, RecruitmentPriority>,
): boolean {
  let lastRank = -1;
  for (const id of ids) {
    const priority = priorityById.get(id);
    if (priority === undefined) continue;
    const rank = recruitmentPriorityRank(priority);
    if (rank < lastRank) return true;
    lastRank = rank;
  }
  return false;
}

/**
 * Place une annonce créée ou modifiée dans une liste triée, **comme le serveur
 * la range** : une annonce qui garde son statut garde sa place ; une annonce
 * neuve, ou qui change de statut, passe en **fin de son groupe** (le serveur
 * lui donne alors le plus grand rang d'affichage).
 */
export function placeRecruitmentAd<T extends Prioritized & { id: number }>(
  ads: readonly T[],
  ad: T,
): T[] {
  const current = ads.find((a) => a.id === ad.id);
  if (current && current.priority === ad.priority) {
    return ads.map((a) => (a.id === ad.id ? ad : a));
  }
  return sortRecruitmentAds([...ads.filter((a) => a.id !== ad.id), ad]);
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
