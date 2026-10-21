import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_CONTACTS_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { loadViewerMatchContacts } from "@/lib/server/tournaments/match-launch-info";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";

/**
 * Contacts d'un match pour le bouton « Contacts » de sa carte
 * (`docs/features/MATCH_LAUNCH.md` § Contacts hors lancement) : la présentation
 * de la modale de lancement — engagées, hôte, contacts, caster —, aux seules
 * parties du match : ses joueurs dès que ses deux adversaires sont connus
 * (« À planifier » compris), ses arbitres (permission `tournaments`) aux
 * mêmes moments, son caster le temps du match seulement (du départ à la
 * fin). Les contacts **du caster** suivent la même borne pour les joueurs ;
 * les arbitres les lisent dès que les deux adversaires sont connus
 * (`exposesCasterContacts`). Un lecteur qui n'en est pas
 * partie reçoit le même refus qu'un match sans contacts : la réponse ne dit
 * pas qui joue quoi au-delà de ce que montre le plateau.
 */
export async function GET(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const throttled = enforceRateLimit(MATCH_CONTACTS_READ_RULE, user.id);
  if (throttled) return throttled;

  try {
    const launch = await loadViewerMatchContacts(user, matchId);
    if (!launch) return fail("MATCH_CONTACTS_UNAVAILABLE", 404);
    return ok({ launch });
  } catch (error) {
    console.error("[match-launch] lecture des contacts impossible", error);
    return fail("MATCH_CONTACTS_READ_FAILED", 500);
  }
}
