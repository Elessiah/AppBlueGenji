import { discordInline } from "./discord-text";
import { localizedSiteUrl } from "./dm-language";
import type { Locale } from "./locales";
import {
  OFF_SITE_CONDUCT_ICON,
  REPORT_CATEGORY_RULES,
  REPORT_TARGET_LABELS,
  REPORT_TARGET_TYPES,
  type ReportAlertTarget,
  type ReportCategory,
  type ReportCategoryRules,
  type ReportTargetType,
} from "./content-reports";

/**
 * Les catégories de signalement **avec leurs phrases françaises** (libellé,
 * aide, aide du champ de description) et les lignes Discord qui les citent —
 * pour les écrans du staff, le serveur et les notifications, en français.
 * Module à part (revue de performance du lot 9-2) : le formulaire et la page
 * d'un signalement, traduits, n'en ont pas besoin (`REPORT_CATEGORY_RULES` +
 * `messages/<langue>/reports.json`) et n'emportent plus ce français une
 * seconde fois.
 */
export interface ReportCategoryDefinition extends ReportCategoryRules {
  label: string;
  /** Une ligne sous le titre, dans le choix de la catégorie. */
  hint: string;
  /** Aide du champ de description. */
  descriptionPlaceholder: string;
}

export const REPORT_CATEGORY_DEFINITIONS: Record<ReportCategory, ReportCategoryDefinition> = {
  COPYRIGHT: {
    ...REPORT_CATEGORY_RULES.COPYRIGHT,
    label: "Droit d'auteur",
    hint: "Un logo, un avatar ou une image utilisé sans autorisation.",
    descriptionPlaceholder:
      "Quelle œuvre est reproduite, où la voir sur le site, et à qui elle appartient…",
  },
  MODERATION: {
    ...REPORT_CATEGORY_RULES.MODERATION,
    label: "Modération",
    hint: "Un pseudo, un nom d'équipe ou un contenu du site contraire aux règles.",
    descriptionPlaceholder: "Quel contenu du site, sur quelle page, et ce qui ne va pas…",
  },
  BUG: {
    ...REPORT_CATEGORY_RULES.BUG,
    label: "Bug",
    hint: "Une page qui ne s'affiche pas, un bouton qui ne répond pas.",
    descriptionPlaceholder: "Ce que tu faisais, ce que tu attendais, ce qui s'est passé…",
  },
  RGPD: {
    ...REPORT_CATEGORY_RULES.RGPD,
    label: "RGPD",
    hint: "Exercer tes droits sur tes données : accès, rectification, effacement, opposition, portabilité.",
    descriptionPlaceholder:
      "Le droit que tu exerces, le compte concerné (pseudo), et ce que tu demandes précisément…",
  },
  HOSTING: {
    ...REPORT_CATEGORY_RULES.HOSTING,
    label: "Hébergeur",
    hint: "Écrire à l'éditeur ou à l'hébergeur du site : mentions légales, demande d'une autorité, question juridique.",
    descriptionPlaceholder: "Qui tu es (particulier, organisme, autorité), l'objet de ta demande, et la page concernée…",
  },
  OTHER: {
    ...REPORT_CATEGORY_RULES.OTHER,
    label: "Autre",
    hint: "Tout ce qui ne rentre dans aucune case ci-dessus.",
    descriptionPlaceholder: "Explique-nous le problème…",
  },
  CONTEST: {
    ...REPORT_CATEGORY_RULES.CONTEST,
    label: "Contestation",
    hint: "Répondre à un signalement qui te vise, toi ou ton équipe — ou contester la décision prise sur ton propre signalement de droit d'auteur ou de modération.",
    descriptionPlaceholder:
      "Pourquoi le signalement est infondé : licence, autorisation du titulaire, création de l'équipe, contexte…",
  },
};

function plural(count: number, type: ReportTargetType): string {
  const labels = REPORT_TARGET_LABELS[type];
  return `${count} ${count > 1 ? labels.many : labels.one}`;
}

/**
 * Ligne Discord d'un nouveau signalement (canal de logs, et message privé au
 * propriétaire et au président de l'association).
 *
 * Les joueurs sont **comptés**, jamais nommés ; équipes et tournois sont nommés
 * — c'est ce qui permet de juger l'urgence sans ouvrir le panneau. Le lien mène
 * au signalement lui-même.
 */
export function formatReportAlert(input: {
  id: number;
  category: ReportCategory;
  targets: ReportAlertTarget[];
  fromMember: boolean;
  adminUrl: string;
}): string {
  const definition = REPORT_CATEGORY_DEFINITIONS[input.category];
  const parts: string[] = [];
  for (const type of REPORT_TARGET_TYPES) {
    const ofType = input.targets.filter((target) => target.type === type);
    if (ofType.length === 0) continue;
    if (type === "USER") {
      parts.push(plural(ofType.length, type));
      continue;
    }
    const names = ofType
      .map((target) => target.label)
      .filter((label): label is string => Boolean(label))
      .map(discordInline);
    parts.push(names.length > 0 ? `${plural(ofType.length, type)} (${names.join(", ")})` : plural(ofType.length, type));
  }
  const scope = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  const author = input.fromMember ? "un membre" : "un visiteur";
  return `🚩 Signalement #${input.id} · ${definition.label}${scope}. Envoyé par ${author}. À traiter : ${input.adminUrl}`;
}

/**
 * Message privé aux personnes visées par un signalement : les joueurs désignés
 * et les membres des équipes désignées.
 *
 * Un seul texte pour tous — il ne nomme donc ni le joueur, ni l'équipe, ni
 * l'auteur du signalement : le lien mène à une page qui, elle, ne s'ouvre qu'à
 * qui est visé. Il dit ce qui est en cause (la catégorie), qu'aucune décision
 * n'est prise, et comment répondre.
 */
export function formatTargetNotice(
  input: { category: ReportCategory; url: string; /** Libellé anglais de la catégorie (`reports.json`). */ labelEn?: string },
  locale: Locale = "fr",
): string {
  if (locale === "en") {
    return (
      `⚠️ BlueGenji — A report (${input.labelEn ?? REPORT_CATEGORY_DEFINITIONS[input.category].label}) concerns you or your team. ` +
      `The association is reviewing it: no decision has been made at this stage. ` +
      `Read it and, if it is unfounded, appeal it here: ${localizedSiteUrl(input.url, locale)}`
    );
  }
  const label = REPORT_CATEGORY_DEFINITIONS[input.category].label;
  return (
    `⚠️ BlueGenji — Un signalement (${label}) te concerne, toi ou ton équipe. ` +
    `L'association l'examine : aucune décision n'est prise à ce stade. ` +
    `Consulte-le et, s'il est infondé, conteste-le ici : ${input.url}`
  );
}

/**
 * Ligne Discord d'une contestation (canal de logs, propriétaire, président).
 * Même règle que `formatReportAlert` : ni pseudo, ni description.
 */
export function formatContestAlert(input: {
  contestId: number;
  parentId: number;
  parentCategory: ReportCategory;
  reopened: boolean;
  /** Qui conteste : une personne visée, ou l'auteur du signalement (`canContestReport`). */
  by: "TARGET" | "NOTIFIER";
  adminUrl: string;
}): string {
  const label = REPORT_CATEGORY_DEFINITIONS[input.parentCategory].label;
  const state = input.reopened ? " Le signalement était archivé : il est réactivé." : "";
  const author = input.by === "NOTIFIER" ? "l'auteur du signalement" : "une personne visée";
  return (
    `⚖️ Contestation #${input.contestId} du signalement #${input.parentId} (${label}), ` +
    `envoyée par ${author}.${state} À traiter : ${input.adminUrl}`
  );
}

/*
 * Le français de référence de l'entrée « Comportement d'un joueur » et du rappel
 * de l'étape « Modération » — égal, mot pour mot, à `reports.json` (testé) ; le
 * formulaire lit ses textes dans les messages et n'emporte pas celui-ci.
 */
/** Carte du choix de catégorie qui renvoie vers le portail de support. */
export const OFF_SITE_CONDUCT_ENTRY = {
  label: "Comportement d'un joueur",
  hint: "En match, en vocal ou sur Discord : insulte, triche, anti-jeu… Se signale sur notre portail de support.",
  icon: OFF_SITE_CONDUCT_ICON,
} as const;

/** Rappel affiché dans l'étape « Modération » du formulaire. */
export const OFF_SITE_CONDUCT_NOTICE =
  "Ce formulaire concerne les contenus publiés sur le site (pseudo, nom d'équipe, logo…). Un mauvais comportement en match, une insulte d'un joueur, de la triche ou un problème sur Discord se signalent sur le";
