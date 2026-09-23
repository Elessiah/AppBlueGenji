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
      "Seuls des cookies techniques sont déposés. La fréquentation du site est mesurée par une empreinte non réversible (jamais ton adresse IP), et le flux d'activité public du bot n'affiche aucun identifiant Discord.",
    ],
  },
  {
    id: "2026-09-sauvegardes-chiffrees",
    publishedAt: "2026-09-23",
    title: "Sauvegardes chiffrées et suppressions garanties",
    summary:
      "La plateforme est sauvegardée dans des archives chiffrées gardées 30 jours, et une suppression de compte reste acquise même si une sauvegarde est restaurée.",
    details: [
      "La base de données est sauvegardée chaque semaine dans une archive chiffrée avant envoi, avec une clé que seule l'association détient, puis hébergée chez Microsoft (OneDrive), qui la stocke sans pouvoir la lire. Chaque archive est détruite au bout de 30 jours, sans passer par une corbeille.",
      "Les images téléversées (avatars, logos) sont copiées, chiffrées, chaque heure. Une image retirée du site disparaît de la sauvegarde dans l'heure.",
      "Une donnée supprimée peut donc subsister jusqu'à 30 jours dans ces archives, qu'on ne peut pas corriger une à une. Pour qu'elle ne revienne jamais, chaque suppression de compte est notée dans un journal — numéro et date de création du compte, date de suppression, rien d'autre — gardé 60 jours : si une sauvegarde devait être restaurée, les suppressions intervenues depuis sont réappliquées avant la remise en service.",
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
