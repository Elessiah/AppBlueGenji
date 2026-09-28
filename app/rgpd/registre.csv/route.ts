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
 * staff). Rien n'y dépend plus de l'environnement du serveur : le contact
 * est une constante du code (`lib/shared/legal-contact.ts`), si bien que la
 * route peut être rendue à la compilation.
 */

export function GET(): Response {
  return new Response(registerToCsv(registerController()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${registerExportFilename()}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
