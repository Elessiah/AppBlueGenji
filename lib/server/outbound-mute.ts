/**
 * Coupe, pour **tout le processus**, ce qui part vers l'extérieur : appels au
 * bot Discord (journal, messages privés, annonces, salons vocaux) et
 * notifications push. Posé par le rejeu des suppressions après une
 * restauration (`npm run replay:deletions`) : les gestes rejoués (forfaits,
 * retraits) ont déjà été annoncés avant la sauvegarde perdue, et rien ne doit
 * partir pendant la remise en état. Jamais levé : le script sort après son
 * rapport. Le site, lui, ne le pose jamais.
 */
let muted = false;

/** Coupe les envois sortants du processus (bot, push), sans retour. */
export function muteOutboundForProcess(): void {
  muted = true;
}

/** `true` une fois les envois sortants coupés ({@link muteOutboundForProcess}). */
export function outboundMuted(): boolean {
  return muted;
}
