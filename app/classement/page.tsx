import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { loadLeaderboardRows } from "@/lib/server/landing-service";
import { loadCachedTeamForms } from "@/lib/server/teams/directory";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { RANKING_BASE_POINTS, RANKING_FLOOR_POINTS } from "@/lib/shared/ranking";
import { parseRankingFilter, parseRankingShown, rankingFilterGame } from "@/lib/shared/ranking-page";
import { RankingBoard } from "./RankingBoard";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Classement des équipes",
  description:
    "Le classement des équipes BlueGenji Esport : cote de chaque équipe, podium, bilan et forme récente, en général ou par jeu (Overwatch, Marvel Rivals).",
  shareDescription: "Qui est au sommet ? Le classement des équipes de la scène BlueGenji.",
  path: "/classement",
});

// Le classement bouge à chaque score : la page se rend à la demande, la
// mutualisation se fait en amont (`ranking-cache`, `stats-cache`).
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClassementPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const filter = parseRankingFilter(params.jeu);
  const game = rankingFilterGame(filter);
  // Affichage progressif : `?n=` lignes (validé et borné). Le classement
  // complet est rejoué et trié de toute façon (le rang en dépend) : on le garde
  // entier pour savoir s'il en reste et si une colonne « N » existe, puis on
  // coupe — le rang reste absolu d'une page à l'autre, le rendu borné.
  const shown = parseRankingShown(params.n);

  // Les deux lectures sont indépendantes : en parallèle, chacune avec son repli.
  // La forme couvre tous les jeux : elle n'accompagne que le classement général.
  const [loaded, forms] = await Promise.all([
    loadLeaderboardRows(game).catch((): LandingLeaderboardRow[] | null => null),
    game === undefined ? loadCachedTeamForms().catch(() => null) : Promise.resolve(null),
  ]);
  const unavailable = loaded === null;
  const rows = loaded?.slice(0, shown) ?? [];
  const hasMore = (loaded?.length ?? 0) > shown;
  const anyDraws = loaded?.some((row) => row.draws > 0) ?? false;

  return (
    <PublicPageShell>
      <section className={`${styles.section} ${styles.hero}`} aria-labelledby="classement-title">
        <div className="fabric" />
        <div className={styles.heroAurora} aria-hidden="true" />
        <span className="eyebrow">COMPÉTITION · CLASSEMENT</span>
        <h1 id="classement-title" className={`display ${styles.heroTitle}`}>
          Grimpe jusqu'au<br />
          <span className="text-gradient">sommet.</span>
        </h1>
        <p className={styles.heroSub}>
          Chaque match compte. Battre plus fort que soi rapporte gros, aller loin en tournoi aussi —
          la cote de chaque équipe raconte sa saison.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="classement-board">
        {/* Titre de section pour la hiérarchie (h1 → h2 → noms du podium en h3). */}
        <h2 id="classement-board" className="sr-only">Classement des équipes</h2>
        <RankingBoard rows={rows} filter={filter} forms={forms} unavailable={unavailable} hasMore={hasMore} anyDraws={anyDraws} />
      </section>

      <section className={`${styles.section} ${styles.how}`} aria-labelledby="classement-how">
        <h2 id="classement-how" className={styles.howTitle}>Comment marche la cote</h2>
        <ul className={styles.howList}>
          <li>
            <strong>{RANKING_BASE_POINTS} pts</strong> au départ, pour toutes les équipes : une équipe
            sans match est rangée à cette cote, ni devant ni derrière.
          </li>
          <li>
            <strong>Chaque match</strong> transfère des points du perdant au vainqueur — beaucoup pour
            une victoire improbable, presque rien pour une victoire attendue.
          </li>
          <li>
            <strong>Le rang final</strong> d'un tournoi redistribue aussi des points, d'autant plus que
            le plateau était relevé. Plancher à {RANKING_FLOOR_POINTS} pts.
          </li>
        </ul>
        <div className={styles.cta}>
          <Link href="/tournois" className={styles.ctaPrimary}>Inscrire mon équipe à un tournoi →</Link>
          <Link href="/regles" className={styles.ctaSecondary}>Lire les règles</Link>
        </div>
      </section>
    </PublicPageShell>
  );
}
