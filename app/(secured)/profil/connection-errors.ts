/**
 * Les refus du rattachement et du retrait d'un moyen de connexion, dits en
 * français.
 *
 * Même forme que `discord-errors.ts` et `app/connexion/_lib/login-errors.ts` —
 * registre pur, testable, repli qui ne laisse jamais sortir un jeton en
 * capitales. Distinct des deux autres parce que les consignes diffèrent : ici le
 * joueur est **déjà connecté**, il n'y a donc jamais lieu de lui proposer une
 * autre porte d'entrée, seulement de lui dire quel geste lève le refus.
 *
 * `LAST_CONNECTION` a le sien dans le module pur
 * (`connectionUnlinkRefusalMessage`), qui sait de quel fournisseur on parle :
 * l'écran s'en sert pour griser le bouton **avant** le clic. La ligne ci-dessous
 * ne couvre que le cas où le serveur refuse un geste que l'écran croyait permis
 * — deux onglets ouverts, par exemple.
 */
const CONNECTION_ERRORS: Record<string, string> = {
  // Le compte porte déjà une autre identité de ce fournisseur. On ne déplace
  // pas une porte d'entrée : au joueur de retirer l'ancienne d'abord, en
  // sachant ce qu'il fait.
  PROVIDER_ALREADY_LINKED:
    "Une autre application de ce fournisseur est déjà rattachée à ton compte. Retire-la d'abord, puis recommence.",
  // L'identité appartient à un autre compte du site. Rien que le joueur puisse
  // corriger seul : les deux comptes sont peut-être les siens.
  IDENTITY_ALREADY_LINKED:
    "Ce compte est déjà rattaché à un autre profil BlueGenji. Contacte l'organisation si les deux sont bien à toi.",
  LAST_CONNECTION:
    "C'est ton dernier moyen de connexion : rattache-en un autre avant de le retirer.",
  NOT_LINKED: "Cette application n'est pas rattachée à ton compte.",
  UNKNOWN_PROVIDER: "Application inconnue.",
  OAUTH_FAILED: "Le rattachement a échoué chez le fournisseur. Réessaie dans un instant.",
  // Le motif que prennent toutes les pannes qui n'ont pas de nom : le message du
  // serveur ne voyage pas jusqu'ici (`LINK_REFUSALS`), et il n'apprendrait rien
  // au joueur.
  LINK_FAILED: "Le rattachement n'a pas abouti. Réessaie dans un instant.",
  // Rien à réessayer : la variable d'environnement manque, et le bouton ne
  // marchera pas tant que personne ne l'aura remplie.
  NOT_CONFIGURED:
    "Ce moyen de connexion n'est pas configuré sur le site. Signale-le à l'organisation.",
  PROFILE_NOT_FOUND: "Ton compte est introuvable. Reconnecte-toi.",
  UNAUTHORIZED: "Reconnecte-toi pour gérer tes applications.",
};

export function connectionErrorMessage(code: string | null | undefined): string {
  if (!code) return "L'opération a échoué. Réessaie dans un instant.";
  return CONNECTION_ERRORS[code] ?? "L'opération a échoué. Réessaie dans un instant.";
}
