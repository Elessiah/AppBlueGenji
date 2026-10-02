/**
 * Déclaration d'accessibilité — contenu de `/accessibilite`.
 *
 * L'association n'est, à notre connaissance, pas tenue de la publier
 * (article 47 de la loi n° 2005-102 : services publics et grandes
 * entreprises) : elle le fait **de sa propre initiative**, sur le modèle
 * RGAA 4.1.2, parce qu'un joueur qui bute sur le site doit savoir ce qui est
 * connu, ce qui le contourne, et à qui écrire.
 *
 * **Une déclaration ne promet que ce qu'on sait.** Aucun audit RGAA complet
 * n'a été mené : la méthode du référentiel classe alors le site « non
 * conforme », quel que soit le soin qu'on y a mis. Le statut ne s'écrit donc
 * pas à la main — il se **déduit** du taux d'un audit (`conformityStatusFor`),
 * et tant qu'il n'y en a pas, il reste ce que le référentiel dit.
 *
 * **Règle pour la suite** : une PR qui règle un point de `KNOWN_ISSUES` le
 * retire de cette liste, et une limite découverte et laissée pour plus tard
 * (`ACCESSIBILITE.md`) s'y ajoute si elle gêne réellement un visiteur. La date
 * avance avec la liste.
 *
 * Module **pur** : la page ne fait que le mettre en forme.
 */

import { A11Y_SETTINGS } from "@/lib/shared/accessibility-settings";

/** Date d'établissement (ou de dernière mise à jour) de la déclaration. */
export const ACCESSIBILITY_STATEMENT_DATE = "2026-10-02";

/** Référentiel suivi. */
export const ACCESSIBILITY_STANDARD = "RGAA 4.1.2 (critères WCAG 2.1 niveau AA)";

/**
 * Taux de conformité mesuré par un audit RGAA, en pourcentage — `null` tant
 * qu'aucun audit complet n'a été réalisé.
 */
export const AUDIT_CONFORMITY_RATE: number | null = null;

export type ConformityStatus = "TOTAL" | "PARTIAL" | "NONE";

/** Mention imposée par le référentiel, reprise telle quelle au pied de page. */
export const CONFORMITY_LABELS: Record<ConformityStatus, string> = {
  TOTAL: "totalement conforme",
  PARTIAL: "partiellement conforme",
  NONE: "non conforme",
};

/**
 * Statut selon la méthode RGAA : 100 % → totalement conforme, au moins 50 % →
 * partiellement, en dessous **ou sans audit** → non conforme. Une valeur hors
 * de 0–100 n'est pas un taux : elle ne vaut pas mieux qu'une absence d'audit.
 */
export function conformityStatusFor(rate: number | null): ConformityStatus {
  if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 100) return "NONE";
  if (rate === 100) return "TOTAL";
  if (rate >= 50) return "PARTIAL";
  return "NONE";
}

/** Statut actuel du site. */
export const CONFORMITY_STATUS: ConformityStatus = conformityStatusFor(AUDIT_CONFORMITY_RATE);

/** Intitulé du lien de pied de page : « Accessibilité : non conforme ». */
export function accessibilityFooterLabel(status: ConformityStatus = CONFORMITY_STATUS): string {
  return `Accessibilité : ${CONFORMITY_LABELS[status]}`;
}

/** La date, en toutes lettres et dans le fuseau de l'association. */
export function accessibilityStatementDateLabel(iso: string = ACCESSIBILITY_STATEMENT_DATE): string {
  // Midi UTC : la date se lit le même jour dans tous les fuseaux, quel que soit
  // celui du serveur qui rend la page.
  const label = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(new Date(`${iso}T12:00:00Z`));
  // Le premier du mois s'écrit « 1er » : `Intl` ne connaît pas l'ordinal.
  return label.replace(/^1 /, "1er ");
}

export type KnownIssue = {
  /** Ce qui ne va pas, dit du point de vue du visiteur. */
  title: string;
  /** Critère en cause. */
  criterion: string;
  detail: string;
  /** Ce qui permet de le contourner aujourd'hui, s'il y a quelque chose. */
  workaround: string | null;
  /**
   * Le contournement passe par une demande : la page affiche alors les moyens
   * de contact **à la suite** de la phrase, plutôt que de renvoyer le lecteur
   * vers une section plus bas qu'il devrait aller chercher.
   */
  requestByContact?: boolean;
};

/** Contenus connus pour ne pas être accessibles, et leur contournement. */
export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    title: "Parcours au lecteur d'écran",
    criterion: "Ensemble du référentiel",
    detail:
      "Aucun parcours complet n'a encore été mené avec NVDA ou VoiceOver (connexion, inscription " +
      "d'une équipe, report de score) : des défauts qu'aucun outil automatique ne voit peuvent subsister.",
    workaround: null,
  },
  {
    title: "Documents de l'association",
    criterion: "RGAA 13.3",
    detail:
      "Les statuts (PDF), le bulletin d'adhésion (DOCX) et le règlement intérieur (Google Docs) " +
      "sont publiés sans contrôle d'accessibilité du document.",
    workaround: "Une version accessible de ces documents peut être demandée :",
    requestByContact: true,
  },
];

/**
 * Ce que le site met en place de lui-même — le menu d'accessibilité, repris de
 * son registre plutôt que recopié : un réglage ajouté y apparaît seul.
 */
export function accessibilityFeatures(): string[] {
  return A11Y_SETTINGS.map((setting) => `${setting.label} — ${setting.description}`);
}

/** Outils et méthodes de l'évaluation. */
export const EVALUATION_METHODS: readonly string[] = [
  "Audit interne du 24 septembre 2026, outil axe et navigation au clavier",
  "Contrôles automatisés du dépôt à chaque modification (contrastes, focus, repères, modales, noms accessibles)",
];

/**
 * Échantillon de pages vérifiées, rubrique du modèle RGAA. Il n'en existe
 * **pas** : un échantillon se constitue pour un audit complet, et il n'y en a
 * pas eu. La déclaration le dit plutôt que de présenter les pages vues par
 * l'audit interne comme un échantillon qu'elles ne sont pas.
 */
export const EVALUATION_SAMPLE =
  "Aucun échantillon de pages au sens du RGAA n'a été constitué, faute d'audit complet.";

/**
 * Environnement de test, rubrique du modèle RGAA. Rien n'est documenté pour
 * l'audit interne : on ne nomme pas de navigateur qu'on n'a pas consigné.
 */
export const EVALUATION_ENVIRONMENT =
  "Aucun environnement de test (navigateurs et versions) n'est documenté pour l'audit interne, " +
  "et aucune technologie d'assistance n'a été employée (voir « Parcours au lecteur d'écran »).";

/** Technologies sur lesquelles repose le site. */
export const TECHNOLOGIES: readonly string[] = ["HTML5", "CSS", "JavaScript", "WAI-ARIA"];
