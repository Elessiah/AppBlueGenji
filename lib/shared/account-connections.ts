/**
 * Les moyens de connexion d'un compte : ce qu'on peut ajouter, ce qu'on ne peut
 * pas retirer.
 *
 * **Le site n'a pas de mot de passe.** Un compte n'est atteignable que par les
 * identités OAuth rattachées — et, pour Discord, par le code reçu en message
 * privé, qui passe par le *même* `discord_id`. Détacher la dernière ne « délie »
 * donc pas un compte : elle le **ferme définitivement**, sans recours possible,
 * puisqu'il n'existe aucun chemin de récupération par courriel. C'est la seule
 * règle que ce module porte, et elle vaut d'être écrite une fois : l'écran qui
 * grise le bouton et la route qui refuse en 409 doivent dire la même chose, sans
 * quoi le bouton mène à un mur.
 *
 * Module **pur** : la liste des rattachements est un fait que l'appelant a déjà
 * établi (le serveur en base, le client depuis la réponse de l'API).
 */
import { OAUTH_PROVIDERS, OAUTH_PROVIDER_LABELS, type OAuthProvider } from "./oauth-providers";

/**
 * **Par quel geste** le rattachement Discord a été établi.
 *
 * Discord est le seul fournisseur à avoir deux portes : l'aller-retour OAuth
 * (le bouton), et le code à six chiffres reçu en message privé, que le bot
 * distribue. Les deux aboutissent au même `bg_users.discord_id` et ouvrent
 * ensuite les mêmes sessions — mais elles ne laissent pas la même trace **chez
 * Discord** : l'une y pose une autorisation d'application, que le joueur peut
 * consulter et révoquer de son côté, l'autre non. C'est exactement ce qu'une
 * liste de « comptes connectés » doit dire, et « Rattaché » ne le disait pas.
 *
 * `OAUTH` l'emporte donc, et ne redescend jamais : une fois l'autorisation
 * donnée, elle existe chez Discord tant que le joueur ne la retire pas, qu'il
 * se connecte ensuite par code ou non. Le sens n'est pas « comment je me suis
 * connecté la dernière fois » mais « sur quoi ce rattachement repose ».
 */
export type ConnectionMethod = "OAUTH" | "DM_CODE";

/** L'état d'une porte d'entrée pour un compte donné. */
export type AccountConnection = {
  provider: OAuthProvider;
  /** Une identité de ce fournisseur est-elle rattachée au compte ? */
  linked: boolean;
  /**
   * Le geste qui a établi ce rattachement, quand le site le sait.
   *
   * `null` a **deux** causes qu'il ne sert à rien de distinguer ici : le
   * fournisseur n'a qu'une porte (Google, Blizzard), ou le rattachement est
   * antérieur à l'enregistrement de cette information — les comptes reliés à
   * Discord avant cette colonne ne peuvent pas être classés après coup, et
   * leur inventer une méthode serait affirmer ce qu'on ignore. L'écran n'en
   * dit alors rien, ce qui est la seule chose honnête.
   */
  method: ConnectionMethod | null;
  /**
   * Le nom que le fournisseur donne à cette identité — tag Discord, BattleTag.
   *
   * `null` quand le fournisseur n'en donne aucun (Google) ou quand rien n'est
   * rattaché. Ce n'est **jamais** l'identifiant opaque : un `sub` affiché ne
   * renseigne personne, et le montrer reviendrait à publier une donnée de plus
   * pour rien.
   */
  handle: string | null;
};

/**
 * Pourquoi un détachement est refusé.
 *
 * Deux cas seulement, et le second est le seul qui compte : `LAST_CONNECTION`
 * dit qu'on s'apprête à murer la porte par laquelle on est entré.
 */
export type ConnectionUnlinkRefusal = "NOT_LINKED" | "LAST_CONNECTION";

/** Nombre de fournisseurs effectivement rattachés. */
export function linkedConnectionCount(connections: readonly AccountConnection[]): number {
  return connections.filter((connection) => connection.linked).length;
}

/**
 * Ce compte peut-il détacher ce fournisseur ? `null` = oui.
 *
 * Le seuil est **un**, et non deux : il reste toujours au moins un moyen
 * d'entrer. Le refus ne dépend pas du fournisseur visé — aucune porte n'est
 * « principale », elles se valent toutes.
 */
export function checkConnectionUnlink(
  connections: readonly AccountConnection[],
  provider: OAuthProvider,
): ConnectionUnlinkRefusal | null {
  const target = connections.find((connection) => connection.provider === provider);
  if (!target || !target.linked) return "NOT_LINKED";
  if (linkedConnectionCount(connections) <= 1) return "LAST_CONNECTION";
  return null;
}

/**
 * Le refus, dit au joueur.
 *
 * Vit ici et non dans l'écran : c'est la phrase qui accompagne la règle, et une
 * copie côté client aurait cessé de la décrire au premier ajustement.
 */
export function connectionUnlinkRefusalMessage(
  refusal: ConnectionUnlinkRefusal,
  provider: OAuthProvider,
): string {
  const label = OAUTH_PROVIDER_LABELS[provider];
  if (refusal === "NOT_LINKED") return `Aucun compte ${label} n'est rattaché.`;
  return `Impossible de retirer ${label} : c'est ton dernier moyen de connexion. Ajoutes-en un autre d'abord.`;
}

/**
 * Une liste complète à partir de ce que la base détient.
 *
 * Complète : **tous** les fournisseurs y figurent, rattachés ou non. L'écran
 * doit pouvoir proposer d'ajouter ce qui manque, et un tableau qui ne
 * contiendrait que l'existant l'obligerait à reconstruire le complément — donc
 * à connaître la liste, qu'il vient justement de recevoir.
 */
export function buildAccountConnections(
  linked: Partial<
    Record<
      OAuthProvider,
      { subject: string | null; handle?: string | null; method?: ConnectionMethod | null }
    >
  >,
): AccountConnection[] {
  return OAUTH_PROVIDERS.map((provider) => {
    const entry = linked[provider];
    const isLinked = Boolean(entry?.subject);
    return {
      provider,
      linked: isLinked,
      // Le tag **et** la méthode sont attachés au rattachement, pas au compte :
      // détaché, il ne reste rien à en dire. La colonne est effacée en base par
      // le même geste, mais une ligne périmée arrivant ici ne doit pas pouvoir
      // faire annoncer « rattaché par… » à côté d'un bouton « Rattacher ».
      method: isLinked ? (entry?.method ?? null) : null,
      handle: isLinked ? (entry?.handle ?? null) : null,
    };
  });
}

/**
 * Ce que la ligne dit du **geste** de rattachement, ou `null` s'il n'y a rien à
 * en dire.
 *
 * Rien à en dire dans trois cas : le fournisseur n'a qu'une porte (la préciser
 * serait du bruit sur chaque ligne), rien n'est rattaché, ou le rattachement est
 * antérieur à l'enregistrement de cette information. La phrase vit ici plutôt
 * que dans l'écran pour la raison habituelle — c'est la lecture de la règle, et
 * une copie côté client aurait cessé de la décrire au premier ajustement.
 */
export function connectionMethodLabel(connection: AccountConnection): string | null {
  if (!connection.linked || connection.method === null) return null;
  if (connection.provider !== "DISCORD") return null;
  return connection.method === "OAUTH"
    ? "Rattaché par le bouton Discord"
    : "Rattaché par code en message privé";
}

/**
 * Les refus du **rattachement** — ceux qu'une URL a le droit de porter.
 *
 * Le rappel OAuth renvoie le motif dans `?connection_error=`, et `oauth-flow`
 * y recopiait le message de l'erreur attrapée. Or le service ne lève pas que
 * ses refus nommés : tout ce que `mysql2` fait remonter le traverse. Un
 * `ER_LOCK_DEADLOCK` se retrouvait donc en toutes lettres dans la barre
 * d'adresse, l'historique du navigateur, le `Referer` de la requête suivante et
 * les journaux de chaque relais — sans que rien ne le signale à l'écran, le
 * registre de l'interface retombant sur sa phrase générique.
 *
 * C'est la règle déjà tenue pour les toasts (« un repli qui ne laisse jamais
 * sortir un jeton »), appliquée à une URL, qui voyage plus loin qu'un toast.
 * La liste vit ici, avec les refus qu'elle énumère, et non dans le module
 * serveur qui s'en sert : le registre français de `/profil` doit couvrir
 * exactement ces codes-là, et un test le vérifie.
 */
export const LINK_REFUSALS: readonly string[] = [
  "PROVIDER_ALREADY_LINKED",
  "IDENTITY_ALREADY_LINKED",
  "PROFILE_NOT_FOUND",
  "NOT_CONFIGURED",
  "OAUTH_FAILED",
  "LINK_FAILED",
];

/** Ce motif peut-il être écrit dans l'URL de retour ? */
export function isLinkRefusal(code: string | null | undefined): boolean {
  return typeof code === "string" && LINK_REFUSALS.includes(code);
}
