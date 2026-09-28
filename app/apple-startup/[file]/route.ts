import { renderAppleStartupImage } from "@/lib/server/apple-startup-image";
import { appleStartupImageFiles, parseAppleStartupImageFile } from "@/lib/shared/apple-startup-images";

/**
 * `/apple-startup/<largeur>x<hauteur>.png` — écran de lancement iOS. Liste et
 * règles dans `lib/shared/apple-startup-images.ts`.
 *
 * Rendu **à la compilation** (`force-static` + `generateStaticParams`) : ces
 * images ne dépendent que du logo, et un nom absent de la liste répond 404
 * (`dynamicParams = false`, doublé d'un contrôle ici) — la route ne fabrique
 * jamais une taille choisie par l'appelant.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { file: string }[] {
  return appleStartupImageFiles().map((file) => ({ file }));
}

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await context.params;
  const size = parseAppleStartupImageFile(file);
  if (!size) return new Response(null, { status: 404 });
  const body = await renderAppleStartupImage(size.width, size.height);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
