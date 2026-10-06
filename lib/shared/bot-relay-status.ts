import type { BotServerEntry } from "@/lib/shared/types";
import { FR_BOT_TEXT, type BotText } from "@/lib/shared/bot-text";

/**
 * L'état du relais d'un serveur Discord, **dit en français**.
 *
 * La colonne s'intitulait « STATUS » et rendait `● OK` / `● LAG` / `○ OFF` :
 * trois mots anglais sans définition nulle part, dont le deuxième ne veut rien
 * dire pour un lecteur — « lag » est le vocabulaire du bot, pas celui de la
 * page. Ce que la colonne décrit est en réalité **le relais** de ce serveur : à
 * jour, en retard, ou arrêté. Les valeurs renvoyées par le bot
 * (`ok` / `lag` / `off`) sont inchangées — c'est leur traduction qui manquait.
 *
 * La règle vit ici, et non dans le composant, pour la raison qui vaut partout
 * ailleurs dans le projet : elle est **pure**, donc elle se teste sans rendu.
 *
 * Deux points à connaître.
 *
 * 1. **Un état inconnu se nomme, il ne disparaît pas.** `fetchBotServers` fait
 *    un simple `as BotServersPayload` sur du JSON reçu par le réseau : rien ne
 *    garantit à l'exécution que `status` vaut l'une des trois valeurs du type.
 *    Une recherche directe dans un `Record` rendrait alors `undefined`, React
 *    n'afficherait **rien**, et la cellule serait vide sans qu'aucune erreur ne
 *    le signale — exactement la panne muette que cette page vient de chasser.
 *    D'où le repli explicite, qui dit « Inconnu » plutôt que de mentir en
 *    « Hors ligne » : le bot a répondu, c'est la page qui ne sait pas lire.
 * 2. **Le ton est une valeur du registre, jamais la chaîne reçue.** Coller
 *    `status` dans un nom de classe laisserait une valeur non validée décider
 *    du CSS ; un état inconnu n'y trouverait de toute façon aucune couleur.
 */
export type BotRelayStatus = BotServerEntry["status"];

export interface BotRelayState {
  /** Libellé affiché dans la cellule (la puce fait partie du dessin). */
  label: string;
  /** Ce que l'état veut dire, pour qui s'arrête sur la cellule. */
  hint: string;
  /** Suffixe de classe CSS — toujours l'une des valeurs connues ici. */
  tone: "ok" | "lag" | "off" | "unknown";
}

type RelayTone = BotRelayState["tone"];

/** Le dessin de chaque état : puce pleine, sauf l'arrêt (cercle vide). */
const RELAY_GLYPHS: Record<RelayTone, string> = { ok: "●", lag: "●", off: "○", unknown: "●" };

const KNOWN_RELAY_STATES: Record<BotRelayStatus, true> = { ok: true, lag: true, off: true };

/** L'état dans la langue de la page : libellé (puce comprise) et explication. */
function relayState(tone: RelayTone, text: BotText): BotRelayState {
  const label = text.t(`relay.${tone}.label`);
  return { label: `${RELAY_GLYPHS[tone]} ${label}`, hint: text.t(`relay.${tone}.hint`), tone };
}

/**
 * Traduit l'état renvoyé par le bot, sans jamais rendre une cellule vide.
 *
 * La recherche passe par `hasOwnProperty` et non par un simple `??` : une
 * valeur reçue par le réseau peut nommer une **propriété du prototype**
 * (`toString`, `constructor`), que l'indexation rendrait — une fonction, là où
 * la cellule attend un libellé.
 */
export function resolveBotRelayState(status: string | null | undefined, text: BotText = FR_BOT_TEXT): BotRelayState {
  if (!status) return relayState("unknown", text);
  if (!Object.hasOwn(KNOWN_RELAY_STATES, status)) {
    return relayState("unknown", text);
  }
  return relayState(status as BotRelayStatus, text);
}

/**
 * Nom accessible de la cellule : **le texte visible d'abord**, puis sa
 * définition (WCAG 2.5.3).
 *
 * Ce que porte chaque canal, sans en promettre plus : le **libellé** dit l'état
 * à tout le monde — c'est lui qui devait rendre une légende inutile, et c'est
 * pourquoi il fallait qu'il se lise (« Retard », pas « LAG ») ; le `title`
 * donne la définition au pointeur ; cet `aria-label` la donne aux technologies
 * d'assistance. Un visiteur **voyant, au doigt** n'a ni l'un ni l'autre : il lit
 * le libellé, et rien de plus. C'est le choix assumé de ne pas poser de légende
 * sous le tableau — pas une lacune qu'un `aria-label` viendrait combler.
 */
export function botRelayAccessibleLabel(state: BotRelayState): string {
  return `${stripBullet(state.label)} — ${state.hint}`;
}

/** La puce est un dessin : elle se lit « point noir moyen » et rien d'autre. */
function stripBullet(label: string): string {
  return label.replace(/^[●○]\s*/u, "");
}
