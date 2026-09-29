import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { signedInLoginRedirect } from "@/lib/shared/safe-redirect";
import { LoginForm } from "./_components/LoginForm";

/**
 * Page de connexion.
 *
 * Un visiteur **déjà connecté** n'a rien à faire ici : il voyait le formulaire
 * et la modale d'entrée d'un nouveau compte, sans que rien ne lui dise qu'il
 * avait déjà une session. Il est envoyé là où il allait (`?redirect=`, filtré
 * comme au retour d'une connexion), `/tournois` sinon.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  // Sauf s'il arrive avec un refus à lire (`?error=`) : un rattachement OAuth
  // raté avant la lecture de l'intention (`params`, `state`) retombe ici, et le
  // rediriger ferait disparaître le message sans rien dire.
  if (user && params.error === undefined) redirect(signedInLoginRedirect(params.redirect));

  return <LoginForm />;
}
