/**
 * Valeurs du formulaire de tournoi, et les deux ponts avec l'API.
 *
 * Séparés du composant : ce sont des fonctions pures, testées telles quelles
 * (`tests/tournois/tournament-form.test.ts`), et le composant n'a pas à porter
 * la table de correspondance en plus de son rendu.
 */
import { localDateTimeInput } from "@/lib/shared/dates";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import { DEFAULT_MATCH_FORMAT, type MatchFormat } from "@/lib/shared/match-format";
import {
  DEFAULT_REGISTRATION_FILTERS,
  type PlayerRequirement,
} from "@/lib/shared/registration-filters";
import type { ParticipantType } from "@/lib/shared/participants";
import { createDefaultPhase } from "../creer/phase-form";

/** Plafond de manches qualificatives BG Survie proposé à la création. */
export const DEFAULT_ENDURANCE_MAX_ROUNDS = 5;

/**
 * Miroir client des valeurs éditables (`EditableTournamentValues`), à deux
 * différences près, imposées par les contrôles HTML :
 *
 * - les quatre dates sont des chaînes `datetime-local` (`YYYY-MM-DDTHH:mm`,
 *   heure locale), pas de l'ISO — `toApiPayload` / `toFormValues` font le pont ;
 * - les réglages propres à un format ne sont jamais `null` : un tournoi en
 *   élimination simple garde les défauts de survie sous la main, prêts à servir
 *   si l'organisateur bascule le format.
 */
export type TournamentFormValues = {
  name: string;
  description: string;
  game: TournamentGame;
  format: TournamentFormat;
  participantType: ParticipantType;
  maxTeams: number;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number;
  survivalRoundsPerCut: number;
  swissTotalRounds: number;
  swissPointsWin: number;
  swissPointsDraw: number;
  swissPointsLoss: number;
  endurancePoints: number;
  enduranceWinDelta: number;
  enduranceLossDelta: number;
  endurancePlayoffSize: number;
  /**
   * Plafond de manches qualificatives, **0 valant « aucune limite »**. Le
   * formulaire ne manipule que des nombres ; c'est `toApiPayload` qui traduit
   * ce zéro en `null`, donc en `NULL` côté base.
   */
  enduranceMaxRounds: number;
  matchFormat: MatchFormat | null;
  /**
   * BG Survie : format de l'**arbre final**. `null` = le même que la
   * qualification, égalités en moins.
   *
   * Il existe parce que le règlement distingue les deux : la qualification se
   * joue en BO5 **sans tiebreaker** (une map nulle peut l'arrêter sur 2-2), les
   * play-offs en vrai FT3 — une élimination directe a besoin d'un vainqueur.
   */
  endurancePlayoffFormat: MatchFormat | null;
  /**
   * Conditions d'inscription. Aplaties en trois champs, comme côté serveur : ce
   * sont trois réglages indépendants, et la liste blanche de l'édition les juge
   * séparément.
   */
  registrationDiscordRequirement: PlayerRequirement;
  registrationBlizzardRequirement: PlayerRequirement;
  registrationMinPlayers: number;
  phases: PhaseConfig[];
};

/**
 * Valeurs telles que les rend `GET /api/tournaments/[id]/edit`.
 *
 * Déclaré ici plutôt qu'importé : `EditableTournamentValues` vit dans
 * `lib/server/`, interdit à un composant client.
 */
export type TournamentApiValues = {
  name: string;
  description: string | null;
  game: TournamentGame;
  format: TournamentFormat;
  participantType: ParticipantType;
  maxTeams: number;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
  swissTotalRounds: number | null;
  swissPointsWin: number | null;
  swissPointsDraw: number | null;
  swissPointsLoss: number | null;
  endurancePoints: number | null;
  enduranceWinDelta: number | null;
  enduranceLossDelta: number | null;
  endurancePlayoffSize: number | null;
  enduranceMaxRounds: number | null;
  matchFormat: MatchFormat | null;
  endurancePlayoffFormat: MatchFormat | null;
  registrationDiscordRequirement: PlayerRequirement;
  registrationBlizzardRequirement: PlayerRequirement;
  registrationMinPlayers: number;
  phases: PhaseConfig[] | null;
};

/** Valeurs proposées à la création d'un tournoi. */
export function defaultTournamentFormValues(): TournamentFormValues {
  return {
    name: "",
    description: "",
    game: "OW",
    format: "SINGLE",
    // Équipes (défaut) ou joueurs inscrits individuellement. Le format de
    // bracket est indépendant : tous fonctionnent dans les deux cas.
    participantType: "TEAM",
    maxTeams: 16,
    startVisibilityAt: localDateTimeInput(1),
    registrationOpenAt: localDateTimeInput(3),
    registrationCloseAt: localDateTimeInput(24),
    startAt: localDateTimeInput(30),
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: 3,
    survivalRoundsPerCut: 3,
    swissTotalRounds: computeRecommendedRounds(16),
    swissPointsWin: 3,
    swissPointsDraw: 1,
    swissPointsLoss: 0,
    // BlueGenji Survie : capital d'endurance et barème (défauts du règlement).
    endurancePoints: 9,
    enduranceWinDelta: 1,
    enduranceLossDelta: 1,
    endurancePlayoffSize: 8,
    // Cinq manches qualificatives au plus : c'est le déroulé habituel d'une
    // soirée. 0 (aucun plafond, la phase s'arrête sur l'effectif) reste un
    // choix explicite.
    enduranceMaxRounds: DEFAULT_ENDURANCE_MAX_ROUNDS,
    // « Libre » (`null`) conserve la saisie de score sans contrainte, comme les
    // tournois créés avant la fonctionnalité. Les égalités sont ouvertes
    // d'office : la qualification BG Survie se joue sans tiebreaker, et la case
    // n'a d'effet qu'en BG Survie (`toApiPayload` les ferme ailleurs).
    matchFormat: { ...DEFAULT_MATCH_FORMAT, drawsAllowed: true },
    // `null` = l'arbre final reprend le format du tournoi. C'est le défaut, et
    // il vaut pour tous les tournois créés avant ce réglage.
    endurancePlayoffFormat: null,
    // Conditions d'inscription : les défauts du module partagé — « au moins un
    // Discord vérifié », aucune exigence Blizzard, et cinq joueurs.
    registrationDiscordRequirement: DEFAULT_REGISTRATION_FILTERS.discordRequirement,
    registrationBlizzardRequirement: DEFAULT_REGISTRATION_FILTERS.blizzardRequirement,
    registrationMinPlayers: DEFAULT_REGISTRATION_FILTERS.minPlayers,
    phases: [createDefaultPhase(1, "SWISS"), createDefaultPhase(2, "DOUBLE")],
  };
}

/**
 * Instant ISO → saisie `datetime-local` en heure locale.
 *
 * Cette conversion ISO → `datetime-local` est correcte uniquement parce que le
 * chargement et la soumission du formulaire se font dans le même navigateur, à
 * la même heure de fuseau horaire. Un aller-retour sur plusieurs sessions ou
 * plusieurs fuseaux perdrait l'information. Cette asymétrie est volontaire :
 * le formulaire stocke des chaînes locales (ce que HTML5 exige pour
 * `<input type="datetime-local">`) tandis que l'API parle en ISO 8601
 * (fuseau-agnostique). Le réseau ne voit jamais la fuseau du navigateur.
 */
function isoToLocalInput(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Corps de requête attendu par `POST /api/tournaments` et
 * `PATCH /api/tournaments/[id]/edit`.
 *
 * Attention à une asymétrie assumée : le format de match voyage **aplati** en
 * `matchFormatType` / `matchFormatValue`, alors que `TournamentField` ne connaît
 * qu'un seul champ, `matchFormat`. Un appelant qui filtre ce corps par champ
 * éditable doit donc traiter ces deux clés comme une seule.
 *
 * Les réglages propres à un format ne partent que pour le format qui les
 * possède : envoyer une cadence de survie sur un bracket à élimination simple
 * écrirait un réglage que rien ne relira.
 */
export function toApiPayload(values: TournamentFormValues): Record<string, unknown> {
  const { format } = values;
  return {
    name: values.name,
    description: values.description,
    game: values.game,
    format,
    participantType: values.participantType,
    maxTeams: values.maxTeams,
    startVisibilityAt: new Date(values.startVisibilityAt).toISOString(),
    registrationOpenAt: new Date(values.registrationOpenAt).toISOString(),
    registrationCloseAt: new Date(values.registrationCloseAt).toISOString(),
    startAt: new Date(values.startAt).toISOString(),
    hasThirdPlaceMatch: format === "SINGLE" ? values.hasThirdPlaceMatch : false,
    survivalRoundsPerCut: format === "SURVIVAL" ? values.survivalRoundsPerCut : undefined,
    survivalRoundsBeforeFirstCut:
      format === "SURVIVAL" ? values.survivalRoundsBeforeFirstCut : undefined,
    phases: format === "MULTI" ? values.phases : undefined,
    swissTotalRounds: format === "SWISS" ? values.swissTotalRounds : undefined,
    swissPointsWin: format === "SWISS" ? values.swissPointsWin : undefined,
    swissPointsDraw: format === "SWISS" ? values.swissPointsDraw : undefined,
    swissPointsLoss: format === "SWISS" ? values.swissPointsLoss : undefined,
    endurancePoints: format === "BG_SURVIE" ? values.endurancePoints : undefined,
    enduranceWinDelta: format === "BG_SURVIE" ? values.enduranceWinDelta : undefined,
    enduranceLossDelta: format === "BG_SURVIE" ? values.enduranceLossDelta : undefined,
    endurancePlayoffSize: format === "BG_SURVIE" ? values.endurancePlayoffSize : undefined,
    // 0 n'est pas une valeur à enregistrer, c'est l'absence de plafond — et
    // c'est `null` qui le dit, jamais `undefined` : la liste blanche de
    // `PATCH .../edit` ne recopie que les champs dont `body[field] !==
    // undefined`, et `updateTournament` fusionne le patch sur les valeurs
    // courantes. Un champ omis vaut donc « on ne touche pas », si bien qu'un
    // plafond une fois posé ne pourrait plus jamais être retiré. Hors du mode,
    // en revanche, on ne touche effectivement à rien (comme le reste du barème
    // d'endurance).
    enduranceMaxRounds:
      format === "BG_SURVIE" ? (values.enduranceMaxRounds > 0 ? values.enduranceMaxRounds : null) : undefined,
    matchFormatType: values.matchFormat?.type ?? null,
    matchFormatValue: values.matchFormat?.value ?? null,
    // Le plafond de maps et les égalités voyagent **aplatis** eux aussi, comme
    // le type et le nombre de manches : un seul champ éditable, `matchFormat`,
    // quatre clés dans le corps.
    matchFormatMaxMaps: values.matchFormat?.maxMaps ?? null,
    // Les égalités n'ont de sens qu'en qualification de BG Survie : ailleurs,
    // la validation les refuse, et les envoyer ferait échouer la création d'un
    // tournoi dont le formulaire n'affiche même pas la case.
    matchFormatDraws:
      format === "BG_SURVIE" ? (values.matchFormat?.drawsAllowed ?? false) : false,
    endurancePlayoffFormatType:
      format === "BG_SURVIE" ? (values.endurancePlayoffFormat?.type ?? null) : null,
    endurancePlayoffFormatValue:
      format === "BG_SURVIE" ? (values.endurancePlayoffFormat?.value ?? null) : null,
    // Les conditions partent pour **tous** les formats : elles ne portent pas
    // sur le déroulé du tournoi mais sur qui a le droit d'y entrer, question
    // que les six formats posent à l'identique.
    registrationDiscordRequirement: values.registrationDiscordRequirement,
    registrationBlizzardRequirement: values.registrationBlizzardRequirement,
    registrationMinPlayers: values.registrationMinPlayers,
  };
}

/**
 * Inverse de `toApiPayload` : préremplit le formulaire depuis les valeurs
 * stockées. Un réglage absent (`null` — le tournoi n'est pas dans ce format)
 * retombe sur le défaut de création, pour que basculer le format ne présente
 * jamais un champ vide.
 */
export function toFormValues(apiValues: TournamentApiValues): TournamentFormValues {
  const defaults = defaultTournamentFormValues();
  const or = (value: number | null, fallback: number) => (value === null ? fallback : value);

  return {
    name: apiValues.name,
    description: apiValues.description ?? "",
    game: apiValues.game,
    format: apiValues.format,
    participantType: apiValues.participantType,
    maxTeams: apiValues.maxTeams,
    startVisibilityAt: isoToLocalInput(apiValues.startVisibilityAt),
    registrationOpenAt: isoToLocalInput(apiValues.registrationOpenAt),
    registrationCloseAt: isoToLocalInput(apiValues.registrationCloseAt),
    startAt: isoToLocalInput(apiValues.startAt),
    hasThirdPlaceMatch: apiValues.hasThirdPlaceMatch,
    survivalRoundsBeforeFirstCut: or(
      apiValues.survivalRoundsBeforeFirstCut,
      defaults.survivalRoundsBeforeFirstCut,
    ),
    survivalRoundsPerCut: or(apiValues.survivalRoundsPerCut, defaults.survivalRoundsPerCut),
    swissTotalRounds: or(apiValues.swissTotalRounds, computeRecommendedRounds(apiValues.maxTeams)),
    swissPointsWin: or(apiValues.swissPointsWin, defaults.swissPointsWin),
    swissPointsDraw: or(apiValues.swissPointsDraw, defaults.swissPointsDraw),
    swissPointsLoss: or(apiValues.swissPointsLoss, defaults.swissPointsLoss),
    endurancePoints: or(apiValues.endurancePoints, defaults.endurancePoints),
    enduranceWinDelta: or(apiValues.enduranceWinDelta, defaults.enduranceWinDelta),
    enduranceLossDelta: or(apiValues.enduranceLossDelta, defaults.enduranceLossDelta),
    endurancePlayoffSize: or(apiValues.endurancePlayoffSize, defaults.endurancePlayoffSize),
    // En BG Survie, `null` en base = pas de plafond : le champ retombe sur 0,
    // qui le dit — surtout pas sur le défaut de création, qui poserait un
    // plafond que personne n'a choisi. Hors du mode, `null` veut seulement
    // dire « pas ce format » : basculer vers BG Survie présente le défaut.
    enduranceMaxRounds:
      apiValues.format === "BG_SURVIE"
        ? (apiValues.enduranceMaxRounds ?? 0)
        : defaults.enduranceMaxRounds,
    matchFormat: apiValues.matchFormat,
    endurancePlayoffFormat: apiValues.endurancePlayoffFormat,
    registrationDiscordRequirement: apiValues.registrationDiscordRequirement,
    registrationBlizzardRequirement: apiValues.registrationBlizzardRequirement,
    registrationMinPlayers: apiValues.registrationMinPlayers,
    phases: apiValues.phases ?? defaults.phases,
  };
}
