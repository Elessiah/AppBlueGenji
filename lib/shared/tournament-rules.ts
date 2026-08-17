/**
 * Registre des **règles des modes de tournoi**, source unique des pages
 * `/regles` et `/regles/[slug]`.
 *
 * Le contenu est décrit en données (et non en JSX) pour trois raisons : les
 * pages restent génériques, le lien « bouton d'aide » d'une page de tournoi se
 * résout depuis le format stocké en base ({@link ruleModeForFormat}), et les
 * tests peuvent vérifier l'intégrité du registre (slugs uniques, couverture de
 * tous les formats).
 *
 * Module `shared` : importable côté serveur comme côté client.
 */
import { SCORE_REPORT_TIMEOUT_MINUTES } from "./constants";
import type { TournamentFormat } from "./types";

/** `SOON` = mode décrit mais pas encore ouvert à la création. */
export type RuleStatus = "AVAILABLE" | "SOON";

/** Identifiant du schéma illustrant le mode (rendu par `components/rules`). */
export type RuleDiagram = "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL" | "MULTI";

export type RuleFact = { label: string; value: string };

export type RuleSection = {
  title: string;
  /** Paragraphes introductifs (peut être vide si la section n'a que des points). */
  body: string[];
  bullets?: string[];
};

export type TournamentRuleMode = {
  /** Segment d'URL : `/regles/<slug>`. */
  slug: string;
  format: TournamentFormat;
  label: string;
  /** Libellé court, pour les pastilles et les cartes. */
  shortLabel: string;
  status: RuleStatus;
  tagline: string;
  /** Chiffres clés affichés en tête de page et sur la carte d'index. */
  facts: RuleFact[];
  /** Le mode en trois phrases, avant d'entrer dans le détail. */
  principles: string[];
  diagram: RuleDiagram;
  diagramCaption: string;
  sections: RuleSection[];
};

/**
 * Règles transverses, identiques à tous les modes : elles vivent ici plutôt que
 * dupliquées dans chaque mode, et sont affichées en bas de chaque page.
 */
export const COMMON_RULES: RuleSection[] = [
  {
    title: "Report des scores",
    body: [
      "Le mécanisme est le même dans tous les modes : chaque équipe déclare le score de son match depuis la page du tournoi.",
    ],
    bullets: [
      "Deux déclarations concordantes valident le match immédiatement.",
      `Une seule déclaration ouvre un délai de confirmation de ${SCORE_REPORT_TIMEOUT_MINUTES} minutes : sans contestation de l'adversaire, le score est retenu.`,
      "Deux déclarations contradictoires mettent le match en litige : un arbitre tranche et enregistre le score officiel.",
      "Un arbitre ou un administrateur peut corriger un score à tout moment.",
    ],
  },
  {
    title: "Forfait",
    body: [
      "Une équipe peut déclarer forfait à tout moment ; un arbitre peut aussi le faire à sa place.",
    ],
    bullets: [
      "Le match en cours est résolu en faveur de l'adversaire.",
      "L'équipe quitte le tournoi et n'apparaît plus dans les rounds suivants.",
      "Son classement final tient compte du moment où elle est sortie.",
    ],
  },
];

export const TOURNAMENT_RULE_MODES: TournamentRuleMode[] = [
  {
    slug: "elimination-simple",
    format: "SINGLE",
    label: "Élimination simple",
    shortLabel: "Simple élim.",
    status: "AVAILABLE",
    tagline: "Une défaite et c'est terminé. Le format le plus court et le plus lisible.",
    facts: [
      { label: "Équipes", value: "2 à 256" },
      { label: "Défaites fatales", value: "1" },
      { label: "Durée", value: "La plus courte" },
      { label: "Option", value: "Petite finale" },
    ],
    principles: [
      "Chaque match élimine une équipe : l'effectif est divisé par deux à chaque round.",
      "Le bracket est dimensionné à la puissance de 2 supérieure au nombre d'inscrites ; les places manquantes deviennent des victoires d'office au premier round.",
      "En option, les deux perdants des demi-finales s'affrontent pour la 3ᵉ place.",
    ],
    diagram: "SINGLE",
    diagramCaption:
      "Bracket à 8 équipes : quarts, demi-finales, finale. Chaque flèche suit le vainqueur.",
    sections: [
      {
        title: "Déroulé",
        body: [
          "Au démarrage du tournoi, le bracket complet est généré d'un coup à partir des équipes inscrites. Les matchs d'un round s'ouvrent dès que leurs deux participantes sont connues.",
        ],
        bullets: [
          "Un match perdu = élimination immédiate.",
          "Le vainqueur avance automatiquement au match suivant, sans intervention d'un arbitre.",
          "Le tournoi se termine quand la finale est validée.",
        ],
      },
      {
        title: "Nombre d'équipes non puissance de 2",
        body: [
          "Un bracket ne peut se jouer qu'à 2, 4, 8, 16, 32… équipes. Quand le nombre d'inscrites tombe entre deux paliers, la taille retenue est la puissance de 2 supérieure et les places vides deviennent des victoires d'office (byes).",
        ],
        bullets: [
          "Une équipe qui reçoit un bye ne joue pas le premier round et rejoint directement le second.",
          "Exemple : à 7 équipes, le bracket est à 8 — 3 matchs au premier round et 1 bye.",
          "Exemple : à 5 équipes, le bracket est à 8 — 1 match au premier round et 3 byes.",
        ],
      },
      {
        title: "Petite finale",
        body: [
          "Option choisie à la création du tournoi, disponible uniquement en élimination simple. Elle ajoute un match entre les deux perdants des demi-finales pour départager la 3ᵉ et la 4ᵉ place.",
        ],
      },
      {
        title: "Classement final",
        body: [
          "Le classement découle du round atteint : la championne, la finaliste, puis les équipes sorties en demi-finales, en quarts, et ainsi de suite. Avec la petite finale, les 3ᵉ et 4ᵉ places sont départagées sur le terrain.",
        ],
      },
    ],
  },
  {
    slug: "double-elimination",
    format: "DOUBLE",
    label: "Double élimination",
    shortLabel: "Double élim.",
    status: "AVAILABLE",
    tagline: "Un droit à l'erreur : il faut perdre deux fois pour quitter le tournoi.",
    facts: [
      { label: "Équipes", value: "2 à 256" },
      { label: "Défaites fatales", value: "2" },
      { label: "Durée", value: "≈ 2× simple élim." },
      { label: "Grande finale", value: "Un seul match" },
    ],
    principles: [
      "Deux tableaux coexistent : le bracket haut (invaincues) et le bracket bas (une défaite au compteur).",
      "Perdre dans le bracket haut fait basculer dans le bracket bas ; perdre dans le bracket bas élimine.",
      "Les deux survivantes se rencontrent en grande finale.",
    ],
    diagram: "DOUBLE",
    diagramCaption:
      "Bracket haut en bleu, bracket bas en ambre : chaque défaite en haut redescend d'un cran.",
    sections: [
      {
        title: "Bracket haut et bracket bas",
        body: [
          "Toutes les équipes démarrent dans le bracket haut. La première défaite n'élimine pas : elle fait descendre dans le bracket bas, où le tournoi continue face aux autres équipes déjà tombées.",
        ],
        bullets: [
          "Bracket haut : une défaite = descente dans le bracket bas.",
          "Bracket bas : une défaite = élimination définitive.",
          "Le bracket bas alterne les rounds d'intégration (accueil des équipes qui viennent de tomber) et les rounds d'élimination.",
        ],
      },
      {
        title: "Grande finale",
        body: [
          "La gagnante du bracket haut affronte la survivante du bracket bas. La grande finale se joue en **un seul match** : il n'y a pas de belle à rejouer si la finaliste issue du bracket bas l'emporte — elle est alors championne.",
        ],
      },
      {
        title: "Nombre d'équipes non puissance de 2",
        body: [
          "Comme en élimination simple, le bracket est dimensionné à la puissance de 2 supérieure et les places vides deviennent des victoires d'office au premier round du bracket haut.",
        ],
      },
      {
        title: "Classement final",
        body: [
          "La championne et la finaliste sortent de la grande finale ; les autres sont classées selon le round du bracket bas où elles ont été éliminées — plus une équipe tient, mieux elle est classée.",
        ],
      },
    ],
  },
  {
    slug: "survie",
    format: "SURVIVAL",
    label: "Survie",
    shortLabel: "Survie",
    status: "AVAILABLE",
    tagline: "Un seul groupe, des coupes régulières, une seule survivante.",
    facts: [
      { label: "Structure", value: "Groupe unique" },
      { label: "Coupe", value: "2 dernières" },
      { label: "Seed initial", value: "Classement du site" },
      { label: "Effectif impair", value: "Barrage" },
    ],
    principles: [
      "Pas d'arbre : toutes les équipes restent dans un même groupe, classé et reclassé à chaque round.",
      "À chaque round, les équipes sont appariées par paires adjacentes au classement : 1 vs 2, 3 vs 4, 5 vs 6…",
      "À intervalle régulier, les deux dernières du classement sont éliminées, jusqu'à la championne.",
    ],
    diagram: "SURVIVAL",
    diagramCaption:
      "Le classement est rejoué à chaque round ; la zone rouge est la zone de coupe.",
    sections: [
      {
        title: "Classement de départ",
        body: [
          "Le seeding initial vient du classement du site, calculé sur l'ensemble des matchs joués toutes compétitions confondues (victoire = 3 points, défaite = 1 point). Seed 1 = meilleure équipe.",
        ],
      },
      {
        title: "Appariement et reclassement",
        body: [
          "Chaque round oppose les équipes deux à deux dans l'ordre du classement courant : la 1ʳᵉ affronte la 2ᵉ, la 3ᵉ affronte la 4ᵉ, et ainsi de suite. Les meilleures se rencontrent donc entre elles, les plus fragiles aussi.",
        ],
        bullets: [
          "Après chaque round, le classement est recalculé : victoires (décroissant), puis défaites (croissant), puis seed initial.",
          "Une équipe qui gagne remonte et affrontera plus fort ; une équipe qui perd descend vers la zone de coupe.",
        ],
      },
      {
        title: "Coupes",
        body: [
          "La cadence est fixée à la création du tournoi, en deux réglages : le nombre de manches avant la **première** coupe, puis l'intervalle entre les coupes suivantes. On peut ainsi laisser le classement se former avant d'éliminer, puis accélérer. À chaque coupe, les **deux dernières équipes** du classement sortent.",
        ],
        bullets: [
          "La zone de coupe est signalée en direct dans le classement : on sait toujours qui est au bord du tableau.",
          "Quand il ne resterait plus personne, la coupe n'élimine qu'une équipe : il y a toujours une championne unique.",
        ],
      },
      {
        title: "Nombre d'équipes impair : le barrage",
        body: [
          "Un effectif impair obligerait à distribuer une victoire d'office à chaque round — et comme une coupe retire deux équipes, l'effectif resterait impair jusqu'au bout. Le mode corrige donc la parité dès l'ouverture.",
        ],
        bullets: [
          "Inscriptions impaires : le round 1 est un barrage entre les deux dernières du classement, le perdant est éliminé. Les autres équipes entrent en lice au round suivant.",
          "Le barrage ne compte pas dans la cadence des coupes : elle démarre au premier round complet.",
          "Si un forfait recasse la parité en cours de tournoi, la coupe suivante n'élimine qu'une équipe au lieu de deux pour revenir à un effectif pair.",
          "Conséquence : hors forfait, aucune victoire d'office n'est distribuée, quel que soit le nombre d'inscrites.",
        ],
      },
      {
        title: "Classement final",
        body: [
          "La championne obtient le rang 1. Les autres sont classées par round d'élimination décroissant — sortir tard vaut mieux que sortir tôt — puis par victoires, défaites et seed initial.",
        ],
      },
    ],
  },
  {
    slug: "ronde-suisse",
    format: "SWISS",
    label: "Ronde suisse",
    shortLabel: "Suisse",
    status: "SOON",
    tagline:
      "Un nombre de rondes fixe, aucune élimination, un classement fiable en peu de matchs.",
    facts: [
      { label: "Statut", value: "Bientôt" },
      { label: "Élimination", value: "Aucune" },
      { label: "Rondes", value: "⌈log₂(N)⌉ + 1" },
      { label: "Départages", value: "Buchholz & co." },
    ],
    principles: [
      "Toutes les équipes jouent le même nombre de rondes, fixé à l'avance : personne n'est éliminé en cours de route.",
      "À chaque ronde, on affronte une équipe ayant le même nombre de points que soi.",
      "Le classement final se lit aux points, départagés par la difficulté du parcours.",
    ],
    diagram: "SWISS",
    diagramCaption:
      "Après chaque ronde, les équipes se regroupent par score et s'affrontent à l'intérieur de leur groupe.",
    sections: [
      {
        title: "Principe",
        body: [
          "Le système suisse produit un classement fiable avec beaucoup moins de matchs qu'un championnat complet : au lieu d'affronter tout le monde, chaque équipe affronte à chaque ronde une adversaire de niveau équivalent au tournoi.",
        ],
        bullets: [
          "Le nombre de rondes est fixé au lancement (recommandation : ⌈log₂(nombre d'équipes)⌉ + 1).",
          "Aucune élimination : une équipe qui perd ses premiers matchs joue quand même jusqu'au bout.",
        ],
      },
      {
        title: "Appariements",
        body: [
          "La première ronde suit le seeding. Ensuite, les équipes sont regroupées par nombre de points et appariées à l'intérieur de leur groupe.",
        ],
        bullets: [
          "Les invaincues jouent contre les invaincues, celles à une défaite entre elles, etc.",
          "Deux équipes ne se rencontrent normalement jamais deux fois.",
          "Si l'effectif est impair, une équipe reçoit une victoire d'office — jamais deux fois la même tant que c'est évitable.",
        ],
      },
      {
        title: "Classement et départages",
        body: [
          "Le classement se fait aux points. À égalité, les départages mesurent la difficulté du parcours plutôt que le hasard des appariements : Buchholz (somme des points des adversaires), Sonneborn-Berger, pourcentage de victoires des adversaires, confrontation directe.",
        ],
      },
      {
        title: "Ouverture",
        body: [
          "Le moteur d'appariement est déjà en place côté plateforme, mais le format n'est pas encore proposé à la création d'un tournoi. Il sera activé une fois la phase de test terminée.",
        ],
      },
    ],
  },
  {
    slug: "multi-phases",
    format: "MULTI",
    label: "Tournoi multi-phases",
    shortLabel: "Multi-phases",
    status: "AVAILABLE",
    tagline: "Plusieurs phases enchaînées, chacune éliminant les plus faibles, jusqu'à la championne.",
    facts: [
      { label: "Phases", value: "2 à 8" },
      { label: "Qualification", value: "Nombre ou %" },
      { label: "Formats", value: "Combinables" },
      { label: "Finalité", value: "Une championne" },
    ],
    principles: [
      "Chaque phase se joue dans son propre format et ne transmet que ses qualifiées à la suivante.",
      "La qualification peut être fixe (un nombre d'équipes) ou adaptative (un pourcentage de l'effectif réel).",
      "La dernière phase désigne la championne ; les autres équipes sont classées par la phase la plus avancée qu'elles ont atteinte, puis par leur rang dans cette phase.",
    ],
    diagram: "MULTI",
    diagramCaption:
      "Exemple : ronde suisse (128 → 64), survie (64 → 16), double élimination (16 → 1). Chaque phase affine le podium.",
    sections: [
      {
        title: "Enchaînement des phases",
        body: [
          "Le tournoi se divise en une succession de phases numérotées. Chaque phase joue indépendamment dans son format (simple élimination, double élimination, suisse, survie) et établit son propre classement.",
        ],
        bullets: [
          "Seules les qualifiées de la phase N accèdent à la phase N+1.",
          "Les équipes non qualifiées quittent le tournoi, leur rang final fixé par la dernière phase qu'elles ont atteinte.",
          "La dernière phase désigne la championne et tout le podium final.",
        ],
      },
      {
        title: "Qualification : nombre fixe ou pourcentage",
        body: [
          "Chaque phase définit le nombre d'équipes qui avancent vers la suivante. Deux réglages sont possibles :",
        ],
        bullets: [
          "**Nombre fixe** (ex. 64 équipes) : la phase cherche à éliminer jusqu'à ce qu'il en reste 64. Si l'effectif réel est déjà ≤ 64, la phase saute et tout le groupe avance. Un effectif fixe sur une élimination simple est arrondi à la puissance de 2 inférieure ou égale.",
          "**Pourcentage** (ex. 50%) : la phase adapte dynamiquement — si 128 équipes entrent, 64 sortent ; si 100 entrent, 50 sortent.",
        ],
      },
      {
        title: "Combinaisons possibles",
        body: [
          "La ronde suisse et la survie coupent naturellement l'effectif et peuvent commencer une cascade. La double élimination est autorisée uniquement en phase finale (elle demande trop de matchs pour être utilisée en amont).",
        ],
        bullets: [
          "Exemple viable : ronde suisse → survie → simple élimination.",
          "Exemple viable : simple élimination → double élimination (dernière phase).",
          "Non viable : ronde suisse → double élimination (sauf si c'est la dernière phase).",
        ],
      },
      {
        title: "Classement final",
        body: [
          "Le classement se construit du haut vers le bas : d'abord par la phase atteinte (plus tard = mieux), puis par le rang dans cette phase.",
        ],
        bullets: [
          "La gagnante de la dernière phase = classement 1ʳ.",
          "Une équipe éliminée en phase 3 rank 2 devance une équipe éliminée en phase 2 rank 1.",
          "À égalité de phase et rang, les départages se font sur les victoires et défaites au sein de la phase.",
        ],
      },
    ],
  },
];

/** Modes ouverts à la création, dans l'ordre d'affichage. */
export function availableRuleModes(): TournamentRuleMode[] {
  return TOURNAMENT_RULE_MODES.filter((m) => m.status === "AVAILABLE");
}

/** Modes documentés mais pas encore ouverts. */
export function upcomingRuleModes(): TournamentRuleMode[] {
  return TOURNAMENT_RULE_MODES.filter((m) => m.status === "SOON");
}

/** Résout un mode depuis son slug d'URL (null si inconnu). */
export function ruleModeBySlug(slug: string): TournamentRuleMode | null {
  return TOURNAMENT_RULE_MODES.find((m) => m.slug === slug) ?? null;
}

/**
 * Résout un mode depuis le format stocké en base — utilisé par le bouton d'aide
 * flottant des pages de tournoi.
 */
export function ruleModeForFormat(format: TournamentFormat): TournamentRuleMode | null {
  return TOURNAMENT_RULE_MODES.find((m) => m.format === format) ?? null;
}

/** URL des règles d'un format, ou l'index si le format est inconnu. */
export function rulesHrefForFormat(format: TournamentFormat): string {
  const mode = ruleModeForFormat(format);
  return mode ? `/regles/${mode.slug}` : "/regles";
}
