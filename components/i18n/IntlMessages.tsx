import type { ReactNode } from "react";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { pickMessages, type MessageNamespace } from "@/lib/shared/i18n-messages";
import { AppIntlProvider } from "./locale-context";

/**
 * Remet aux composants **client** d'un segment les messages qu'ils lisent, et
 * seulement ceux-là (`docs/features/I18N.md` § Découpage par route).
 *
 * Un fournisseur imbriqué **remplace** celui du dessus, il ne le complète pas :
 * lister tous les espaces dont le sous-arbre a besoin, `common` compris.
 */
export async function IntlMessages({
  namespaces,
  children,
}: Readonly<{ namespaces: readonly MessageNamespace[]; children: ReactNode }>) {
  const locale = await requestLocale();
  return (
    <AppIntlProvider locale={locale} messages={pickMessages(messagesFor(locale), namespaces)}>
      {children}
    </AppIntlProvider>
  );
}
