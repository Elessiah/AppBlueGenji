import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SUSPENSION_NOTICE_HEADER, parseSuspensionNotice } from "@/lib/shared/account-suspension";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { LoginTextProvider } from "@/components/i18n/login-text";
import { DEFAULT_LOCALE, localeHref } from "@/lib/shared/locales";
import { signedInLoginRedirect } from "@/lib/shared/safe-redirect";
import { LoginForm } from "./_components/LoginForm";

/**
 * Page de connexion, en français (`/connexion`) et en anglais (`/en/connexion`,
 * lot 6 — `docs/features/I18N.md` § Connexion).
 *
 * Un visiteur **déjà connecté** n'a rien à faire ici : il voyait le formulaire
 * et la modale d'entrée d'un nouveau compte, sans que rien ne lui dise qu'il
 * avait déjà une session. Il est envoyé là où il allait (`?redirect=`, filtré
 * comme au retour d'une connexion, dans la langue de la page), `/tournois` sinon.
 */
export default async function LoginPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}>) {
  const [user, params, locale] = await Promise.all([getCurrentUser(), searchParams, requestLocale()]);
  // Sauf s'il arrive avec un refus à lire (`?error=`) : un rattachement OAuth
  // raté avant la lecture de l'intention (`params`, `state`) retombe ici, et le
  // rediriger ferait disparaître le message sans rien dire.
  if (user && params.error === undefined) redirect(localeHref(signedInLoginRedirect(params.redirect), locale));

  // Exposé d'une suspension laissé par un retour OAuth refusé : lu seulement
  // quand la page annonce ce refus, et jamais depuis l'URL. Remis par le
  // middleware dans un en-tête de requête, le cookie qui le portait étant
  // effacé dans cette même réponse (`middleware.ts`) — sous `/en/connexion`
  // aussi, le middleware comparant la page sans préfixe.
  const suspensionNotice =
    params.error === "suspended" ? parseSuspensionNotice((await headers()).get(SUSPENSION_NOTICE_HEADER)) : null;

  // Français inclus dans le paquet : seul l'anglais voyage jusqu'au navigateur.
  return (
    <LoginTextProvider locale={locale} messages={locale === DEFAULT_LOCALE ? undefined : messagesFor(locale).login}>
      <LoginForm suspensionNotice={suspensionNotice} />
    </LoginTextProvider>
  );
}
