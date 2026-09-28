/**
 * Abonnement de l'appareil courant aux notifications push.
 *
 * `POST` range l'abonnement que le navigateur vient de créer (ou renvoie celui
 * qu'il a déjà : l'écriture est un « upsert », et c'est ce qui rattache un
 * navigateur partagé au compte qui s'y connecte — sur preuve des clés, 409
 * sinon) ; `DELETE` le retire. Le corps
 * est celui de `PushSubscription.toJSON()`.
 */
import { enforceRateLimit, PUSH_WRITE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteSubscription, saveSubscription } from "@/lib/server/push-subscriptions";
import { webPushConfig } from "@/lib/server/web-push";
import { parsePushSubscription } from "@/lib/shared/push-notifications";

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const limited = enforceRateLimit(PUSH_WRITE_RULE, `user:${user.id}`);
  if (limited) return limited;
  // Sans clés, un abonnement rangé ne recevrait jamais rien : autant le dire.
  if (!webPushConfig()) return fail("PUSH_NOT_CONFIGURED", 503);

  const body = (await readJson(req)) as { subscription?: unknown } | null;
  const parsed = parsePushSubscription(body?.subscription);
  if (!parsed.ok) return fail(parsed.error, 400);

  // Refusé : l'appareil est rangé sous un autre compte avec d'autres clés, et
  // l'adresse seule ne prouve pas qu'on le détient (`saveSubscription`).
  if (!(await saveSubscription(user.id, parsed.value))) return fail("PUSH_SUBSCRIPTION_CLAIMED", 409);
  return ok({ subscribed: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const limited = enforceRateLimit(PUSH_WRITE_RULE, `user:${user.id}`);
  if (limited) return limited;

  const body = (await readJson(req)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length === 0 || body.endpoint.length > 2048) {
    return fail("INVALID_PUSH_SUBSCRIPTION", 400);
  }
  await deleteSubscription(user.id, body.endpoint);
  return ok({ subscribed: false });
}
