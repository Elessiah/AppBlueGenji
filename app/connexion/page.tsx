import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/server/auth";
import { CSP_NONCE_HEADER } from "@/lib/shared/csp";
import { LoginForm, type OneTapConfig } from "./_components/LoginForm";

/**
 * Page de connexion — le seul endroit du site où l'invite Google One Tap peut
 * apparaître.
 *
 * Elle était montée par la mise en page racine, donc sur **toutes** les pages,
 * pour tout visiteur sans session : le navigateur chargeait
 * `accounts.google.com/gsi/client` dès l'arrivée sur l'accueil, Google recevait
 * l'IP et la page consultée, lisait sa propre session pour proposer « Continuer
 * en tant que … » et pouvait poser `g_state` sur notre domaine — le tout sans
 * que le visiteur ait rien demandé. Un module tiers qui accède au terminal sans
 * action de l'utilisateur relève du consentement (ePrivacy art. 5.3), et
 * `/rgpd` promettait « aucun traceur tiers ».
 *
 * Ici, le visiteur est venu se connecter, et l'invite attend en plus qu'il ait
 * accepté la modale RGPD (`LoginForm`). Le serveur ne décide que de ce qu'il est
 * seul à savoir : la session et la configuration.
 */
export default async function LoginPage() {
  const [user, requestHeaders] = await Promise.all([getCurrentUser(), headers()]);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  // Même nonce que celui que le middleware appose sur les scripts de Next :
  // c'est lui qui rend le `<script src="…gsi/client">` recevable sous
  // `strict-dynamic` (voir `lib/shared/csp.ts`).
  const nonce = requestHeaders.get(CSP_NONCE_HEADER) ?? undefined;
  const oneTap: OneTapConfig | null = !user && clientId ? { clientId, nonce } : null;

  return <LoginForm oneTap={oneTap} />;
}
