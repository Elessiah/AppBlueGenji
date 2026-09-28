/**
 * État des notifications push du compte connecté : la clé publique VAPID (le
 * navigateur en a besoin pour s'abonner), les sujets qu'il peut recevoir, ceux
 * qu'il a coupés, et le nombre d'appareils abonnés.
 *
 * `publicKey: null` = push éteint sur le site (clés absentes) : le panneau le
 * dit au lieu d'offrir un bouton qui échouerait.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { loadDisabledTopics, subscriptionStatus } from "@/lib/server/push-subscriptions";
import { webPushConfig } from "@/lib/server/web-push";
import { visiblePushTopics } from "@/lib/shared/push-notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const config = webPushConfig();
  const [disabledTopics, status] = await Promise.all([
    loadDisabledTopics(user.id).catch(() => []),
    subscriptionStatus(user.id, null).catch(() => ({ thisDevice: false, devices: 0 })),
  ]);
  return ok({
    publicKey: config?.publicKey ?? null,
    topics: visiblePushTopics(user),
    disabledTopics,
    devices: status.devices,
  });
}
