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
  // Le bot a répondu trop tard : tag absent de ses serveurs ou bot surchargé,
  // sans qu'on sache lequel. Les deux sorties évitent la recherche par tag —
  // l'ID ne vaut pourtant que dans le second cas : sans serveur commun, Discord
  // refuse le message privé quel que soit l'identifiant, d'où la condition dite.
  BOT_RESOLVE_TIMEOUT:
    "La recherche de ton tag par le bot n'a pas abouti à temps. Si tu es sur un de ses serveurs, utilise plutôt ton ID Discord ; sinon, passe par le bouton Discord.",
  BOT_INTERNAL_UNAUTHORIZED:
    "Connexion Discord indisponible (token interne invalide). Tu peux passer par Google.",
  // Sur une saisie par ID, c'est aussi ce qui arrive sans serveur commun : la
  // recherche est sautée, et c'est Discord qui refuse l'envoi.
  DISCORD_DM_FAILED:
    "Impossible de t'envoyer le code en message privé : le bot doit partager un serveur avec toi, et tes DM doivent y être ouverts. Rejoins le serveur BlueGenji, ou passe par le bouton Discord.",
  // Tag inconnu de tous les serveurs du bot : saisir l'ID ne changerait rien, le
  // message privé serait refusé faute de serveur commun.
  DISCORD_USER_NOT_FOUND:
    "Tag introuvable : le bot doit partager un serveur avec toi. Rejoins le serveur BlueGenji, ou passe par le bouton Discord.",
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

/**
 * Les refus de l'aller-retour OAuth, dits en français.
 *
 * **Une table, pas trois.** La page portait cinq codes écrits en dur, tous
 * préfixés `google_` — `google_not_configured`, `google_unavailable`… —, soit
 * cinq phrases à recopier par fournisseur ajouté, et quinze à tenir à jour. Le
 * refus ne dépend pourtant jamais du fournisseur : c'est toujours « la
 * configuration manque », « l'aller-retour a échoué », « l'état a expiré ». Seul
 * le **nom** change, et il arrive maintenant à part (`?provider=`).
 *
 * Chaque phrase nomme le geste qui lève le refus, et renvoie vers **les autres
 * portes** quand celle-ci est fermée : un joueur bloqué sur Discord n'a pas à
 * deviner que Google marche encore.
 */
const OAUTH_ERRORS: Record<string, (provider: string) => string> = {
  // La variable d'environnement manque : rien à réessayer, la panne est chez
  // nous et aucune patience ne la corrigera.
  not_configured: (p) => `Connexion ${p} indisponible : configuration manquante. Essaie un autre moyen de connexion.`,
  unavailable: (p) => `Connexion ${p} temporairement indisponible. Réessaie dans un instant.`,
  // Le rappel est arrivé sans code ni état : lien tronqué, ou consentement
  // refusé chez le fournisseur.
  params: (p) => `Connexion ${p} interrompue. Relance la connexion depuis cette page.`,
  // L'état a expiré (dix minutes) ou ne correspond pas : relancer est la seule
  // réponse, et c'est aussi celle qu'on doit à une tentative de rejeu.
  state: () => "Session de connexion expirée ou invalide. Relance la connexion.",
  oauth: (p) => `Échec de la connexion ${p}. Réessaie dans un instant.`,
  // `intent=link` sans session : la connexion a expiré pendant l'aller-retour.
  session: () => "Tu dois être connecté pour rattacher une application. Connecte-toi, puis réessaie.",
};

/** Nom du fournisseur tel qu'il s'affiche dans une phrase de refus. */
const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  discord: "Discord",
  blizzard: "Blizzard",
};

/**
 * Message à afficher pour un refus d'aller-retour OAuth.
 *
 * Un fournisseur inconnu — ou absent, sur un vieux lien — retombe sur « OAuth »
 * plutôt que sur une phrase amputée : le message reste lisible même quand le
 * paramètre manque.
 */
export function oauthErrorMessage(
  kind: string | null | undefined,
  providerSlug: string | null | undefined,
): string | null {
  if (!kind) return null;
  const render = OAUTH_ERRORS[kind];
  if (!render) return null;
  return render(PROVIDER_LABELS[(providerSlug ?? "").toLowerCase()] ?? "OAuth");
}
