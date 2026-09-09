import { serializeJsonLd, type JsonLdNode } from "@/lib/shared/structured-data";

/**
 * Pose des données structurées dans la page.
 *
 * Un `<script type="application/ld+json">` n'est pas exécuté par le navigateur :
 * c'est un bloc de données que seuls les moteurs lisent. Il n'a donc rien à
 * faire dans le `<head>` — Next ne le permettrait pas depuis un composant —, et
 * sa place dans le corps de la page est celle que `schema.org` recommande.
 *
 * L'échappement vit dans le module pur ({@link serializeJsonLd}) : c'est la
 * partie qui peut casser la page, et elle se teste sans rendu.
 */
export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
