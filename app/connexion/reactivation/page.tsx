import { cookies } from "next/headers";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { LoginTextProvider } from "@/components/i18n/login-text";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { peekReactivationTicket, REACTIVATION_COOKIE } from "@/lib/server/users/account-reactivation";
import { ReactivationPanel } from "./ReactivationPanel";

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
  const ticket = await peekReactivationTicket(cookieStore.get(REACTIVATION_COOKIE)?.value);
  return (
    <LoginTextProvider locale={locale} messages={locale === DEFAULT_LOCALE ? undefined : messagesFor(locale).login}>
      <ReactivationPanel finalAt={ticket?.finalAt ?? null} />
    </LoginTextProvider>
  );
}
