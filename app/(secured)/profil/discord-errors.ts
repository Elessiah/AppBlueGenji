/**
 * Les refus de la certification Discord, dits en français.
 *
 * Même forme que `app/connexion/_lib/login-errors.ts` — registre pur, testable,
 * repli qui ne laisse jamais sortir un jeton en capitales. Distinct de celui de
 * la connexion parce que les consignes diffèrent : là-bas on propose de passer
 * par Google, ici il n'y a pas d'autre chemin, la certification *est* le geste.
 */
const VERIFICATION_ERRORS: Record<string, string> = {
  INVALID_DISCORD_HANDLE:
    "Renseigne un tag Discord (un pseudo, pas un identifiant numérique) : c'est lui qui sera certifié.",
  INVALID_CODE: "Le code doit contenir 6 chiffres.",
  CODE_INVALID_OR_EXPIRED: "Code invalide ou expiré. Recommence la certification.",

  // Le tag résout vers un compte Discord différent de celui déjà relié au
  // compte : on ne déplace pas une porte d'entrée, c'est au joueur de trancher.
  DISCORD_ID_MISMATCH:
    "Ce tag appartient à un autre compte Discord que celui relié à ton compte BlueGenji. Corrige le tag, ou contacte l'organisation.",
  DISCORD_ALREADY_LINKED:
    "Ce compte Discord est déjà certifié par un autre compte du site. Contacte l'organisation si c'est bien le tien.",

  DISCORD_USER_NOT_FOUND:
    "Tag introuvable : le bot doit partager un serveur avec toi. Rejoins le serveur BlueGenji, puis réessaie.",
  DISCORD_DM_FAILED:
    "Impossible de t'envoyer le code en message privé : ouvre tes DM sur le serveur BlueGenji, puis réessaie.",
  BOT_INTERNAL_UNREACHABLE:
    "Certification indisponible pour le moment (bot non joignable). Réessaie plus tard.",
  BOT_INTERNAL_UNAUTHORIZED:
    "Certification indisponible (configuration interne). Signale-le à l'organisation.",

  TOO_MANY_CODE_REQUESTS:
    "Trop de codes demandés pour ce compte Discord. Attends une quinzaine de minutes.",
  TOO_MANY_REQUESTS: "Trop de tentatives. Attends une quinzaine de minutes.",

  PROFILE_NOT_FOUND: "Ton compte est introuvable. Reconnecte-toi.",
  UNAUTHORIZED: "Reconnecte-toi pour certifier ton tag.",
};

export function discordVerificationErrorMessage(code: string | null | undefined): string {
  if (!code) return "La certification a échoué. Réessaie dans un instant.";
  return VERIFICATION_ERRORS[code] ?? "La certification a échoué. Réessaie dans un instant.";
}
