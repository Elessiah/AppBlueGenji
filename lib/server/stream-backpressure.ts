/**
 * Contre-pression d'un flux SSE : quoi faire d'une trame quand le client ne lit
 * plus.
 *
 * `controller.enqueue` n'échoue jamais sur une connexion bloquée sans être
 * fermée — un mobile sorti du réseau, une fenêtre TCP pleine : la trame s'ajoute
 * à la file du flux, en mémoire du serveur, et la suivante aussi. Sur un gros
 * plateau, chaque trame pèse plus de 200 Ko, et le battement de cœur ne tombe
 * jamais en erreur pour libérer la connexion. La file grandissait donc sans
 * borne, à chaque diffusion.
 *
 * La règle tient en trois cas, décidés ici sans rien toucher (module pur, testé
 * seul) :
 *
 * - la file a de la place → on écrit ;
 * - elle est pleine → on **n'écrit pas**, et l'appelant le dit à la salle, qui
 *   garde l'abonné « en retard » : la comparaison de version lui renverra la
 *   **dernière** trame une fois la file dégagée, au lieu de toutes celles
 *   manquées entre-temps ;
 * - elle est pleine depuis trop longtemps → on **ferme**. Un client vivant se
 *   reconnecte seul (attente exponentielle du client), un client mort libère sa
 *   file et sa place de flux.
 */

/**
 * Taille de la file d'un flux, en octets. Au-delà, la connexion est réputée
 * bloquée. Large à dessein : plusieurs instantanés d'un gros plateau, pour
 * qu'une lenteur passagère (la trame d'ouverture pas encore lue au moment de la
 * première diffusion) ne fasse jamais sauter un envoi — seul un client qui ne
 * lit réellement plus remplit la file.
 */
export const STREAM_QUEUE_HIGH_WATER_BYTES = 1024 * 1024;

/**
 * Durée au-delà de laquelle une file restée pleine fait fermer la connexion.
 * Le battement de cœur (25 s) suffit à la constater même sur un tournoi calme.
 */
export const STREAM_STALL_TIMEOUT_MS = 60_000;

export type StreamWriteDecision =
  /** Écrire la trame ; la file n'est plus pleine. */
  | { action: "WRITE"; backedUpSince: null }
  /** Ne pas écrire ; la file est pleine depuis `backedUpSince`. */
  | { action: "SKIP"; backedUpSince: number }
  /** Fermer la connexion : la file ne se vide plus. */
  | { action: "CLOSE"; backedUpSince: number };

/**
 * Décide du sort d'une trame.
 *
 * @param desiredSize `controller.desiredSize` : place restante dans la file
 *   (négative quand elle déborde, `null` sur un flux en erreur — traité comme
 *   de la place, l'écriture lèvera d'elle-même).
 * @param backedUpSince instant où la file a été vue pleine pour la première
 *   fois, `null` si elle ne l'est pas.
 */
export function decideStreamWrite(
  desiredSize: number | null,
  backedUpSince: number | null,
  now: number,
): StreamWriteDecision {
  if (desiredSize === null || desiredSize > 0) {
    return { action: "WRITE", backedUpSince: null };
  }
  const since = backedUpSince ?? now;
  if (now - since >= STREAM_STALL_TIMEOUT_MS) {
    return { action: "CLOSE", backedUpSince: since };
  }
  return { action: "SKIP", backedUpSince: since };
}
