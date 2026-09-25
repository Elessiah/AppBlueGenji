import Link from "next/link";
import { CyberButton, CyberCard, MiniBracket, Pill } from "@/components/cyber";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { formatLocalDateTime } from "@/lib/shared/dates";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { activeTournamentCards, landingCardActionLabel } from "@/lib/shared/landing";
import { tournamentStateLabel } from "@/lib/shared/tournament-labels";
import styles from "./TournamentBoard.module.css";

type TournamentBoardProps = {
  buckets: TournamentBuckets;
  featured: TournamentCard | null;
  miniBracket: { a: string; b: string; sa: number | string; sb: number | string }[];
};

function makeTitle(tournament: TournamentCard | null): string {
  if (!tournament) return "Aucun tournoi visible pour le moment";
  return tournament.name;
}

export function TournamentBoard({ buckets, featured, miniBracket }: TournamentBoardProps) {
  const upcomingCards = activeTournamentCards(buckets)
    .filter((card) => !featured || card.id !== featured.id)
    .slice(0, 3);

  return (
    <section id="tournois" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 01</span>
          <h2 className={styles.sectionTitle}>Tournois en cours et à venir</h2>
        </div>
        <div className={styles.meta}>EN COURS · INSCRIPTIONS · BRACKETS</div>
      </div>

      <div className={styles.grid}>
        <CyberCard ticks className={styles.featured}>
          {featured ? (
            <>
              <TournamentImageBanner
                image={featured.image}
                sizes="(max-width: 900px) 100vw, 640px"
                className={styles.featuredBanner}
              />
              <div className={styles.badgeRow}>
                <Pill variant="blue">{featured.game}</Pill>
                <span className="mono">{tournamentStateLabel(featured.state).toUpperCase()}</span>
              </div>

              <div className={styles.titleRow}>
                <TournamentImageEmblem image={featured.image} size={56} />
                <h3 className={styles.featuredTitle}>{makeTitle(featured)}</h3>
              </div>
              <MiniBracket matches={miniBracket} />

              <div className={styles.footerRow}>
                <CyberButton variant="primary" asChild>
                  <Link href={`/tournois/${featured.id}`}>{landingCardActionLabel(featured)} →</Link>
                </CyberButton>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <span className="eyebrow">TOURNAMENTS</span>
              {/*
                * « Encore » dirait que le site n'a jamais rien organisé, ce qui
                * est faux dès qu'un tournoi s'est terminé : la section ne
                * montrant que ce qui est en cours ou à venir, son état vide est
                * atteint aussi bien par un site neuf que par une saison close.
                */}
              <h3>Aucun tournoi en cours ni à venir pour le moment.</h3>
            </div>
          )}
        </CyberCard>

        {upcomingCards.map((card) => {
          const progress = card.maxTeams > 0 ? Math.min(100, Math.round((card.registeredTeams / card.maxTeams) * 100)) : 0;

          return (
            <CyberCard key={card.id} ticks className={styles.upcoming}>
              <TournamentImageBanner
                image={card.image}
                sizes="(max-width: 900px) 100vw, 420px"
                className={styles.upcomingBanner}
              />
              <div className={styles.cardTop}>
                <Pill variant="blue">{card.game}</Pill>
                <span className="mono">{tournamentStateLabel(card.state).toUpperCase()}</span>
              </div>

              <div className={styles.titleRow}>
                <TournamentImageEmblem image={card.image} size={40} />
                <h3 className={styles.cardTitle}>{card.name}</h3>
              </div>

              <div className={styles.metaGrid}>
                <div>
                  <div className="mono">DÉBUT</div>
                  <div>{formatLocalDateTime(card.startAt)}</div>
                </div>
                <div>
                  <div className="mono">ÉQUIPES</div>
                  <div><span className="num">{card.registeredTeams}</span><span className={styles.dim}> / {card.maxTeams}</span></div>
                </div>
              </div>

              <div className={styles.progress}>
                <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              </div>

              <div className={styles.footerRow}>
                <CyberButton variant="ghost" asChild>
                  <Link href={`/tournois/${card.id}`}>{landingCardActionLabel(card)}</Link>
                </CyberButton>
              </div>
            </CyberCard>
          );
        })}
      </div>
    </section>
  );
}
