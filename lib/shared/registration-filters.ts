/**
 * Conditions d'inscription à un tournoi — logique pure, partagée.
 *
 * Un tournoi s'annonçait ouvert à toute équipe existante. En pratique deux
 * refus tombaient toujours trop tard : une équipe de deux joueurs qui se
 * présente le jour même, et une équipe dont l'organisation ne peut joindre
 * personne. Les deux se lisent sur le roster **avant** l'inscription, donc les
 * deux sont des conditions du tournoi et non des surprises d'arbitrage.
 *
 * Trois réglages, et pas un de plus :
 *
 * - **Discord vérifié** — `ANY_PLAYER` (défaut), `ALL_PLAYERS` ou `NONE`. La
 *   valeur par défaut est celle qui rend l'équipe joignable en exigeant le
 *   minimum : un interlocuteur suffit à reprogrammer une manche. `ALL_PLAYERS`
 *   sert aux tournois où chaque joueur doit être joignable individuellement
 *   (vérification d'éligibilité, tournoi à enjeu) ; `NONE` retire la condition.
 * - **Compte Blizzard rattaché** — mêmes trois valeurs, `NONE` par défaut. Ce
 *   n'est pas une **coordonnée** comme le tag Discord mais une **attestation de
 *   compte de jeu** : l'aller-retour OAuth prouve que le BattleTag du profil est
 *   bien celui du joueur. La condition se lit donc sur `bg_users.blizzard_sub`
 *   et **jamais** sur `overwatch_battletag`, chaîne que n'importe qui remplit
 *   sans rien prouver — c'est le même écart qu'entre `discord_verified_at` et
 *   `discord_pseudo`, et c'est le trou que la condition ferme. Le défaut est
 *   `NONE` parce que la moitié du site joue à Marvel Rivals, où un compte
 *   Battle.net ne veut rien dire : l'exiger par défaut fermerait des tournois
 *   qui n'ont aucune raison de l'être — et, la migration reprenant ce défaut,
 *   aucun tournoi d'avant ce réglage ne change de conditions.
 * - **Effectif minimal** — 5 par défaut, l'effectif d'une équipe complète sur
 *   les deux jeux du site.
 *
 * **Deux règles que ce module ne porte pas, et qui comptent :**
 *
 * 1. Les **équipes fantômes** n'y sont pas soumises. Ce sont des équipes sans
 *    joueur, créées par le staff pour remplir un plateau : les y soumettre
 *    interdirait l'usage même pour lequel elles existent. Le contrôle est donc
 *    posé sur l'inscription **d'un joueur** (`registerCurrentUserTeam`), jamais
 *    dans le tronc commun (`registerTeam`) — c'est le seul endroit du moteur où
 *    la distinction se lit sans rien deviner.
 * 2. Une inscription **déjà enregistrée** n'est jamais relue. Les conditions se
 *    jugent à l'écriture ; les durcir après coup ne désengage personne, pas plus
 *    qu'abaisser `maxTeams` ne renvoie une équipe chez elle (ce que l'édition
 *    refuse, d'ailleurs). Un engagé qui ne remplit plus les conditions se retire
 *    à la main (`docs/features/ENTRANT_REMOVAL.md`).
 */

/**
 * Combien de joueurs du roster doivent remplir une condition.
 *
 * Un seul type pour les deux réglages qui s'en servent : ils posent la **même**
 * question (« aucun / au moins un / tous »), et deux énumérations jumelles
 * auraient fini par diverger — ne serait-ce que par leurs libellés, qui sont
 * ceux d'une liste déroulante partagée.
 */
export type PlayerRequirement = "NONE" | "ANY_PLAYER" | "ALL_PLAYERS";

/** Conditions d'inscription d'un tournoi. */
export type RegistrationFilters = {
  discordRequirement: PlayerRequirement;
  /** Compte Battle.net **rattaché** au compte du site, jamais un BattleTag saisi. */
  blizzardRequirement: PlayerRequirement;
  /** Effectif minimal du roster. `1` = aucune exigence. */
  minPlayers: number;
};

/** Les valeurs par défaut d'un tournoi neuf, et de tous ceux d'avant ce réglage. */
export const DEFAULT_REGISTRATION_FILTERS: RegistrationFilters = {
  discordRequirement: "ANY_PLAYER",
  blizzardRequirement: "NONE",
  minPlayers: 5,
};

/**
 * Bornes de l'effectif minimal.
 *
 * `1` est le plancher parce qu'il **est** l'absence de condition : une équipe
 * sans membre ne peut pas s'inscrire elle-même (elle n'a personne pour le
 * faire), donc « au moins un joueur » ne refuse rien. Un `0` serait la même
 * chose, écrite d'une façon qui laisse croire à un autre sens.
 *
 * Le plafond suit l'effectif d'un roster plausible sur les deux jeux, marge
 * comprise (remplaçants, coach, manager comptant dans les membres).
 */
export const MIN_PLAYERS_BOUNDS = { min: 1, max: 20 } as const;

/** Les trois valeurs, dans l'ordre où le formulaire les propose. */
export const PLAYER_REQUIREMENTS: readonly PlayerRequirement[] = [
  "ANY_PLAYER",
  "ALL_PLAYERS",
  "NONE",
];

/** Vrai si `value` est une exigence connue. */
export function isPlayerRequirement(value: unknown): value is PlayerRequirement {
  return typeof value === "string" && (PLAYER_REQUIREMENTS as readonly string[]).includes(value);
}

/** Libellés FR, pour le formulaire comme pour l'en-tête d'un tournoi. */
export const PLAYER_REQUIREMENT_LABELS: Record<PlayerRequirement, string> = {
  NONE: "Aucun joueur",
  ANY_PLAYER: "Au moins un joueur",
  ALL_PLAYERS: "Tous les joueurs",
};

/**
 * Les refus possibles, énumérés — **source unique** dont le type est dérivé.
 *
 * La route d'inscription doit rendre un **409** sur chacun d'eux (la saisie est
 * bonne, c'est l'état de l'équipe qui ne convient pas) et les listait à la main :
 * un code ajouté ici sans être ajouté là-bas serait ressorti en 500, sur un
 * refus parfaitement prévu. Le tableau ferme le cas — `isRegistrationFilterError`
 * est le seul test à écrire.
 */
export const REGISTRATION_FILTER_ERRORS = [
  "TEAM_TOO_FEW_PLAYERS",
  "TEAM_NEEDS_VERIFIED_DISCORD",
  "TEAM_NEEDS_ALL_VERIFIED_DISCORD",
  "TEAM_NEEDS_LINKED_BLIZZARD",
  "TEAM_NEEDS_ALL_LINKED_BLIZZARD",
] as const;

/** Refus de condition. Un code par geste : chacun nomme ce qu'il faut faire. */
export type RegistrationFilterError = (typeof REGISTRATION_FILTER_ERRORS)[number];

/** Vrai si `value` est un refus de condition d'inscription. */
export function isRegistrationFilterError(value: unknown): value is RegistrationFilterError {
  return (
    typeof value === "string" && (REGISTRATION_FILTER_ERRORS as readonly string[]).includes(value)
  );
}

/** Un membre du roster, réduit à ce que les conditions regardent. */
export type RosterMemberEligibility = {
  /** Le joueur porte-t-il un tag Discord **vérifié** ? */
  discordVerified: boolean;
  /** Son compte du site porte-t-il une identité **Blizzard** rattachée ? */
  blizzardLinked: boolean;
};

/**
 * Un réglage `ANY_PLAYER` / `ALL_PLAYERS` appliqué à un roster.
 *
 * Écrit une fois pour les deux conditions : elles ne diffèrent que par le champ
 * lu et par leurs deux codes de refus, et les recopier aurait fait deux endroits
 * où oublier la garde du **roster vide** — qu'un `every` laisse passer, faute
 * d'un seul membre à mettre en défaut. En tournoi par équipes l'effectif minimal
 * l'a déjà écarté (son plancher est 1), mais la garde ne coûte rien et ferme le
 * cas pour de bon : un appelant qui passerait un roster vide obtiendrait sinon
 * un « toutes les conditions remplies » sur une équipe sans personne.
 */
function checkPlayerRequirement(
  requirement: PlayerRequirement,
  roster: readonly RosterMemberEligibility[],
  satisfies: (member: RosterMemberEligibility) => boolean,
  anyError: RegistrationFilterError,
  allError: RegistrationFilterError,
): RegistrationFilterError | null {
  if (requirement === "ANY_PLAYER" && !roster.some(satisfies)) return anyError;
  if (requirement === "ALL_PLAYERS" && (roster.length === 0 || !roster.every(satisfies))) {
    return allError;
  }
  return null;
}

/**
 * L'engagé remplit-il les conditions ? `null` = oui.
 *
 * `soloEntry` dit que l'engagé **est** un joueur (tournoi individuel) : son
 * roster n'a alors qu'une ligne, et l'effectif minimal n'a **aucun sens** — le
 * défaut à 5 interdirait toute inscription à tout tournoi individuel, sur un
 * réglage que le formulaire n'a même pas affiché. Les deux conditions de compte,
 * elles, s'appliquent telles quelles : « au moins un » et « tous » désignent le
 * même unique joueur.
 *
 * L'ordre des contrôles est significatif, et va du plus urgent au moins urgent :
 * l'**effectif** d'abord, parce qu'il se corrige en recrutant et que reprocher
 * un tag manquant à une équipe de deux joueurs enverrait corriger le moins
 * urgent des deux ; le **Discord** ensuite, sans lequel l'arbitrage ne peut
 * joindre personne ; le **Blizzard** enfin, qui n'atteste que l'éligibilité au
 * jeu.
 */
export function checkRegistrationFilters(
  filters: RegistrationFilters,
  roster: readonly RosterMemberEligibility[],
  soloEntry = false,
): RegistrationFilterError | null {
  if (!soloEntry && roster.length < filters.minPlayers) return "TEAM_TOO_FEW_PLAYERS";

  return (
    checkPlayerRequirement(
      filters.discordRequirement,
      roster,
      (member) => member.discordVerified,
      "TEAM_NEEDS_VERIFIED_DISCORD",
      "TEAM_NEEDS_ALL_VERIFIED_DISCORD",
    ) ??
    checkPlayerRequirement(
      filters.blizzardRequirement,
      roster,
      (member) => member.blizzardLinked,
      "TEAM_NEEDS_LINKED_BLIZZARD",
      "TEAM_NEEDS_ALL_LINKED_BLIZZARD",
    )
  );
}

/**
 * Normalise une saisie arbitraire (corps de requête, ligne SQL ancienne) en
 * conditions valides.
 *
 * Tolérante par construction : les tournois créés avant ce réglage n'ont pas ces
 * colonnes, et une valeur illisible doit retomber sur le défaut plutôt que de
 * rendre un tournoi inscriptible par personne. Le **refus**, lui, appartient à
 * la validation de saisie (`validateRegistrationFilters`) : un formulaire qui
 * envoie n'importe quoi doit l'apprendre, une ligne d'avant n'a rien à
 * apprendre.
 */
export function parseRegistrationFilters(
  discordRequirement: unknown,
  minPlayers: unknown,
  blizzardRequirement: unknown,
): RegistrationFilters {
  const parsedMin = Number(minPlayers);
  return {
    discordRequirement: isPlayerRequirement(discordRequirement)
      ? discordRequirement
      : DEFAULT_REGISTRATION_FILTERS.discordRequirement,
    blizzardRequirement: isPlayerRequirement(blizzardRequirement)
      ? blizzardRequirement
      : DEFAULT_REGISTRATION_FILTERS.blizzardRequirement,
    minPlayers: isValidMinPlayers(parsedMin)
      ? parsedMin
      : DEFAULT_REGISTRATION_FILTERS.minPlayers,
  };
}

/** Effectif minimal recevable. */
export function isValidMinPlayers(value: unknown): boolean {
  const parsed = Number(value);
  return (
    Number.isInteger(parsed) &&
    parsed >= MIN_PLAYERS_BOUNDS.min &&
    parsed <= MIN_PLAYERS_BOUNDS.max
  );
}

/** Refus de saisie possibles, codes bruts — la route les traduit en 400. */
export type RegistrationFiltersInputError =
  | "INVALID_DISCORD_REQUIREMENT"
  | "INVALID_BLIZZARD_REQUIREMENT"
  | "INVALID_MIN_PLAYERS";

/**
 * Valide une saisie de conditions. Rend un code d'erreur, jamais un statut HTTP
 * — même contrat que `validateTournamentInput`, qui l'appelle.
 */
export function validateRegistrationFilters(
  discordRequirement: unknown,
  minPlayers: unknown,
  blizzardRequirement: unknown,
): RegistrationFiltersInputError | null {
  if (discordRequirement != null && !isPlayerRequirement(discordRequirement)) {
    return "INVALID_DISCORD_REQUIREMENT";
  }
  if (blizzardRequirement != null && !isPlayerRequirement(blizzardRequirement)) {
    return "INVALID_BLIZZARD_REQUIREMENT";
  }
  if (minPlayers != null && !isValidMinPlayers(minPlayers)) return "INVALID_MIN_PLAYERS";
  return null;
}

/**
 * Les conditions, en une phrase lisible — ou `null` quand il n'y en a aucune.
 *
 * Écrite ici et pas dans l'en-tête du tournoi : la même phrase sert à annoncer
 * les conditions (fiche du tournoi) et à expliquer un refus (message d'erreur),
 * et deux rédactions divergeraient au premier réglage ajouté.
 *
 * `soloEntry` retire l'effectif, qui ne s'applique pas — annoncer « 5 joueurs
 * minimum » sur un tournoi individuel serait faux. Les deux conditions de compte
 * y restent, au singulier : elles désignent le seul joueur engagé.
 */
export function registrationFiltersSummary(
  filters: RegistrationFilters,
  soloEntry = false,
): string | null {
  const parts: string[] = [];
  if (!soloEntry && filters.minPlayers > MIN_PLAYERS_BOUNDS.min) {
    parts.push(`${filters.minPlayers} joueurs minimum`);
  }
  if (filters.discordRequirement === "ANY_PLAYER") {
    parts.push(soloEntry ? "Discord vérifié" : "au moins un Discord vérifié");
  }
  if (filters.discordRequirement === "ALL_PLAYERS") {
    parts.push(soloEntry ? "Discord vérifié" : "tous les Discord vérifiés");
  }
  if (filters.blizzardRequirement === "ANY_PLAYER") {
    parts.push(soloEntry ? "compte Blizzard lié" : "au moins un compte Blizzard lié");
  }
  if (filters.blizzardRequirement === "ALL_PLAYERS") {
    parts.push(soloEntry ? "compte Blizzard lié" : "tous les comptes Blizzard liés");
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
