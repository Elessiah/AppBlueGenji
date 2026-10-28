"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { PlayerLink } from "@/components/entity-link";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useSpectatorView } from "@/components/spectator-view";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { CasterCards, RefereeCard } from "@/components/match-launch/LaunchContactCards";
import { useMatchContacts } from "@/components/match-launch/MatchContactsDialog";
import { useLaunchText } from "@/components/match-launch/launch-text";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import { MATCH_LAUNCH_REFRESH_EVENT, type MatchLaunchInfo } from "@/lib/shared/match-launch";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import {
  firstMapFieldFollows,
  matchPageDecision,
  matchPageSides,
  matchPageStreams,
  selfManagementSteps,
  type MatchPageSide,
} from "@/lib/shared/match-page";
import { FIRST_MAP_MAX_LENGTH, normalizeFirstMap } from "@/lib/shared/match-referee";
import { streamLinkText } from "@/lib/shared/live-streams";
import { localizedPlaceholder, matchPositionText, versusText } from "@/lib/shared/tournament-page-text";
import { canPickMatchMap, firstBanOrder, roundMapsOf } from "@/lib/shared/round-maps";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";
import { launchStripControls } from "../_lib/launch-strip";
import { useLiveControls } from "../_lib/live-context";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { EntrantName } from "./EntrantName";
import { MatchRow } from "./MatchRow";
import { MatchRoundMaps } from "./MatchRoundMaps";
import { StreamLink } from "./MatchLiveStrip";
import { MatchPageScope } from "../_lib/match-page-context";
import styles from "./MatchPage.module.css";

const FIRST_MAP_FIELD_ERRORS = { INVALID_FIRST_MAP: "map" } as const;

/** Nom d'un côté (ou de sa case vide), dans la langue de la page. */
function useSideName(side: MatchPageSide): string {
  const text = useTournamentPageText();
  return side.name ?? localizedPlaceholder(text, side.placeholder) ?? text.t("match.tbd");
}

/** Un côté de la partie : l'engagé, sa place (gauche / droite) et son rôle à la création. */
function SideBlock({ side, position }: Readonly<{ side: MatchPageSide; position: "left" | "right" }>) {
  const { t } = useTournamentPageText();
  const name = useSideName(side);
  return (
    <div className={styles.side} data-position={position}>
      <span className={styles.sideLabel}>{t(position === "left" ? "matchPage.left" : "matchPage.right")}</span>
      <EntrantName teamId={side.teamId} name={name} title={name} logoSize={20} truncate className={styles.sideName} />
      <span className={styles.tags}>
        {side.host && <span className="pill pill-info">{t("matchPage.host")}</span>}
        {side.firstBan && <span className="pill pill-neutral">{t("matchPage.firstBan")}</span>}
      </span>
    </div>
  );
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

/** Création de la partie : côtés (hôte à gauche), première carte, premier ban, rappel du cast. */
function LobbySection({
  detail,
  match,
  sides,
  staff,
  editable,
  canPick,
}: Readonly<{
  detail: TournamentDetail;
  match: BracketMatch;
  sides: [MatchPageSide, MatchPageSide];
  staff: boolean;
  editable: boolean;
  canPick: boolean;
}>) {
  const { t } = useTournamentPageText();
  const titleId = useId();
  const [left, right] = sides;
  const banSide = sides.find((side) => side.firstBan) ?? null;
  const banName = useSideName(banSide ?? left);
  const otherName = useSideName(banSide === right ? left : right);
  const rules = detail.mapRules;
  // Ordre des bans de la carte 1 (règlement §10) : les deux équipes bannissent.
  const banOrder = firstBanOrder(rules.firstBan, match.hostTeamId, match.team1Id, match.team2Id);
  // Une carte 1 réglée pour la manche (imposée ou pool) remplace la saisie libre.
  const firstSlotSet = (roundMapsOf(rules.rounds, match)?.slots.length ?? 0) > 0;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <div className="ds-section-title blue">
        <h2 id={titleId}>{t("matchPage.sections.lobby")}</h2>
      </div>
      <div className={styles.sides}>
        <SideBlock side={left} position="left" />
        <span className={styles.versus} aria-hidden="true">
          {t("matchPage.vs")}
        </span>
        <SideBlock side={right} position="right" />
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>{t("matchPage.firstMap")}</dt>
          <dd>{match.firstMap ?? <span className={styles.muted}>{t("matchPage.firstMapUnset")}</span>}</dd>
        </div>
        <div>
          <dt>{t("matchPage.banOrder")}</dt>
          <dd>
            {banSide && banOrder ? (
              t("matchPage.banOrderValue", { first: banName, second: otherName })
            ) : (
              <span className={styles.muted}>{t("matchPage.opponentsPending")}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("matchPage.nextBans")}</dt>
          <dd className={styles.ruleText}>{t(rules.nextBan === "WINNER" ? "matchPage.nextBansWINNER" : "matchPage.nextBansLOSER")}</dd>
        </div>
      </dl>
      <MatchRoundMaps detail={detail} match={match} canPick={canPick && editable} staff={staff} />
      {staff && editable && !firstSlotSet && <FirstMapForm match={match} />}
      {match.casters.length > 0 && (
        <p className={styles.reminder}>
          <span aria-hidden="true">🎙</span> {t("matchPage.sortByRole")}
        </p>
      )}
    </section>
  );
}

/** Décision d'arbitrage : sa pastille, son explication derrière le « i » (`INFO_HINTS.md`). */
function DecisionLine({
  pill,
  subject,
  hintId,
  hint,
}: Readonly<{ pill: ReactNode; subject: string; hintId: string; hint: string }>) {
  return (
    <div className={styles.decision}>
      <InfoHintRow>
        {pill}
        <InfoHint id={hintId} subject={subject}>
          <p>{hint}</p>
        </InfoHint>
      </InfoHintRow>
    </div>
  );
}

/** Arbitrage : l'arbitre (nommé aux seules parties du match), l'autogestion et ses étapes, ou l'absence de décision (staff). */
function OfficiatingSection({
  match,
  staff,
  launch,
  onCopy,
}: Readonly<{
  match: BracketMatch;
  staff: boolean;
  launch: MatchLaunchInfo | null;
  onCopy: (value: string, label: string) => Promise<void>;
}>) {
  const { t } = useTournamentPageText();
  const titleId = useId();
  const decision = matchPageDecision(match, staff);
  if (decision === null) return null;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <div className="ds-section-title blue">
        <h2 id={titleId}>{t("matchPage.sections.officiating")}</h2>
      </div>
      {decision === "REFEREE" && (
        <>
          <DecisionLine
            pill={<span className="pill pill-info">{t("launch.referee")}</span>}
            subject={t("launch.referee")}
            hintId={`${titleId}-referee`}
            hint={t("matchPage.refereeLead")}
          />
          {launch?.referee && (
            <RefereeCard
              referee={launch.referee}
              selfManaged={false}
              phase={launch.phase}
              onCopy={onCopy}
              linkNames
              battletagNote={t("matchPage.refereeBattletagNote")}
            />
          )}
        </>
      )}
      {decision === "SELF_MANAGED" && (
        <>
          <DecisionLine
            pill={<span className="pill pill-info">{t("launch.selfManaged")}</span>}
            subject={t("launch.selfManaged")}
            hintId={`${titleId}-self`}
            hint={t("launch.selfManagedTitle")}
          />
          <ol className={styles.steps} aria-label={t("matchPage.stepsLabel")}>
            {selfManagementSteps(match.casters.length).map((step) => (
              <li key={step}>{t(`matchPage.steps.${step}`)}</li>
            ))}
          </ol>
        </>
      )}
      {decision === "UNDECIDED" && (
        <DecisionLine
          pill={<span className="pill pill-warning">{t("matchPage.undecided")}</span>}
          subject={t("matchPage.undecided")}
          hintId={`${titleId}-undecided`}
          hint={t("matchPage.undecidedLead")}
        />
      )}
    </section>
  );
}

/** Cast et streams : chaque stream avec son lien et ses casters, puis les BattleTags des casters à inviter. */
function CastSection({
  match,
  matchLabel,
  launch,
  onCopy,
}: Readonly<{
  match: BracketMatch;
  matchLabel: string;
  launch: MatchLaunchInfo | null;
  onCopy: (value: string, label: string) => Promise<void>;
}>) {
  const { t } = useTournamentPageText();
  const launchText = useLaunchText();
  const titleId = useId();
  const liveState = useMatchLiveState(match);
  const streams = matchPageStreams(match, liveState);
  // Deux liens au même texte (deux vidéos YouTube sans poignée) se distinguent
  // par leur numéro, dans le texte comme dans le nom accessible (WCAG 2.4.4).
  const linkTexts = streams.map((stream) => (stream.url ? streamLinkText(stream.url, t("match.channel")) : null));
  const sharedText = (index: number) =>
    linkTexts[index] !== null && linkTexts.filter((item) => item === linkTexts[index]).length > 1;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <div className="ds-section-title blue">
        <h2 id={titleId}>{t("matchPage.sections.casts")}</h2>
      </div>
      {streams.length === 0 ? (
        <p className={styles.muted}>{t("matchPage.noCaster")}</p>
      ) : (
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
                <span className={styles.muted}>{t("matchPage.noLink")}</span>
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
      {launch && launch.casters.length > 0 && (
        <div className={styles.castContacts}>
          <h3 className={styles.subTitle}>{t("matchPage.castersToInvite")}</h3>
          <CasterCards
            casters={launch.casters}
            phase={launch.phase}
            onCopy={onCopy}
            laterText={launchText.t("contacts.casterLater")}
            linkNames
            battletagNote={t("matchPage.battletagRequired")}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Page d'un match (`docs/features/MATCH_PAGE.md`) : la carte du match et tous
 * ses gestes, puis ce qu'il faut pour créer la partie — côtés (hôte à
 * gauche), première carte, premier ban —, l'arbitrage ou l'autogestion, les
 * streams avec leurs casters et, aux seules parties du match et au staff, les
 * BattleTags à inviter (même lecture que la modale « Contacts »). Rendue dans
 * la fiche du tournoi (`TournamentSheet`), dont elle partage le flux, les
 * fenêtres et les droits du lecteur.
 */
export function MatchPage({
  detail,
  match,
  adminResolvable,
  scoreLocked,
  onOpenAdminModal,
  frozen,
  status,
}: Readonly<{
  detail: TournamentDetail;
  match: BracketMatch;
  adminResolvable: boolean;
  scoreLocked: boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  frozen: boolean;
  /** Témoin du flux de la fiche (« À jour », « Reconnexion… », « Hors ligne »). */
  status: ReactNode;
}>) {
  const text = useTournamentPageText();
  const { t } = text;
  const spectator = useSpectatorView();
  const { canManage, canSchedule, viewerUserId, myTeamId, launchPhase, refereeScheduling } = useLiveControls();
  const phase = useMatchLaunchPhase({ ...match, refereeScheduling, launchPhase });
  const controls = launchStripControls(match, phase, { canManage, canSchedule, viewerUserId, myTeamId, launchPhase });
  // Les parties du match et le staff lisent ses contacts, comme sur la carte.
  const readsContacts = !spectator && !frozen && (controls.showContacts || controls.showOpen);
  const { launch } = useMatchContacts(match.id, match, readsContacts);
  const shownLaunch = readsContacts ? launch : null;
  const onCopy = useCopy();
  const sides = matchPageSides(match);
  const team1 = match.team1Name ?? localizedPlaceholder(text, match.team1Placeholder) ?? t("match.tbd");
  const team2 = match.team2Name ?? localizedPlaceholder(text, match.team2Placeholder) ?? t("match.tbd");
  const matchLabel = versusText(text, team1, team2);
  const phaseName = detail.phases?.find((item) => item.id === match.phaseId)?.name ?? null;
  const editable = match.status !== "COMPLETED" && match.team1Id !== null && match.team2Id !== null;

  return (
    <>
      <div className={styles.topbar}>
        <nav className={styles.crumbs} aria-label={t("matchPage.crumbsLabel")}>
          <LocaleLink href={tournamentMatchHref(detail.card.id, match.id, spectator)} className={`${styles.back} tap-target`}>
            <span aria-hidden="true">←</span> {detail.card.name}
          </LocaleLink>
        </nav>
        {status}
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>{matchLabel}</h1>
        <p className={styles.meta}>
          {[phaseName, matchPositionText(text, match)].filter(Boolean).join(" · ")}
        </p>
      </header>

      <section className={`ds-block ${styles.block}`} aria-label={t("matchPage.sections.match")}>
        <div className={styles.card}>
          <MatchPageScope value>
            <MatchRow
              match={match}
              adminResolvable={adminResolvable}
              onOpenAdminModal={onOpenAdminModal}
              scoreLocked={scoreLocked}
              roundNumber={match.roundNumber}
            />
          </MatchPageScope>
        </div>
      </section>

      <LobbySection
        detail={detail}
        match={match}
        sides={sides}
        staff={canSchedule && !frozen}
        editable={editable}
        canPick={!spectator && !frozen && canPickMatchMap({ staff: canSchedule, myTeamId }, match)}
      />
      <OfficiatingSection match={match} staff={canSchedule} launch={shownLaunch} onCopy={onCopy} />
      <CastSection match={match} matchLabel={matchLabel} launch={shownLaunch} onCopy={onCopy} />
    </>
  );
}
