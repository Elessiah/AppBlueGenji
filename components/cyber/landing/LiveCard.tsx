"use client";

import Link from "next/link";
import { Eye } from "lucide-react";
import { CyberCard, Pill, TeamSigil } from "@/components/cyber";
import { EntityLink } from "@/components/entity-link";
import type { LandingLive } from "@/lib/shared/landing";
import {
  FEATURED_TOURNAMENT_STATE_LABEL,
  featuredMatchPill,
  inferPhaseLabel,
  visibleLiveViewerCount,
} from "@/lib/shared/landing";
import { PLATFORM_LABELS, streamPlatform } from "@/lib/shared/live-streams";
import { matchFormatLabel } from "@/lib/shared/match-format";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import { useClock } from "@/lib/shared/hooks/useClock";
import styles from "./LiveCard.module.css";

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
  if (!href) return <>{name}</>;
  return (
    <EntityLink href={href} className={`${styles.nested} ${styles.entrantLink}`} title={`Voir la fiche de ${name}`}>
      {name}
    </EntityLink>
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
function noLiveTournamentMessage(iso: string | null | undefined): string {
  if (!iso) return "Aucun tournoi en cours, et rien n'est encore programmé.";
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const days = Math.max(0, Math.ceil(diff / 86400000));
  if (days <= 0) return "Aucun tournoi en cours. Le prochain démarre aujourd'hui.";
  if (days === 1) return "Aucun tournoi en cours. Le prochain démarre dans 1 jour.";
  return `Aucun tournoi en cours. Le prochain démarre dans ${days} jours.`;
}

/**
 * Carte du tournoi en cours, en tête de l'accueil.
 *
 * Elle met un match en avant ; elle **y mène** aussi. Le lien principal est une
 * plaque transparente (`.cardOverlay`) plutôt qu'une ancre enveloppant toute la
 * carte : les noms d'engagés et le bouton de diffusion portent leurs propres
 * liens, et un `<a>` dans un `<a>` casse l'hydratation. Les liens imbriqués
 * repassent au-dessus de la plaque avec `.nested`.
 *
 * La cible est `/tournois/[id]#match-[id]` (`tournamentMatchHref`) : la fiche du
 * tournoi s'ouvre défilée sur ce match précis, et le surligne à l'arrivée. Sans
 * match à montrer, elle se réduit au tournoi.
 */
export function LiveCard({ live, nextUpcomingISO }: Readonly<LiveCardProps>) {
  // Seule l'horloge fait passer un match daté en lancement : sans elle, la
  // carte annoncerait « Prochain match · 20:30 » jusqu'au sondage suivant.
  // Elle ne tourne que pour un tel match (`useClock` respecte le mode économe).
  const clock = useClock(LIVE_CARD_CLOCK_MS, live?.currentMatch?.launchPhase === "SCHEDULED");
  if (!live) {
    return (
      <CyberCard ticks className={styles.root}>
        <div className={styles.empty}>
          <span className="pill pill-blue">INFO TOURNOI</span>
          <p>{noLiveTournamentMessage(nextUpcomingISO)}</p>
        </div>
      </CyberCard>
    );
  }

  const currentMatch = live.currentMatch;
  // Le format est un réglage, jamais une déduction du nom de la manche : un FT3
  // s'écrit « FT3 », un BO5 « BO5 ». Un tournoi en score libre n'a rien à
  // annoncer — la ligne se réduit alors au numéro du match plutôt que
  // d'afficher « Score libre » là où on attend une notation.
  //
  // Et c'est le format **du match** qu'on lit, pas celui du tournoi : « BlueGenji
  // Survie » en joue deux, si bien qu'une demi-finale s'annonçait au plafond de
  // maps de la qualification. Le serveur l'a déjà résolu (`LandingLiveMatch`).
  const matchFormat = currentMatch?.matchFormat ?? null;
  const title = live.tournament.name.toUpperCase();
  const matchIsLive = currentMatch?.liveState === "LIVE";
  const matchIsScheduled = currentMatch?.liveState === "SCHEDULED";
  const matchPill = currentMatch ? featuredMatchPill(currentMatch, clock) : null;
  const matchPlatform = streamPlatform(currentMatch?.liveUrl);
  // Le bouton de diffusion n'apparaît **que** pour un match réellement à
  // l'antenne. `SCHEDULED` annonce un cast à venir : la chaîne ne montre pas
  // encore ce match, et l'y envoyer serait la même impasse que le bouton
  // « Regarder le live » du hero, qui ne se rend qu'à l'antenne ouverte.
  const streamHref = matchIsLive ? currentMatch?.liveUrl ?? null : null;

  const visibleViewers = visibleLiveViewerCount(live.viewers);
  const team1Label = currentMatch?.team1Name ?? "Équipe 1";
  const team2Label = currentMatch?.team2Name ?? "Équipe 2";
  const href = tournamentMatchHref(live.tournament.id, currentMatch?.id ?? null);
  const openLabel = currentMatch
    ? `Ouvrir ${live.tournament.name} sur le match ${team1Label} contre ${team2Label}`
    : `Ouvrir la fiche du tournoi ${live.tournament.name}`;

  return (
    // `lift` : la carte est cliquable de bout en bout, sa bordure doit réagir au
    // survol. Le pied fléché dit *où* l'on va, la bordure dit *que* l'on peut y
    // aller — la carte sans tournoi en cours, elle, ne mène nulle part et n'en
    // reçoit pas.
    <CyberCard ticks lift className={styles.root}>
      {/* Plaque de lien : posée en premier pour rester sous les liens imbriqués
          dans l'ordre du DOM autant que par le `z-index`. */}
      <Link href={href} className={styles.cardOverlay} aria-label={openLabel} />

      {/* L'état du **tournoi** est une mention secondaire, collée au jeu et au
          nom du tournoi — jamais une pastille : « EN COURS » en tête de carte
          se lisait comme l'état du match, alors que celui-ci n'était que daté. */}
      <div className={styles.head}>
        <span className={`${styles.tournamentMeta} mono`}>
          {FEATURED_TOURNAMENT_STATE_LABEL.toUpperCase()} · {live.game.toUpperCase()}
        </span>
        {visibleViewers !== null && (
          <span className={styles.viewers}>
            <Eye size={12} />
            <span className="mono">{visibleViewers}</span>
          </span>
        )}
      </div>

      <div className={styles.title}>{title}</div>

      {currentMatch && matchPill ? (
        <div className={styles.match}>
          {/* La pastille dit l'état **du match**, dans les mots des sections de
              manche ; le rouge ne sert qu'à « En direct » (vraie diffusion). */}
          <div className={styles.matchHead}>
            <Pill variant={matchPill.tone === "default" ? undefined : matchPill.tone}>{matchPill.label}</Pill>
            <span className="mono">{inferPhaseLabel(currentMatch)}</span>
          </div>
          {((matchIsLive && streamHref) || matchIsScheduled) && (
            <div className={matchIsLive ? styles.streamBanner : styles.streamBannerScheduled}>
              {/* À l'antenne, la pastille « En direct » le dit déjà : le
                  bandeau ne porte plus que le bouton. */}
              {matchIsScheduled && <span className={styles.streamLabel}>○ DIFFUSION ANNONCÉE</span>}
              {streamHref && (
                <a
                  className={`${styles.streamButton} ${styles.nested}`}
                  href={streamHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Regarder ${team1Label} contre ${team2Label} en direct${
                    matchPlatform ? ` sur ${PLATFORM_LABELS[matchPlatform]}` : ""
                  } (nouvel onglet)`}
                >
                  <span aria-hidden="true">▶</span>
                  {matchPlatform ? `Regarder sur ${PLATFORM_LABELS[matchPlatform]}` : "Regarder le live"}
                </a>
              )}
            </div>
          )}

          <div className={styles.team}>
            <TeamSigil label={sigilFor(currentMatch.team1Name)} size={40} logoUrl={currentMatch.team1LogoUrl} />
            <div className={styles.teamText}>
              <div className={styles.teamName}>
                <EntrantName href={currentMatch.team1Href} name={team1Label} />
              </div>
              {/* Rien plutôt qu'un seed inventé : la ligne portait « FR · SEED 1 »
                  en dur, identique sur tous les matchs de tous les tournois. */}
              {currentMatch.team1Seed !== null && (
                <div className="mono">SEED {currentMatch.team1Seed}</div>
              )}
            </div>
            <div className="num" style={{ fontSize: 30 }}>{currentMatch.team1Score ?? "—"}</div>
          </div>

          <div className={`${styles.vs} mono`}>
            {currentMatch.roundLabel}
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
            <TeamSigil
              label={sigilFor(currentMatch.team2Name)}
              color="var(--amber)"
              size={40}
              logoUrl={currentMatch.team2LogoUrl}
            />
            <div className={styles.teamText}>
              <div className={styles.teamName}>
                <EntrantName href={currentMatch.team2Href} name={team2Label} />
              </div>
              {currentMatch.team2Seed !== null && (
                <div className="mono">SEED {currentMatch.team2Seed}</div>
              )}
            </div>
            <div className="num" style={{ fontSize: 30 }}>{currentMatch.team2Score ?? "—"}</div>
          </div>
        </div>
      ) : (
        <div className={styles.match}>
          <div className={styles.emptyMatch}>Le prochain match en direct sera affiché ici dès son lancement.</div>
        </div>
      )}

      {/*
        Affordance de la plaque, et rien de plus : le seul lien est la plaque
        elle-même, un second `<a>` redisant la même cible n'ajouterait qu'un
        arrêt de tabulation. Remplace le bloc « CARTE EN COURS · — », qui
        promettait la map jouée que le modèle ne porte pas.
      */}
      <div className={styles.footer} aria-hidden="true">
        <span>{currentMatch ? "Voir le match dans le tournoi" : "Voir le tournoi"}</span>
        <span className={styles.footerArrow}>→</span>
      </div>
    </CyberCard>
  );
}
