import { RGPD_CONTACT_EMAIL_FALLBACK } from "@/lib/shared/rgpd-policy";
import {
  registerController,
  registerExportFilename,
  registerToCsv,
} from "@/lib/shared/processing-register";

/**
 * Le registre des traitements en tableur — `/rgpd/registre.csv`.
 *
 * Public et sans compte : le registre ne contient aucune donnée personnelle, et
 * c'est tout son intérêt d'être récupérable sans rien demander (CNIL, joueur,
 * staff). Rendu à la demande pour que l'adresse de contact suive
 * `RGPD_CONTACT_EMAIL` du serveur, comme la page `/rgpd`, et non celle de la
 * machine qui a compilé.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const contactEmail = process.env.RGPD_CONTACT_EMAIL ?? RGPD_CONTACT_EMAIL_FALLBACK;
  return new Response(registerToCsv(registerController(contactEmail)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${registerExportFilename()}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
