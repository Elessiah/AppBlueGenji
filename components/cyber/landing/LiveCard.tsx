"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { ChevronLeft, ChevronRight, Eye, Pause, Play } from "lucide-react";
import { CyberCard, Pill, TeamSigil } from "@/components/cyber";
import { EntityLink } from "@/components/entity-link";
import type { LandingLive, LandingLiveMatch } from "@/lib/shared/landing";
import { featuredMatchPill, inferPhaseLabel, visibleLiveViewerCount } from "@/lib/shared/landing";
import { PLATFORM_LABELS, streamPlatform, type MatchLiveState } from "@/lib/shared/live-streams";
import { matchFormatLabel } from "@/lib/shared/match-format";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import { useClock } from "@/lib/shared/hooks/useClock";
import type { LandingText } from "@/lib/shared/landing-text";
import { useLandingText } from "@/components/i18n/landing-text";
import { useMatchCarousel, type MatchCarousel } from "./useMatchCarousel";
import styles from "./LiveCard.module.css";

/**
 * Nom de la manche dans la langue de la page. Le français garde `roundLabel`,
 * rédigé par le serveur ; l'anglais le relit d'après `round`.
 */
function roundText({ t, locale }: LandingText, match: LandingLiveMatch): string {
  if (locale === "fr") return match.roundLabel;
  return match.round.kind === "round"
    ? t("live.round.round", { n: String(match.round.number) })
    : t(`live.round.${match.round.kind}`);
}

/**
 * Phase affichée sous la pastille. En français, `inferPhaseLabel` (inchangé :
 * la finale et la demi-finale se lisent « PHASE FINALE », les quarts « PHASE
 * ÉLIMINATOIRE ») ; en anglais, la même règle d'après `round`.
 */
function phaseText(text: LandingText, match: LandingLiveMatch): string {
  if (text.locale === "fr") return inferPhaseLabel(match);
  if (match.round.kind === "round") return text.t("live.phase.round", { n: String(match.round.number) });
  if (match.round.kind === "quarter") return text.t("live.phase.knockout");
  return text.t("live.phase.final");
}

/** Relecture de l'horloge pour un match daté : à la demi-minute près. */
const LIVE_CARD_CLOCK_MS = 30_000;

type LiveCardProps = {
  /**
   * État du direct, tenu par le `Hero` (`useLandingLive`). La carte est
   * volontairement contrôlée : elle partage sa source avec le bouton
   * « Regarder le live », qui doit apparaître et disparaître en même temps
   * qu'elle annonce un match à l'antenne.
   */
  live: LandingLive | null;
  nextUpcomingISO?: string | null;
};

/**
 * Nom d'un engagé du match à l'antenne, cliquable quand la place est occupée.
 *
 * Le chemin est résolu côté serveur (`LandingLiveMatch.team1Href`) : la carte
 * n'a pas à savoir si le tournoi oppose des équipes ou des joueurs. Une place
 * vide — bye, adversaire encore à désigner — ne mène nulle part.
 */
function EntrantName({ href, name }: Readonly<{ href: string | null; name: string }>) {
  const { t } = useLandingText();
  if (!href) return <>{name}</>;
  return (
    <EntityLink href={href} className={`${styles.nested} ${styles.entrantLink}`} title={t("common.teamPageTitle", { name })}>
      {name}
    </EntityLink>
  );
}

/**
 * Bandeau de diffusion du match mis en avant.
 *
 * Le bouton n'apparaît **que** pour un match réellement à l'antenne.
 * `SCHEDULED` annonce un cast à venir : la chaîne ne montre pas encore ce
 * match, et l'y envoyer serait la même impasse que le bouton « Regarder le
 * live » du hero, qui ne se rend qu'à l'antenne ouverte. À l'antenne, la
 * pastille « En direct » le dit déjà : le bandeau ne porte plus que le bouton,
 * et disparaît sans lien public.
 */
function MatchStreamBanner({
  liveState,
  liveUrl,
  matchLabel,
}: Readonly<{ liveState: MatchLiveState; liveUrl: string | null; matchLabel: string }>) {
  const { t } = useLandingText();
  const streamHref = liveState === "LIVE" ? liveUrl : null;
  if (liveState === "SCHEDULED") {
    return (
      <div className={styles.streamBannerScheduled}>
        <span className={styles.streamLabel}>{t("live.streamScheduled")}</span>
      </div>
    );
  }
  if (!streamHref) return null;
  const platform = streamPlatform(streamHref);
  const platformName = platform ? PLATFORM_LABELS[platform] : null;
  return (
    <div className={styles.streamBanner}>
      <a
        className={`${styles.streamButton} ${styles.nested}`}
        href={streamHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={
          platformName
            ? t("live.watchMatchLabelOn", { match: matchLabel, platform: platformName })
            : t("live.watchMatchLabel", { match: matchLabel })
        }
      >
        <span aria-hidden="true">▶</span>
        {platformName ? t("live.watchOn", { platform: platformName }) : t("common.watchLive")}
      </a>
    </div>
  );
}

function sigilFor(name: string | null): string {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Phrase entière de la carte sans tournoi en cours — jamais un simple
 * complément : « dans bientôt » et « dans aujourd'hui » ne se lisent pas,
 * faute de construction commune avec « dans N jours ».
 */
function noLiveTournamentMessage({ t }: LandingText, iso: string | null | undefined): string {
  if (!iso) return t("live.noneScheduled");
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const days = Math.max(0, Math.ceil(diff / 86400000));
  if (days <= 0) return t("live.nextToday");
  return t("live.nextInDays", { days });
}

/**
 * Un match de la carte : pastille d'état, bandeau de diffusion, les deux
 * engagés et la manche. Le carrousel en empile un par match.
 */
function MatchSlide({ match, clock }: Readonly<{ match: LandingLiveMatch; clock: number | null }>) {
  const text = useLandingText();
  const { t } = text;
  // Le format est un réglage, jamais une déduction du nom de la manche : un FT3
  // s'écrit « FT3 », un BO5 « BO5 ». Un tournoi en score libre n'a rien à
  // annoncer — la ligne se réduit alors au numéro du match plutôt que
  // d'afficher « Score libre » là où on attend une notation.
  //
  // Et c'est le format **du match** qu'on lit, pas celui du tournoi : « BlueGenji
  // Survie » en joue deux, si bien qu'une demi-finale s'annonçait au plafond de
  // maps de la qualification. Le serveur l'a déjà résolu (`LandingLiveMatch`).
  const matchFormat = match.matchFormat;
  const matchPill = featuredMatchPill(match, clock, text.locale);
  const team1Label = match.team1Name ?? t("live.team1");
  const team2Label = match.team2Name ?? t("live.team2");

  return (
    <div className={styles.match}>
      {/* La pastille dit l'état **du match**, dans les mots des sections de
          manche ; le rouge ne sert qu'à « En direct » (vraie diffusion). */}
      <div className={styles.matchHead}>
        <Pill variant={matchPill.tone}>{t(`live.pill.${matchPill.kind}`)}</Pill>
        <span className="mono">
          {/* L'horaire d'un match en attente est l'information de la carte :
              en cyan gras, pas noyé dans la ligne de phase. */}
          {matchPill.when ? (
            <>
              <span className={styles.when}>{matchPill.when.toUpperCase()}</span>
              {" · "}
            </>
          ) : null}
          {phaseText(text, match)}
        </span>
      </div>
      <MatchStreamBanner
        liveState={match.liveState}
        liveUrl={match.liveUrl}
        matchLabel={t("live.versus", { team1: team1Label, team2: team2Label })}
      />

      <div className={styles.team}>
        <TeamSigil label={sigilFor(match.team1Name)} size={40} logoUrl={match.team1LogoUrl} />
        <div className={styles.teamText}>
          <div className={styles.teamName}>
            <EntrantName href={match.team1Href} name={team1Label} />
          </div>
          {/* Rien plutôt qu'un seed inventé : la ligne portait « FR · SEED 1 »
              en dur, identique sur tous les matchs de tous les tournois. */}
          {match.team1Seed !== null && <div className="mono">{t("live.seed", { seed: String(match.team1Seed) })}</div>}
        </div>
        <div className="num" style={{ fontSize: 30 }}>{match.team1Score ?? "—"}</div>
      </div>

      <div className={`${styles.vs} mono`}>
        {roundText(text, match)}
        {matchFormat && (
          <>
            {" · "}
            {/*
              Un simple libellé, comme les trois autres écrans qui affichent
              un format (en-tête du tournoi, carte de match, arbitrage). Ni
              `<abbr>` ni `title` : l'infobulle est réservée à la souris, la
              règle chiffrée qu'elle porterait est la même en BO5 et en FT3
              (elle ne distingue donc pas les deux notations), et un lecteur
              d'écran qui l'annonce à la place du contenu perdrait justement
              la notation. Ce qui manque à un visiteur n'est pas une bulle,
              c'est la règle **visible** — elle a sa place sur la fiche du
              tournoi, pas dans une ligne de dix pixels.
            */}
            <span className={styles.matchFormat}>{matchFormatLabel(matchFormat)}</span>
          </>
        )}
      </div>

      <div className={styles.team}>
        <TeamSigil label={sigilFor(match.team2Name)} color="var(--violet-400)" size={40} logoUrl={match.team2LogoUrl} />
        <div className={styles.teamText}>
          <div className={styles.teamName}>
            <EntrantName href={match.team2Href} name={team2Label} />
          </div>
          {match.team2Seed !== null && <div className="mono">{t("live.seed", { seed: String(match.team2Seed) })}</div>}
        </div>
        <div className="num" style={{ fontSize: 30 }}>{match.team2Score ?? "—"}</div>
      </div>
    </div>
  );
}

/**
 * Commandes du carrousel : précédent, position, suivant, pause. Au-dessus de la
 * plaque de lien (`.nested`). La position n'est annoncée (`aria-live`) que
 * lorsque le défilement est arrêté : annoncée à chaque tour automatique, elle
 * couperait la parole au lecteur d'écran toutes les sept secondes.
 */
function CarouselControls({ carousel }: Readonly<{ carousel: MatchCarousel }>) {
  const { t } = useLandingText();
  return (
    <div className={`${styles.carouselControls} ${styles.nested}`} data-tap-zone>
      <button type="button" className={styles.carouselButton} onClick={() => carousel.go(-1)} aria-label={t("live.carousel.previous")}>
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <span className={`${styles.carouselCount} mono`} aria-live={carousel.rotating ? "off" : "polite"} aria-atomic="true">
        <span className="sr-only">{t("live.carousel.position", { n: carousel.index + 1, total: carousel.count })}</span>
        <span aria-hidden="true">
          {carousel.index + 1} / {carousel.count}
        </span>
      </span>
      <button type="button" className={styles.carouselButton} onClick={() => carousel.go(1)} aria-label={t("live.carousel.next")}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {carousel.canRotate && (
        <button
          type="button"
          className={styles.carouselButton}
          onClick={carousel.togglePaused}
          aria-label={carousel.paused ? t("live.carousel.play") : t("live.carousel.pause")}
        >
          {carousel.paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

/**
 * Zone des matchs : le carrousel empilé (plusieurs matchs), le match seul, ou
 * l'attente du prochain lancement.
 */
function MatchArea({
  matches,
  carousel,
  clock,
  tournament,
}: Readonly<{ matches: LandingLiveMatch[]; carousel: MatchCarousel; clock: number | null; tournament: string }>) {
  const { t } = useLandingText();
  if (matches.length === 0) {
    return (
      <div className={styles.match}>
        <div className={styles.emptyMatch}>{t("live.emptyMatch")}</div>
      </div>
    );
  }
  if (matches.length === 1) return <MatchSlide match={matches[0]} clock={clock} />;
  return (
    <section className={styles.slides} aria-roledescription={t("live.carousel.role")} aria-label={t("live.carousel.label", { tournament })}>
      {matches.map((match, index) => (
        <div
          key={match.id}
          className={index === carousel.index ? `${styles.slide} ${styles.slideActive}` : styles.slide}
          aria-hidden={index === carousel.index ? undefined : true}
        >
          <MatchSlide match={match} clock={clock} />
        </div>
      ))}
    </section>
  );
}

/** Matchs du carrousel : ceux du serveur, ou le seul match mis en avant. */
function carouselMatches(live: LandingLive | null): LandingLiveMatch[] {
  if (!live) return [];
  if (live.matches && live.matches.length > 0) return live.matches;
  return live.currentMatch ? [live.currentMatch] : [];
}

/**
 * Carte du tournoi en cours, en tête de l'accueil.
 *
 * Elle fait défiler les matchs du tournoi **dans l'ordre chronologique**
 * (`LandingLive.matches`, `carouselMatchOrder`), en s'ouvrant sur le match mis
 * en avant ; elle **mène** aussi au match affiché. Le lien principal est une
 * plaque transparente (`.cardOverlay`) plutôt qu'une ancre enveloppant toute la
 * carte : les noms d'engagés, le bouton de diffusion et les commandes du
 * carrousel portent leurs propres cibles, et un `<a>` dans un `<a>` casse
 * l'hydratation. Ils repassent au-dessus de la plaque avec `.nested`.
 *
 * La cible est `/tournois/[id]#match-[id]` (`tournamentMatchHref`) : la fiche du
 * tournoi s'ouvre défilée sur ce match précis, et le surligne à l'arrivée. Sans
 * match à montrer, elle se réduit au tournoi.
 *
 * Les matchs sont **empilés** dans une même case de grille, un seul visible :
 * la carte prend la hauteur du plus haut et ne bouge pas d'un match à l'autre —
 * le hero, en dessous, ne saute pas toutes les sept secondes.
 */
export function LiveCard({ live, nextUpcomingISO }: Readonly<LiveCardProps>) {
  const matches = carouselMatches(live);
  // Seule l'horloge fait passer un match daté en lancement : sans elle, la
  // carte annoncerait « En attente de lancement » jusqu'au sondage suivant.
  // Elle ne tourne que pour un tel match (`useClock` respecte le mode économe).
  const clock = useClock(LIVE_CARD_CLOCK_MS, matches.some((match) => match.launchPhase === "SCHEDULED"));
  const carousel = useMatchCarousel(
    matches.map((match) => match.id),
    live?.currentMatch?.id ?? null,
  );
  const text = useLandingText();
  const { t } = text;
  if (!live) {
    return (
      <CyberCard ticks className={styles.root}>
        <div className={styles.empty}>
          <span className="pill pill-blue">{t("live.info")}</span>
          <p>{noLiveTournamentMessage(text, nextUpcomingISO)}</p>
        </div>
      </CyberCard>
    );
  }

  const shown = matches[carousel.index] ?? null;
  const title = live.tournament.name.toUpperCase();
  const visibleViewers = visibleLiveViewerCount(live.viewers);
  const href = tournamentMatchHref(live.tournament.id, shown?.id ?? null);
  const tournament = live.tournament.name;
  const openLabel = shown
    ? t("live.openMatch", {
        tournament,
        team1: shown.team1Name ?? t("live.team1"),
        team2: shown.team2Name ?? t("live.team2"),
      })
    : t("live.openTournament", { tournament });
  const footerHint = shown ? t("live.footerMatch") : t("common.viewTournament");

  return (
    // `lift` : la carte est cliquable de bout en bout, sa bordure doit réagir au
    // survol. Le pied fléché dit *où* l'on va, la bordure dit *que* l'on peut y
    // aller — la carte sans tournoi en cours, elle, ne mène nulle part et n'en
    // reçoit pas.
    //
    // L'enveloppe (`display: contents`, sans boîte) suspend le défilement sous
    // le pointeur et le focus **de toute la carte** : la plaque de lien couvre
    // les matchs, un survol ne les atteint donc jamais directement.
    <div className={styles.hold} {...carousel.holdHandlers}>
      <CyberCard ticks lift className={styles.root}>
        {/* Plaque de lien : posée en premier pour rester sous les liens imbriqués
            dans l'ordre du DOM autant que par le `z-index`. */}
        <LocaleLink href={href} className={styles.cardOverlay} aria-label={openLabel} />
        {/* Reflet qui balaie la bordure haute : décoratif, figé avec le régime de charge. */}
        <span className={styles.shimmer} aria-hidden="true" />

        {/* L'état du **tournoi** est une mention secondaire, collée au jeu et au
            nom du tournoi — jamais une pastille : « EN COURS » en tête de carte
            se lisait comme l'état du match, alors que celui-ci n'était que daté. */}
        <div className={styles.head}>
          <span className={`${styles.tournamentMeta} mono`}>
            {t("live.tournamentState").toUpperCase()} · {live.game.toUpperCase()}
          </span>
          {visibleViewers !== null && (
            <span className={styles.viewers}>
              <Eye size={12} />
              <span className="mono">{visibleViewers}</span>
            </span>
          )}
        </div>

        <div className={styles.title}>{title}</div>

        <MatchArea matches={matches} carousel={carousel} clock={clock} tournament={tournament} />

        {/*
          Affordance de la plaque, et rien de plus : le seul lien est la plaque
          elle-même, un second `<a>` redisant la même cible n'ajouterait qu'un
          arrêt de tabulation. Remplace le bloc « CARTE EN COURS · — », qui
          promettait la map jouée que le modèle ne porte pas. Avec plusieurs
          matchs, les commandes du carrousel prennent la droite du pied.
        */}
        {matches.length > 1 ? (
          <div className={`${styles.footer} ${styles.footerCarousel}`}>
            <span className={styles.footerHint} aria-hidden="true">
              <span>{footerHint}</span>
              <span className={styles.footerArrow}>→</span>
            </span>
            <CarouselControls carousel={carousel} />
          </div>
        ) : (
          <div className={styles.footer} aria-hidden="true">
            <span>{footerHint}</span>
            <span className={styles.footerArrow}>→</span>
          </div>
        )}
      </CyberCard>
    </div>
  );
}
