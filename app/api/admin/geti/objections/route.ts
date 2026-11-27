import { getCurrentUser, type AuthUser } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { unexpectedFailureCode } from "@/lib/server/failure-reason";
import { liftGetiObjection, parseGetiObjection, recordGetiObjection, type GetiObjection } from "@/lib/server/geti/objections";
import { forgetGetiListScans, refreshStaleGetiPosts } from "@/lib/server/geti/posts";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { can } from "@/lib/shared/permissions";

/** Corps d'une opposition illisible : ni `{ authorId }` ni `{ messageId }`, ou les deux. */
const INVALID_OBJECTION = "INVALID_GETI_OBJECTION";

async function staffObjection(req: Request): Promise<{ refusal: Response } | { user: AuthUser; objection: GetiObjection }> {
  const user = await getCurrentUser();
  if (!user) return { refusal: fail("UNAUTHORIZED", 401) };
  if (!can(user, "moderation")) return { refusal: fail("FORBIDDEN", 403) };
  const read = await readJsonBodyOrFallback(req, null);
  if ("refusal" in read) return { refusal: read.refusal };
  const objection = parseGetiObjection(read.body);
  if (!objection) return { refusal: fail(INVALID_OBJECTION, 400) };
  return { user, objection };
}

/**
 * `POST /api/admin/geti/objections` — l'auteur d'annonces GETI s'y oppose
 * (RGPD, art. 21) : `{ authorId }` (toutes ses annonces, présentes et à venir)
 * ou `{ messageId }` (une annonce). Les annonces couvertes sont retirées
 * sur-le-champ (une ligne d'analyse ancienne est d'abord réécrite, auteur relu
 * compris) et ne sont plus recopiées ; rend `{ removed }`. Permission
 * `moderation` ; le geste est tracé dans pm2, avec son auteur.
 */
export async function POST(req: Request) {
  const checked = await staffObjection(req);
  if ("refusal" in checked) return checked.refusal;
  try {
    const db = await getDatabase();
    const removed = await recordGetiObjection(db, checked.objection);
    // Une ligne ancienne, lue à l'affichage depuis son message brut, peut nommer un auteur que ses
    // colonnes ignorent encore : la réécrire tout de suite rejoue l'opposition sur l'auteur relu.
    await refreshStaleGetiPosts(db);
    forgetGetiListScans();
    auditStaffAction(`[geti] opposition enregistrée (${checked.objection.kind}) : ${removed} annonce(s) retirée(s)`, checked.user);
    return ok({ removed });
  } catch (error) {
    return fail(unexpectedFailureCode(error, "GETI_OBJECTION_FAILED", "[geti] opposition non enregistrée"), 500);
  }
}

/**
 * `DELETE /api/admin/geti/objections` — l'auteur retire son opposition (même
 * corps) : ses annonces encore sur Discord reviennent au prochain rattrapage du
 * bot. Rend `{ lifted }`.
 */
export async function DELETE(req: Request) {
  const checked = await staffObjection(req);
  if ("refusal" in checked) return checked.refusal;
  try {
    const lifted = await liftGetiObjection(await getDatabase(), checked.objection);
    auditStaffAction(`[geti] opposition levée (${checked.objection.kind}) : ${lifted ? "levée" : "absente"}`, checked.user);
    return ok({ lifted });
  } catch (error) {
    return fail(unexpectedFailureCode(error, "GETI_OBJECTION_FAILED", "[geti] opposition non levée"), 500);
  }
}
