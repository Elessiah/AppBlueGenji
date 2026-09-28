import type { MetadataRoute } from "next";
import { buildWebManifest } from "@/lib/shared/web-manifest";

/**
 * `/manifest.webmanifest` — Next le déclare de lui-même dans le `<head>` de
 * chaque page (`<link rel="manifest">`). Contenu dans `lib/shared/web-manifest.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildWebManifest();
}
