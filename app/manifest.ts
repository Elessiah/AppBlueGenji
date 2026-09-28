import type { MetadataRoute } from "next";

/**
 * Manifeste de l'application web.
 *
 * Il ne sert qu'une chose : sur iPhone et iPad, Safari ne livre les
 * notifications push (`lib/shared/push-notifications.ts`) qu'à un site
 * **ajouté à l'écran d'accueil** et ouvert en mode autonome — ce qui suppose un
 * manifeste qui le demande (`display: "standalone"`). Ailleurs, il donne au
 * site un nom et une icône quand on l'installe.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BlueGenji Esport",
    short_name: "BlueGenji",
    description: "Tournois amateurs Marvel Rivals et Overwatch.",
    start_url: "/tournois",
    display: "standalone",
    background_color: "#05060a",
    theme_color: "#05060a",
    lang: "fr",
    icons: [
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/favicon.png", sizes: "32x32", type: "image/png" },
    ],
  };
}
