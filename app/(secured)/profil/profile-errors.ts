/**
 * Les refus de la **sauvegarde du profil**, dits en français.
 *
 * Distinct du registre de la certification (`discord-errors.ts`) : router les
 * erreurs du profil vers celui-là faisait annoncer « La certification a échoué »
 * à un pseudo déjà pris, à une coupure réseau, à tout ce qui n'était pas prévu.
 * Un repli ne doit jamais affirmer une cause qu'il ne connaît pas.
 *
 * Les codes que la route rend vraiment, et rien d'autre ; le repli reste vague
 * **exprès**, et ne laisse jamais sortir un code en capitales dans un toast.
 */
const PROFILE_ERRORS: Record<string, string> = {
  PSEUDO_ALREADY_USED: "Ce pseudo est déjà pris. Choisis-en un autre.",

  // Un compte Discord rattaché possède son tag : il ne peut pas en inventer un
  // autre, mais il peut le retirer. Le message nomme les deux gestes qui
  // existent à l'écran.
  DISCORD_TAG_LOCKED:
    "Ton compte Discord est rattaché : ce tag vient de lui. Renomme-toi sur Discord puis reconnecte-toi pour en changer, ou retire-le.",

  UNAUTHORIZED: "Reconnecte-toi pour modifier ton profil.",
  PROFILE_NOT_FOUND: "Ton compte est introuvable. Reconnecte-toi.",
};

export function profileErrorMessage(code: string | null | undefined): string {
  if (!code) return "La sauvegarde a échoué. Réessaie dans un instant.";
  return PROFILE_ERRORS[code] ?? "La sauvegarde a échoué. Réessaie dans un instant.";
}
