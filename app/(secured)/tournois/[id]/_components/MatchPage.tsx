"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { PlayerLink } from "@/components/entity-link";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useSpectatorView } from "@/components/spectator-view";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { KeyFacts, type KeyFact } from "@/components/cyber/KeyFacts";
import { CasterCards, RefereeCard } from "@/components/match-launch/LaunchContactCards";
import { useMatchContacts } from "@/components/match-launch/MatchContactsDialog";
import { useLaunchText } from "@/components/match-launch/launch-text";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { MATCH_LAUNCH_REFRESH_EVENT, type MatchLaunchInfo, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import {
  firstMapFieldFollows,
  matchPageDecision,
  matchPageSides,
  matchPageStreams,
  selfManagementSteps,
  OW_SELF_MANAGEMENT_SETTINGS,
  type MatchPageSide,
} from "@/lib/shared/match-page";
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { FIRST_MAP_MAX_LENGTH, normalizeFirstMap, refereeNameOf } from "@/lib/shared/match-referee";
import { isMatchCastable, requiresMatchStartAt, streamLinkText, type MatchLiveState } from "@/lib/shared/live-streams";
import { formatMatchStartAt, formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import {
  localizedPlaceholder,
  matchFormatDescriptionText,
  matchFormatText,
  matchPositionText,
  versusText,
} from "@/lib/shared/tournament-page-text";
import { canPickMatchMap, firstBanOrder, roundMapsOf } from "@/lib/shared/round-maps";
import type { BracketMatch, TournamentDetail, TournamentGame } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { useMatchCardModel } from "../_lib/match-card-model";
import { useMatchFormat } from "../_lib/match-format-context";
import { useMatchPageText } from "../_lib/match-page-text";
import { matchPageHeaderScore, matchPageMapFacts, type MatchPageMapFact } from "../_lib/match-page-facts";
import { matchSideViews } from "../_lib/match-row-sides";
import { EntrantName, type EntrantLogoSize } from "./EntrantName";
import { MatchCardActions } from "./MatchCardActions";
import { LaunchPhaseBadge, hasLaunchPhaseBadge } from "./MatchLaunchStrip";
import { MapResultList } from "./MatchMapDetails";
import { MatchReplayStrip } from "./MatchReplayStrip";
import { MatchRoundMaps } from "./MatchRoundMaps";
import { StreamLink } from "./MatchLiveStrip";
import { MatchPageScope } from "../_lib/match-page-context";
import { useRoundMapsText } from "../_lib/round-maps-text";
import styles from "./MatchPage.module.css";

const FIRST_MAP_FIELD_ERRORS = { INVALID_FIRST_MAP: "map" } as const;

/**
 * Côté de la page, avec le repli de sa case vide — celui de la carte
 * (`matchSideViews`) : « BYE » au premier tour face à une engagée, « TBD » sinon.
 */
type PageSide = MatchPageSide & { emptyLabel: "BYE" | "TBD" };

/** Côtés de la page (`matchPageSides`, hôte à gauche), chacun avec le repli de sa case vide. */
function pageSides(match: BracketMatch): [PageSide, PageSide] {
  const views = matchSideViews(match, match.roundNumber, false);
  const [left, right] = matchPageSides(match);
  return [
    { ...left, emptyLabel: views[left.slot - 1].emptyLabel },
    { ...right, emptyLabel: views[right.slot - 1].emptyLabel },
  ];
}

/** Nom d'un côté (ou de sa case vide), dans la langue de la page. */
function useSideName(side: PageSide | null): string {
  const text = useTournamentPageText();
  if (side === null) return text.t("match.tbd");
  const empty = text.t(side.emptyLabel === "BYE" ? "match.bye" : "match.tbd");
  return side.name ?? localizedPlaceholder(text, side.placeholder) ?? empty;
}

/** Un engagé de la page, son emblème compris, cliquable vers sa fiche (`EntrantName`). */
function SideName({
  side,
  logoSize,
  className,
  truncate = false,
}: Readonly<{ side: PageSide; logoSize: EntrantLogoSize; className?: string; truncate?: boolean }>) {
  const name = useSideName(side);
  return <EntrantName teamId={side.teamId} name={name} title={name} logoSize={logoSize} truncate={truncate} className={className} />;
}

/**
 * Première carte, saisie en place par le staff (permission `tournaments`) —
 * même route que la fenêtre « Arbitrage » (`PUT /api/admin/matches/[id]/first-map`).
 * Le bouton reste focalisable pendant l'envoi (`aria-disabled`, `aria-busy`).
 */
function FirstMapForm({ match }: Readonly<{ match: Pick<BracketMatch, "id" | "firstMap"> }>) {
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { t } = useTournamentPageText();
  const { showError, showSuccess } = useToast();
  const inputId = useId();
  const [value, setValue] = useState(match.firstMap ?? "");
  const [busy, setBusy] = useState(false);
  const fieldErrors = useFieldErrors(FIRST_MAP_FIELD_ERRORS, { map: inputId });
  // Une carte posée ailleurs (autre membre du staff, fenêtre « Arbitrage »)
  // remplace la saisie tant qu'elle n'a pas été modifiée ici. Après un
  // enregistrement, la saisie reste jusqu'à ce que le plateau relu la porte :
  // sinon l'ancienne carte revenait dans le champ jusqu'au prochain instantané.
  const [edited, setEdited] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!firstMapFieldFollows(match.firstMap, edited, saved)) return;
    setSaved(null);
    setEdited(false);
    setValue(match.firstMap ?? "");
  }, [match.firstMap, edited, saved]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/first-map`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ map: value.trim() === "" ? null : value }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      // Comparée à la carte relue telle que le serveur l'enregistre.
      setSaved(normalizeFirstMap(value) ?? "");
      showSuccess(actionText.t("cardActions.refereeDialog.mapSaved"));
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
    } catch (error) {
      const code = (error as Error).message;
      const message = launchErrorText(actionText, errorsText, code);
      fieldErrors.report(code, message);
      showError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.mapForm} onSubmit={(event) => void save(event)} aria-busy={busy}>
      <div className={`field ${styles.mapField}`}>
        <label htmlFor={inputId}>{t("matchPage.firstMap")}</label>
        <input
          id={inputId}
          type="text"
          value={value}
          maxLength={FIRST_MAP_MAX_LENGTH}
          readOnly={busy}
          onChange={(event) => {
            setValue(event.target.value);
            setEdited(true);
            setSaved(null);
            fieldErrors.clear("map");
          }}
          {...fieldErrors.aria("map")}
        />
        <FieldErrorText fieldId={inputId} message={fieldErrors.message("map")} />
      </div>
      <button type="submit" className="btn ghost" aria-disabled={busy || undefined}>
        {actionText.t("cardActions.refereeDialog.mapSave")}
      </button>
    </form>
  );
}

/** Copie d'un BattleTag ou d'un tag Discord, notifiée en bas à gauche. */
function useCopy() {
  const { t } = useLaunchText();
  const { showError, showSuccess } = useToast();
  return async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(t("copied", { label }));
    } catch {
      showError(t("copyFailed"));
    }
  };
}

/** Le lecteur, partie du match, peut-il déclarer son « Prêt » (donc choisir une carte en autogestion) ? */
function canDeclareFor(launch: MatchLaunchInfo | null): boolean {
  if (!launch) return false;
  return (launch.viewer.role === "TEAM1" || launch.viewer.role === "TEAM2") && launch.viewer.canDeclareReady;
}

/** Titre d'une section de la page, au gabarit des blocs de la fiche. */
function SectionTitle({ id, children }: Readonly<{ id: string; children: ReactNode }>) {
  return (
    <div className="ds-section-title blue">
      <h2 id={id}>{children}</h2>
    </div>
  );
}

/**
 * En-tête du match : situation (tournoi · phase · manche · match), titre
 * « A contre B », tableau d'affichage (emblèmes, noms cliquables, score —
 * l'hôte à gauche, comme en jeu), puis l'état : terminé et vainqueur, horaire,
 * diffusion, rediff et proposition de score en attente.
 */
function MatchHeader({
  detail,
  match,
  sides,
  liveState,
  reportNotice,
}: Readonly<{
  detail: TournamentDetail;
  match: BracketMatch;
  sides: [PageSide, PageSide];
  liveState: MatchLiveState;
  reportNotice: string | null;
}>) {
  const text = useTournamentPageText();
  const { t, locale } = text;
  const page = useMatchPageText();
  const { canManage, canSchedule } = useLiveControls();
  const [left, right] = sides;
  const leftName = useSideName(left);
  const rightName = useSideName(right);
  const doubleForfeit = isMatchDoubleForfeit(match);
  const score = matchPageHeaderScore(match, sides, doubleForfeit);
  const phaseName = detail.phases?.find((item) => item.id === match.phaseId)?.name ?? null;
  const startAt = formatMatchStartAtFull(match.startAt, locale);
  const winner = sides.find((side) => side.teamId !== null && side.teamId === match.winnerTeamId) ?? null;
  const winnerName = useSideName(winner);
  // Même alerte que le bandeau d'horaire de la carte : un match casté à son
  // heure de début, sans date, ne passera jamais à l'antenne.
  const missingStartAt =
    requiresMatchStartAt(match.liveTrigger) &&
    formatMatchStartAt(match.startAt) === null &&
    isMatchCastable(match) &&
    (canManage || canSchedule);
  const completed = match.status === "COMPLETED";

  return (
    <header className={styles.header}>
      <p className={styles.meta}>
        {[detail.card.name, phaseName, matchPositionText(text, match)].filter(Boolean).join(" · ")}
      </p>
      {/* Dans l'ordre du tableau d'affichage : l'hôte d'abord, à gauche. */}
      <h1 className={styles.title}>{versusText(text, leftName, rightName)}</h1>
      <div className={styles.scoreboard}>
        <div className={styles.team} data-position="left" data-winner={winner === left ? "" : undefined}>
          <SideName side={left} logoSize={40} className={styles.teamName} />
        </div>
        {score ? (
          <p className={styles.score}>
            <span aria-hidden="true" className="num">
              {score.left} – {score.right}
            </span>
            <span className="sr-only">
              {page.t("header.scoreLabel", { team1: leftName, score1: score.left, team2: rightName, score2: score.right })}
            </span>
          </p>
        ) : (
          <span className={styles.versus} aria-hidden="true">
            {page.t("header.versus")}
          </span>
        )}
        <div className={styles.team} data-position="right" data-winner={winner === right ? "" : undefined}>
          <SideName side={right} logoSize={40} className={styles.teamName} />
        </div>
      </div>
      <div className={styles.status}>
        {completed && <span className="pill pill-success">{page.t("header.completed")}</span>}
        {completed && winner && <span className={styles.statusText}>{page.t("header.winner", { team: winnerName })}</span>}
        {isMatchDrawn(match) && <span className="pill pill-neutral">{t("match.draw")}</span>}
        {doubleForfeit && <span className="pill pill-warning">{t("match.doubleForfeit")}</span>}
        {startAt && (
          <span className={styles.statusText}>
            <span aria-hidden="true">🕑</span> {page.t("header.startAt", { date: startAt })}
          </span>
        )}
        {/* Le rouge ne sert qu'à ce qui est réellement à l'antenne (`LIVE_STREAMS.md`). */}
        {liveState === "LIVE" && (
          <span className="pill pill-live">
            <span aria-hidden="true">●</span> {page.t("header.liveNow")}
          </span>
        )}
        {liveState === "SCHEDULED" && <span className="pill pill-info">{page.t("header.castAnnounced")}</span>}
        {missingStartAt && (
          <span className="pill pill-warning" title={t("launch.missingDateTitle")}>
            <span aria-hidden="true">⚠</span>
            <span className="sr-only">{t("launch.missingDateSr")}</span> {page.t("header.missingDate")}
          </span>
        )}
      </div>
      <MatchReplayStrip match={match} />
      {reportNotice && <p className={styles.reportNotice}>{reportNotice}</p>}
    </header>
  );
}

/** Valeur d'un fait clé sans réponse encore (adversaires à venir, carte pas choisie…). */
function Muted({ children }: Readonly<{ children: ReactNode }>) {
  return <span className={styles.muted}>{children}</span>;
}

/** Décision d'arbitrage en valeur de fait clé, son explication derrière le « i » (`INFO_HINTS.md`). */
function DecisionValue({ value, subject, hintId, hint }: Readonly<{ value: ReactNode; subject: string; hintId: string; hint: string }>) {
  return (
    <InfoHintRow>
      {value}
      <InfoHint id={hintId} subject={subject}>
        <p>{hint}</p>
      </InfoHint>
    </InfoHintRow>
  );
}

/** Fait « Arbitre » / « Arbitrage » selon la décision (`matchPageDecision`) ; rien sur un match sans objet. */
function useOfficiatingFact(match: BracketMatch, decision: ReturnType<typeof matchPageDecision>, hintId: string): KeyFact | null {
  const { t } = useTournamentPageText();
  const page = useMatchPageText();
  const { refereeNames } = useLiveControls();
  const refereeName = refereeNameOf(match, refereeNames);
  if (decision === "REFEREE") {
    return {
      id: "officiating",
      label: page.t("facts.referee"),
      // Pseudo de l'arbitre pour un membre connecté (décision 52), « Arbitre
      // désigné » sans compte, ou tant que le pseudo de la désignation manque.
      value: (
        <DecisionValue
          value={<strong>{refereeName ?? page.t("facts.refereeDesignated")}</strong>}
          subject={t("launch.referee")}
          hintId={`${hintId}-referee`}
          hint={t("matchPage.refereeLead")}
        />
      ),
    };
  }
  if (decision === "SELF_MANAGED") {
    return {
      id: "officiating",
      label: page.t("facts.officiating"),
      value: (
        <DecisionValue
          value={<strong>{t("launch.selfManaged")}</strong>}
          subject={t("launch.selfManaged")}
          hintId={`${hintId}-self`}
          hint={t("launch.selfManagedTitle")}
        />
      ),
    };
  }
  if (decision === "UNDECIDED") {
    return {
      id: "officiating",
      label: page.t("facts.officiating"),
      value: (
        <DecisionValue
          value={<span className="pill pill-warning">{t("matchPage.undecided")}</span>}
          subject={t("matchPage.undecided")}
          hintId={`${hintId}-undecided`}
          hint={t("matchPage.undecidedLead")}
        />
      ),
    };
  }
  return null;
}

/** Maps du tour dans les faits clés : « Map 1 : Ilios · imposée », pool à choisir, choix du perdant. */
function MapFactList({ mapFacts }: Readonly<{ mapFacts: readonly MatchPageMapFact[] }>) {
  const page = useMatchPageText();
  return (
    <ol className={styles.factList}>
      {mapFacts.map((slot) => (
        <li key={slot.number}>
          {slot.map !== null && page.t("facts.mapSlot", { number: slot.number, map: slot.map })}
          {slot.map === null && slot.candidates.length > 0 && (
            <Muted>{page.t("facts.mapPool", { number: slot.number, maps: slot.candidates.join(", ") })}</Muted>
          )}
          {slot.map === null && slot.candidates.length === 0 && <Muted>{page.t("facts.mapOpen", { number: slot.number })}</Muted>}
          {slot.imposed && <span className={styles.factNote}> · {page.t("facts.mapImposed")}</span>}
          {slot.loserPick && <span className={styles.factNote}> · {page.t("facts.loserPick")}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Faits clés du match, au gabarit de l'en-tête des pages de règles
 * (`KeyFacts`) : chacun titré en toutes lettres — hôte, premier ban, arbitre ou
 * autogestion, maps, format, côtés, casters, lancement. Rien de nouveau n'est
 * lu : ce sont les champs de l'instantané que la carte montrait déjà, et le
 * pseudo de l'arbitre aux seuls membres connectés (`refereeNameOf`).
 */
function MatchKeyFacts({
  detail,
  match,
  sides,
  phase,
  staff,
}: Readonly<{
  detail: TournamentDetail;
  match: BracketMatch;
  sides: [PageSide, PageSide];
  phase: MatchLaunchPhase;
  staff: boolean;
}>) {
  const text = useTournamentPageText();
  const { t } = text;
  const page = useMatchPageText();
  const spectator = useSpectatorView();
  const hintId = useId();
  const format = useMatchFormat(match);
  const [left, right] = sides;
  const leftName = useSideName(left);
  const rightName = useSideName(right);
  const hostSide = sides.find((side) => side.host) ?? null;
  const banSide = sides.find((side) => side.firstBan) ?? null;
  const decision = matchPageDecision(match, staff);
  const mapFacts = matchPageMapFacts(detail.mapRules, match);
  const pending = <Muted>{t("matchPage.opponentsPending")}</Muted>;
  // « Adversaires à venir » seulement quand une case attend encore son engagé ;
  // deux adversaires connus sans hôte désigné (lancement sans phase, exemption,
  // match clos) : le fait se tait, comme l'ancienne pastille.
  const opponentsPending = match.team1Id === null || match.team2Id === null;

  const facts: KeyFact[] = [];
  if (hostSide || opponentsPending) {
    facts.push({
      id: "host",
      label: page.t("facts.host"),
      value: hostSide ? <SideName side={hostSide} logoSize={20} /> : pending,
      detail: hostSide ? page.t("facts.hostDetail") : undefined,
    });
  }
  if (banSide || opponentsPending) {
    facts.push({
      id: "firstBan",
      label: page.t("facts.firstBan"),
      value: banSide ? <SideName side={banSide} logoSize={20} /> : pending,
    });
  }
  const officiating = useOfficiatingFact(match, decision, hintId);
  if (officiating) facts.push(officiating);
  if (mapFacts.length > 0) {
    facts.push({
      id: "maps",
      label: page.t("facts.maps"),
      wide: mapFacts.length > 1,
      value: (
<MapFactList mapFacts={mapFacts} />
      ),
    });
  } else {
    facts.push({
      id: "maps",
      label: t("matchPage.firstMap"),
      value: match.firstMap ?? <Muted>{t("matchPage.firstMapUnset")}</Muted>,
    });
  }
  facts.push({
    id: "format",
    label: page.t("facts.format"),
    // Le détail du format est une explication : derrière le « i » (`INFO_HINTS.md`).
    value: format ? (
      <DecisionValue
        value={matchFormatText(text, format)}
        subject={page.t("facts.format")}
        hintId={`${hintId}-format`}
        hint={capitalize(matchFormatDescriptionText(text, format))}
      />
    ) : (
      matchFormatText(text, format)
    ),
  });
  // Règlement §14 : l'équipe du haut (l'hôte) prend le côté gauche.
  if (hostSide) {
    facts.push({
      id: "sides",
      label: page.t("facts.sides"),
      value: (
        <span className={styles.factLines}>
          <span>{page.t("facts.sideLeft", { team: leftName })}</span>
          <span>{page.t("facts.sideRight", { team: rightName })}</span>
        </span>
      ),
    });
  }
  facts.push({
    id: "casters",
    label: page.t("facts.casters"),
    value:
      match.casters.length === 0 ? (
        <Muted>{page.t("facts.noCaster")}</Muted>
      ) : (
        <span className={styles.factLines}>
          {match.casters.map((caster, index) => (
            <span key={`${index}:${caster.userId}`}>
              {/* Sans compte, l'identifiant du caster est masqué (négatif,
                  `spectatorSnapshot`) : son pseudo seul, sans lien vers une fiche. */}
              {caster.userId > 0 ? <PlayerLink userId={caster.userId}>{caster.pseudo}</PlayerLink> : caster.pseudo}
              {/* Sans compte, aucun « Prêt » n'est servi : pas d'« attendu » trompeur. */}
              {phase === "LOBBY" && !spectator && (
                <span className={caster.ready ? styles.ok : styles.factNote}>
                  {" · "}
                  {caster.ready ? t("launch.casterReady") : t("launch.casterWaiting")}
                </span>
              )}
            </span>
          ))}
        </span>
      ),
  });
  if (hasLaunchPhaseBadge(match, phase)) {
    facts.push({ id: "launch", label: page.t("facts.launch"), value: <LaunchPhaseBadge match={match} phase={phase} /> });
  }
  // Les ordres de bans se lisent sous « Maps et bans » ; ici, l'équipe qui ouvre.
  return (
    <section className={styles.factsBlock} aria-label={page.t("facts.label")}>
      <KeyFacts facts={facts} />
    </section>
  );
}

/** Première lettre en capitale : la description du format se lit d'ordinaire après sa notation. */
function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

/**
 * Maps et bans : l'ordre des bans de la carte 1 et la règle des suivantes,
 * puis — pour qui peut agir — le choix dans les pools et les outils du staff
 * (cartes du tour, première map). Le rappel du tri par rôle d'un match casté.
 */
function MapsSection({
  detail,
  match,
  sides,
  staff,
  editable,
  canPick,
}: Readonly<{
  detail: TournamentDetail;
  match: BracketMatch;
  sides: [PageSide, PageSide];
  staff: boolean;
  editable: boolean;
  canPick: boolean;
}>) {
  const { t } = useTournamentPageText();
  const page = useMatchPageText();
  const titleId = useId();
  const [left, right] = sides;
  const banSide = sides.find((side) => side.firstBan) ?? null;
  const banName = useSideName(banSide ?? left);
  const otherName = useSideName(banSide === right ? left : right);
  const rm = useRoundMapsText();
  const rules = detail.mapRules;
  // Ordre des bans de la carte 1 (règlement §10) : les deux équipes bannissent.
  const banOrder = firstBanOrder(rules.firstBan, match.hostTeamId, match.team1Id, match.team2Id);
  // Une carte 1 réglée pour la manche (imposée ou pool) remplace la saisie libre.
  const firstSlotSet = (roundMapsOf(rules.rounds, match)?.slots.length ?? 0) > 0;
  const picking = canPick && editable;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <SectionTitle id={titleId}>{page.t("sections.maps")}</SectionTitle>
      <dl className={styles.rules}>
        <div>
          <dt>{rm.t("page.banOrder")}</dt>
          <dd>
            {banSide && banOrder ? (
              rm.t("page.banOrderValue", { first: banName, second: otherName })
            ) : (
              <Muted>{t("matchPage.opponentsPending")}</Muted>
            )}
          </dd>
        </div>
        <div>
          <dt>{rm.t("page.nextBans")}</dt>
          <dd className={styles.ruleText}>{rm.t(rules.nextBan === "WINNER" ? "page.nextBansWINNER" : "page.nextBansLOSER")}</dd>
        </div>
      </dl>
      {/* Les cartes se lisent dans les faits clés ; la liste ne revient ici que
          pour qui choisit dans un pool ou règle le tour. */}
      {(staff || picking) && (
        <MatchRoundMaps detail={detail} match={match} canPick={picking} staff={staff} />
      )}
      {staff && editable && !firstSlotSet && <FirstMapForm match={match} />}
      {match.casters.length > 0 && (
        <p className={styles.reminder}>
          <span aria-hidden="true">🎙</span> {t("matchPage.sortByRole")}
        </p>
      )}
    </section>
  );
}

/**
 * Arbitrage, en détail : la fiche de l'arbitre (aux lecteurs que sert la
 * lecture des contacts) ou l'aide-mémoire de l'autogestion. La décision
 * elle-même se lit dans les faits clés.
 */
function OfficiatingSection({
  match,
  game,
  staff,
  launch,
  onCopy,
  invitesByBattletag,
}: Readonly<{
  match: BracketMatch;
  game: TournamentGame;
  staff: boolean;
  launch: MatchLaunchInfo | null;
  onCopy: (value: string, label: string) => Promise<void>;
  /** Overwatch : on invite par BattleTag (`battletagRelevantFor`) ; ailleurs, ni BattleTag ni consigne. */
  invitesByBattletag: boolean;
}>) {
  const { t } = useTournamentPageText();
  const page = useMatchPageText();
  const titleId = useId();
  const decision = matchPageDecision(match, staff);
  const refereeCard = decision === "REFEREE" && launch?.referee ? launch.referee : null;
  if (refereeCard === null && decision !== "SELF_MANAGED") return null;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <SectionTitle id={titleId}>{page.t("sections.officiating")}</SectionTitle>
      {refereeCard && launch && (
        <RefereeCard
          referee={refereeCard}
          selfManaged={false}
          phase={launch.phase}
          onCopy={onCopy}
          linkNames
          battletagNote={invitesByBattletag ? t("matchPage.refereeBattletagNote") : undefined}
        />
      )}
      {decision === "SELF_MANAGED" && (
        <ol className={styles.steps} aria-label={t("matchPage.stepsLabel")}>
          {selfManagementSteps(match.casters.length).map((step) => (
            <li key={step}>
              {t(`matchPage.steps.${step}`)}
              {/* Réglages propres à Overwatch : rien à lister pour Marvel Rivals. */}
              {step === "settings" && game === "OW" && (
                <ul className={styles.stepSettings}>
                  {OW_SELF_MANAGEMENT_SETTINGS.map((setting) => (
                    <li key={setting}>{t(`matchPage.owSettings.${setting}`)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Cast et streams : chaque stream avec son lien et ses casters, puis les
 * contacts des casters — en Overwatch, leurs BattleTags à inviter ; ailleurs,
 * ni BattleTag (le serveur ne l'envoie pas) ni consigne d'invitation. Rien
 * sans stream ni contact : « Aucun caster » se lit dans les faits clés.
 */
function CastSection({
  match,
  matchLabel,
  launch,
  liveState,
  onCopy,
  invitesByBattletag,
}: Readonly<{
  match: BracketMatch;
  matchLabel: string;
  launch: MatchLaunchInfo | null;
  liveState: MatchLiveState;
  onCopy: (value: string, label: string) => Promise<void>;
  invitesByBattletag: boolean;
}>) {
  const { t } = useTournamentPageText();
  const page = useMatchPageText();
  const launchText = useLaunchText();
  const titleId = useId();
  const streams = matchPageStreams(match, liveState);
  // Deux liens au même texte (deux vidéos YouTube sans poignée) se distinguent
  // par leur numéro, dans le texte comme dans le nom accessible (WCAG 2.4.4).
  const linkTexts = streams.map((stream) => (stream.url ? streamLinkText(stream.url, t("match.channel")) : null));
  const sharedText = (index: number) =>
    linkTexts[index] !== null && linkTexts.filter((item) => item === linkTexts[index]).length > 1;
  const contacts = launch && launch.casters.length > 0 ? launch : null;
  if (streams.length === 0 && contacts === null) return null;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <SectionTitle id={titleId}>{page.t("sections.casts")}</SectionTitle>
      {streams.length > 0 && (
        <ul className={styles.streams}>
          {streams.map((stream, index) => (
            <li key={stream.id} className={styles.stream}>
              <span className={styles.streamLabel}>{t("matchPage.stream", { number: index + 1 })}</span>
              {stream.url ? (
                <StreamLink
                  url={stream.url}
                  matchLabel={matchLabel}
                  className={styles.streamLink}
                  ordinal={sharedText(index) ? index + 1 : undefined}
                />
              ) : (
                <Muted>{t("matchPage.noLink")}</Muted>
              )}
              {stream.casters.length > 0 && (
                <span className={styles.streamCasters}>
                  <span aria-hidden="true">🎙</span>
                  <span className="sr-only">{t("launch.casterSr")}</span>
                  {stream.casters.map((caster, casterIndex) => (
                    <span key={caster.userId}>
                      {casterIndex > 0 && ", "}
                      {/* Sans compte, l'identifiant du caster est masqué (négatif,
                          `spectatorSnapshot`) : son pseudo seul, sans lien vers une fiche. */}
                      {caster.userId > 0 ? (
                        <PlayerLink userId={caster.userId}>{caster.pseudo}</PlayerLink>
                      ) : (
                        <span>{caster.pseudo}</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {contacts && (
        <div className={styles.castContacts}>
          <h3 className={styles.subTitle}>
            {t(invitesByBattletag ? "matchPage.castersToInvite" : "matchPage.castersContacts")}
          </h3>
          <CasterCards
            casters={contacts.casters}
            phase={contacts.phase}
            onCopy={onCopy}
            laterText={launchText.t("contacts.casterLater")}
            linkNames
            battletagNote={invitesByBattletag ? t("matchPage.battletagRequired") : undefined}
          />
        </div>
      )}
    </section>
  );
}

/** Détail map par map d'un match joué : scores et codes de replay (ceux-ci aux seuls membres). */
function ResultSection({ match, sides }: Readonly<{ match: BracketMatch; sides: [PageSide, PageSide] }>) {
  const { t } = useTournamentPageText();
  const page = useMatchPageText();
  const titleId = useId();
  // Les maps se lisent dans l'ordre du plateau (équipe 1, équipe 2) : les noms suivent.
  const team1 = useSideName(sides.find((side) => side.slot === 1) ?? null);
  const team2 = useSideName(sides.find((side) => side.slot === 2) ?? null);
  if (match.maps.length === 0) return null;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <SectionTitle id={titleId}>{page.t("sections.result")}</SectionTitle>
      <MapResultList maps={match.maps} team1Name={team1} team2Name={team2} label={t("match.maps.listLabel")} />
    </section>
  );
}

/**
 * Page d'un match (`docs/features/MATCH_PAGE.md`) : un en-tête (situation,
 * équipes, score, état), les faits clés au gabarit des pages de règles, puis
 * une grille de sections — les gestes de la carte du match (mêmes actions,
 * `useMatchCardModel`), le résultat map par map, maps et bans, l'arbitrage,
 * les casts. Rendue dans la fiche du tournoi (`TournamentSheet`), dont elle
 * partage le flux, les fenêtres et les droits du lecteur.
 */
export function MatchPage(props: Readonly<MatchPageProps>) {
  // Sous la page, les gestes tus sont ceux qui mènent à la page elle-même.
  return (
    <MatchPageScope value>
      <MatchPageContent {...props} />
    </MatchPageScope>
  );
}

type MatchPageProps = {
  detail: TournamentDetail;
  match: BracketMatch;
  adminResolvable: boolean;
  scoreLocked: boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  frozen: boolean;
  /** Témoin du flux de la fiche (« À jour », « Reconnexion… », « Hors ligne »). */
  status: ReactNode;
};

function MatchPageContent({ detail, match, adminResolvable, scoreLocked, onOpenAdminModal, frozen, status }: Readonly<MatchPageProps>) {
  const text = useTournamentPageText();
  const { t } = text;
  const page = useMatchPageText();
  const actionText = useActionsText();
  const spectator = useSpectatorView();
  const { canSchedule, myTeamId } = useLiveControls();
  const model = useMatchCardModel(match, adminResolvable, scoreLocked);
  const { liveState } = model;
  const actionsId = useId();
  // Les parties du match et le staff lisent ses contacts, comme sur la carte.
  const readsContacts = !spectator && !frozen && (model.launch.showContacts || model.launch.showOpen);
  const { launch } = useMatchContacts(match.id, match, readsContacts);
  const shownLaunch = readsContacts ? launch : null;
  const onCopy = useCopy();
  const sides = pageSides(match);
  const team1 = match.team1Name ?? localizedPlaceholder(text, match.team1Placeholder) ?? t("match.tbd");
  const team2 = match.team2Name ?? localizedPlaceholder(text, match.team2Placeholder) ?? t("match.tbd");
  const matchLabel = versusText(text, team1, team2);
  const editable = match.status !== "COMPLETED" && match.team1Id !== null && match.team2Id !== null;
  const invitesByBattletag = battletagRelevantFor(detail.card.game);
  const locked = adminResolvable && scoreLocked;

  return (
    <>
      <div className={styles.topbar}>
        {/* Le retour du site (`← Retour` de la fiche, même style) : un vrai lien
            qui ramène à la carte de ce match, dans la bonne vue (`MATCH_PAGE.md`). */}
        <LocaleLink href={tournamentMatchHref(detail.card.id, match.id, spectator)} className={`${styles.back} tap-target`}>
          <span aria-hidden="true">←</span> {t("matchPage.backToTournament")}
        </LocaleLink>
        {status}
      </div>

      <MatchHeader
        detail={detail}
        match={match}
        sides={sides}
        liveState={liveState}
        reportNotice={model.reportNotice}
      />

      <MatchKeyFacts detail={detail} match={match} sides={sides} phase={model.launchPhase} staff={canSchedule} />

      <div className={styles.grid}>
        <div className={styles.column}>
          {/* Les gestes de la carte du match, tous : la page ne reprend plus la
              carte, mais en offre exactement les actions (`useMatchCardModel`). */}
          {(model.actions.length > 0 || locked) && (
            <section className={`ds-block ${styles.block} ${styles.actions}`} aria-labelledby={actionsId}>
              <SectionTitle id={actionsId}>{page.t("sections.actions")}</SectionTitle>
              {model.actions.length > 0 && (
                <MatchCardActions
                  match={match}
                  phase={model.launchPhase}
                  actions={model.actions}
                  matchLabel={matchLabel}
                  isCaster={model.launch.isCaster}
                  releasesOthers={model.launch.releasesOthers}
                  onAir={liveState === "LIVE"}
                  onPlayerScore={model.openPlayerScore}
                  onAdminScore={() => onOpenAdminModal(match)}
                  onReport={model.openReport}
                />
              )}
              {locked && (
                <p className={styles.locked} title={actionText.t("cardActions.lockedTitle")}>
                  <span aria-hidden="true">🔒</span> {actionText.t("cardActions.locked")}
                  <span className="sr-only"> {actionText.t("cardActions.lockedReason")}</span>
                </p>
              )}
            </section>
          )}
          <ResultSection match={match} sides={sides} />
          <MapsSection
            detail={detail}
            match={match}
            sides={sides}
            staff={canSchedule && !frozen}
            editable={editable}
            canPick={
              !spectator &&
              !frozen &&
              canPickMatchMap({ staff: canSchedule, myTeamId, canDeclareReady: canDeclareFor(shownLaunch) }, match)
            }
          />
        </div>
        <div className={styles.column}>
          <OfficiatingSection
            match={match}
            game={detail.card.game}
            staff={canSchedule}
            launch={shownLaunch}
            onCopy={onCopy}
            invitesByBattletag={invitesByBattletag}
          />
          <CastSection
            match={match}
            matchLabel={matchLabel}
            launch={shownLaunch}
            liveState={liveState}
            onCopy={onCopy}
            invitesByBattletag={invitesByBattletag}
          />
        </div>
      </div>
    </>
  );
}
