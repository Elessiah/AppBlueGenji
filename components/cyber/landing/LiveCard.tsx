"use client";

import { Eye } from "lucide-react";
import { CyberCard, Pill, TeamSigil } from "@/components/cyber";
import { EntityLink } from "@/components/entity-link";
import type { LandingLive } from "@/lib/shared/landing";
import { inferPhaseLabel } from "@/lib/shared/landing";
import { PLATFORM_LABELS, streamPlatform } from "@/lib/shared/live-streams";
import { matchFormatDescription, matchFormatLabel } from "@/lib/shared/match-format";
import styles from "./LiveCard.module.css";

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
function EntrantName({ href, name }: { href: string | null; name: string }) {
  if (!href) return <>{name}</>;
  return (
    <EntityLink href={href} title={`Voir la fiche de ${name}`}>
      {name}
    </EntityLink>
  );
}

function sigilFor(name: string | null): string {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

function nextDaysLabel(iso: string | null | undefined): string {
  if (!iso) return "bientôt";
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const days = Math.max(0, Math.ceil(diff / 86400000));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "1 jour";
  return `${days} jours`;
}

export function LiveCard({ live, nextUpcomingISO }: LiveCardProps) {
  if (!live) {
    return (
      <CyberCard ticks className={styles.root}>
        <div className={styles.empty}>
          <span className="pill pill-blue">INFO TOURNOI</span>
          <p>Aucun tournoi en cours. Le prochain démarre dans {nextDaysLabel(nextUpcomingISO)}.</p>
        </div>
      </CyberCard>
    );
  }

  const currentMatch = live.currentMatch;
  // Le format des matchs est un réglage du tournoi, jamais une déduction du nom
  // de la manche : un FT3 s'écrit « FT3 », un BO5 « BO5 ». Un tournoi en score
  // libre n'a rien à annoncer — la ligne se réduit alors au numéro du match
  // plutôt que d'afficher « Score libre » là où on attend une notation.
  const matchFormat = live.tournament.matchFormat;
  const title = live.tournament.name.toUpperCase();
  const matchIsLive = currentMatch?.liveState === "LIVE";
  const matchIsScheduled = currentMatch?.liveState === "SCHEDULED";
  const matchPlatform = streamPlatform(currentMatch?.liveUrl);

  return (
    <CyberCard ticks className={styles.root}>
      <div className={styles.head}>
        <Pill variant="live">EN COURS</Pill>
        <span className="mono">{live.game.toUpperCase()} · {inferPhaseLabel(currentMatch)}</span>
        <span className={styles.viewers}>
          <Eye size={12} />
          <span className="mono">{live.viewers}</span>
        </span>
      </div>

      <div className={styles.title}>{title}</div>

      {currentMatch ? (
        <div className={styles.match}>
          {(matchIsLive || matchIsScheduled) && (
            <div className={matchIsLive ? styles.streamBanner : styles.streamBannerScheduled}>
              <span className={styles.streamLabel}>
                {matchIsLive ? "● CE MATCH EST EN DIRECT" : "○ MATCH PROGRAMMÉ EN DIRECT"}
              </span>
              {currentMatch.liveUrl && (
                <a
                  className={styles.streamLink}
                  href={currentMatch.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {matchPlatform ? `Voir sur ${PLATFORM_LABELS[matchPlatform]}` : "Voir la chaîne"}
                </a>
              )}
            </div>
          )}

          <div className={styles.team}>
            <TeamSigil letter={sigilFor(currentMatch.team1Name)} size={40} />
            <div className={styles.teamText}>
              <div className={styles.teamName}>
                <EntrantName href={currentMatch.team1Href} name={currentMatch.team1Name ?? "Équipe 1"} />
              </div>
              <div className="mono">FR · SEED 1</div>
            </div>
            <div className="num" style={{ fontSize: 30 }}>{currentMatch.team1Score ?? "—"}</div>
          </div>

          <div className={`${styles.vs} mono`}>
            MATCH {String(currentMatch.id).padStart(2, "0")}
            {matchFormat && (
              <>
                {" · "}
                {/*
                  « FT3 » ne se lit pas tout seul. `<abbr title>` porte
                  l'**expansion** de l'abréviation, et rien d'autre : y répéter
                  « FT3 » ferait annoncer deux fois la même chose aux lecteurs
                  d'écran, qui lisent déjà le contenu visible. L'infobulle reste
                  un confort de souris — la fiche du tournoi donne la même
                  phrase en clair, sous la pastille de format.
                */}
                <abbr className={styles.matchFormat} title={matchFormatDescription(matchFormat)}>
                  {matchFormatLabel(matchFormat)}
                </abbr>
              </>
            )}
          </div>

          <div className={styles.team}>
            <TeamSigil letter={sigilFor(currentMatch.team2Name)} color="var(--amber)" size={40} />
            <div className={styles.teamText}>
              <div className={styles.teamName}>
                <EntrantName href={currentMatch.team2Href} name={currentMatch.team2Name ?? "Équipe 2"} />
              </div>
              <div className="mono">FR · SEED 4</div>
            </div>
            <div className="num" style={{ fontSize: 30 }}>{currentMatch.team2Score ?? "—"}</div>
          </div>
        </div>
      ) : (
        <div className={styles.match}>
          <div className={styles.emptyMatch}>Le prochain match en direct sera affiché ici dès son lancement.</div>
        </div>
      )}

      <div className={styles.map}>
        <span>CARTE EN COURS</span>
        <span>—</span>
      </div>
    </CyberCard>
  );
}
