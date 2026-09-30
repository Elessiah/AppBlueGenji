import { getCurrentUser } from "@/lib/server/auth";
import { liftSuspension, suspendAccount } from "@/lib/server/account-suspensions";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { validateSuspensionInput } from "@/lib/shared/account-suspension";
import { can } from "@/lib/shared/permissions";

/**
 * Suspension d'un compte par la modération (permission `moderation`) —
 * `lib/shared/account-suspension.ts`.
 *
 * `POST` prononce : `{ reason, ground, durationDays }` (`durationDays: null` =
 * durée indéterminée, à choisir explicitement). `DELETE` lève la suspension en
 * cours. Le joueur est prévenu dans les deux cas, et le geste part au journal
 * du staff sans son pseudo.
 */
type Context = { params: Promise<{ id: string }> };

async function resolveTarget(context: Context): Promise<number | null> {
  const { id } = await context.params;
  const userId = Number(id);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

const REFUSALS: Record<string, number> = {
  USER_NOT_FOUND: 404,
  CANNOT_SUSPEND_SELF: 409,
  CANNOT_SUSPEND_ADMIN: 409,
  ACCOUNT_ALREADY_SUSPENDED: 409,
  NO_ACTIVE_SUSPENSION: 409,
};

export async function POST(req: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const userId = await resolveTarget(context);
  if (userId === null) return fail("INVALID_USER_ID", 400);

  const body = await readJsonBody(req).catch(() => ({}));
  const input = validateSuspensionInput(body);
  if (!input.ok) return fail(input.error, 400);

  try {
    const suspension = await suspendAccount(userId, input.value, { id: user.id, pseudo: user.pseudo });
    return ok({ suspension });
  } catch (error) {
    const message = (error as Error).message;
    if (Object.hasOwn(REFUSALS, message)) return fail(message, REFUSALS[message]);
    console.error("[moderation] suspension impossible", error);
    return fail("SUSPENSION_FAILED", 500);
  }
}

export async function DELETE(_: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const userId = await resolveTarget(context);
  if (userId === null) return fail("INVALID_USER_ID", 400);

  try {
    await liftSuspension(userId, { id: user.id, pseudo: user.pseudo });
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (Object.hasOwn(REFUSALS, message)) return fail(message, REFUSALS[message]);
    console.error("[moderation] levée de suspension impossible", error);
    return fail("SUSPENSION_LIFT_FAILED", 500);
  }
}
