import type { Metadata } from "next";
import Link from "next/link";
import { EditableCopy } from "@/components/cyber/landing/EditableCopy";
import { SessionPageShell } from "@/components/cyber/landing/SessionPageShell";
import { getCurrentUser } from "@/lib/server/auth";
import { loadLeaderboardRows } from "@/lib/server/landing-service";
import { getSiteCopy } from "@/lib/server/site-copy-service";
import { loadCachedTeamForms } from "@/lib/server/teams/directory";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";
import { RANKING_BASE_POINTS, RANKING_FLOOR_POINTS, RANKING_MARGIN_MAX_BONUS } from "@/lib/shared/ranking";
import { parseRankingFilter, parseRankingShown, rankingFilterGame } from "@/lib/shared/ranking-page";
import { RankingBoard } from "./RankingBoard";
import styles from "./page.module.css";

// Métadonnées figées, comme à l'accueil et sur la page association : le titre
// éditable de l'en-tête (`ranking.hero.title`) est une accroche, pas le nom de
// la page — l'onglet et l'aperçu de partage gardent « Classement des équipes ».
export const metadata: Metadata = pageMetadata({
  title: "Classement des équipes",
  description:
    "Le classement des équipes BlueGenji Esport : cote de chaque équipe, podium, bilan et forme récente, en général ou par jeu (Overwatch, Marvel Rivals).",
  shareDescription: "Qui est au sommet ? Le classement des équipes de la scène BlueGenji.",
  path: "/classement",
});

/** « 1,5 » : majoration maximale d'un balayage, dérivée de la constante. */
const MARGIN_MAX_TEXT = (1 + RANKING_MARGIN_MAX_BONUS).toLocaleString("fr-FR");

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

  // Lectures indépendantes : en parallèle, chacune avec son repli. La forme
  // couvre tous les jeux : elle n'accompagne que le classement général. Les
  // textes de l'en-tête retombent d'eux-mêmes sur leurs défauts (`getSiteCopy`),
  // la session est déjà lue par le layout (mémoïsée par requête).
  const [loaded, forms, copy, user] = await Promise.all([
    loadLeaderboardRows(game).catch((): LandingLeaderboardRow[] | null => null),
    game === undefined ? loadCachedTeamForms().catch(() => null) : Promise.resolve(null),
    getSiteCopy(),
    getCurrentUser().catch(() => null),
  ]);
  // Mêmes éditeurs que les textes de la vitrine : administrateurs + Community Managers.
  const canEditCopy = can(user, "showcase");
  const unavailable = loaded === null;
  const rows = loaded?.slice(0, shown) ?? [];
  const hasMore = (loaded?.length ?? 0) > shown;
  const anyDraws = loaded?.some((row) => row.draws > 0) ?? false;

  return (
    <SessionPageShell>
      <section className={`${styles.section} ${styles.hero}`} aria-labelledby="classement-title">
        <div className="fabric" />
        <div className={styles.heroAurora} aria-hidden="true" />
        <span className="eyebrow">COMPÉTITION · CLASSEMENT</span>
        <EditableCopy copyKey="ranking.hero.title" value={copy["ranking.hero.title"]} canEdit={canEditCopy}>
          {/* Une ligne par retour à la ligne saisi, la dernière en dégradé. */}
          <h1 id="classement-title" className={`display ${styles.heroTitle}`}>
            {copy["ranking.hero.title"].split("\n").map((line, index, lines) => (
              <span key={line + index} className={index > 0 && index === lines.length - 1 ? "text-gradient" : undefined}>
                {line}
                {index < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </h1>
        </EditableCopy>
        <EditableCopy copyKey="ranking.hero.lede" value={copy["ranking.hero.lede"]} canEdit={canEditCopy}>
          <p className={styles.heroSub}>{copy["ranking.hero.lede"]}</p>
        </EditableCopy>
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
            <strong>Le score</strong> pèse aussi : une victoire sans perdre de map (3-0, 2-0) transfère
            jusqu'à {MARGIN_MAX_TEXT} fois les points d'une victoire arrachée (3-2, 2-1) — autant de
            gagné pour le vainqueur, autant de perdu pour le perdant. Un match en une seule map et un
            forfait comptent comme une victoire simple.
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
    </SessionPageShell>
  );
}
