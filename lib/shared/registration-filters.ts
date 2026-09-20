/**
 * Conditions d'inscription à un tournoi — logique pure, partagée.
 *
 * Un tournoi s'annonçait ouvert à toute équipe existante. En pratique deux
 * refus tombaient toujours trop tard : une équipe de deux joueurs qui se
 * présente le jour même, et une équipe dont l'organisation ne peut joindre
 * personne. Les deux se lisent sur le roster **avant** l'inscription, donc les
 * deux sont des conditions du tournoi et non des surprises d'arbitrage.
 *
 * Deux réglages, et pas un de plus :
 *
 * - **Discord vérifié** — `ANY_PLAYER` (défaut), `ALL_PLAYERS` ou `NONE`. La
 *   valeur par défaut est celle qui rend l'équipe joignable en exigeant le
 *   minimum : un interlocuteur suffit à reprogrammer une manche. `ALL_PLAYERS`
 *   sert aux tournois où chaque joueur doit être joignable individuellement
 *   (vérification d'éligibilité, tournoi à enjeu) ; `NONE` retire la condition.
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

/** Combien de joueurs doivent porter un tag Discord vérifié. */
export type DiscordRequirement = "NONE" | "ANY_PLAYER" | "ALL_PLAYERS";

/** Conditions d'inscription d'un tournoi. */
export type RegistrationFilters = {
  discordRequirement: DiscordRequirement;
  /** Effectif minimal du roster. `1` = aucune exigence. */
  minPlayers: number;
};

/** Les valeurs par défaut d'un tournoi neuf, et de tous ceux d'avant ce réglage. */
export const DEFAULT_REGISTRATION_FILTERS: RegistrationFilters = {
  discordRequirement: "ANY_PLAYER",
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

const DISCORD_REQUIREMENTS: readonly DiscordRequirement[] = ["NONE", "ANY_PLAYER", "ALL_PLAYERS"];

/** Vrai si `value` est une exigence connue. */
export function isDiscordRequirement(value: unknown): value is DiscordRequirement {
  return typeof value === "string" && (DISCORD_REQUIREMENTS as readonly string[]).includes(value);
}

/** Libellés FR, pour le formulaire comme pour l'en-tête d'un tournoi. */
export const DISCORD_REQUIREMENT_LABELS: Record<DiscordRequirement, string> = {
  NONE: "Aucun joueur",
  ANY_PLAYER: "Au moins un joueur",
  ALL_PLAYERS: "Tous les joueurs",
};

/** Refus possibles. Trois codes distincts : chacun désigne un geste différent. */
export type RegistrationFilterError =
  | "TEAM_TOO_FEW_PLAYERS"
  | "TEAM_NEEDS_VERIFIED_DISCORD"
  | "TEAM_NEEDS_ALL_VERIFIED_DISCORD";

/** Un membre du roster, réduit à ce que les conditions regardent. */
export type RosterMemberEligibility = {
  /** Le joueur porte-t-il un tag Discord **vérifié** ? */
  discordVerified: boolean;
};

/**
 * L'engagé remplit-il les conditions ? `null` = oui.
 *
 * `soloEntry` dit que l'engagé **est** un joueur (tournoi individuel) : son
 * roster n'a alors qu'une ligne, et l'effectif minimal n'a **aucun sens** — le
 * défaut à 5 interdirait toute inscription à tout tournoi individuel, sur un
 * réglage que le formulaire n'a même pas affiché. La condition Discord, elle,
 * s'applique telle quelle : « au moins un » et « tous » désignent le même unique
 * joueur.
 *
 * L'ordre des contrôles est significatif : l'effectif d'abord, parce qu'il se
 * corrige en recrutant, et que reprocher un tag manquant à une équipe de deux
 * joueurs enverrait corriger le moins urgent des deux.
 */
export function checkRegistrationFilters(
  filters: RegistrationFilters,
  roster: readonly RosterMemberEligibility[],
  soloEntry = false,
): RegistrationFilterError | null {
  if (!soloEntry && roster.length < filters.minPlayers) return "TEAM_TOO_FEW_PLAYERS";

  if (filters.discordRequirement === "ANY_PLAYER") {
    if (!roster.some((member) => member.discordVerified)) return "TEAM_NEEDS_VERIFIED_DISCORD";
  }

  if (filters.discordRequirement === "ALL_PLAYERS") {
    // Un roster **vide** passerait un `every` : il n'a aucun joueur non vérifié.
    // En tournoi par équipes l'effectif minimal l'a déjà écarté (son plancher
    // est 1), mais la garde ne coûte rien et ferme le cas pour de bon — un
    // appelant qui passerait un roster vide obtiendrait sinon un « toutes les
    // conditions remplies » sur une équipe sans personne.
    if (roster.length === 0) return "TEAM_NEEDS_ALL_VERIFIED_DISCORD";
    if (!roster.every((member) => member.discordVerified)) {
      return "TEAM_NEEDS_ALL_VERIFIED_DISCORD";
    }
  }

  return null;
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
): RegistrationFilters {
  const parsedMin = Number(minPlayers);
  return {
    discordRequirement: isDiscordRequirement(discordRequirement)
      ? discordRequirement
      : DEFAULT_REGISTRATION_FILTERS.discordRequirement,
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

/**
 * Valide une saisie de conditions. Rend un code d'erreur, jamais un statut HTTP
 * — même contrat que `validateTournamentInput`, qui l'appelle.
 */
export function validateRegistrationFilters(
  discordRequirement: unknown,
  minPlayers: unknown,
): "INVALID_DISCORD_REQUIREMENT" | "INVALID_MIN_PLAYERS" | null {
  if (discordRequirement != null && !isDiscordRequirement(discordRequirement)) {
    return "INVALID_DISCORD_REQUIREMENT";
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
 * minimum » sur un tournoi individuel serait faux.
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
  return parts.length === 0 ? null : parts.join(" · ");
}
