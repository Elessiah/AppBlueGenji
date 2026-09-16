import type { Metadata } from "next";
import { headers } from "next/headers";
import { Exo_2, Rajdhani, Inter, JetBrains_Mono, Orbitron } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { RecruitmentHighlight } from "@/components/recruitment-highlight";
import { VisitTracker } from "@/components/visit-tracker";
import { siteMetadataBase } from "@/lib/server/site-url";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/shared/share-metadata";
import { DEFAULT_SHARE_IMAGE } from "@/lib/shared/page-metadata";

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
 * L'image d'aperçu **est** déclarée ici, et pas laissée à la convention de
 * fichier : `app/opengraph-image.tsx` ne vaut que pour son propre segment —
 * contrairement à `icon`, elle n'est pas héritée par les pages imbriquées, si
 * bien que `/connexion` ou `/partenaires` partaient sans image. La désigner par
 * la route qu'elle expose la fait descendre partout ; un segment qui en pose une
 * à lui (la fiche d'un tournoi) garde la sienne.
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
    images: [{ url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_SHARE_IMAGE],
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

/**
 * Mise en page racine.
 *
 * Elle est `async` et lit les en-têtes de requête sans rien en faire, et c'est
 * **la** ligne qui permet à la politique de sécurité d'être appliquée. Le
 * raisonnement tient en trois temps.
 *
 * Le middleware tire un nonce par requête et le pose en en-tête ; Next le relit
 * et l'appose lui-même sur chacun de ses `<script>` en ligne. Le HTML de chaque
 * page **dépend donc d'un en-tête de requête** — il ne peut pas être le même
 * pour tout le monde. Seulement Next ne compte pas cette lecture-là comme une
 * dépendance dynamique : il prérendait les pages dont rien *d'autre* n'était
 * dynamique, et leurs scripts en ligne partaient alors **sans nonce**. En
 * `Report-Only` cela ne se voyait pas ; en application, un nonce dans la
 * politique fait ignorer `'unsafe-inline'`, donc ces scripts-là auraient été
 * refusés — sur `/connexion`, la page qui ouvre les sessions.
 *
 * `headers()` déclare cette dépendance, qui est réelle. On la pose **ici**
 * plutôt qu'un `dynamic = "force-dynamic"` sur chaque route concernée, pour la
 * raison même qui a produit le défaut : cette liste **dérive**. Elle était
 * écrite « cinq routes » dans deux fichiers alors qu'elles étaient trois, et
 * rien ne l'aurait signalé — la page qui s'y ajoute demain hérite au contraire
 * de cette ligne sans qu'on ait à y penser. Voir `lib/shared/csp.ts`.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();

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
