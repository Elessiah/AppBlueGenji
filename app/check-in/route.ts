import { CHECK_IN_INVITE_URL } from "@/lib/shared/discord";

/**
 * `/check-in` — renvoie vers l'invitation du serveur Discord du check-in.
 *
 * Le push du rappel de 10 h (`matchReminderPush`) y mène : une notification
 * n'ouvre que des adresses du site (`public/push-sw.js`), et une adresse écrite
 * dans son texte ne se touche pas. Public, sans compte : l'invitation l'est
 * aussi. Rendue à la compilation, comme une constante (`force-static` : sans
 * lui, Next 15 exécuterait la route à chaque clic).
 */
export const dynamic = "force-static";

/** La redirection, figée au build. */
export function GET(): Response {
  return Response.redirect(CHECK_IN_INVITE_URL, 307);
}
