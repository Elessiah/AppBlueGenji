/**
 * Changements du traitement des données personnelles, et ce que chaque compte
 * en a déjà accepté.
 *
 * **Ajouter une entrée à `PRIVACY_CHANGES` est le seul geste à faire** quand
 * une modification change ce que le site collecte, qui le lit, combien de temps
 * il le garde ou ce qu'une suppression emporte. Rien d'autre n'est à brancher :
 *
 * - la modale `PrivacyChangesModal` (montée par `app/layout.tsx`) la présente à
 *   chaque compte **une seule fois**, avec un bouton « J'accepte » et un bouton
 *   « Je refuse, je supprime mon compte » ;
 * - les changements **se cumulent** — un joueur revenu après trois entrées les
 *   voit toutes les trois dans la même modale, et une acceptation les acquitte
 *   ensemble (`bg_privacy_acknowledgments`, une ligne par changement) ;
 * - chaque compte joignable sur Discord en reçoit un résumé en message privé,
 *   une seule fois par changement (`lib/server/privacy-change-notifications.ts`) ;
 * - la mention « Dernière mise à jour » de `/rgpd` suit la dernière entrée.
 *
 * Module **pur** : le registre, la décision « qu'est-ce que ce compte n'a pas
 * encore vu ? » et la rédaction du message Discord se testent sans base.
 *
 * Voir `docs/features/PRIVACY_CHANGES_CONSENT.md`.
 */

import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_DAYS } from "@/lib/shared/logo-quarantine";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
} from "@/lib/shared/account-deletion-journal";

/** Un changement du traitement des données, tel qu'il est présenté au joueur. */
export type PrivacyChange = {
  /**
   * Identifiant **stable** : c'est lui qu'on enregistre à l'acceptation. Le
   * renommer ferait réapparaître le changement à tous ceux qui l'ont accepté.
   * Minuscules, chiffres et tirets (`PRIVACY_CHANGE_ID_PATTERN`).
   */
  id: string;
  /**
   * Date de publication, `AAAA-MM-JJ`. Un compte **créé ce jour-là ou après**
   * ne voit pas le changement : il a consenti à la politique déjà à jour en
   * s'inscrivant. Poser la date de mise en production prévue.
   */
  publishedAt: string;
  /** Titre court, affiché en tête du changement et dans le message Discord. */
  title: string;
  /** Une ou deux phrases qui disent l'essentiel — reprises dans le message Discord. */
  summary: string;
  /** Le détail, une puce par règle. */
  details: readonly string[];
};

/**
 * Événement de fenêtre émis quand le joueur a accepté les changements
 * présentés. Les autres modales de la mise en page racine (lancement d'un match)
 * attendent ce signal pour s'ouvrir : deux modales ouvertes ensemble se
 * disputeraient le piège de focus, et celle du dessous le gagnerait.
 */
export const PRIVACY_CHANGES_ANSWERED_EVENT = "bg:privacy-changes-answered";

/** Forme d'un identifiant de changement. */
export const PRIVACY_CHANGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longueur maximale d'un identifiant — la colonne `change_id` est un `VARCHAR(80)`. */
export const PRIVACY_CHANGE_ID_MAX_LENGTH = 80;

/**
 * Le registre, **dans l'ordre de publication** et en ajout seul : une entrée
 * publiée ne se retire ni ne se renomme (son identifiant est en base chez
 * chaque compte qui l'a acceptée). Une erreur de rédaction se corrige sur
 * place ; un changement de fond est une **nouvelle** entrée.
 */
export const PRIVACY_CHANGES: readonly PrivacyChange[] = [
  {
    id: "2026-09-recapitulatif-rgpd",
    publishedAt: "2026-09-23",
    title: "Récapitulatif des règles en vigueur",
    summary:
      "Nous avons revu la façon dont BlueGenji traite tes données. Voici, en une fois, les règles qui s'appliquent aujourd'hui à ton compte.",
    details: [
      "Aucune adresse e-mail n'est plus demandée ni conservée : celles collectées auparavant ont été supprimées. Ton compte ne tient qu'à des pseudonymes et aux identifiants techniques des services par lesquels tu te connectes (Google, Discord, Blizzard).",
      "Un compte ne se rattache plus à un autre par son adresse : c'est toi qui ajoutes ou retires un moyen de connexion, depuis « Applications connectées » dans Mon profil. Le dernier ne peut pas être retiré, sans quoi plus personne ne pourrait entrer.",
      "Ton tag Discord reste invisible de tous tant qu'il n'est pas certifié. Une fois certifié (par un code, ou en te connectant avec Discord), l'organisation peut le lire pour te joindre pendant un tournoi : les administrateurs en permanence, les arbitres tant que tu es engagé dans un tournoi en cours. Jamais le public.",
      "Si tu rattaches ton compte Battle.net, Blizzard renseigne ton BattleTag et le remplace à chaque connexion. Sa visibilité sur ton profil ne change pas.",
      "Ta photo de profil est copiée sur nos serveurs à la connexion : aucune page du site ne fait plus appel à Google pour l'afficher, et un avatar que tu masques l'est partout, accueil compris.",
      "Supprimer ton compte l'efface entièrement s'il n'a laissé aucune trace. S'il a joué ou organisé un tournoi, ou s'il possède une équipe, il est anonymisé et seul le palmarès sportif reste. Tu peux exporter tes données à tout moment depuis Mon profil.",
      "Seuls des cookies techniques sont déposés. La fréquentation du site est mesurée par une empreinte non réversible : ni ton adresse IP ni ton compte ne sont enregistrés avec tes visites. Le flux d'activité public du bot n'affiche aucun identifiant Discord.",
      "Le journal d'activité que le staff suit sur Discord ne nomme aucun joueur : il parle d'équipes et écrit « un joueur », y compris en tournoi individuel.",
    ],
  },
  // Durées lues sur les constantes que `/rgpd` affiche déjà : la modale ne peut
  // pas annoncer une autre durée que la politique. Les changer est en soi un
  // changement du traitement — il appelle une **nouvelle** entrée.
  {
    id: "2026-09-sauvegardes-chiffrees",
    publishedAt: "2026-09-23",
    title: "Sauvegardes chiffrées et suppressions garanties",
    summary:
      `La plateforme est sauvegardée dans des archives chiffrées gardées ${BACKUP_RETENTION_DAYS} jours, et une suppression de compte reste acquise même si une sauvegarde est restaurée.`,
    details: [
      `La base de données est sauvegardée chaque semaine dans une archive chiffrée avant envoi, avec une clé que seule l'association détient, puis hébergée chez Microsoft (OneDrive), qui la stocke sans pouvoir la lire. Chaque archive est détruite au bout de ${BACKUP_RETENTION_DAYS} jours, sans passer par une corbeille.`,
      "Les images téléversées (avatars, logos) sont copiées, chiffrées, chaque heure. Une image retirée du site disparaît de la sauvegarde dans l'heure.",
      `Une donnée supprimée peut donc subsister jusqu'à ${BACKUP_RETENTION_DAYS} jours dans ces archives, qu'on ne peut pas corriger une à une. Pour qu'elle ne revienne jamais, chaque suppression de compte est notée dans un journal — numéro et date de création du compte, date de suppression, rien d'autre — gardé ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours : si une sauvegarde devait être restaurée, les suppressions intervenues depuis sont réappliquées avant la remise en service.`,
    ],
  },
  // Le masquage du BattleTag ne valait jusqu'ici pour personne d'autre que son
  // titulaire, alors que la modale de `/profil` annonçait déjà l'exception :
  // c'est l'**application** de la règle qui élargit qui le lit.
  {
    id: "2026-09-battletag-masque-matchs",
    publishedAt: "2026-09-24",
    title: "BattleTag masqué : lisible là où il sert à jouer",
    summary:
      "Un BattleTag masqué reste hors de ta fiche publique et de l'annuaire, mais les joueurs de tes matchs et l'arbitrage peuvent le lire tant que le tournoi n'est pas terminé.",
    details: [
      "Les autres joueurs d'un match que tu disputes (adversaires et coéquipiers) lisent ton BattleTag sur ta fiche, même masqué : c'est par lui qu'on s'ajoute en jeu pour lancer la partie.",
      "Les arbitres et les administrateurs le lisent aussi tant que tu es engagé dans un tournoi qui n'est pas terminé. En dehors, un administrateur ne voit pas un BattleTag masqué.",
      "Ces accès s'éteignent à la fin du tournoi. Pour ne plus communiquer ton BattleTag du tout, efface-le depuis Mon profil.",
    ],
  },
  // L'invite Google One Tap était chargée sur chaque page pour tout visiteur
  // sans session : Google était sollicité sans que personne l'ait demandé. Le
  // changement restreint qui lit la donnée — c'en est un quand même.
  {
    id: "2026-09-google-one-tap-connexion",
    publishedAt: "2026-09-24",
    title: "Google sollicité sur la seule page de connexion",
    summary:
      "L'invite « Continuer avec Google » ne se charge plus sur tout le site : seulement sur la page de connexion, et après que tu as accepté la politique de confidentialité.",
    details: [
      "Auparavant, tout visiteur non connecté chargeait l'invite de connexion de Google (Google One Tap) sur chaque page : Google recevait son adresse IP et la page consultée.",
      "Désormais, aucune page du site ne fait appel à Google, sauf la page de connexion, une fois la politique acceptée. Google peut y déposer un cookie « g_state » pour retenir que tu as fermé l'invite.",
      "Rien ne change pour ton compte : les moyens de connexion et les données conservées restent les mêmes.",
    ],
  },
  // Lancement des matchs : la modale présente à chaque partie d'un match les
  // contacts des autres — c'est un public de plus pour le tag Discord certifié,
  // et un nouveau public (le caster) pour le BattleTag.
  {
    id: "2026-09-lancement-des-matchs",
    publishedAt: "2026-09-25",
    title: "Lancement des matchs : tes contacts présentés à ton adversaire et au caster",
    summary:
      "Au lancement d'un match, les deux équipes et le caster voient le tag Discord certifié et le BattleTag d'un ou deux joueurs de chaque équipe.",
    details: [
      "Pour chaque équipe, le site présente le capitaine, un manager ou le propriétaire — en priorité un joueur dont le tag Discord ou le BattleTag est vérifié —, et un second joueur si c'est le seul moyen d'avoir à la fois un contact Discord et un BattleTag.",
      "Un tag Discord non certifié n'est jamais montré. Un BattleTag l'est même non vérifié, avec la mention « non vérifié » : c'est par lui qu'on s'ajoute en jeu.",
      "Le caster inscrit sur un match se présente de la même façon aux deux équipes, et voit leurs contacts : s'inscrire pour caster exige un tag Discord certifié et un compte Battle.net rattaché.",
      "Ces informations ne sont visibles qu'entre les parties du match, à partir de son lancement et jusqu'à ce qu'il soit terminé. Le site garde aussi l'heure à laquelle chaque partie s'est déclarée prête, avec le match.",
    ],
  },
  // La suppression change ce qu'elle emporte : l'effacement complet s'étend à
  // tout compte qui n'a joué aucun match, et le compte conservé perd son
  // pseudo au profit d'un pseudo d'emprunt, ses rôles et ses consentements.
  {
    id: "2026-09-suppression-pseudo-emprunt",
    publishedAt: "2026-09-25",
    title: "Suppression de compte : effacement élargi, pseudo de remplacement",
    summary:
      "Un compte supprimé qui n'a joué aucun match est désormais effacé entièrement. Un compte qui a joué garde ses résultats sous un pseudo d'emprunt.",
    details: [
      "Si tu n'as disputé aucun match (et que tu n'as organisé aucun tournoi, ne possèdes aucune équipe ni n'es inscrit à un tournoi individuel), la suppression efface ton compte entièrement — y compris si ton équipe avait été inscrite à un tournoi sans que tu joues.",
      "Si tu as joué, tes résultats restent, parce qu'ils appartiennent aussi aux équipes que tu as affrontées. Ton pseudo est alors remplacé par un pseudo d'emprunt tiré au hasard, et ta fiche indique clairement que le compte a été supprimé.",
      "Tout ce qui te désigne est effacé : tags Discord et de jeu, comptes de connexion, avatar, majorité, rôles sur le site et historique de tes consentements.",
      "Les comptes déjà supprimés suivent la même règle : ceux sans match sont effacés, les autres reçoivent un pseudo d'emprunt.",
    ],
  },
  // Trois traitements nouveaux d'un coup : les signalements (et ce qu'on en dit
  // aux personnes visées), le masquage d'un logo, et la trace de l'acceptation
  // des conditions d'utilisation. Durées lues sur les constantes du code.
  {
    id: "2026-09-signalements-conditions",
    publishedAt: "2026-09-25",
    title: "Signalements et contestation",
    summary: "Tu es prévenu d'un signalement qui te vise, et tu peux le contester.",
    details: [
      "Un signalement garde sa catégorie, sa description, les joueurs, équipes ou tournois désignés, le compte de son auteur et, s'il les indique, son nom et son adresse. Il est lu par les administrateurs, puis effacé " +
        `${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après son archivage — plus tard si un logo a été masqué ou supprimé à sa suite, jusqu'à l'échéance de la contestation.`,
      "Si un signalement te vise, toi ou une équipe dont tu es membre, tu reçois un message privé Discord (si ton compte Discord est rattaché ou ton tag certifié). Tu lis ce qui est reproché — jamais qui l'a signalé — et tu peux le contester ; une contestation rouvre un signalement archivé.",
      `Un logo d'équipe signalé peut être masqué : il n'est plus en ligne, et il est supprimé définitivement au bout de ${LOGO_QUARANTINE_DAYS / 30} mois sans contestation, ou rétabli si la contestation aboutit. Tes coéquipiers et toi en êtes prévenus.`,
      "L'acceptation des conditions d'utilisation (à la création du compte, d'une équipe, ou en recevant la gestion d'une équipe) est enregistrée avec sa date et sa version ; elle figure dans l'export de tes données.",
    ],
  },
];

/**
 * Les changements qu'un compte n'a pas encore acceptés, dans l'ordre du
 * registre.
 *
 * Un changement publié **avant** la création du compte le concerne ; publié le
 * jour même ou après, non — le compte a consenti à la politique déjà à jour.
 * La comparaison se fait sur le **jour** (`AAAA-MM-JJ`, donc en chaînes) :
 * `created_at` arrive de MySQL en `dateStrings`, et comparer des jours évite
 * toute question de fuseau.
 *
 * @param accountCreatedAt `created_at` du compte (`AAAA-MM-JJ HH:MM:SS` ou ISO),
 *   `null` si inconnu — auquel cas tout ce qui n'est pas accepté est dû.
 * @param acknowledged Identifiants déjà acceptés par ce compte.
 */
export function pendingPrivacyChanges(
  accountCreatedAt: string | null,
  acknowledged: Iterable<string>,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  const done = new Set(acknowledged);
  const createdDay = accountCreatedAt ? accountCreatedAt.slice(0, 10) : null;
  return changes.filter(
    (change) => !done.has(change.id) && (createdDay === null || createdDay < change.publishedAt),
  );
}

/** Refus d'une demande d'acceptation mal formée. */
export const INVALID_PRIVACY_CHANGES = "INVALID_PRIVACY_CHANGES";
/** Refus d'une acceptation qui nomme un changement absent du registre. */
export const UNKNOWN_PRIVACY_CHANGE = "UNKNOWN_PRIVACY_CHANGE";

export type PrivacyAcknowledgementCheck =
  | { ok: true; ids: string[] }
  | { ok: false; error: typeof INVALID_PRIVACY_CHANGES | typeof UNKNOWN_PRIVACY_CHANGE };

/**
 * Valide les identifiants envoyés à l'acceptation.
 *
 * L'écran envoie **ce qu'il a montré**, jamais « tout ce qui est dû » : un
 * changement publié entre l'affichage de la modale et le clic ne doit pas être
 * accepté par un joueur qui ne l'a pas lu. Le serveur se contente donc de
 * vérifier que chaque identifiant existe — un identifiant inconnu est refusé
 * plutôt qu'ignoré, sans quoi une faute de frappe côté client enregistrerait
 * une acceptation partielle en répondant « c'est fait ».
 */
export function checkPrivacyAcknowledgement(
  requested: unknown,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyAcknowledgementCheck {
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > changes.length) {
    return { ok: false, error: INVALID_PRIVACY_CHANGES };
  }
  if (!requested.every((id): id is string => typeof id === "string")) {
    return { ok: false, error: INVALID_PRIVACY_CHANGES };
  }
  const known = new Set(changes.map((change) => change.id));
  if (!requested.every((id) => known.has(id))) {
    return { ok: false, error: UNKNOWN_PRIVACY_CHANGE };
  }
  return { ok: true, ids: [...new Set(requested)] };
}

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** `2026-09-23` → `23 septembre 2026`. Écrit à la main : aucun fuseau n'entre en jeu. */
export function formatPrivacyChangeDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Le mois de la dernière mise à jour de la politique, pour `/rgpd`
 * (« septembre 2026 ») — dérivé du registre, pour que la page ne puisse plus
 * annoncer une date antérieure au dernier changement présenté aux joueurs.
 */
export function privacyPolicyUpdatedLabel(
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): string | null {
  const last = changes.at(-1);
  if (!last) return null;
  const [year, month] = last.publishedAt.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Titre de la modale, qui compte les changements. */
export function privacyChangesHeading(count: number): string {
  return count <= 1
    ? "Nos règles de confidentialité ont changé"
    : `${count} changements de nos règles de confidentialité`;
}

/** Plafond d'un message privé côté bot (`MAX_MESSAGE_LENGTH`, `blueGenjiBot/src/notifications`). */
export const PRIVACY_DM_MAX_LENGTH = 1800;

/**
 * Le message privé Discord qui annonce des changements.
 *
 * Un **résumé**, pas le texte complet : le détail et le choix (accepter ou
 * supprimer son compte) vivent sur le site, où le joueur est connecté. Le
 * message nomme chaque changement par son titre et son résumé, puis dit où
 * décider. Borné sous le plafond du bot : au-delà, les derniers changements
 * sont comptés plutôt que coupés au milieu d'une phrase.
 *
 * @param siteUrl Adresse absolue du site, `null` si elle n'est pas configurée.
 */
export function buildPrivacyChangesMessage(
  changes: readonly PrivacyChange[],
  siteUrl: string | null,
): string {
  const header =
    changes.length > 1
      ? `🔐 **BlueGenji — ${changes.length} changements de nos règles de confidentialité**`
      : "🔐 **BlueGenji — nos règles de confidentialité ont changé**";
  const where = siteUrl ? ` sur ${siteUrl}` : " sur le site";
  const footer =
    `Le détail t'attend à ta prochaine visite${where} : tu pourras ${changes.length > 1 ? "les " : "l'"}accepter, ` +
    "ou refuser et supprimer ton compte. Politique complète : " +
    (siteUrl ? `${siteUrl.replace(/\/$/, "")}/rgpd` : "page « RGPD » du site") +
    ".";

  const omittedLine = (count: number) => `• … et ${count} autre(s) changement(s).`;
  const assemble = (lines: string[], omitted: number) =>
    [header, ...lines, ...(omitted > 0 ? [omittedLine(omitted)] : []), footer].join("\n\n");

  // Chaque changement n'est gardé que si le message **complet** — y compris la
  // mention de ceux qui ne tiendraient plus après lui — reste sous le plafond.
  const lines: string[] = [];
  for (const [index, change] of changes.entries()) {
    const line = `• **${change.title}** (${formatPrivacyChangeDate(change.publishedAt)}) — ${change.summary}`;
    if (assemble([...lines, line], changes.length - index - 1).length > PRIVACY_DM_MAX_LENGTH) {
      return assemble(lines, changes.length - index);
    }
    lines.push(line);
  }
  return assemble(lines, 0);
}

/**
 * Au-delà de cette ancienneté, un changement ne s'annonce plus sur Discord.
 *
 * Le message privé est une **annonce**, pas le consentement — la modale s'en
 * charge, sans limite de temps. Un compte qui rattache Discord un an après un
 * changement n'a pas à recevoir une nouvelle vieille d'un an ; et la borne
 * garde la requête de balayage courte, le registre ne faisant que grandir.
 */
export const PRIVACY_DM_WINDOW_DAYS = 60;

/** Les changements encore à annoncer sur Discord à l'instant `now`. */
export function announceablePrivacyChanges(
  now: Date,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  const cutoff = new Date(now.getTime() - PRIVACY_DM_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return changes.filter((change) => change.publishedAt >= cutoff);
}
