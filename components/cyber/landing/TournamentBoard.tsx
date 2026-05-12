import Link from "next/link";
import { CyberButton, CyberCard, MiniBracket, Pill } from "@/components/cyber";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { inferGameCode, inferGameLabel } from "@/lib/shared/landing";
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
  const upcomingCards = [...buckets.running, ...buckets.upcoming, ...buckets.registration, ...buckets.finished]
    .filter((card) => !featured || card.id !== featured.id)
    .slice(0, 3);

  return (
    <section id="tournois" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 01</span>
          <h2 className={styles.sectionTitle}>Tournois en cours et à venir</h2>
        </div>
        <div className={styles.meta}>LIVE · INSCRIPTIONS · BRACKETS</div>
      </div>

      <div className={styles.grid}>
        <CyberCard ticks className={styles.featured}>
          {featured ? (
            <>
              <div className={styles.badgeRow}>
                <Pill variant={featured.state === "RUNNING" ? "live" : "blue"}>
                  {featured.state === "RUNNING" ? "LIVE" : "OW2"}
                </Pill>
                <span className="mono">{inferGameLabel(featured.name).toUpperCase()}</span>
              </div>

              <div className={styles.gameEyebrow}>OVERWATCH 2</div>
              <h3 className={styles.featuredTitle}>{makeTitle(featured)}</h3>
              <div className={styles.phase}>{featured.state} · BRACKET LIVE</div>
              <MiniBracket matches={miniBracket} />

              <div className={styles.footerRow}>
                <div>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-mute)" }}>CASH PRIZE</div>
                  <div className="num" style={{ fontSize: 18 }}>—</div>
                </div>
                <CyberButton variant="primary" asChild>
                  <Link href={`/tournois/${featured.id}`}>Voir le bracket →</Link>
                </CyberButton>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <span className="eyebrow">TOURNAMENTS</span>
              <h3>Aucun tournoi public n&apos;est encore visible.</h3>
            </div>
          )}
        </CyberCard>

        {upcomingCards.map((card) => {
          const progress = card.maxTeams > 0 ? Math.min(100, Math.round((card.registeredTeams / card.maxTeams) * 100)) : 0;
          const game = inferGameLabel(card.name);
          const code = inferGameCode(card.name);

          return (
            <CyberCard key={card.id} ticks className={styles.upcoming}>
              <div className={styles.cardTop}>
                <Pill variant="blue">{code.toUpperCase()}</Pill>
                <span className="mono">{game.toUpperCase()}</span>
              </div>

              <div className={styles.cardGame}>{game}</div>
              <h3 className={styles.cardTitle}>{card.name}</h3>

              <div className={styles.metaGrid}>
                <div>
                  <div className="mono">DÉBUT</div>
                  <div>{new Date(card.startAt).toLocaleString("fr-FR")}</div>
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
                <div>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-mute)" }}>CASH PRIZE</div>
                  <div className="num" style={{ fontSize: 16 }}>—</div>
                </div>
                <CyberButton variant="ghost" asChild>
                  <Link href={`/tournois/${card.id}`}>S&apos;inscrire</Link>
                </CyberButton>
              </div>
            </CyberCard>
          );
        })}
      </div>
    </section>
  );
}
