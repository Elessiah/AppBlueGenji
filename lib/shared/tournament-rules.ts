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
import { MIN_MINUTES_PER_REPORTED_MAP } from "./score-report-deadline";
import { LAUNCH_AUTO_DELAY_MINUTES } from "./match-launch";
import { RANKING_SEEDING_RULE } from "./ranking";
import type { TournamentFormat } from "./types";

/** `SOON` = mode décrit mais pas encore ouvert à la création. */
export type RuleStatus = "AVAILABLE" | "SOON";

/** Identifiant du schéma illustrant le mode (rendu par `components/rules`). */
export type RuleDiagram = "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL" | "MULTI" | "BG_SURVIE";

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
    title: "Lancement d'un match",
    body: [
      "Un match jouable ne commence pas d'emblée : à son heure de début (ou dès qu'il est jouable s'il n'a pas d'horaire), il entre en **lancement**. Une fenêtre s'ouvre alors pour les joueurs des deux équipes, avec l'équipe hôte et les contacts utiles.",
    ],
    bullets: [
      "Chaque équipe confirme qu'elle est prête — capitaine, manager ou propriétaire ; en tournoi individuel, le joueur lui-même. Le caster inscrit confirme aussi.",
      `Le match est lancé quand toutes les parties sont prêtes, quand un arbitre le force, ou d'office au bout de ${LAUNCH_AUTO_DELAY_MINUTES} minutes.`,
      "Aucun score ne peut être déclaré avant le lancement.",
    ],
  },
  {
    title: "Format des matchs",
    body: [
      "Le format des matchs (BO — nombre de maps au maximum — ou FT — nombre de maps à gagner) est fixé à la création et vaut pour tout le tournoi. Sans réglage, le score est libre.",
    ],
    bullets: [
      "Un score qui dépasse le format, ou qui ne désigne pas de vainqueur quand le format en exige un, est refusé à la saisie.",
      "Le match nul n'existe que si le tournoi l'autorise ; il ne s'applique jamais à un arbre à élimination directe.",
    ],
  },
  {
    title: "Report des scores",
    body: [
      "Le mécanisme est le même dans tous les modes : chaque équipe déclare le score de son match depuis la page du tournoi, par son capitaine, un de ses managers ou son propriétaire (le joueur lui-même en tournoi individuel).",
    ],
    bullets: [
      "Deux déclarations concordantes valident le match immédiatement.",
      `Une seule déclaration ouvre un délai de confirmation de ${SCORE_REPORT_TIMEOUT_MINUTES} minutes, qui ne court qu'après une durée de série plausible depuis le lancement (${MIN_MINUTES_PER_REPORTED_MAP} minutes par map que le format autorise) : sans contestation de l'adversaire, le score est retenu.`,
      "Deux déclarations contradictoires mettent le match en litige : un arbitre tranche et enregistre le score officiel.",
      "Un arbitre ou un administrateur peut corriger un score tant que la manche suivante n'a reçu aucune saisie ; au-delà, le score est verrouillé, y compris pour lui.",
    ],
  },
  {
    title: "Forfait",
    body: [
      "Un arbitre peut prononcer le forfait d'une équipe sur un match : la rencontre est résolue en faveur de l'adversaire. Pour elle, c'est une défaite comme une autre : en élimination simple elle sort, en double élimination elle descend au bracket bas, en BlueGenji Survie elle perd le score plein du format et reste en lice avec le capital qui lui reste.",
    ],
    bullets: [
      "En Survie par coupes, en Ronde suisse et en BlueGenji Survie, une équipe peut aussi se retirer du reste du tournoi pendant qu'il est en cours (ou l'arbitre l'en retirer) : elle n'est plus appariée.",
      "Son classement final tient compte du moment où elle est sortie.",
    ],
  },
  {
    title: "Double forfait",
    body: [
      "Quand aucune des deux équipes ne se présente, l'arbitre prononce un **double forfait** : le match est clos sans vainqueur ni score, et les deux équipes le perdent.",
    ],
    bullets: [
      "En élimination, les deux équipes sortent et personne ne monte : le match suivant devient une victoire d'office pour l'autre qualifiée.",
      "En Ronde suisse et en Survie par coupes, chacune encaisse une défaite ; en qualification BlueGenji Survie, chacune perd le score plein du format.",
      "En finale, un double forfait ne désigne pas de championne : les deux finalistes sont classées 2ᵉ ex æquo.",
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
      "Bracket haut en bleu, bracket bas en violet : chaque défaite en haut redescend d'un cran.",
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
    slug: "bluegenji-survie",
    format: "BG_SURVIE",
    label: "BlueGenji Survie",
    shortLabel: "BG Survie",
    status: "AVAILABLE",
    tagline:
      "Un capital d'endurance qui fond à chaque map perdue, puis un arbre à huit. Personne n'est coupé : on sort quand son capital est vide.",
    facts: [
      { label: "Capital", value: "9 points par défaut" },
      { label: "Barème", value: "+1 / −1 par map" },
      { label: "Élimination", value: "À 0 point" },
      { label: "Play-offs", value: "8 équipes" },
    ],
    principles: [
      "Chaque équipe démarre avec un capital d'endurance : une map gagnée le fait monter, une map perdue le fait descendre.",
      "Tomber à zéro élimine immédiatement — personne n'est éliminé par une coupe, seulement par ses propres résultats. C'est ce qui la distingue de la **Survie par coupes**, où les deux dernières sortent à intervalle régulier.",
      "Quand il ne reste que huit équipes — ou au bout du nombre de manches annoncé, si le tournoi en fixe un —, la phase qualificative s'arrête et laisse place à un arbre à élimination directe.",
    ],
    diagram: "BG_SURVIE",
    diagramCaption:
      "L'endurance monte et descend à chaque map ; à zéro l'équipe sort. Les huit dernières se rencontrent selon un tableau fixe.",
    sections: [
      {
        title: "Classement de départ",
        body: [
          RANKING_SEEDING_RULE,
          "L'arbitre peut **réordonner** ce classement tant qu'aucun score n'a été saisi : son ordre prime alors. C'est ce classement qui décide des premiers appariements.",
        ],
      },
      {
        title: "Phase qualificative — l'endurance",
        body: [
          "Chaque équipe reçoit le même capital de départ (9 points par défaut, réglable à la création). Une victoire de map rapporte un point, une défaite en retire un : un match gagné 3-0 déplace donc trois points, un 3-2 un seul.",
        ],
        bullets: [
          "Une équipe dont le capital atteint zéro est éliminée sur-le-champ.",
          "Un forfait compte comme le score maximal du format du tournoi : en FT3, l'équipe forfait encaisse un 3-0 et perd trois points d'endurance.",
          "Le classement est relu avant chaque manche : endurance décroissante, puis — à égalité — l'ordre du classement précédent.",
          "Les équipes s'affrontent par couples adjacents : 1ʳᵉ contre 2ᵉ, 3ᵉ contre 4ᵉ, et ainsi de suite.",
          "La mieux classée du couple prend le side gauche, l'autre le side droite.",
          "Sur un effectif impair, la dernière du classement ne joue pas cette manche : son capital reste intact, sans victoire d'office.",
        ],
      },
      {
        title: "Le match nul en qualification",
        body: [
          "Overwatch et Marvel Rivals connaissent la **map nulle**. Le tournoi peut donc ouvrir l'égalité sur sa phase qualificative : un BO5 s'y joue **sans tiebreaker**, et s'arrête quand les maps sont épuisées — même si personne n'a atteint les trois manches.",
          "Le capital n'a besoin d'aucune règle de plus : il se compte **map par map**. Un 2-2 rapporte deux points à chacune et leur en retire deux — donc rien, au barème par défaut. Un 2-1 suit le même calcul, un point net pour la gagnante.",
        ],
        bullets: [
          "N'importe quel score tenant dans le plafond de maps clôt la rencontre : 2-2, 2-1, et jusqu'à 0-0 si aucune map n'a été départagée.",
          "Une map nulle ne figure dans aucun des deux scores — elle allonge la rencontre sans entamer le plafond.",
          "Un match nul ne compte ni victoire ni défaite : il apparaît à part au classement, et rompt les séries des fiches d'équipe.",
          "**L'arbre final n'accepte jamais d'égalité**, quel que soit le réglage : il lui faut savoir qui joue le tour suivant. Le tournoi peut lui donner son propre format — un vrai FT3, là où la qualification tolère le nul.",
        ],
      },
      {
        title: "Fin de la phase qualificative",
        body: [
          "La phase s'arrête à la fin de la manche où il ne reste plus que huit équipes (ou moins) : une manche entamée est toujours jouée jusqu'au bout. Sans autre réglage, aucune durée maximale n'est imposée : c'est l'endurance seule qui fait le tri.",
          "Le tournoi peut cependant annoncer un **nombre maximal de manches**. La phase s'arrête alors à la manche dite, et les huit premières du classement sont qualifiées — même si elles étaient encore trente en lice. Les autres sortent avec le capital qu'il leur restait : elles ne sont pas « éliminées », elles sont **hors course**.",
        ],
        bullets: [
          "Sous ce plafond, une équipe qui ne peut plus mathématiquement rejoindre les huit premières dans les manches restantes est écartée sans attendre la fin.",
          "Le calcul est prudent : il faut que huit équipes la devancent quoi qu'il arrive, en supposant qu'elle gagne tout ce qui reste et qu'elles perdent tout ce qui reste.",
          "Il suppose donc un format de match connu (BO/FT), qui borne le nombre de maps d'une manche. En saisie libre, aucune équipe n'est jamais écartée d'avance.",
          "Si cette sortie devait laisser un nombre impair d'équipes en course, elle est reportée d'une manche : un effectif impair condamne une équipe au repos, et on ne pénalise pas une équipe en course pour sortir des équipes déjà condamnées.",
        ],
      },
      {
        title: "Phase éliminatoire",
        body: [
          "Les huit qualifiées jouent un arbre à élimination directe. Les affrontements ne suivent pas le seeding classique mais un tableau fixe, dans cet ordre d'affichage :",
        ],
        bullets: [
          "Match 1 : 8ᵉ contre 4ᵉ",
          "Match 2 : 6ᵉ contre 2ᵉ",
          "Match 3 : 1ʳᵉ contre 5ᵉ",
          "Match 4 : 3ᵉ contre 7ᵉ",
          "L'équipe affichée au-dessus prend le side gauche, celle du dessous le side droite.",
          "Une petite finale départage la 3ᵉ place, jouée en parallèle de la finale.",
          "Le vainqueur du match 1 affronte celui du match 2 en demi-finale, le vainqueur du match 3 celui du match 4.",
          "L'arbre ne connaît pas le match nul : il se joue au format propre aux play-offs s'il en a un, sinon au format du tournoi, égalité fermée.",
        ],
      },
      {
        title: "Pénalités d'endurance",
        body: [
          "L'arbitrage peut retirer des points de capital sans passer par un score de match : retard, joueur non éligible, conduite antisportive. Chaque sanction porte un motif, public, et figure au journal des sanctions sous le classement.",
        ],
        bullets: [
          "La pénalité s'applique à la manche en cours, après ses matchs : si elle vide le capital, l'équipe est éliminée comme par une défaite.",
          "Elle peut être levée tant qu'aucune manche suivante n'a reçu de score ; le classement est alors recalculé comme si elle n'avait jamais existé.",
          "Aucune pénalité ne se pose ni ne se lève une fois l'arbre des play-offs lancé.",
          "Au classement, « −N » à côté du capital indique ce que les pénalités ont réellement retiré.",
        ],
      },
      {
        title: "Forfait : deux gestes à ne pas confondre",
        body: [
          "Un forfait ne fait jamais match blanc : il compte pour le score maximal du format du tournoi. En FT3, l'équipe absente encaisse un 3-0 — trois points d'endurance en moins pour elle, trois de plus pour son adversaire — et la rencontre entre au palmarès des deux équipes comme une victoire et une défaite pleines.",
        ],
        bullets: [
          "Forfait sur une manche : l'équipe ne se présente pas à une rencontre. L'arbitre le déclare sur le match ; l'équipe reste engagée et joue la manche suivante avec le capital qui lui reste.",
          "Forfait sur le reste du tournoi : l'équipe se retire, ou l'arbitre l'en retire. Son capital tombe à zéro, elle ne sera plus appariée, et le classement est aussitôt recalculé — la manche suivante est réappariée en conséquence.",
          "Dans le tableau manche par manche, une équipe retirée n'affiche plus de capital : ses manches restantes portent « FF » en rouge, à la manière de la feuille de calcul d'arbitrage.",
          "Le retrait définitif n'est possible que pendant la phase qualificative. Une fois l'arbre des play-offs lancé, un forfait se tranche sur le match, qui fait avancer le tableau.",
        ],
      },
    ],
  },
  {
    slug: "survie",
    format: "SURVIVAL",
    label: "Survie par coupes",
    shortLabel: "Survie par coupes",
    status: "AVAILABLE",
    tagline:
      "Un seul groupe, des coupes à cadence fixe, une seule survivante. Ce sont les coupes qui éliminent, pas un capital de points.",
    facts: [
      { label: "Structure", value: "Groupe unique" },
      { label: "Coupe", value: "2 dernières" },
      { label: "Seed initial", value: "Classement du site" },
      { label: "Effectif impair", value: "Barrage" },
    ],
    principles: [
      "Pas d'arbre : toutes les équipes restent dans un même groupe, classé et reclassé à chaque round.",
      "À chaque round, les équipes sont appariées par paires adjacentes au classement : 1 vs 2, 3 vs 4, 5 vs 6…",
      "À intervalle régulier, les deux dernières du classement sont éliminées, jusqu'à la championne. À ne pas confondre avec **BlueGenji Survie**, où chaque équipe sort quand son capital d'endurance est vide, sans coupe.",
    ],
    diagram: "SURVIVAL",
    diagramCaption:
      "Le classement est rejoué à chaque round ; la zone rose est la zone de coupe.",
    sections: [
      {
        title: "Classement de départ",
        body: [
          RANKING_SEEDING_RULE,
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
    status: "AVAILABLE",
    tagline:
      "Un nombre de rondes fixe, aucune élimination, un classement fiable en peu de matchs.",
    facts: [
      { label: "Équipes", value: "2 à 256" },
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
          "Le nombre de rondes est fixé à la création (recommandation : ⌈log₂(nombre d'équipes)⌉ + 1, proposée par défaut).",
          "Aucune élimination : une équipe qui perd ses premiers matchs joue quand même jusqu'au bout.",
          "Le barème est réglable à la création : 3 points la victoire, 1 le nul, 0 la défaite par défaut.",
        ],
      },
      {
        title: "Première ronde",
        body: [
          RANKING_SEEDING_RULE,
        ],
        bullets: [
          "La moitié haute du seeding affronte la moitié basse : la 1ʳᵉ rencontre la (N/2 + 1)ᵉ, et ainsi de suite.",
          "Les têtes de série ne s'éliminent donc pas entre elles dès l'ouverture.",
        ],
      },
      {
        title: "Appariements des rondes suivantes",
        body: [
          "Les équipes sont regroupées par nombre de points et appariées à l'intérieur de leur groupe. Le tirage explore les combinaisons possibles pour éviter les rematchs, quitte à piocher dans le groupe voisin quand un groupe est bloqué.",
        ],
        bullets: [
          "Les invaincues jouent contre les invaincues, celles à une défaite entre elles, etc.",
          "Deux équipes ne se rencontrent jamais deux fois tant qu'une autre combinaison existe.",
          "Si l'effectif est impair, une équipe reçoit une victoire d'office, qui vaut exactement une victoire — attribuée à la plus basse du classement n'en ayant pas encore reçu.",
          "Une correction de score en amont réapparie automatiquement la ronde suivante, tant qu'aucun score n'y a été saisi.",
        ],
      },
      {
        title: "Classement et départages",
        body: [
          "Le classement se fait aux points, recalculé après chaque match. À égalité, les départages mesurent la difficulté du parcours plutôt que le hasard des appariements ; ils s'appliquent dans cet ordre :",
        ],
        bullets: [
          "Buchholz : somme des points des adversaires rencontrés.",
          "Sonneborn-Berger : somme des points des adversaires battus (moitié pour un nul).",
          "Pourcentage de victoires des adversaires rencontrés.",
          "Confrontation directe entre les équipes à départager.",
          "En dernier ressort, le seed initial — jamais un tirage au sort.",
        ],
      },
      {
        title: "Abandon",
        body: [
          "Comme en Survie par coupes, une équipe peut quitter le tournoi en cours de route. Elle conserve les points déjà acquis mais n'est plus appariée, et passe derrière toutes les équipes encore en lice au classement final.",
        ],
      },
      {
        title: "Classement final",
        body: [
          "Le tournoi se termine à l'issue de la dernière ronde prévue : la tête du classement est championne. Il n'y a pas de finale — le classement fait foi.",
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
