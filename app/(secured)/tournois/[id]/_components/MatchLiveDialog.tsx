"use client";

import { FormEvent, useMemo, useState } from "react";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { fieldAria } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  canToggleOnAir,
  isMatchCastable,
  isValidStreamUrl,
  LIVE_PLATFORMS,
  MAX_STREAM_URL_LENGTH,
  requiresMatchStartAt,
  staffStream,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import {
  liveTriggerViewer,
  viewerMayChangeLiveTrigger,
  viewerMayUnmarkLiveTrigger,
} from "@/lib/shared/live-trigger-owner";
import { viewerRefereesMatch } from "@/lib/shared/match-referee";
import { canEditReplay } from "@/lib/shared/match-replay";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import { useActionsText } from "../_lib/actions-text";
import { useLiveControls } from "../_lib/live-context";
import { formatMatchStartAt } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { useOnAirToggle } from "../_lib/use-on-air-toggle";
import styles from "./MatchLiveDialog.module.css";
import { useDialogsText } from "../_lib/dialogs-text";
import { CastTriggerField } from "./CastSettingsFields";
import { TournamentDialogFrame } from "./TournamentDialogFrame";

interface MatchLiveDialogProps {
  match: BracketMatch;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Le lecteur parle pour l'organisation (permission `tournaments`) : il dit si
   * le lien est celui de l'organisation ou sa propre chaîne. Sans elle, le lien
   * est toujours le sien.
   */
  canSpeakForOrganisation: boolean;
}

/**
 * Les liens de casters que l'arbitre a **touchés** et qui diffèrent du lien
 * actuel (`undefined` : aucun). Un stream arrivé, ou dont le caster a changé
 * le lien, pendant que la fenêtre est ouverte n'est jamais renvoyé : seule une
 * saisie de l'arbitre devient une modification.
 */
export function casterLinkEdits(
  streams: readonly { id: number; liveUrl: string | null }[],
  typed: Readonly<Record<number, string>>,
): { streamId: number; liveUrl: string | null }[] | undefined {
  const edits = streams
    .filter((stream) => typed[stream.id] !== undefined)
    .map((stream) => ({ streamId: stream.id, liveUrl: typed[stream.id].trim() || null, current: stream.liveUrl }))
    .filter((edit) => edit.liveUrl !== edit.current)
    .map(({ streamId, liveUrl }) => ({ streamId, liveUrl }));
  return edits.length === 0 ? undefined : edits;
}

/**
 * Le mode choisi manque-t-il de la date de début qu'il exige ? Un mode
 * inchangé ne la redemande pas : le serveur l'accepte (date retirée depuis),
 * et les liens restent réglables.
 */
export function changedTriggerNeedsDate(
  current: MatchLiveTrigger | null,
  chosen: MatchLiveTrigger,
  startAtMissing: boolean,
): boolean {
  return chosen !== current && requiresMatchStartAt(chosen) && startAtMissing;
}

/** Ce qu'il faut d'un match pour dire s'il est encore castable. */
type ClosableMatch = Pick<BracketMatch, "status" | "liveTrigger" | "liveStartedAt" | "launchedAt">;

/**
 * Rien à enregistrer : le mode, verrouillé, est renvoyé tel quel, et le
 * serveur refuse tout mode sur un match qui n'est plus castable (score
 * déclaré) — seul qui tient le mode peut encore le retirer.
 */
export function lockedOnClosedMatch(
  triggerLocked: boolean,
  match: ClosableMatch,
): boolean {
  return triggerLocked && match.liveTrigger !== null && !isMatchCastable(match);
}

/**
 * La rediff depuis cette fenêtre : la seule `live` ne règle que celle de son
 * cast (`NOT_MATCH_CASTER` au serveur), le staff `tournaments` toutes.
 */
export function mayEditReplay(
  match: { casters: readonly { userId: number }[] },
  controls: { canManage: boolean; canSchedule: boolean; viewerUserId: number | null },
): boolean {
  if (!controls.canManage) return false;
  return controls.canSchedule || match.casters.some((caster) => caster.userId === controls.viewerUserId);
}

/** Aide du lien du staff : verrouillé par le mode d'un autre, ou réservé au staff. */
function StaffLinkHint({ staffSide, linkLocked }: Readonly<{ staffSide: boolean; linkLocked: boolean }>) {
  const { t } = useDialogsText();
  if (!staffSide) return <p>{t("live.urlStaffOnly")}</p>;
  return linkLocked ? <p>{t("live.urlLocked")}</p> : null;
}

/**
 * Le lien du staff dans la fenêtre : un lien changé ailleurs pendant qu'elle
 * est ouverte est repris par un champ **intouché**, pour ne pas renvoyer un
 * lien périmé ; une saisie en cours n'est jamais écrasée.
 */
function useResyncedStaffUrl(current: string) {
  const [liveUrl, setLiveUrl] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    if (liveUrl === seen) setLiveUrl(current);
  }
  /** Repart du lien actuel quoi qu'il y ait de saisi (le mode du match a changé). */
  const reset = () => {
    setSeen(current);
    setLiveUrl(current);
  };
  return [liveUrl, setLiveUrl, reset] as const;
}

type StreamedReason = "closed" | "orphan" | null;
type SaveReason = "locked" | "unchanged" | null;

/** Identifiant du « i » qui décrit « Enregistrer » désarmé ; absent quand il s'arme selon les saisies. */
function saveHintId(reason: SaveReason): string | undefined {
  return reason === null ? undefined : SAVE_HINT_ID;
}

/** Rangée qui dit pourquoi « Enregistrer » est désarmé, l'explication derrière un « i » ; rien quand il s'arme selon les saisies. */
function SaveBlockedHint({ reason }: Readonly<{ reason: SaveReason }>) {
  const { t } = useDialogsText();
  if (reason === null) return null;
  return (
    <div className={styles.saveHint}>
      <InfoHintRow>
        <span className={styles.saveNote}>{t("live.saveSubject")}</span>
        <InfoHint id={SAVE_HINT_ID} subject={t("live.saveSubject")}>
          <p>{t(reason === "locked" ? "live.saveClosedLocked" : "live.saveClosedUnchanged")}</p>
        </InfoHint>
      </InfoHintRow>
    </div>
  );
}

/**
 * Pourquoi « Enregistrer » est désarmé sur un match joué : le mode appartient à
 * un autre (`locked`), ou rien n'est à enregistrer (`unchanged`). `null` :
 * il s'arme selon les saisies.
 */
export function saveBlockedReason(
  match: ClosableMatch,
  triggerLocked: boolean,
  streamed: boolean,
  casterLinksEdited: boolean,
): SaveReason {
  if (lockedOnClosedMatch(triggerLocked, match)) return "locked";
  return closedMatchUnchanged(match, streamed, casterLinksEdited) ? "unchanged" : null;
}

/**
 * Pourquoi la case « casté » est grisée : le score est saisi sur un match
 * jamais casté (`closed`), ou un mode sans maître que ce lecteur ne peut pas
 * démarquer (`orphan`). `null` : la case se coche.
 */
export function streamedBoxReason(
  match: Pick<BracketMatch, "liveTrigger" | "liveTriggerCasterId">,
  disabled: boolean,
  castable: boolean,
): StreamedReason {
  if (!disabled) return null;
  return !castable && match.liveTrigger === null ? "closed" : "orphan";
}

/** La case « casté », son refus rattaché et, grisée, l'explication derrière un « i ». */
function StreamedBox({
  checked,
  reason,
  disabled,
  invalid,
  error,
  onChange,
}: Readonly<{
  checked: boolean;
  reason: StreamedReason;
  disabled: boolean;
  invalid: boolean;
  error: string | null;
  onChange: (checked: boolean) => void;
}>) {
  const { t } = useDialogsText();
  const label = (
    <label className={`${styles.streamed} ${styles.checkRow}`}>
      <input
        id={STREAMED_INPUT_ID}
        type="checkbox"
        checked={checked}
        // Un mode sans maître ne se démarque que par l'arbitre ou le staff
        // (`LIVE_TRIGGER_NOT_OWNED` au serveur) ; un match joué jamais casté ne
        // se marque plus (`MATCH_NOT_CASTABLE`) : case grisée, avec son « i ».
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...fieldAria(STREAMED_INPUT_ID, invalid, reason !== null && STREAMED_HINT_ID)}
      />
      {/* NOSONAR S6772 — label en flex avec `gap` */}
      {t("live.streamed")}
    </label>
  );
  return (
    <>
      {reason === null ? (
        label
      ) : (
        <InfoHintRow separated>
          {label}
          <InfoHint id={STREAMED_HINT_ID} subject={t("live.streamedSubject")}>
            <p>{t(reason === "closed" ? "live.streamedClosed" : "live.streamedOrphan")}</p>
          </InfoHint>
        </InfoHintRow>
      )}
      <FieldErrorText fieldId={STREAMED_INPUT_ID} message={error} />
    </>
  );
}

/**
 * La case « casté » est grisée quand elle ne mène qu'à un refus : un mode sans
 * maître (`LIVE_TRIGGER_NOT_OWNED`) ou un match joué jamais casté, qui ne se
 * marque plus (`MATCH_NOT_CASTABLE`).
 */
function streamedBoxDisabled(
  match: Pick<BracketMatch, "liveTrigger" | "liveTriggerCasterId">,
  viewer: Parameters<typeof viewerMayUnmarkLiveTrigger>[1],
  castable: boolean,
): boolean {
  return !viewerMayUnmarkLiveTrigger(match, viewer) || (!castable && match.liveTrigger === null);
}

/** Le champ du lien du staff : il suit le mode du match quand ce mode est verrouillé, la case sinon. */
function staffUrlShown(triggerLocked: boolean, liveTrigger: MatchLiveTrigger | null, streamed: boolean): boolean {
  return triggerLocked ? liveTrigger !== null : streamed;
}

/**
 * Le corps du réglage envoyé. Sur un match joué resté marqué (`castable`
 * faux, mode gardé), seuls les liens des casters partent : le mode et le lien
 * du staff restent tels quels (clés absentes), le serveur n'y prenant plus
 * que le démarquage. `organisationLink` absent : le lecteur ne le dit pas.
 */
export function matchLiveBody(input: {
  castable: boolean;
  trigger: MatchLiveTrigger | null;
  liveUrl: string;
  organisationLink: boolean | undefined;
  streamLinks: { streamId: number; liveUrl: string | null }[] | undefined;
}): Record<string, unknown> {
  const links = input.streamLinks === undefined ? {} : { streamLinks: input.streamLinks };
  if (!input.castable && input.trigger !== null) return links;
  return {
    trigger: input.trigger,
    liveUrl: input.trigger === null ? null : input.liveUrl.trim() || null,
    ...(input.organisationLink === undefined ? {} : { organisationLink: input.organisationLink }),
    ...links,
  };
}

/**
 * Match qui n'est plus castable (score déclaré ou confirmé) : le serveur n'y
 * prend plus que le démarquage (`MATCH_NOT_CASTABLE`). Le mode et le lien ne
 * s'y offrent plus ; un match resté marqué n'a rien à enregistrer tant que la
 * case « casté » reste cochée et qu'aucun lien de caster n'est corrigé.
 */
export function closedMatchUnchanged(
  match: ClosableMatch,
  streamed: boolean,
  casterLinksEdited: boolean,
): boolean {
  // Marqué et resté coché, ou jamais marqué (case grisée) : rien à enregistrer.
  return !isMatchCastable(match) && (streamed || match.liveTrigger === null) && !casterLinksEdited;
}

/**
 * Le lien du staff suit le mode d'un autre caster montré : lu, pas écrit, par
 * qui ne peut pas changer ce mode (décision 2, même règle que le serveur).
 */
export function staffLinkLocked(triggerLocked: boolean, match: Pick<BracketMatch, "liveTriggerCasterId">): boolean {
  return triggerLocked && (match.liveTriggerCasterId ?? null) !== null;
}

/**
 * Les streams des casters d'un match (jamais celui du staff), avec qui les
 * tient — « A, B et C » / "A, B, and C" par `list` (`Intl.ListFormat` de la
 * langue de la page).
 */
export function casterStreamsOf(
  match: Pick<BracketMatch, "streams" | "casters">,
  list: Pick<Intl.ListFormat, "format">,
): { id: number; liveUrl: string | null; casters: string }[] {
  return match.streams
    .filter((stream) => !stream.staff)
    .map((stream) => ({
      id: stream.id,
      liveUrl: stream.liveUrl,
      casters: list.format(match.casters.filter((caster) => caster.streamId === stream.id).map((caster) => caster.pseudo)),
    }));
}

/** Champ de la fenêtre que vise un refus : le lien du staff, ou le lien d'un stream de caster. */
type LiveField = "url" | "streamed" | `caster-${number}`;

/** Refus sans stream désigné : le lien du staff, ou la case « casté » d'un match qui ne l'est plus. */
const LIVE_FIELD_ERRORS = { INVALID_STREAM_URL: "url", MATCH_NOT_STREAMED: "streamed" } as const;

const URL_INPUT_ID = "match-live-url";
const STREAMED_INPUT_ID = "match-live-streamed";
const STREAMED_HINT_ID = "match-live-streamed-hint";
const SAVE_HINT_ID = "match-live-save-hint";

/** Identifiant du champ de lien d'un stream de caster. */
function casterLinkInputId(streamId: number): string {
  return `match-live-caster-link-${streamId}`;
}

/**
 * Le champ que vise un refus du serveur : le stream de caster qu'il nomme
 * (`streamId`, refus d'un lien de médiation), sinon `null` — le code seul dit
 * alors s'il vise le lien du staff (`LIVE_FIELD_ERRORS`).
 */
export function refusedCasterField(payload: { streamId?: unknown }): LiveField | null {
  const id = payload.streamId;
  return typeof id === "number" && Number.isInteger(id) ? `caster-${id}` : null;
}

/** Refus que la fenêtre formule elle-même (la table commune dit autre chose, ou rien d'utile ici). */
export function ownRefusalKey(code: string): "live.casterStreamGone" | "live.sessionExpired" | null {
  if (code === "STREAM_NOT_FOUND") return "live.casterStreamGone";
  return code === "UNAUTHORIZED" ? "live.sessionExpired" : null;
}

/**
 * Le refus a-t-il un champ où se rattacher ? La case « casté » n'existe pas
 * sous un mode verrouillé (`modeLocked`) : `MATCH_NOT_STREAMED` n'y vise rien.
 */
export function refusalHasField(code: string, modeLocked: boolean): boolean {
  return !(code === "MATCH_NOT_STREAMED" && modeLocked);
}

/** Refus du serveur qui garde le stream qu'il désigne. */
class LiveRefusal extends Error {
  constructor(
    code: string,
    readonly field: LiveField | null,
  ) {
    super(code);
  }
}

/**
 * Configuration de diffusion d'un match, pour le staff `tournaments` + `live`
 * et pour l'**arbitre désigné** de ce match (médiateur).
 *
 * Un match n'est jamais casté par défaut et n'hérite jamais de la chaîne
 * officielle du tournoi : le lien saisi ici est celui de la chaîne qui montre
 * **ce** match, éventuellement celle d'un streamer indépendant.
 *
 * Le mode d'antenne posé par un caster ne se change ici que par lui, l'arbitre
 * du match ou un admin (`mayChangeLiveTrigger`) : pour les autres il se lit
 * sans se modifier. L'arbitre seul corrige ou efface les liens des casters
 * (`docs/features/CAST_SETTINGS.md` § Médiation de l'arbitre).
 *
 * Voile, cadre et comportement modal : `TournamentDialogFrame`. `busy`
 * verrouille Échap pendant l'envoi : une modale en train d'écrire ne se
 * referme pas.
 */
export function MatchLiveDialog({
  match,
  onClose,
  onSaved,
  canSpeakForOrganisation,
}: Readonly<MatchLiveDialogProps>) {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const text = useDialogsText();
  const { t } = text;
  // Libellés déjà rédigés pour le pied d'action de la carte (antenne, rediff) :
  // les mêmes mots ici, dans le seul espace qui les porte.
  const actions = useActionsText();
  const controls = useLiveControls();
  const { openReplay, refereeNames } = controls;
  const referee = viewerRefereesMatch(match, refereeNames);
  // Même règle que le serveur (`LIVE_TRIGGER_NOT_OWNED`) : un mode verrouillé
  // se montre sans contrôle, plutôt qu'un bouton qui mène à un refus.
  const viewer = liveTriggerViewer(controls, referee);
  const triggerLocked = !viewerMayChangeLiveTrigger(match, viewer);
  // Le lien de l'organisation n'est réglé que par le staff `tournaments` ou
  // l'arbitre du match : la seule `live` le lit (`STAFF_STREAM_FORBIDDEN`).
  const staffSide = canSpeakForOrganisation || referee;
  const linkLocked = staffLinkLocked(triggerLocked, match) || !staffSide;
  const onAir = useMatchLiveState(match) === "LIVE";
  const [streamed, setStreamed] = useState(match.liveTrigger !== null);
  const [trigger, setTrigger] = useState<MatchLiveTrigger>(match.liveTrigger ?? "MANUAL");
  // Le lien du stream du staff, que ce réglage écrit — jamais celui qu'un
  // caster a ouvert (lecture partielle sans streams : le premier lien).
  const currentStaffUrl = (match.streams.length > 0 ? staffStream(match.streams)?.liveUrl : match.liveUrl) ?? "";
  const [liveUrl, setLiveUrl, resetLiveUrl] = useResyncedStaffUrl(currentStaffUrl);
  // Fausse par défaut (protection des données dès la conception) : un lien
  // n'est celui de l'organisation — gardé après la suppression du compte de qui
  // le pose — que si ce membre le coche ; rien ne se déduit de ce qu'il caste.
  const [organisationLink, setOrganisationLink] = useState(false);
  // Le mode du match changé pendant que la fenêtre est ouverte (retiré ou
  // reposé par qui le tient) : la case et le choix reprennent le mode du match.
  // Sans quoi la case « casté », cochée à l'ouverture sur un mode verrouillé,
  // le resterait une fois ce mode retiré — et Enregistrer recasterait le match.
  const [seenTrigger, setSeenTrigger] = useState(match.liveTrigger);
  // Médiation : les liens des streams des casters, que l'arbitre seul édite.
  const casterList = useMemo(() => new Intl.ListFormat(text.locale, { style: "long", type: "conjunction" }), [text.locale]);
  const casterStreams = referee ? casterStreamsOf(match, casterList) : [];
  // Seules les saisies de l'arbitre ; un champ intouché montre le lien actuel.
  const [casterLinks, setCasterLinks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // Un refus du serveur rattaché à son champ (`ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`).
  const fieldIds: Record<LiveField, string> = { url: URL_INPUT_ID, streamed: STREAMED_INPUT_ID };
  for (const stream of casterStreams) fieldIds[`caster-${stream.id}`] = casterLinkInputId(stream.id);
  const fieldErrors = useFieldErrors<LiveField>(LIVE_FIELD_ERRORS, fieldIds);
  if (seenTrigger !== match.liveTrigger) {
    // Les liens aussi : un mode retiré a effacé celui du staff, que la fenêtre
    // ne doit pas reposer à l'enregistrement ; les saisies des liens des
    // casters et leurs refus ne survivent pas à l'état qu'ils visaient.
    setSeenTrigger(match.liveTrigger);
    setStreamed(match.liveTrigger !== null);
    setTrigger(match.liveTrigger ?? "MANUAL");
    resetLiveUrl();
    setOrganisationLink(false);
    setCasterLinks({});
    fieldErrors.clear();
  }

  // Un match joué ne prend plus que le démarquage : ni mode ni lien à régler.
  const castable = isMatchCastable(match);
  // Mode verrouillé : le champ suit le mode du match, posé par un autre.
  const showUrl = castable && staffUrlShown(triggerLocked, match.liveTrigger, streamed);
  const urlTouched = liveUrl.trim().length > 0;
  // Conditionné au champ affiché : décocher la case n'envoie plus l'URL
  // (`liveUrl: null`) et démonte le champ. Sans cette garde, une saisie fautive
  // laissée derrière soi bloquerait le décochage avec un champ devenu invisible.
  const urlInvalid = showUrl && urlTouched && !isValidStreamUrl(liveUrl);
  // Seuls les liens saisis : un lien de caster déjà en base ne bloque pas l'envoi.
  const invalidCasterLink = casterStreams.some((stream) => {
    const value = (casterLinks[stream.id] ?? "").trim();
    return value !== "" && !isValidStreamUrl(value);
  });
  // « À la date de début » n'a pas de frontière à franchir sans date : le
  // serveur refuse ce couple en 409, l'interface le désactive en amont plutôt
  // que de laisser le staff buter dessus. La date se fixe avec la permission
  // `tournaments`, sur le bandeau du match.
  //
  // Conditionné à `streamed` : décocher « ce match est casté » envoie
  // `trigger: null`, que le serveur accepte toujours. Sans cette garde, un match
  // passé en `START_TIME` puis privé de sa date deviendrait indécastable — les
  // radios sont masquées quand la case est décochée, donc `trigger` resterait
  // bloqué sur `START_TIME` et « Enregistrer » sur désactivé.
  const startAtMissing = formatMatchStartAt(match.startAt, text.locale) === null;
  const triggerNeedsDate = !triggerLocked && streamed && changedTriggerNeedsDate(match.liveTrigger, trigger, startAtMissing);
  const platforms = LIVE_PLATFORMS.join(", ");
  // L'antenne d'un mode manuel suit la règle du mode (décision 2) : un
  // co-caster ne l'ouvre ni ne la coupe pour le caster qui l'a posé.
  const streamedDisabled = streamedBoxDisabled(match, viewer, castable);
  const saveReason = saveBlockedReason(match, triggerLocked, streamed, casterLinkEdits(casterStreams, casterLinks) !== undefined);
  const airToggle = canToggleOnAir(match) && viewerMayChangeLiveTrigger(match, viewer);

  /** Ouvre ou coupe l'antenne (mode manuel), sans quitter la fenêtre. */
  const toggleAir = useOnAirToggle(match.id, onAir, { setBusy, onDone: onSaved });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (urlInvalid || triggerNeedsDate || invalidCasterLink) return;

    // Mode verrouillé : renvoyé tel quel, le serveur n'y voit aucun changement.
    const chosenTrigger = streamed ? trigger : null;
    const sentTrigger = triggerLocked ? match.liveTrigger : chosenTrigger;
    const streamLinks = casterLinkEdits(casterStreams, casterLinks);
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/live`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          matchLiveBody({ castable, trigger: sentTrigger, liveUrl, organisationLink: canSpeakForOrganisation ? organisationLink : undefined, streamLinks }),
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; streamId?: unknown };
      if (!response.ok) throw new LiveRefusal(payload.error || "MATCH_LIVE_UPDATE_FAILED", refusedCasterField(payload));
      // « Retiré » seulement d'un mode qui était posé : corriger les liens des
      // casters d'un match sans mode n'en retire aucun.
      showSuccess(sentTrigger === null && match.liveTrigger !== null ? t("live.removed") : t("live.saved"));
      onSaved();
      onClose();
    } catch (error) {
      reportRefusal(error);
    } finally {
      setBusy(false);
    }
  };

  /** Un refus : notifié, et rattaché au champ qu'il désigne (lien d'un caster, sinon par son code). */
  const reportRefusal = (error: unknown) => {
    const code = (error as Error).message;
    // Le stream d'un caster disparu : la fenêtre n'a pas de choix de stream, elle se rouvre.
    const ownKey = ownRefusalKey(code);
    const message = ownKey === null ? mapError(code) : t(ownKey);
    showError(message);
    const field = error instanceof LiveRefusal ? error.field : null;
    if (field !== null && field in fieldIds) fieldErrors.flag(field, message);
    else if (refusalHasField(code, triggerLocked && match.liveTrigger !== null)) fieldErrors.report(code, message);
  };

  return (
    <TournamentDialogFrame
      titleId="match-live-title"
      maxWidth={460}
      zIndex={80}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <h3 id="match-live-title" className={styles.title}>
          {t("live.title")}
        </h3>
        <p className={styles.pairing}>
          {match.team1Name ?? t("schedule.tbd")} vs {match.team2Name ?? t("schedule.tbd")}
        </p>

        {triggerLocked && match.liveTrigger !== null ? (
          // Le mode verrouillé se lit sans contrôle, avec les mots des réglages du caster.
          <div className={styles.streamed}>
            <CastTriggerField trigger={match.liveTrigger} startAt={match.startAt} onChange={setTrigger} locked />
          </div>
        ) : (
          <StreamedBox
            checked={streamed}
            disabled={streamedDisabled}
            reason={streamedBoxReason(match, streamedDisabled, castable)}
            invalid={fieldErrors.invalidField === "streamed"}
            error={fieldErrors.message("streamed")}
            onChange={(next) => {
              setStreamed(next);
              fieldErrors.clear("streamed");
            }}
          />
        )}

        {showUrl && (
          <>
            {!triggerLocked && <CastTriggerField trigger={trigger} startAt={match.startAt} onChange={setTrigger} />}

            <div className="field">
              <InfoHintRow>
                <label htmlFor="match-live-url">{t("live.url")}</label>
                <InfoHint id="match-live-url-hint" subject={t("live.urlSubject")}>
                  <p>{t("live.urlHint", { platforms })}</p>
                  <StaffLinkHint staffSide={staffSide} linkLocked={linkLocked} />
                </InfoHint>
              </InfoHintRow>
              <input
                id={URL_INPUT_ID}
                value={liveUrl}
                readOnly={linkLocked}
                onChange={(e) => {
                  setLiveUrl(e.target.value);
                  fieldErrors.clear("url");
                }}
                maxLength={MAX_STREAM_URL_LENGTH}
                placeholder="https://twitch.tv/…"
                // Refus d'avance ou du serveur : lu avant l'aide (`fieldAria`).
                {...fieldAria(
                  URL_INPUT_ID,
                  urlInvalid || fieldErrors.invalidField === "url",
                  urlInvalid && "match-live-url-invalid",
                  "match-live-url-hint",
                )}
              />
              {urlInvalid && (
                <p id="match-live-url-invalid" className={styles.invalid}>
                  {t("live.urlInvalid", { platforms })}
                </p>
              )}
              <FieldErrorText fieldId={URL_INPUT_ID} message={fieldErrors.message("url")} />
              {canSpeakForOrganisation && urlTouched && !linkLocked && (
                <InfoHintRow inline>
                  <label className={`${styles.checkRow} ${styles.organisation}`}>
                    <input
                      type="checkbox"
                      checked={organisationLink}
                      onChange={(e) => setOrganisationLink(e.target.checked)}
                    />
                    {/* NOSONAR S6772 — label en flex avec `gap` */}
                    {t("live.organisationLink")}
                  </label>
                  <InfoHint id="match-live-org-hint" subject={t("live.organisationLinkSubject")}>
                    <p>{t("live.organisationLinkHint")}</p>
                  </InfoHint>
                </InfoHintRow>
              )}
            </div>
          </>
        )}

        {/* Médiation de l'arbitre : les liens des casters, corrigés ou effacés. */}
        {casterStreams.length > 0 && (
          <fieldset className={styles.casterLinks}>
            {/* Légende en texte seul (nom du groupe) ; l'aide, hors légende. */}
            <legend className="sr-only">{t("live.casterLinks")}</legend>
            <InfoHintRow>
              <span className={styles.casterLinksLegend} aria-hidden="true">
                {t("live.casterLinks")}
              </span>
              <InfoHint id="match-live-caster-links-hint" subject={t("live.casterLinksSubject")}>
                <p>{t("live.casterLinksHint")}</p>
              </InfoHint>
            </InfoHintRow>
            {casterStreams.map((stream) => {
              const typed = casterLinks[stream.id];
              const value = typed ?? stream.liveUrl ?? "";
              const invalid = typed !== undefined && typed.trim() !== "" && !isValidStreamUrl(typed);
              const field: LiveField = `caster-${stream.id}`;
              const inputId = casterLinkInputId(stream.id);
              return (
                <div className="field" key={stream.id}>
                  <label htmlFor={inputId}>
                    {t("live.casterLink", { casters: stream.casters || t("live.casterLinkNobody") })}
                  </label>
                  <input
                    id={inputId}
                    value={value}
                    onChange={(e) => {
                      setCasterLinks((links) => ({ ...links, [stream.id]: e.target.value }));
                      fieldErrors.clear(field);
                    }}
                    maxLength={MAX_STREAM_URL_LENGTH}
                    placeholder="https://twitch.tv/…"
                    {...fieldAria(inputId, invalid || fieldErrors.invalidField === field, invalid && `${inputId}-invalid`)}
                  />
                  {invalid && (
                    <p id={`${inputId}-invalid`} className={styles.invalid}>
                      {t("live.urlInvalid", { platforms })}
                    </p>
                  )}
                  <FieldErrorText fieldId={inputId} message={fieldErrors.message(field)} />
                </div>
              );
            })}
          </fieldset>
        )}

        {/* Antenne (mode manuel) et rediff : la carte ne les porte plus. */}
        {airToggle && (
          <div className={styles.section}>
            <button
              type="button"
              className={`${onAir ? "btn ghost" : "btn"} ${styles.sectionButton}`}
              disabled={busy}
              onClick={() => void toggleAir()}
            >
              {onAir ? actions.t("cardActions.stopLive") : actions.t("cardActions.startLive")}
            </button>
          </div>
        )}
        {canEditReplay(match, mayEditReplay(match, controls)) && (
          <div className={styles.section}>
            <button
              type="button"
              className={`btn ghost ${styles.sectionButton}`}
              disabled={busy}
              onClick={() => {
                // Une autre modale : celle-ci se ferme d'abord, les deux ne se
                // disputent pas le piège de focus.
                onClose();
                openReplay(match);
              }}
            >
              {match.replayUrl === null
                ? actions.t("cardActions.addReplay")
                : actions.t("cardActions.editReplay")}
            </button>
          </div>
        )}

        <SaveBlockedHint reason={saveReason} />
        <div className={styles.footer}>
          <button type="button" className={`btn ghost ${styles.sectionButton}`} onClick={onClose} disabled={busy}>
            {t("score.cancel")}
          </button>
          <button
            type="submit"
            className={`btn ${styles.submitButton}`}
            disabled={busy || urlInvalid || triggerNeedsDate || invalidCasterLink || saveReason !== null}
            aria-describedby={saveHintId(saveReason)}
          >
            {busy ? t("schedule.saving") : t("schedule.save")}
          </button>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
