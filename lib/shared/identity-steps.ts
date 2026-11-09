/**
 * Où en est chaque identité du compte, et le **seul** geste suivant.
 *
 * Les joueurs croyaient qu'un compte lié suffisait et ne trouvaient jamais le
 * bouton « Certifier » : l'écran dit désormais, pour Discord, Battle.net et
 * Google, un état parmi trois (`UNLINKED` → `LINKED` → `CERTIFIED`) et l'unique
 * action qui fait avancer d'un cran. Logique pure : aucun accès au réseau, la
 * page lui passe ce qu'elle a déjà lu.
 *
 * - **Discord** : lié, le tag n'est pas pour autant certifié (`CERTIFY` s'il y a
 *   un tag, `REGISTER` s'il faut d'abord en poser un).
 * - **Battle.net** : « certifié » = le BattleTag vient de Blizzard. Lié sans
 *   BattleTag fourni, le tag tapé reste non certifié et aucun bouton ne peut le
 *   changer : `action` vaut `null`.
 * - **Google** : sans certification, lié = terminé.
 */
import type { OAuthProvider } from "./oauth-providers";

export type IdentityStage = "UNLINKED" | "LINKED" | "CERTIFIED";
export type IdentityAction = "LINK" | "CERTIFY" | "REGISTER";

export type IdentityStep = {
  stage: IdentityStage;
  /** Le geste suivant, `null` quand il n'y en a pas. */
  action: IdentityAction | null;
  /** Vrai quand ce fournisseur peut être « certifié » (pas Google). */
  certifiable: boolean;
};

export type IdentityStepInput = {
  linked: boolean;
  /** Discord : un tag est enregistré. */
  discordHasTag: boolean;
  /** Discord : le tag est certifié. */
  discordVerified: boolean;
  /** Battle.net : le BattleTag vient de Blizzard (non tapé). */
  battletagFromBlizzard: boolean;
};

export function identityStep(provider: OAuthProvider, input: IdentityStepInput): IdentityStep {
  const certifiable = provider !== "GOOGLE";
  if (!input.linked) return { stage: "UNLINKED", action: "LINK", certifiable };
  if (provider === "DISCORD") {
    if (input.discordVerified) return { stage: "CERTIFIED", action: null, certifiable };
    return { stage: "LINKED", action: input.discordHasTag ? "CERTIFY" : "REGISTER", certifiable };
  }
  if (provider === "BLIZZARD") {
    return input.battletagFromBlizzard
      ? { stage: "CERTIFIED", action: null, certifiable }
      : { stage: "LINKED", action: null, certifiable };
  }
  return { stage: "LINKED", action: null, certifiable };
}
