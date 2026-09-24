import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { FONT_VARIABLES } from "./site-fonts";
import { ToastProvider } from "@/components/ui/toast";
import { RecruitmentHighlight } from "@/components/recruitment-highlight";
import { VisitTracker } from "@/components/visit-tracker";
import { ClientPowerRoot } from "@/components/client-power-root";
import { PrivacyChangesModal } from "@/components/privacy/PrivacyChangesModal";
import { AccessibilityMenu } from "@/components/accessibility/AccessibilityMenu";
import { SkipLink } from "@/components/accessibility/SkipLink";
import { MatchLaunchCenter } from "@/components/match-launch/MatchLaunchCenter";
import { getRecruitmentSpotlight } from "@/lib/server/recruitment-service";
import { getCurrentUser } from "@/lib/server/auth";
import { loadPendingPrivacyChanges } from "@/lib/server/privacy-consent";
import { dispatchPrivacyChangeNotifications } from "@/lib/server/privacy-change-notifications";
import type { PrivacyChange } from "@/lib/shared/privacy-changes";
import { siteMetadataBase } from "@/lib/server/site-url";
import { PATHNAME_HEADER } from "@/lib/shared/csp";
import {
  RECRUITMENT_BANNER_COOKIE,
  RECRUITMENT_MODAL_COOKIE,
  recruitmentDismissed,
  recruitmentSeenAmong,
} from "@/lib/shared/recruitment";
import { A11Y_COOKIE, a11yAttribute, parseA11yCookie } from "@/lib/shared/accessibility-settings";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/shared/share-metadata";
import { DEFAULT_SHARE_IMAGE, SITE_TITLE_TEMPLATE } from "@/lib/shared/page-metadata";

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
  title: { default: SITE_NAME, template: SITE_TITLE_TEMPLATE },
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

/** Page où la mise en avant se tait : le visiteur y lit déjà les annonces. */
const RECRUITMENT_PAGE = "/recrutement";

/**
 * Les changements de confidentialité que le compte connecté n'a pas acceptés.
 * Une panne de lecture ne doit pas faire tomber la mise en page : la modale
 * reviendra au chargement suivant.
 */
async function pendingChangesFor(userId: number | undefined): Promise<PrivacyChange[]> {
  if (userId === undefined) return [];
  try {
    return await loadPendingPrivacyChanges(userId);
  } catch (error) {
    console.error("[privacy-changes] lecture impossible", error);
    return [];
  }
}

/**
 * Mise en page racine.
 *
 * Elle est `async` et lit les en-têtes de requête, et c'est **cette lecture**
 * qui permet à la politique de sécurité d'être appliquée — elle le ferait même
 * si personne n'en consommait la valeur. Le raisonnement tient en trois temps.
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
  const requestHeaders = await headers();

  // L'annonce est résolue **ici**, côté serveur, et non plus par un `fetch`
  // du composant monté. Deux gains, et le second est le vrai.
  //
  // Le petit : cet aller-retour partait de **chaque page** du site, à chaque
  // visiteur, pour ne presque jamais rien rapporter.
  //
  // Le grand : la modale peut désormais être **dans le HTML initial**. Peinte
  // par du JavaScript, elle arrivait après l'hydratation, et comme c'est le
  // plus gros bloc de l'accueil sur mobile, elle en était le LCP — 4,4 s dont
  // 3,8 s de seul délai de rendu. Ce qui est peint tard est peint tard : aucun
  // réglage du composant n'y pouvait rien, seul l'endroit du rendu le pouvait.
  //
  // `getRecruitmentSpotlight` est déjà en cache à vol unique (60 s) et avale
  // ses erreurs en listes vides : la mise en page ne peut pas tomber à cause
  // d'elle. Le cookie de la modale ne se lit qu'ici : la modale en déduit sa
  // première page (la première prioritaire jamais vue) et se tait quand toutes
  // l'ont été ; la banderole se tait tant qu'aucune annonce qu'elle porte n'est
  // neuve pour ce visiteur.
  const cookieStore = await cookies();
  const spotlight = await getRecruitmentSpotlight();
  const onRecruitmentPage = requestHeaders.get(PATHNAME_HEADER) === RECRUITMENT_PAGE;
  const modalSeen = recruitmentSeenAmong(
    cookieStore.get(RECRUITMENT_MODAL_COOKIE)?.value,
    spotlight.modal.map((ad) => ad.id),
  );
  const bannerDismissed = recruitmentDismissed(
    cookieStore.get(RECRUITMENT_BANNER_COOKIE)?.value,
    spotlight.banner.map((ad) => ad.id),
  );

  // `getCurrentUser` est mémoïsé par requête (`cache()` de React), donc cet
  // appel ne coûte rien de plus sur les pages où `PublicHeader`/`PublicFooter`
  // le lisent déjà. L'invite Google One Tap n'est **plus** montée ici : chargée
  // sur chaque page pour tout visiteur anonyme, elle faisait appel à Google sans
  // que personne l'ait demandé — elle vit sur `/connexion` (`app/connexion/page.tsx`).
  const user = await getCurrentUser();
  // Lus sur **toutes** les pages, `/rgpd` comprise : la modale s'y tait côté
  // client. Décidé ici, le silence survivrait à la navigation — la mise en
  // page racine n'est pas re-rendue d'un lien à l'autre, et un joueur arrivé
  // par `/rgpd` parcourrait ensuite le site sans jamais avoir à répondre.
  const privacyChanges = await pendingChangesFor(user?.id);
  // L'annonce Discord des mêmes changements, entraînée par le trafic comme les
  // rappels de match : étranglée, à vol unique, jamais attendue — la page ne
  // doit ni ralentir ni tomber à cause du bot.
  void dispatchPrivacyChangeNotifications().catch(() => undefined);
  // Réglages d'accessibilité du lecteur : posés **dans le HTML initial**, sans
  // quoi un contraste renforcé ferait d'abord clignoter la page dans ses
  // couleurs d'origine. Voir `lib/shared/accessibility-settings.ts`.
  const a11ySettings = parseA11yCookie(cookieStore.get(A11Y_COOKIE)?.value);

  return (
    <html lang="fr" data-a11y={a11yAttribute(a11ySettings)}>
      <body style={FONT_VARIABLES}>
        <ToastProvider>
          {/* Premier arrêt du clavier sur chaque page : qui a besoin de ces
              réglages ne doit pas traverser toute la page pour les trouver. */}
          <AccessibilityMenu initialSettings={a11ySettings} />
          {/* Deuxième arrêt : le lien d'évitement, qui mène au contenu sans
              traverser la bannière de recrutement ni la navigation. */}
          <SkipLink />
          <VisitTracker />
          <ClientPowerRoot />
          {/* Deux modales ne se superposent pas : tant qu'un choix de
              confidentialité est dû, la mise en avant du recrutement se tait
              (la banderole, elle, reste). */}
          <RecruitmentHighlight
            modalAds={spotlight.modal}
            modalSilenced={privacyChanges.length > 0}
            modalSeen={modalSeen}
            bannerAds={spotlight.banner}
            bannerDismissed={bannerDismissed}
            onAdPage={onRecruitmentPage}
          />
          <PrivacyChangesModal changes={privacyChanges} />
          {/* Lancement des matchs du joueur, sur toutes les pages : la modale
              s'ouvre à l'heure du match, où qu'il se trouve sur le site. */}
          {user && <MatchLaunchCenter privacyPending={privacyChanges.length > 0} />}
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
