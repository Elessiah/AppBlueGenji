import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { validateReorderIds } from "@/lib/shared/reorder";
import { can, type Permission } from "@/lib/shared/permissions";

/**
 * Routes d'administration des listes éditables du site — partenaires, bureau,
 * chiffres et piliers de l'association, bénévoles, annonces de recrutement :
 * `PUT` / `DELETE` sur `[id]`, `PUT` sur `reorder`. Elles suivaient toutes le
 * même déroulé, recopié d'un fichier à l'autre ; il vit ici, et chaque route ne
 * dit plus que ce qui lui est propre (permission, service, codes d'erreur).
 *
 * Déroulé, dans cet ordre : session (401 `UNAUTHORIZED`), permission
 * (403 `FORBIDDEN`), identifiant (400 `INVALID_ID`), corps JSON
 * (400 `INVALID_BODY`), puis le service — dont le message d'erreur devient le
 * code renvoyé (404 pour l'élément introuvable, 400 sinon, le code de repli
 * quand le message est vide).
 */

type JsonBody = Record<string, unknown>;
type IdContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

/** Session et permission ; rend la réponse de refus, ou `null` si l'accès est permis. */
async function refuseAccess(permission: Permission): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, permission)) return fail("FORBIDDEN", 403);
  return null;
}

/**
 * Corps JSON de la requête ; `null` s'il est illisible, trop lourd ou n'est pas
 * un objet (`null`, tableau, nombre, chaîne…) — refusé en `INVALID_BODY`.
 */
async function readBody(req: Request): Promise<JsonBody | null> {
  let json: unknown;
  try {
    json = await readJsonBody(req);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  return json as JsonBody;
}

/** Message du service → code et statut renvoyés. */
function serviceFailure(error: unknown, fallback: string, statusOf: (message: string) => number): Response {
  const msg = (error as Error).message;
  return fail(msg || fallback, statusOf(msg));
}

export interface ItemRouteOptions {
  permission: Permission;
  /** Message du service quand l'élément n'existe pas (→ 404). */
  notFound: string;
  updateFailed: string;
  deleteFailed: string;
  /** Applique la modification ; rend le corps de la réponse (`{ sponsor }`…). */
  update: (id: number, body: JsonBody) => Promise<object>;
  remove: (id: number) => Promise<void>;
}

/** `PUT` (modification) et `DELETE` (suppression) d'un élément d'une liste. */
export function itemRoutes(options: ItemRouteOptions) {
  const statusOf = (message: string) => (message === options.notFound ? 404 : 400);

  async function PUT(req: Request, context: IdContext) {
    const refused = await refuseAccess(options.permission);
    if (refused) return refused;

    const id = parseId((await context.params).id);
    if (id === null) return fail("INVALID_ID", 400);

    const body = await readBody(req);
    if (body === null) return fail("INVALID_BODY", 400);

    try {
      return ok(await options.update(id, body));
    } catch (e) {
      return serviceFailure(e, options.updateFailed, statusOf);
    }
  }

  async function DELETE(_req: Request, context: IdContext) {
    const refused = await refuseAccess(options.permission);
    if (refused) return refused;

    const id = parseId((await context.params).id);
    if (id === null) return fail("INVALID_ID", 400);

    try {
      await options.remove(id);
      return ok({});
    } catch (e) {
      return serviceFailure(e, options.deleteFailed, statusOf);
    }
  }

  return { PUT, DELETE };
}

export interface ReorderRouteOptions {
  permission: Permission;
  reorder: (ids: number[]) => Promise<void>;
  failed: string;
  /** Statut d'un refus du service, quand il n'est pas 400 (ex. 409 d'un conflit). */
  statusOf?: (message: string) => number;
}

/** `PUT` du nouvel ordre d'une liste, donné par `{ ids }`. */
export function reorderRoute(options: ReorderRouteOptions) {
  const statusOf = options.statusOf ?? (() => 400);

  return async function PUT(req: Request) {
    const refused = await refuseAccess(options.permission);
    if (refused) return refused;

    const body = await readBody(req);
    if (body === null) return fail("INVALID_BODY", 400);

    const validation = validateReorderIds(body.ids);
    if (!validation.ok) return fail(validation.error, 400);

    try {
      await options.reorder(validation.ids);
      return ok({});
    } catch (e) {
      return serviceFailure(e, options.failed, statusOf);
    }
  };
}
