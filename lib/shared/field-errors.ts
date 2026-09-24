/**
 * Erreurs de saisie rattachées à leur champ (WCAG 3.3.1 / 3.3.3).
 *
 * Toute erreur du site passe par une notification — c'est la convention, et
 * elle reste. Mais une notification ne dit pas **où** est la faute : un lecteur
 * d'écran entend « Ce pseudo est déjà pris », puis retrouve un formulaire dont
 * aucun champ ne se signale, et doit deviner lequel reprendre. Le refus est donc
 * aussi posé sur le champ fautif : `aria-invalid="true"`, et un
 * `aria-describedby` qui lit la phrase du refus **puis** l'aide existante (la
 * règle à respecter). Le focus y est ramené, si bien que la consigne et
 * l'endroit arrivent ensemble.
 *
 * La phrase n'est **pas** réécrite sous le champ : elle vit dans un texte réservé
 * aux technologies d'assistance (`FieldErrorText`). Le voyant a la notification
 * et le liseré rouge du champ, et l'interface ne gagne aucun second message.
 *
 * Ce module est pur : il dit **quel champ** un code désigne, et quels attributs
 * poser. L'état (le champ fautif du moment, le focus) vit dans
 * `lib/shared/hooks/useFieldErrors.ts`.
 */

import { TEAM_NAME_ALREADY_USED, INVALID_TEAM_NAME } from "@/lib/shared/team-name";
import { TEAM_TAG_ALREADY_USED } from "@/lib/shared/team-tag";

/**
 * Table « code de refus → champ » d'un formulaire.
 *
 * Un code absent n'est rattaché à rien — c'est le cas de tous les refus qui ne
 * tiennent pas à une saisie (session expirée, réseau, droits) : aucun champ n'y
 * peut rien, et en marquer un enverrait corriger ce qui est juste.
 */
export type FieldErrorMap<F extends string> = Readonly<Partial<Record<string, F>>>;

/** Champ désigné par un code de refus, ou `null` s'il n'en désigne aucun. */
export function fieldForError<F extends string>(
  code: string | null | undefined,
  map: FieldErrorMap<F>,
): F | null {
  if (!code) return null;
  // `hasOwn` et non un simple accès : un code comme `constructor` ou `toString`
  // lirait sinon une propriété héritée de `Object.prototype`.
  return Object.hasOwn(map, code) ? (map[code] ?? null) : null;
}

/** Champ signalé, et la phrase du refus qui le vise. */
export type FlaggedField<F extends string> = { field: F; message: string };

/**
 * Signalement qu'un refus produit : le champ qu'il désigne, ou `null` — et
 * `null` **efface** le signalement précédent, qui décrivait un envoi qui n'est
 * plus le dernier.
 */
export function flagFromCode<F extends string>(
  code: string | null | undefined,
  message: string,
  map: FieldErrorMap<F>,
): FlaggedField<F> | null {
  const field = fieldForError(code, map);
  return field ? { field, message } : null;
}

/**
 * Signalement après une levée : `field` omis lève tout ; donné, il ne lève que
 * ce champ — saisir dans le nom n'efface pas le refus qui vise le sigle.
 */
export function clearFlag<F extends string>(
  current: FlaggedField<F> | null,
  field?: F,
): FlaggedField<F> | null {
  if (!current) return null;
  if (field !== undefined && current.field !== field) return current;
  return null;
}

/** Identifiant du texte d'erreur rattaché à un champ. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/**
 * Valeur d'`aria-describedby` : les identifiants donnés, dans l'ordre, sans
 * doublon ni vide. `undefined` quand il n'en reste aucun — un attribut vide
 * ne décrirait rien et encombrerait l'arbre d'accessibilité.
 */
export function describedBy(...ids: ReadonlyArray<string | null | undefined | false>): string | undefined {
  const kept: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    for (const part of id.split(/\s+/)) {
      if (part && !kept.includes(part)) kept.push(part);
    }
  }
  return kept.length > 0 ? kept.join(" ") : undefined;
}

export type FieldAria = {
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

/**
 * Attributs ARIA d'un champ.
 *
 * Invalide, le champ est décrit d'abord par la phrase du refus, puis par ses
 * aides : c'est l'ordre dans lequel on a besoin de les entendre (ce qui ne va
 * pas, puis la règle). Valide, il garde ses seules aides, et `aria-invalid`
 * est **absent** plutôt qu'à `false` — un champ n'est pas « valide » tant
 * qu'on ne l'a pas contrôlé, il est seulement non signalé.
 */
export function fieldAria(
  fieldId: string,
  invalid: boolean,
  ...helpIds: ReadonlyArray<string | null | undefined | false>
): FieldAria {
  const describedby = describedBy(invalid && fieldErrorId(fieldId), ...helpIds);
  return {
    ...(invalid ? { "aria-invalid": true as const } : {}),
    ...(describedby ? { "aria-describedby": describedby } : {}),
  };
}

/**
 * Premier jalon mal placé d'une suite qui doit rester chronologique : illisible,
 * ou antérieur au précédent. `null` si la suite est en ordre.
 *
 * Le serveur ne rend qu'un code pour les quatre dates d'un tournoi
 * (`INVALID_DATES`, `INVALID_DATE_ORDER`) : c'est cette lecture qui en tire le
 * champ à reprendre, sur les valeurs que le formulaire vient d'envoyer. Même
 * comparaison que `parseTournamentDates` (égalité permise), pour ne jamais
 * désigner un champ que le serveur accepte.
 */
export function firstMisplacedDate<F extends string>(
  dates: ReadonlyArray<readonly [F, string]>,
): F | null {
  let previous: number | null = null;
  for (const [field, raw] of dates) {
    const time = new Date(raw).getTime();
    if (Number.isNaN(time)) return field;
    if (previous !== null && time < previous) return field;
    previous = time;
  }
  return null;
}

// ── Tables des formulaires ────────────────────────────────────────────────

/** Identité d'une équipe : création, équipe fantôme, fiche en mode gestion. */
export type TeamIdentityField = "name" | "tag";

export const TEAM_IDENTITY_FIELD_ERRORS: FieldErrorMap<TeamIdentityField> = {
  [INVALID_TEAM_NAME]: "name",
  [TEAM_NAME_ALREADY_USED]: "name",
  TEAM_TAG_TOO_SHORT: "tag",
  TEAM_TAG_TOO_LONG: "tag",
  TEAM_TAG_NOT_ALPHANUMERIC: "tag",
  [TEAM_TAG_ALREADY_USED]: "tag",
};

/** Profil du joueur (`/profil`). */
export type ProfileField = "pseudo" | "battletag" | "discord";

export const PROFILE_FIELD_ERRORS: FieldErrorMap<ProfileField> = {
  INVALID_PSEUDO: "pseudo",
  PSEUDO_EMPTY: "pseudo",
  PSEUDO_TOO_LONG: "pseudo",
  PSEUDO_ALREADY_USED: "pseudo",
  INVALID_OVERWATCH_BATTLETAG: "battletag",
  BATTLETAG_LOCKED: "battletag",
  INVALID_DISCORD_PSEUDO: "discord",
  DISCORD_TAG_LOCKED: "discord",
};

/**
 * Connexion par code Discord (`/connexion`). Le pseudo de première connexion
 * n'y figure pas : la route n'en refuse aucun, elle départage elle-même un
 * pseudo déjà pris.
 */
export type LoginField = "handle" | "code";

export const LOGIN_FIELD_ERRORS: FieldErrorMap<LoginField> = {
  INVALID_DISCORD_HANDLE: "handle",
  DISCORD_USER_NOT_FOUND: "handle",
  INVALID_CODE: "code",
  CODE_INVALID_OR_EXPIRED: "code",
};

/**
 * Formulaire de tournoi (création et édition). Les deux codes de date ne
 * désignent pas un champ à eux seuls : `DATE_ORDER_CODES` renvoie à
 * `firstMisplacedDate`.
 */
export type TournamentFormField =
  | "name"
  | "maxTeams"
  | "matchFormatValue"
  | "startVisibilityAt"
  | "registrationOpenAt"
  | "registrationCloseAt"
  | "startAt";

export const TOURNAMENT_FIELD_ERRORS: FieldErrorMap<TournamentFormField> = {
  MISSING_NAME: "name",
  INVALID_MAX_TEAMS: "maxTeams",
  INVALID_MATCH_FORMAT: "matchFormatValue",
};

/** Refus de date du serveur, rattachés au premier jalon mal placé. */
export const DATE_ORDER_CODES: ReadonlySet<string> = new Set(["INVALID_DATES", "INVALID_DATE_ORDER"]);

/**
 * Erreur qui garde son **code** à côté de la phrase affichée.
 *
 * Les formulaires traduisent le refus avant de le lever (la notification lit
 * `message`) ; sans le code, le `catch` ne saurait plus quel champ il désigne.
 */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodedError";
  }
}

/** Code porté par une erreur levée, s'il y en a un. */
export function errorCode(error: unknown): string | null {
  return error instanceof CodedError ? error.code : null;
}
