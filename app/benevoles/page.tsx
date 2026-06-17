import type { Metadata } from "next";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { getCurrentUser } from "@/lib/server/auth";
import { listBenevoles } from "@/lib/server/benevoles-service";
import { groupByCategory } from "@/lib/shared/benevoles";
import { BenevolesSection } from "./BenevolesSection";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "BlueGenji - Bénévoles",
  description: "Découvrez les bénévoles qui font vivre BlueGenji Arena au quotidien.",
  openGraph: {
    title: "BlueGenji - Bénévoles",
    description: "Les passionné·es qui organisent, animent et développent la scène esport francophone.",
    type: "website",
    locale: "fr_FR",
  },
};

export default async function BenevolesPage() {
  const [user, benevoles] = await Promise.all([getCurrentUser(), listBenevoles()]);
  const isAdmin = Boolean(user?.isAdmin);
  const groups = groupByCategory(benevoles);

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">L'ÉQUIPE · BÉNÉVOLES</span>
        <h1 className={`display ${styles.heroTitle}`}>
          Celles et ceux qui font<br />
          vivre BlueGenji.
        </h1>
        <p className={styles.heroSub}>
          Organisateurs, développeurs, casters, arbitres… chaque tournoi existe grâce à eux.
        </p>
      </section>

      <BenevolesSection initialGroups={groups} initialBenevoles={benevoles} isAdmin={isAdmin} />

      <PublicFooter />
    </main>
  );
}
