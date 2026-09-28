/**
 * Sujets de notification coupés par le compte connecté — valables sur tous ses
 * appareils. Le corps nomme la liste **entière** des sujets coupés : c'est ce
 * que le panneau affiche, et deux onglets ne peuvent pas se contredire à
 * moitié.
 */
import { enforceRateLimit, PUSH_WRITE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { saveDisabledTopics } from "@/lib/server/push-subscriptions";
import { sanitizeDisabledTopics } from "@/lib/shared/push-notifications";

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const limited = enforceRateLimit(PUSH_WRITE_RULE, `user:${user.id}`);
  if (limited) return limited;

  let body: { disabledTopics?: unknown } | null;
  try {
    body = (await req.json()) as { disabledTopics?: unknown };
  } catch {
    return fail("INVALID_PUSH_TOPICS", 400);
  }
  if (!Array.isArray(body?.disabledTopics)) return fail("INVALID_PUSH_TOPICS", 400);

  const topics = sanitizeDisabledTopics(body.disabledTopics);
  await saveDisabledTopics(user.id, topics);
  return ok({ disabledTopics: topics });
}
