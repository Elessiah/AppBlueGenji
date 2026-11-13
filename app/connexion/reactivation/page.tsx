import type { Metadata } from "next";
import { cookies } from "next/headers";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { LoginTextProvider } from "@/components/i18n/login-text";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { peekReactivationTicket, reactivationCookieName } from "@/lib/server/users/account-reactivation";
import { ReactivationPanel } from "./ReactivationPanel";

/** Titre propre à l'écran (il reprend la question posée), jamais celui de la connexion ; `noindex`. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { reactivation } = messagesFor(locale).login;
  return {
    ...pageMetadata({ title: reactivation.title, description: reactivation.metaDescription, path: "/connexion/reactivation", locale }),
    robots: { index: false, follow: true },
  };
}

/**
 * Écran de réactivation d'un compte dont la suppression est demandée
 * (`docs/features/ACCOUNT_DELETION.md` § Réactivation), FR et EN.
 *
 * On n'y arrive que renvoyé par une connexion (le ticket est en cookie
 * `httpOnly`) : la page lit le ticket sans le consommer, annonce la date de la
 * suppression définitive et ce que la réactivation ne rend pas. Rien ne se
 * fait sans le clic.
 */
export default async function ReactivationPage() {
  const [locale, cookieStore] = await Promise.all([requestLocale(), cookies()]);
  const token = cookieStore.get(reactivationCookieName())?.value;
  const ticket = await peekReactivationTicket(token);
  return (
    <LoginTextProvider locale={locale} messages={locale === DEFAULT_LOCALE ? undefined : messagesFor(locale).login}>
      <ReactivationPanel finalAt={ticket?.finalAt ?? null} hadTicket={Boolean(token)} />
    </LoginTextProvider>
  );
}
