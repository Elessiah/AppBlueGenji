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
import { OAUTH_PROVIDER_LABELS, type OAuthProvider } from "@/lib/shared/oauth-providers";

const CONNECTION_ERRORS: Record<string, string> = {
  // Le compte porte déjà une autre identité de ce fournisseur. On ne déplace
  // pas une porte d'entrée. Le cas le plus courant n'est **pas** un joueur qui
  // veut changer de compte, mais un joueur qui reconfirme le sien (c'est ainsi
  // qu'un compte relié à Discord certifie son tag) en étant connecté, chez le
  // fournisseur, sous un autre compte : la phrase donne d'abord ce geste-là, et
  // ne propose le retrait qu'ensuite — le conseiller d'emblée pousserait à
  // détacher la bonne identité.
  PROVIDER_ALREADY_LINKED:
    "Le compte avec lequel tu viens de passer chez ce fournisseur n'est pas celui rattaché à ton profil. Connecte-toi chez lui avec le bon compte, puis recommence. Pour changer de compte, retire d'abord l'ancien.",
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

/**
 * La phrase du retour réussi d'un aller-retour de rattachement.
 *
 * Deux cas, parce que le même retour couvre deux gestes : **ajouter** une
 * application, et **reconfirmer** celle qui l'était déjà — c'est le chemin par
 * lequel un compte relié à Discord certifie son tag. Annoncer « rattaché » à qui
 * l'était déjà décrirait un changement qui n'a pas eu lieu, et tairait celui qui
 * a eu lieu : le pseudo a été relu auprès du fournisseur.
 */
export function connectionSuccessMessage(provider: OAuthProvider | null, refreshed: boolean): string {
  if (!provider) return refreshed ? "Application reconfirmée." : "Application rattachée.";
  const label = OAUTH_PROVIDER_LABELS[provider];
  if (!refreshed) return `${label} est maintenant rattaché à ton compte.`;
  return provider === "DISCORD"
    ? "Discord reconfirmé : ton pseudo a été relu auprès de Discord."
    : `${label} reconfirmé : les informations de ton compte ont été relues.`;
}
