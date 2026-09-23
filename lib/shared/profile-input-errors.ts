/**
 * Les refus d'une **saisie** que `updateOwnProfile` sait nommer.
 *
 * Deux lecteurs, une seule liste : la route `PATCH /api/profile` ne laisse
 * sortir en 400 que ces codes-là (tout autre message d'exception est interne),
 * et le registre de `/profil` leur doit une phrase chacun. Recopiée des deux
 * côtés, la liste dériverait au premier refus ajouté — la route le ramènerait
 * au code générique, et le joueur lirait « La sauvegarde a échoué » sur une
 * saisie qu'on savait pourtant nommer.
 *
 * Le registre de l'écran est typé sur `ProfileInputError` : un code ajouté ici
 * sans sa phrase ne compile pas.
 *
 * Module **pur**.
 */
export const PROFILE_INPUT_ERRORS = [
  "INVALID_PSEUDO",
  "PSEUDO_EMPTY",
  "PSEUDO_TOO_LONG",
  "INVALID_DISCORD_PSEUDO",
] as const;

export type ProfileInputError = (typeof PROFILE_INPUT_ERRORS)[number];

const INPUT_ERRORS: ReadonlySet<string> = new Set(PROFILE_INPUT_ERRORS);

export function isProfileInputError(code: string | null | undefined): code is ProfileInputError {
  return !!code && INPUT_ERRORS.has(code);
}
