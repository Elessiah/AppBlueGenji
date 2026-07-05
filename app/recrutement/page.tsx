import type { Metadata } from "next";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { listRecruitmentAds } from "@/lib/server/recruitment-service";
import { RecruitmentSection } from "./RecruitmentSection";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "BlueGenji - Recrutement",
  description:
    "Les équipes qui recrutent sur BlueGenji Arena : trouve ta prochaine équipe Overwatch 2 ou Marvel Rivals.",
  openGraph: {
    title: "BlueGenji - Recrutement",
    description: "Équipes en recherche de joueurs et joueuses sur la scène esport francophone.",
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

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">COMMUNAUTÉ · RECRUTEMENT</span>
        <h1 className={`display ${styles.heroTitle}`}>
          Les équipes<br />
          recrutent.
        </h1>
        <p className={styles.heroSub}>
          Tanks, DPS, soutiens, coachs, managers… découvre les annonces des équipes
          de la scène BlueGenji et trouve ta prochaine place.
        </p>
      </section>

      <RecruitmentSection initialAds={ads} isAdmin={isAdmin} />

      <PublicFooter />
    </main>
  );
}
