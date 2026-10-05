import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppIntlProvider } from "@/components/i18n/locale-context";
import { messagesFor } from "@/lib/server/i18n-messages";
import { MESSAGE_NAMESPACES, pickMessages, type MessageNamespace } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";

export type IntlRenderOptions = {
  locale?: Locale;
  /** Espaces de noms fournis, tous par défaut — comme `IntlMessages` les choisirait. */
  namespaces?: readonly MessageNamespace[];
};

/** Enveloppe un composant dans la langue et les messages voulus (`docs/features/I18N.md`). */
export function withIntl(ui: ReactElement, { locale = "fr", namespaces = MESSAGE_NAMESPACES }: IntlRenderOptions = {}) {
  return (
    <AppIntlProvider locale={locale} messages={pickMessages(messagesFor(locale), namespaces)}>
      {ui}
    </AppIntlProvider>
  );
}

/** Rendu statique d'un composant traduit, dans une langue donnée. */
export function renderIntl(ui: ReactElement, options?: IntlRenderOptions): string {
  return renderToStaticMarkup(withIntl(ui, options));
}
