import { LocaleLink } from "@/components/i18n/locale-navigation";
import { tournamentHref } from "@/lib/shared/match-anchor";
import { CyberButton, CyberCard, MiniBracket, Pill } from "@/components/cyber";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { activeTournamentCards } from "@/lib/shared/landing";
import { boardActionKey, boardStateKey, formatBoardStartAt } from "@/lib/shared/landing-board";
import { gameLabel } from "@/lib/shared/tournament-labels";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import type { LandingText } from "@/lib/shared/landing-text";
import styles from "./TournamentBoard.module.css";

type TournamentBoardProps = {
  buckets: TournamentBuckets;
  featured: TournamentCard | null;
  miniBracket: { a: string; b: string; sa: number | string; sb: number | string }[];
  /** Langue de la page (`requestLocale()`), français par défaut. */
  locale?: Locale;
  /** Visiteur sans session : les cartes mènent à la page sans compte (`SPECTATOR_VIEW.md`). */
  spectator?: boolean;
};

/** Action d'une carte : elle mène toujours à la fiche, seul le libellé change (`boardActionKey`). */
function actionLabel({ t }: LandingText, card: TournamentCard, now: number): string {
  const key = boardActionKey(card, now);
  return key === "view" ? t("common.viewTournament") : t(`board.action.${key}`);
}

export function TournamentBoard({ buckets, featured, miniBracket, locale = DEFAULT_LOCALE, spectator = false }: Readonly<TournamentBoardProps>) {
  const text = landingServerText(locale);
  const { t } = text;
  // Une seule horloge pour toute la section : deux cartes lues à deux instants
  // pourraient se contredire sur une échéance qui tombe pendant le rendu.
  const now = Date.now();
  const upcomingCards = activeTournamentCards(buckets)
    .filter((card) => card.id !== featured?.id)
    .slice(0, 3);
  const openCount = buckets.registration.length + buckets.running.length;

  return (
    <section id="tournois" className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>{t("board.title")}</h2>
        <div className={styles.meta}>{t("board.openCount", { count: openCount })}</div>
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
              {/*
                * Un état de tournoi se met en bleu : le rouge n'habille que ce
                * qui est réellement à l'antenne (règle « Live / Direct »). Le
                * jeu n'est nommé qu'une fois, depuis la donnée du tournoi.
                */}
              <div className={styles.badgeRow}>
                <Pill variant="blue">{t(`board.state.${boardStateKey(featured, now)}`)}</Pill>
                <span className={styles.game}>{gameLabel(featured.game)}</span>
              </div>

              <div className={styles.titleRow}>
                <TournamentImageEmblem image={featured.image} size={56} />
                <h3 className={styles.featuredTitle}>{featured.name}</h3>
              </div>
              <div className={styles.format}>{t(`board.format.${featured.format}`)}</div>
              {/* Un tournoi aux inscriptions n'a pas encore de plateau : pas de cases vides. */}
              {miniBracket.length > 0 && <MiniBracket matches={miniBracket} />}

              <div className={styles.footerRow}>
                <CyberButton variant="primary" asChild>
                  <LocaleLink href={tournamentHref(featured.id, spectator)}>{actionLabel(text, featured, now)} →</LocaleLink>
                </CyberButton>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <span className="eyebrow">{t("board.emptyEyebrow")}</span>
              {/*
                * « Encore » dirait que le site n'a jamais rien organisé, ce qui
                * est faux dès qu'un tournoi s'est terminé : la section ne
                * montrant que ce qui est en cours ou à venir, son état vide est
                * atteint aussi bien par un site neuf que par une saison close.
                */}
              <h3>{t("board.emptyTitle")}</h3>
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
                <Pill variant="blue">{t(`board.state.${boardStateKey(card, now)}`)}</Pill>
                <span className={styles.game}>{gameLabel(card.game)}</span>
              </div>

              <div className={styles.titleRow}>
                <TournamentImageEmblem image={card.image} size={40} />
                <h3 className={styles.cardTitle}>{card.name}</h3>
              </div>

              <div className={styles.metaGrid}>
                <div>
                  <div className="mono">{t("board.start")}</div>
                  <div>{formatBoardStartAt(card.startAt, now, locale)}</div>
                </div>
                <div>
                  <div className="mono">{t("board.teams")}</div>
                  <div><span className="num">{card.registeredTeams}</span><span className={styles.dim}> / {card.maxTeams}</span></div>
                </div>
              </div>

              <div className={styles.progress}>
                <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              </div>

              <div className={styles.footerRow}>
                <CyberButton variant="ghost" asChild>
                  <LocaleLink href={tournamentHref(card.id, spectator)}>{actionLabel(text, card, now)}</LocaleLink>
                </CyberButton>
              </div>
            </CyberCard>
          );
        })}
      </div>
    </section>
  );
}
