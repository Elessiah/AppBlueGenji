import type { Metadata } from "next";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { getRecruiterContactDefaults, listRecruitmentAds } from "@/lib/server/recruitment-service";
import type { RecruiterContactDefaults } from "@/lib/shared/recruitment";
import { RecruitmentSection } from "./RecruitmentSection";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "BlueGenji - Recrutement",
  description:
    "Rejoins le staff bénévole de BlueGenji Arena : arbitrage, casting, développement, communication, design, modération et plus.",
  openGraph: {
    title: "BlueGenji - Recrutement",
    description: "L'association recrute ses bénévoles pour faire vivre la scène esport francophone.",
    type: "website",
    locale: "fr_FR",
  },
};

export default async function RecrutementPage() {
  const user = await getCurrentUser().catch(() => null);
  // Gestion du recrutement : administrateurs + Recruteurs.
  const isAdmin = can(user, "recruitment");
  // Les gestionnaires du recrutement voient aussi les brouillons (annonces inactives).
  const ads = await listRecruitmentAds(isAdmin);
  // Coordonnées du recruteur pour pré-remplir le formulaire (édition libre).
  const contactDefaults: RecruiterContactDefaults =
    isAdmin && user
      ? await getRecruiterContactDefaults(user.id)
      : { discord: null, discordId: null };

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">ASSOCIATION · BÉNÉVOLAT</span>
        <h1 className={`display ${styles.heroTitle}`}>
          L'asso recrute<br />
          son staff.
        </h1>
        <p className={styles.heroSub}>
          Arbitres, casters, développeurs, community managers, graphistes, modérateurs…
          l'association tourne grâce à ses bénévoles. Trouve la mission qui te correspond.
        </p>
      </section>

      <RecruitmentSection initialAds={ads} isAdmin={isAdmin} contactDefaults={contactDefaults} />

      <PublicFooter />
    </main>
  );
}
