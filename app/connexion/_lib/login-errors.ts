/**
 * Les refus de la connexion Discord, dits en français.
 *
 * Le registre vivait dans `page.tsx` et se terminait par `return errorCode` :
 * tout code que la carte ne connaissait pas s'affichait tel quel dans le toast.
 * Les plafonds posés par la passe de sécurité en ont ajouté deux — un joueur
 * lisait `TOO_MANY_CODE_REQUESTS` en capitales —, et ce sont justement les
 * refus qui appellent une consigne : *attends*, et *par où passer en attendant*.
 *
 * Même forme que `app/(secured)/equipes/_lib/membership-errors.ts` : un registre
 * pur, testable, et un repli qui ne laisse **jamais** sortir un jeton.
 */

const LOGIN_ERRORS: Record<string, string> = {
  // Bot injoignable ou mal configuré : la panne est de notre côté, le joueur n'a
  // rien à corriger — mais la connexion Google, elle, reste ouverte.
  BOT_INTERNAL_UNREACHABLE:
    "Connexion Discord indisponible (bot non joignable). Tu peux passer par Google.",
  BOT_INTERNAL_UNAUTHORIZED:
    "Connexion Discord indisponible (token interne invalide). Tu peux passer par Google.",
  DISCORD_DM_FAILED:
    "Impossible de t'envoyer le code en message privé : ouvre tes DM sur le serveur BlueGenji, puis réessaie.",
  DISCORD_USER_NOT_FOUND:
    "Tag introuvable : le bot doit partager un serveur avec toi. Utilise plutôt ton ID Discord.",
  FAILED_TO_SEND_CODE: "Le code n'a pas pu être envoyé. Réessaie dans un instant.",

  INVALID_DISCORD_HANDLE: "Renseigne ton tag Discord ou ton ID.",
  INVALID_DISCORD_ID: "Identifiant Discord invalide.",
  INVALID_CODE: "Le code doit contenir 6 chiffres.",

  // Code faux, expiré (10 min), ou brûlé par cinq essais ratés. Les trois cas
  // se réparent pareil — en redemander un —, et les distinguer renseignerait
  // qui essaie de deviner.
  CODE_INVALID_OR_EXPIRED: "Code invalide ou expiré. Demande un nouveau code.",

  // Plafond du nombre de codes envoyés à ce compte : chaque demande fait vibrer
  // un téléphone, elles sont comptées.
  TOO_MANY_CODE_REQUESTS:
    "Trop de codes demandés pour ce compte Discord. Attends une quinzaine de minutes, ou connecte-toi avec Google.",
  // Plafond de débit générique (`enforceRateLimit`), sur la demande comme sur la
  // vérification.
  TOO_MANY_REQUESTS:
    "Trop de tentatives. Attends une quinzaine de minutes, ou connecte-toi avec Google.",

  DISCORD_AUTH_FAILED: "La connexion Discord a échoué. Réessaie dans un instant.",
};

/**
 * Message à afficher pour un code de refus de la connexion.
 *
 * Un code inconnu retombe sur une phrase générique **et non sur le code
 * lui-même** : le jour où le serveur en ajoute un, le joueur lit une phrase.
 */
export function loginErrorMessage(code: string | null | undefined): string {
  if (!code) return "Une erreur interne est survenue.";
  return LOGIN_ERRORS[code] ?? "Une erreur interne est survenue.";
}
