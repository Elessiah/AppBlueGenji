export const ERROR_MESSAGES: Record<string, string> = {
  CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES: "Score verrouillé : la manche suivante a déjà des scores saisis.",
  MATCH_NOT_FOUND: "Match introuvable.",
  MATCH_NOT_READY: "Le match n'a pas deux équipes.",
  // Volontairement neutre : le code remonte aussi bien du report d'une équipe
  // (`reportMatchScore`) que de l'enregistrement d'un score par l'arbitrage. La
  // consigne « utilise Valider le résultat » enverrait un joueur chercher un
  // bouton qu'il n'a pas — c'est `decideScoreForm` qui la donne, côté arbitrage,
  // avant même l'aller-retour.
  MATCH_ALREADY_COMPLETED: "Ce match est déjà tranché : son résultat ne peut plus être saisi.",
  DRAW_NOT_ALLOWED: "Les scores ne peuvent pas être égaux.",
  // Formulations de repli : l'interface connaît le format du tournoi et
  // remplace ces messages par une version chiffrée (`matchScoreViolationMessage`).
  SCORE_EXCEEDS_MATCH_FORMAT: "Score impossible pour le format de match du tournoi.",
  SCORE_BELOW_MATCH_FORMAT: "Le vainqueur doit atteindre le nombre de manches du format.",
  INVALID_MATCH_FORMAT: "Format de match invalide.",
  TOURNAMENT_NOT_FOUND: "Tournoi introuvable.",
  TOURNAMENT_NOT_RUNNING: "Le tournoi n'est pas en cours.",
  ADMIN_SAVE_SCORES_FAILED: "Erreur lors de la sauvegarde des scores.",
  ADMIN_RESOLVE_FAILED: "Erreur lors de la résolution du match.",
  INVALID_FORFEIT_TEAM_ID: "Le forfait doit désigner une des deux équipes du match.",
  MISSING_SCORES_OR_FORFEIT: "Scores ou forfait requis.",
  TOURNAMENT_FULL: "Ce tournoi est complet.",
  // Formulation neutre : l'inscrit est une équipe ou un joueur selon le tournoi.
  ALREADY_REGISTERED: "Inscription déjà enregistrée pour ce tournoi.",
  REGISTRATION_CLOSED: "Les inscriptions ne sont pas ouvertes.",
  NO_ACTIVE_TEAM: "Tu dois d'abord créer ou rejoindre une équipe.",
  // Tournoi individuel : le nom d'inscription du joueur est déjà pris.
  SOLO_ENTRY_NAME_UNAVAILABLE:
    "Ton pseudo est déjà utilisé comme nom d'équipe : change-le avant de t'inscrire.",
  USER_NOT_FOUND: "Compte introuvable.",
  NOT_SURVIVAL: "Le forfait n'est disponible que pour les tournois en mode Survie.",
  // Formulations neutres : le forfait peut aussi être déclaré par l'arbitrage
  // pour une autre équipe que la sienne.
  TEAM_ALREADY_OUT: "Cette équipe n'est plus en lice dans ce tournoi.",
  ENDURANCE_PLAYOFFS_STARTED:
    "Les play-offs ont commencé : un forfait se déclare désormais sur le match lui-même.",
  TEAM_NOT_IN_TOURNAMENT: "Cette équipe n'est pas inscrite à ce tournoi.",
  // Volontairement neutre : le même code remonte du forfait, de la diffusion et
  // de toute route protégée. Un message parlant de forfait sur un refus
  // d'antenne enverrait le lecteur chercher un bug là où il n'y en a pas.
  FORBIDDEN: "Tu n'as pas les droits nécessaires pour cette action.",
  FORFEIT_FAILED: "Erreur lors de la déclaration de forfait.",
  // Édition d'un tournoi (`GET`/`PATCH /api/tournaments/[id]/edit`).
  TOURNAMENT_LOCKED: "Le tournoi est en cours : il n'est plus modifiable.",
  FIELD_NOT_EDITABLE: "Ce réglage n'est plus modifiable depuis que le tournoi est visible.",
  MAX_TEAMS_CANNOT_DECREASE:
    "Le nombre de places ne peut plus être réduit une fois le tournoi visible.",
  REGISTRATION_CLOSE_IN_PAST:
    "La clôture des inscriptions ne peut pas être placée dans le passé.",
  EMPTY_PATCH: "Aucune modification à enregistrer.",
  TOURNAMENT_UPDATE_FAILED: "Erreur lors de la modification du tournoi.",
  INVALID_DATE_ORDER:
    "Les dates doivent se suivre : visibilité, ouverture, clôture, puis début.",
  INVALID_DATES: "Une des dates est illisible.",
  INVALID_MAX_TEAMS: "Le nombre de places doit être compris entre 2 et 256.",
  MISSING_NAME: "Le nom du tournoi est obligatoire.",
  // Session expirée : le suivi en direct s'arrête, il faut se reconnecter.
  UNAUTHORIZED: "Ta session a expiré. Reconnecte-toi pour suivre le tournoi en direct.",
  // Diffusion en direct (`lib/shared/live-streams.ts`).
  INVALID_STREAM_URL:
    "Lien de diffusion non reconnu (Twitch, YouTube ou Kick attendu).",
  INVALID_LIVE_TRIGGER: "Mode de passage à l'antenne invalide.",
  LIVE_TRIGGER_NOT_MANUAL:
    "Ce match passe à l'antenne automatiquement : il n'y a rien à basculer.",
  MATCH_NOT_LIVE_READY:
    "L'antenne ne s'ouvre que sur un match jouable dont le score n'est pas saisi.",
  MATCH_START_AT_REQUIRED:
    "Fixe d'abord la date de début du match pour le faire passer à l'antenne à l'heure dite.",
  MATCH_LIVE_UPDATE_FAILED: "Erreur lors de la mise à jour de la diffusion.",
  // Calendrier des matchs (`lib/shared/match-schedule.ts`).
  INVALID_MATCH_START_AT: "Date de début non reconnue.",
  MATCH_SCHEDULE_UPDATE_FAILED: "Erreur lors de la mise à jour de la date de début.",
  TOURNAMENT_LIVE_UPDATE_FAILED: "Erreur lors de la mise à jour de la chaîne officielle.",
  // Suppression définitive (`docs/features/TOURNAMENT_DELETION.md`).
  // `TOURNAMENT_NOT_FOUND` et `UNAUTHORIZED` sont déjà couverts plus haut.
  TOURNAMENT_DELETE_FAILED: "Erreur lors de la suppression du tournoi.",
  INVALID_TOURNAMENT_ID: "Identifiant de tournoi invalide.",
  // Lancement anticipé (`lib/shared/tournament-launch.ts`). Le bouton n'est
  // affiché que lorsque la fenêtre est ouverte : ces messages n'apparaissent
  // que si le tournoi a bougé entre l'affichage et le clic — d'où des
  // formulations qui disent ce qui a changé, et non ce qu'il fallait faire.
  TOURNAMENT_ALREADY_STARTED: "Ce tournoi a déjà démarré : il n'y a plus rien à abréger.",
  TOURNAMENT_ALREADY_FINISHED: "Ce tournoi est terminé.",
  TOURNAMENT_LAUNCH_FAILED: "Erreur lors du lancement du tournoi.",
  // Signalement d'un problème (`lib/shared/discord-notifications.ts`).
  INVALID_ISSUE_MESSAGE:
    "Décris le problème en 10 à 1000 caractères pour que l'arbitre puisse agir.",
  NOT_REGISTERED: "Seuls les engagés du tournoi peuvent signaler un problème.",
  BOT_INTERNAL_UNREACHABLE:
    "Le bot Discord est injoignable : le signalement n'est pas parti. Préviens le staff sur Discord.",
  // Générique à dessein : le plafond de débit est partagé par toutes les routes
  // de la page (lecture, report de score, signalement), et cette page les mappe
  // toutes par `mapError`.
  TOO_MANY_REQUESTS: "Trop de requêtes coup sur coup. Patiente quelques minutes.",
  ISSUE_REPORT_FAILED: "Erreur lors de l'envoi du signalement.",
  INVALID_MATCH_ID: "Identifiant de match invalide.",
  // Plus émis par aucune route de cette page — `forfeit` et le report de score
  // nomment désormais l'identifiant en cause. Conservé comme filet : d'autres
  // familles de routes l'emploient encore, et un code sans phrase française
  // s'afficherait brut dans le toast.
  INVALID_ID: "Identifiant invalide.",
  // Ordre de départ (`PATCH /api/admin/tournaments/[id]/seeding`). Sans ces
  // phrases, le refus s'affichait tel quel dans le toast — « SEEDING_LOCKED ».
  SEEDING_LOCKED: "Un score a été saisi : l'ordre de départ est désormais figé.",
  INVALID_SEED_ORDER: "Ordre invalide : la liste doit contenir tous les engagés, une seule fois.",
  SEEDING_REORDER_FAILED: "Erreur lors de l'enregistrement du nouvel ordre.",
  // Inscription en lot d'engagés sans compte
  // (`POST /api/admin/tournaments/[id]/ghost-registrations`). Les phrases
  // restent unitaires : le tout-ou-rien est ajouté par `mapBatchError`, qui seul
  // sait combien d'engagés portait la requête — ces mêmes codes servent aussi à
  // l'inscription d'un seul, où « rien n'a été enregistré » n'apprendrait rien.
  EMPTY_TEAM_SELECTION: "Sélectionne au moins un engagé à inscrire.",
  INVALID_TEAM_IDS: "Sélection illisible : recharge la page et recommence.",
  TOO_MANY_TEAMS: "Sélection trop large : inscris-les en plusieurs fois.",
  // Une fantôme attribuée à un joueur entre l'affichage de la liste et le clic
  // n'est plus une fantôme : le staff n'inscrit pas l'équipe d'un joueur à sa
  // place, ni une entrée solo.
  NOT_A_GHOST_TEAM: "Cet engagé n'est plus une équipe fantôme.",
  TEAM_ALREADY_DELETED: "Cet engagé a été dissous.",
  TEAM_NOT_FOUND: "Engagé introuvable.",
  GHOST_TEAMS_LOAD_FAILED: "Impossible de charger la liste des équipes fantômes.",
  GHOST_TEAM_CREATE_FAILED: "Erreur lors de la création de l'équipe fantôme.",
  GHOST_REGISTRATION_FAILED: "Erreur lors de l'inscription.",
};

export function mapError(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] || errorCode;
}

/**
 * Message d'un refus qui **désigne un engagé**. Sur un lot de trente, « déjà
 * inscrite » sans nom n'apprend rien : le serveur joint l'identifiant en cause,
 * l'appelant retrouve le nom, et la phrase le porte en tête.
 *
 * Le nom est mis à part par un tiret plutôt qu'inséré dans la phrase : le genre
 * d'« équipe » et de « joueur » diverge, et les messages sont partagés entre les
 * deux types de tournoi.
 */
export function mapEntrantError(errorCode: string, entrantName: string | null): string {
  const message = mapError(errorCode);
  return entrantName ? `${entrantName} — ${message}` : message;
}

/**
 * Message d'un refus portant sur un **lot**.
 *
 * Le tout-ou-rien doit se lire dans la phrase, et il ne peut pas l'être dans la
 * table : « Ce tournoi est complet. » est juste pour l'inscription d'un seul,
 * mais devant une sélection de vingt-cinq il laisse ouvert ce que le lot était
 * censé éviter — le staff ne sait pas si les vingt-quatre premières sont
 * passées. Seul l'appelant connaît la taille de la requête, la précision est
 * donc ajoutée ici.
 */
export function mapBatchError(
  errorCode: string,
  entrantName: string | null,
  batchSize: number,
): string {
  const message = mapEntrantError(errorCode, entrantName);
  return batchSize > 1 ? `${message} Rien n'a été enregistré.` : message;
}
