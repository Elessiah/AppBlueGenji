import { permanentRedirect } from "next/navigation";
import { requestLocale } from "@/lib/server/request-locale";
import { localeHref } from "@/lib/shared/locales";

// La page partenaires dédiée a été supprimée : les partenaires sont désormais
// présentés dans la section « Partenaires » de la page d'accueil. On conserve
// la route en redirection permanente (308) pour les liens et favoris existants
// — vers l'accueil dans la langue demandée (`/en/partenaires` → `/en#sponsors`).
export default async function PartenairesPage() {
  const locale = await requestLocale();
  permanentRedirect(`${localeHref("/", locale)}#sponsors`);
}
