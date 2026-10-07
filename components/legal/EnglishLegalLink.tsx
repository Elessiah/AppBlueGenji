import type { ReactNode } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { messagesFor } from "@/lib/server/i18n-messages";
import { crossesLocale } from "@/lib/shared/locales";

/**
 * Lien interne d'un texte légal **anglais** (lot 7b). Vers une page traduite,
 * il reste en anglais (`LocaleLink`) ; vers une page encore française, il le
 * dit — `hrefLang="fr"` et « (in French) » à la suite de son intitulé —,
 * jusqu'à ce que la page cible entre dans `MIGRATED_ROUTES`, où la mention
 * tombe seule.
 */
export function EnglishLegalLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  if (!crossesLocale(href, "en")) return <LocaleLink href={href}>{children}</LocaleLink>;
  return (
    <LocaleLink href={href} hrefLang="fr">
      {children} {messagesFor("en").legal.inFrench}
    </LocaleLink>
  );
}
