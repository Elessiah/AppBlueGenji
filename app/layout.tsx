import type { Metadata } from "next";
import { Exo_2, Rajdhani, Inter, JetBrains_Mono, Orbitron } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { RecruitmentHighlight } from "@/components/recruitment-highlight";
import { VisitTracker } from "@/components/visit-tracker";
import { siteMetadataBase } from "@/lib/server/site-url";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/shared/share-metadata";

const titleFont = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-title",
});

const bodyFont = Exo_2({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

const sansFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

const displayFont = Orbitron({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

/**
 * Socle des métadonnées de partage, hérité par toutes les pages.
 *
 * `metadataBase` n'est pas un détail : sans elle, Next sert les `og:image` en
 * chemin relatif et les robots d'aperçu — Discord le premier — ne savent pas les
 * résoudre. Le gabarit de titre (`%s · BlueGenji Esport`) évite que chaque page
 * réécrive le nom du site ; `title.default` sert celles qui n'en déclarent pas.
 *
 * L'image d'aperçu, elle, n'est pas déclarée ici : `app/opengraph-image.tsx` est
 * une convention de fichier, appliquée d'office à toute page qui n'en fournit
 * pas une.
 */
export const metadata: Metadata = {
  metadataBase: siteMetadataBase(),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "fr_FR",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${titleFont.variable} ${bodyFont.variable} ${sansFont.variable} ${monoFont.variable} ${displayFont.variable}`}>
        <ToastProvider>
          <VisitTracker />
          <RecruitmentHighlight />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
