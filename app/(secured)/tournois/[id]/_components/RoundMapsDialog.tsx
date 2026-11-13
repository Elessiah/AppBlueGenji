"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint } from "@/components/ui/info-hint";
import { NumberInput } from "@/components/ui/number-input";
import { MAP_POINT_TARGET_MAX, MAP_POINT_TARGET_MIN, roundPointsLocked, roundPointTargetOf } from "@/lib/shared/map-points";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import { FIRST_MAP_MAX_LENGTH } from "@/lib/shared/match-referee";
import { fieldErrorId, type FieldAria } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { filterOverwatchMaps } from "@/lib/shared/overwatch-maps";
import { visibleText } from "@/lib/shared/visible-text";
import {
  FIRST_BAN_RULES,
  NEXT_BAN_RULES,
  ROUND_MAP_SLOTS_MAX,
  ROUND_MAPS_BULK_MAX,
  ROUND_MAPS_FLUSH_ROUNDS_MAX,
  roundKeyId,
  roundKeysOf,
  roundMapsOf,
  roundMapsSummary,
  roundTiebreakOf,
  type FirstBanRule,
  type NextBanRule,
  type RoundKey,
  type RoundTiebreak,
} from "@/lib/shared/round-maps";
import { plannedRoundKeys, roundAllowsTiebreak, roundMaxMaps } from "@/lib/shared/round-plan";
import type { BracketType, TournamentDetail } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import {
  addMapToSlot,
  blocksImplicitSubmit,
  chunkRounds,
  findRound,
  firstTargetOverMax,
  focusIndexAfterRemoval,
  overwrittenRounds,
  removeMapFromSlot,
  resyncSlots,
  slotGap,
  slotHasMap,
  slotOverMax,
  slotsDirty,
  slotsToEdit,
  slotsToSave,
  toggleMapInSlot,
  vanishedRoundFallback,
  type SlotEdit,
  sameRoundKeys,
  storedRoundsSignature,
} from "../_lib/round-maps-editor";
import { useRoundMapsText, type RoundMapsText } from "../_lib/round-maps-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import styles from "./RoundMapsDialog.module.css";

/** Tours à proposer : générés, annoncés par le format, et déjà réglés (`round-plan.ts`). */
export function dialogRounds(detail: TournamentDetail): RoundKey[] {
  const card = detail.card;
  return plannedRoundKeys(
    {
      format: card.format,
      state: card.state,
      maxTeams: card.maxTeams,
      registeredTeams: card.registeredTeams,
      hasThirdPlaceMatch: card.hasThirdPlaceMatch,
      swissTotalRounds: detail.swiss?.totalRounds ?? null,
      enduranceMaxRounds: detail.endurance?.maxRounds ?? null,
      endurancePlayoffSize: detail.endurance?.playoffSize ?? null,
      phases: detail.phases ?? card.phases,
    },
    roundKeysOf(detail.matches),
    detail.mapRules.rounds,
  );
}

/** Tours de la fenêtre, référence conservée tant que la liste ne change pas (un instantané n'en change pas toujours). */
function useStableRounds(detail: TournamentDetail): RoundKey[] {
  const planned = useMemo(() => dialogRounds(detail), [detail]);
  const stable = useRef(planned);
  if (!sameRoundKeys(stable.current, planned)) stable.current = planned;
  return stable.current;
}

/** Libellé d'un tour : phase, tableau (hors tableau principal), numéro ; play-offs à part. */
function useRoundLabel(detail: TournamentDetail, t: RoundMapsText["t"]) {
  const pageText = useTournamentPageText();
  return (round: RoundKey) => {
    const playoff = detail.card.format === "BG_SURVIE" && round.roundNumber >= PLAYOFF_ROUND_OFFSET;
    return [
      detail.phases?.find((phase) => phase.id === round.phaseId)?.name ?? null,
      round.bracket === "UPPER" ? null : pageText.t(`page.bracketLabels.${round.bracket as BracketType}`),
      playoff
        ? t("dialog.playoffRoundN", { number: round.roundNumber - PLAYOFF_ROUND_OFFSET + 1 })
        : t("dialog.roundN", { number: round.roundNumber }),
    ]
      .filter(Boolean)
      .join(" · ");
  };
}

/**
 * Champs du tour qui portent un refus : la liste des cartes (refus du serveur ou
 * contrôle avant l'envoi), la cible d'une copie et le bouton « Appliquer à tous ».
 */
type RoundField = "slots" | "copy" | "applyAll";

/** Refus du serveur rattachés à la liste des cartes du tour (`useFieldErrors`). */
const SLOT_FIELD_ERRORS = { INVALID_ROUND_MAPS: "slots" } as const satisfies Record<string, RoundField>;

/**
 * La section « Map de départage » paraît sur un tour éligible, et **reste** sur
 * ce tour si l'éligibilité disparaît ensuite ; changer de tour l'oublie.
 */
function useTiebreakShown(round: RoundKey | null, allowed: boolean): boolean {
  const id = round ? roundKeyId(round) : null;
  const [shownFor, setShownFor] = useState<string | null>(null);
  // Ajustement d'état pendant le rendu (motif React prévu pour cela) : pas de réécriture d'une ref.
  let current = shownFor;
  if (current !== null && current !== id) current = null;
  if (allowed && id !== null) current = id;
  if (current !== shownFor) setShownFor(current);
  return current !== null;
}

/** Section « Map de départage » : paraît-elle, et quelles cartes périmées la suivent. */
function useTiebreakSection(
  stale: readonly RoundTiebreak[] | undefined,
  round: RoundKey | null,
  allowed: boolean,
): { showTiebreak: boolean; staleTiebreaks: readonly RoundTiebreak[] } {
  const showTiebreak = useTiebreakShown(round, allowed);
  const staleTiebreaks = useStaleTiebreaks(stale, round, showTiebreak && !allowed);
  return { showTiebreak, staleTiebreaks };
}

/** Témoin d'un formulaire modifié et pas encore enregistré, annoncé au lecteur d'écran. */
function UnsavedNote({ dirty, text }: Readonly<{ dirty: boolean; text: string }>) {
  return (
    // `<output>` : région d'état native, annoncée quand le témoin paraît.
    <output className={`${styles.muted} ${styles.unsaved}`}>{dirty ? text : ""}</output>
  );
}

type RunTask = (task: () => Promise<void>, onRefused?: (code: string, text: string) => void) => Promise<boolean>;

async function putJson(url: string, body: unknown): Promise<{ skipped?: unknown }> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; skipped?: unknown };
  if (!response.ok) throw new Error(payload.error || "UNKNOWN");
  return payload;
}

type Pending =
  | { kind: "reset" }
  | { kind: "switch"; id: string }
  | { kind: "close" }
  | { kind: "applyAll"; overwritten: number }
  | { kind: "copy"; target: RoundKey };

/**
 * Liste des cartes d'Overwatch pour un créneau : recherche, cases groupées par
 * mode, et saisie libre pour une carte absente. Marvel Rivals : saisie libre seule.
 */
function MapPicker({
  number,
  slot,
  overwatch,
  onEdit,
}: Readonly<{
  number: number;
  slot: readonly string[];
  overwatch: boolean;
  /** Rend `true` quand la carte est prise en compte : un refus laisse la saisie en place. */
  onEdit: (edit: (slot: readonly string[]) => SlotEdit) => boolean;
}>) {
  const { t } = useRoundMapsText();
  const ids = useId();
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const groups = overwatch ? filterOverwatchMaps(query) : [];
  // La liste vient de s'ouvrir : le focus va à son premier champ, il ne reste
  // pas sur le bouton qui la déclenche (ni sur une « Ajouter une carte » démontée).
  useEffect(() => {
    document.getElementById(`${ids}-${overwatch ? "search" : "custom"}`)?.focus();
  }, [ids, overwatch]);
  const addCustom = () => {
    if (onEdit((current) => addMapToSlot(current, custom))) setCustom("");
  };
  // Posé sur chaque champ, pas sur le conteneur : un `div` muni d'un gestionnaire
  // clavier passe pour un faux contrôle (Sonar S6848).
  const blockSubmit = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (blocksImplicitSubmit(event.key, event.currentTarget.type)) event.preventDefault();
  };
  return (
    <div className={styles.picker}>
      {overwatch && (
        <>
          <div className="field">
            <label htmlFor={`${ids}-search`}>{t("dialog.searchLabel")}</label>
            <input
              id={`${ids}-search`}
              type="search"
              value={query}
              placeholder={t("dialog.searchPlaceholder")}
              maxLength={FIRST_MAP_MAX_LENGTH}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={blockSubmit}
            />
          </div>
          {groups.length === 0 && <p className={styles.muted}>{t("dialog.noResult")}</p>}
          {groups.map((group) => (
            <fieldset key={group.mode} className={styles.mode}>
              <legend className={styles.modeLegend}>{t(`dialog.modes.${group.mode}`)}</legend>
              <div className={styles.options} data-tap-zone>
                {group.maps.map((map) => (
                  <label key={map} className={styles.option}>
                    <input
                      type="checkbox"
                      checked={slotHasMap(slot, map)}
                      onChange={() => onEdit((current) => toggleMapInSlot(current, map))}
                      onKeyDown={blockSubmit}
                    />
                    <span>{map}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </>
      )}
      <div className={styles.customRow}>
        <div className={`field ${styles.grow}`}>
          <label htmlFor={`${ids}-custom`}>{t(overwatch ? "dialog.customLabel" : "dialog.customLabelFree")}</label>
          <input
            id={`${ids}-custom`}
            type="text"
            value={custom}
            maxLength={FIRST_MAP_MAX_LENGTH}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addCustom();
            }}
          />
        </div>
        <button type="button" className="btn ghost" aria-label={t("dialog.customAddLabel", { number })} onClick={addCustom}>
          {t("dialog.customAdd")}
        </button>
      </div>
    </div>
  );
}

/** Une carte (créneau) du tour : sa nature, ses cartes retenues, l'ouverture de la liste. */
function SlotEditor({
  number,
  slot,
  open,
  removable,
  busy,
  overwatch,
  toggleId,
  errorAria,
  errorMessage,
  onToggle,
  onRemoveSlot,
  onRemoveMap,
  onEdit,
}: Readonly<{
  number: number;
  slot: readonly string[];
  open: boolean;
  removable: boolean;
  busy: boolean;
  overwatch: boolean;
  /** `id` du bouton de la liste : c'est lui que désigne un refus sur ce créneau. */
  toggleId: string;
  errorAria: FieldAria;
  errorMessage: string | null;
  onToggle: () => void;
  onRemoveSlot: () => void;
  onRemoveMap: (map: string) => void;
  onEdit: (edit: (slot: readonly string[]) => SlotEdit) => boolean;
}>) {
  const { t } = useRoundMapsText();
  const pickerId = useId();
  const chipsId = useId();
  // Retirer une pastille la démonte avec son bouton : le focus passe à la
  // pastille voisine, ou au bouton de la liste quand il n'en reste aucune
  // (jamais au <body>, WCAG 2.4.3).
  const focusAfterChip = useRef<number | null>(null);
  useEffect(() => {
    const removed = focusAfterChip.current;
    if (removed === null) return;
    focusAfterChip.current = null;
    const next = focusIndexAfterRemoval(removed, slot.length);
    document.getElementById(next === null ? toggleId : `${chipsId}-${next}`)?.focus();
  }, [slot, chipsId, toggleId]);
  let kind = t("dialog.slotEmpty");
  if (slot.length === 1) kind = t("dialog.slotImposed");
  else if (slot.length > 1) kind = t("dialog.slotPool", { count: slot.length });
  return (
    <li className={styles.slot}>
      <div className={styles.slotHead}>
        <span className={styles.slotTitle}>{t("dialog.slot", { number })}</span>
        <span className={`pill ${slot.length === 0 ? "pill-neutral" : "pill-info"}`}>{kind}</span>
        {removable && (
          <button
            type="button"
            className="btn ghost"
            aria-label={t("dialog.removeSlot", { number })}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onRemoveSlot();
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
      {slot.length > 0 && (
        <ul className={styles.chips}>
          {slot.map((map, index) => (
            <li key={map} className={styles.chip}>
              <span>{map}</span>
              <button
                type="button"
                id={`${chipsId}-${index}`}
                className={styles.chipRemove}
                aria-label={t("dialog.removeMap", { map, number })}
                onClick={() => {
                  focusAfterChip.current = index;
                  onRemoveMap(map);
                }}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          id={toggleId}
          className="btn ghost"
          aria-expanded={open}
          aria-controls={pickerId}
          {...errorAria}
          onClick={onToggle}
        >
          {t(open ? "dialog.hideMaps" : "dialog.chooseMaps")}
        </button>
        <FieldErrorText fieldId={toggleId} message={errorMessage} />
      </div>
      {open && (
        <div id={pickerId}>
          <MapPicker number={number} slot={slot} overwatch={overwatch} onEdit={onEdit} />
        </div>
      )}
    </li>
  );
}

/** Refus du serveur rattachés au champ de la map de départage. */
const TIEBREAK_FIELD_ERRORS = { INVALID_TIEBREAK_MAP: "tiebreak", TIEBREAK_NOT_ALLOWED: "tiebreak" } as const satisfies Record<
  string,
  "tiebreak"
>;

/** Toutes les cartes de la liste d'Overwatch, pour la suggestion du champ. */
const OVERWATCH_MAP_NAMES: readonly string[] = filterOverwatchMaps("").flatMap((group) => group.maps);

/** Suggestions du champ de départage : une quarantaine d'options, rendues une seule fois. */
const MapNamesDatalist = memo(function MapNamesDatalist({ id }: Readonly<{ id: string }>) {
  return (
    <datalist id={id}>
      {OVERWATCH_MAP_NAMES.map((map) => (
        <option key={map} value={map} />
      ))}
    </datalist>
  );
});

/**
 * Map de départage d'un tour de play-offs à format défini : une carte,
 * imposée, jouée en map N + 1 seulement si la série est à égalité après les N maps.
 * Un champ (liste d'Overwatch suggérée, saisie libre), « Enregistrer » et
 * « Retirer ». Suit le serveur tant que le champ n'a pas été modifié.
 */
function TiebreakForm({
  tournamentId,
  round,
  saved,
  allowed,
  overwatch,
  busy,
  run,
  onWritten,
  onDirtyChange,
}: Readonly<{
  tournamentId: number;
  round: RoundKey;
  saved: string | null;
  /** Faux quand un flux a changé le format du tour pendant la saisie : le texte reste, sans pouvoir s'envoyer. */
  allowed: boolean;
  overwatch: boolean;
  busy: boolean;
  run: RunTask;
  /** Une écriture a réussi : le tour entre dans l'annonce que la fermeture peut devancer. */
  onWritten: () => void;
  /** Le champ porte une saisie non enregistrée : fermer ou changer de tour le demande. */
  onDirtyChange: (dirty: boolean) => void;
}>) {
  const { t } = useRoundMapsText();
  const { showError, showSuccess } = useToast();
  const ids = useId();
  const inputId = `${ids}-tiebreak`;
  const listId = `${ids}-tiebreak-maps`;
  const unavailableId = `${ids}-tiebreak-unavailable`;
  const [value, setValue] = useState(saved ?? "");
  const fieldErrors = useFieldErrors(TIEBREAK_FIELD_ERRORS, { tiebreak: inputId });
  const synced = useRef(saved);
  useEffect(() => {
    const before = synced.current;
    synced.current = saved;
    setValue((current) => (current === (before ?? "") ? (saved ?? "") : current));
  }, [saved]);
  const dirty = visibleText(value) !== (saved ?? "");
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const send = (map: string | null, success: string) =>
    run(
      async () => {
        await putJson(`/api/admin/tournaments/${tournamentId}/round-tiebreak`, { ...round, map });
        // Le champ prend la forme enregistrée (espaces repliés), pas le texte tapé.
        setValue(map ?? "");
        onWritten();
        showSuccess(success);
      },
      (code, text) => fieldErrors.report(code, text),
    );

  const save = (event: FormEvent) => {
    event.preventDefault();
    // Rien de changé : rien à envoyer (renvoyer la valeur en place n'écrirait que du bruit au journal),
    // et Entrée dans un champ intact ne réclame pas un nom que le bouton grisé ne demande pas.
    if (busy || !dirty) return;
    if (!allowed) {
      showError(t("dialog.tiebreakUnavailable"));
      return;
    }
    if (visibleText(value) === "") {
      const text = t("dialog.tiebreakEmpty");
      showError(text);
      fieldErrors.flag("tiebreak", text);
      return;
    }
    void send(visibleText(value), t("dialog.tiebreakSaved"));
  };

  return (
    <form onSubmit={save} aria-busy={busy}>
      <fieldset className={styles.section}>
        <legend className={styles.legend}>{t("dialog.tiebreakTitle")}</legend>
        <div className="field">
          <div className={styles.labelRow}>
            <label htmlFor={inputId}>{t("dialog.tiebreakLabel")}</label>
            <InfoHint id={`${ids}-tiebreak-hint`} subject={t("dialog.tiebreakTitle")}>
              {t("page.tiebreakHint")}
            </InfoHint>
          </div>
          <input
            id={inputId}
            type="text"
            value={value}
            maxLength={FIRST_MAP_MAX_LENGTH}
            list={overwatch ? listId : undefined}
            readOnly={!allowed || undefined}
            {...fieldErrors.aria("tiebreak", !allowed && unavailableId)}
            onChange={(event) => {
              setValue(event.target.value);
              fieldErrors.clear();
            }}
          />
          <FieldErrorText fieldId={inputId} message={fieldErrors.message("tiebreak")} />
          <output id={unavailableId} className={styles.muted}>
            {allowed ? "" : t("dialog.tiebreakUnavailable")}
          </output>
          {overwatch && <MapNamesDatalist id={listId} />}
        </div>
        <div className={styles.actions}>
          <UnsavedNote dirty={dirty} text={t("dialog.unsaved")} />
          {/* Toujours monté : après un retrait réussi il n'y a plus rien à retirer, mais un
              bouton démonté laisserait tomber le focus sur le <body> (WCAG 2.4.3). */}
          <button
            type="button"
            className="btn ghost"
            aria-disabled={busy || saved === null || undefined}
            onClick={() => {
              if (busy || saved === null) return;
              // Le champ suit le serveur tout seul s'il n'a pas été modifié ; un texte en cours de saisie reste.
              void send(null, t("dialog.tiebreakRemoved"));
            }}
          >
            {t("dialog.tiebreakRemove")}
          </button>
          <button type="submit" className="btn ghost" aria-disabled={busy || !dirty || !allowed || undefined}>
            {t("dialog.tiebreakSave")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/** Refus du serveur rattachés au champ des points du tour. */
const POINTS_FIELD_ERRORS = {
  INVALID_MAP_POINT_TARGET: "points",
  MAP_POINTS_LOCKED: "points",
  MAP_POINTS_DISABLED: "points",
} as const satisfies Record<string, "points">;

/**
 * Points par carte propres à un tour, en format Duel / Arcade
 * (`docs/features/DUEL_ARCADE.md`) : « Enregistrer » pose le nombre du tour,
 * « Revenir aux points du tournoi » le retire. Montré seulement quand le
 * format est allumé sur le tournoi. Suit le serveur tant que le champ n'a pas
 * été modifié.
 */
function RoundPointsForm({
  tournamentId,
  round,
  tournamentTarget,
  saved,
  locked,
  busy,
  run,
  onDirtyChange,
}: Readonly<{
  tournamentId: number;
  round: RoundKey;
  /** Un match du tour porte déjà un score : les points sont figés (`roundPointsLocked`). */
  locked: boolean;
  /** Points du tournoi, que le tour suit sans réglage propre. */
  tournamentTarget: number;
  /** Points propres au tour (`null` = il suit le tournoi). */
  saved: number | null;
  busy: boolean;
  run: RunTask;
  onDirtyChange: (dirty: boolean) => void;
}>) {
  const { t } = useRoundMapsText();
  const { showSuccess } = useToast();
  const ids = useId();
  const inputId = `${ids}-points`;
  const statusId = `${ids}-points-status`;
  const lockedId = `${ids}-points-locked`;
  const effective = saved ?? tournamentTarget;
  const [value, setValue] = useState(effective);
  const fieldErrors = useFieldErrors(POINTS_FIELD_ERRORS, { points: inputId });
  const synced = useRef(effective);
  useEffect(() => {
    const before = synced.current;
    synced.current = effective;
    setValue((current) => (current === before ? effective : current));
  }, [effective]);
  const dirty = value !== effective;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const send = (target: number | null, success: string) =>
    run(
      async () => {
        await putJson(`/api/admin/tournaments/${tournamentId}/round-points`, { ...round, target });
        setValue(target ?? tournamentTarget);
        showSuccess(success);
      },
      (code, text) => fieldErrors.report(code, text),
    );

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (busy || locked || !dirty) return;
    // Le nombre du tournoi saisi sur le tour : le tour le suit, aucun réglage propre à garder.
    void send(value === tournamentTarget ? null : value, t("dialog.pointsSaved"));
  };

  return (
    <form onSubmit={save} aria-busy={busy}>
      <fieldset className={styles.section}>
        <legend className={styles.legend}>{t("dialog.pointsTitle")}</legend>
        <div className="field">
          <div className={styles.labelRow}>
            <label htmlFor={inputId}>{t("dialog.pointsLabel")}</label>
            <InfoHint id={`${ids}-points-hint`} subject={t("dialog.pointsTitle")}>
              {t("dialog.pointsHint")}
            </InfoHint>
          </div>
          <NumberInput
            id={inputId}
            min={MAP_POINT_TARGET_MIN}
            max={MAP_POINT_TARGET_MAX}
            value={value}
            onValueChange={setValue}
            onEdit={() => fieldErrors.clear()}
            disabled={locked}
            {...fieldErrors.aria("points", statusId, locked && lockedId)}
          />
          <FieldErrorText fieldId={inputId} message={fieldErrors.message("points")} />
          <p id={statusId} className={styles.muted}>
            {saved === null
              ? t("dialog.pointsInherited", { points: tournamentTarget })
              : t("dialog.pointsOwn", { points: saved, tournament: tournamentTarget })}
          </p>
          {locked && (
            <p id={lockedId} className={styles.muted}>
              {t("dialog.pointsLocked")}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <UnsavedNote dirty={dirty} text={t("dialog.unsaved")} />
          <button
            type="button"
            className="btn ghost"
            aria-disabled={busy || locked || saved === null || undefined}
            onClick={() => {
              if (busy || locked || saved === null) return;
              void send(null, t("dialog.pointsRemoved"));
            }}
          >
            {t("dialog.pointsRemove")}
          </button>
          <button type="submit" className="btn ghost" aria-disabled={busy || locked || !dirty || undefined}>
            {t("dialog.pointsSave")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * Maps de départage gardées en base sur des tours que le format n'autorise
 * plus : ni montrées ni jouées, mais le staff doit pouvoir les retirer.
 */
/** Liste vide partagée : une référence neuve à chaque rendu relancerait l'effet de focus. */
const NO_STALE_TIEBREAKS: readonly RoundTiebreak[] = [];

/** Cartes périmées à lister : le tour dont le formulaire reste affiché, grisé (`greyed`), n'y figure pas aussi. */
function useStaleTiebreaks(
  stale: readonly RoundTiebreak[] | undefined,
  round: RoundKey | null,
  greyed: boolean,
): readonly RoundTiebreak[] {
  const greyedId = round && greyed ? roundKeyId(round) : null;
  return useMemo(() => {
    const items = stale ?? NO_STALE_TIEBREAKS;
    return greyedId === null ? items : items.filter((item) => roundKeyId(item) !== greyedId);
  }, [stale, greyedId]);
}

function StaleTiebreaks({
  items,
  roundLabel,
  tournamentId,
  busy,
  run,
  onWritten,
  fallbackFocusId,
}: Readonly<{
  items: readonly RoundTiebreak[];
  roundLabel: (round: RoundKey) => string;
  tournamentId: number;
  busy: boolean;
  run: RunTask;
  onWritten: (round: RoundKey) => void;
  /** Où va le focus quand le dernier retrait fait disparaître toute la rubrique. */
  fallbackFocusId: string;
}>) {
  const { t } = useRoundMapsText();
  const { showSuccess } = useToast();
  const ids = useId();
  // Un retrait réussi démonte la ligne et son bouton : le focus passe à la ligne
  // voisine, ou à `fallbackFocusId` quand la rubrique disparaît (jamais au <body>).
  // Le retrait n'apparaît dans la liste qu'à la relecture suivante : le focus attend que la ligne ait
  // vraiment disparu (un instantané intermédiaire, même liste, ne le consomme pas).
  const focusAfter = useRef<{ key: string; index: number } | null>(null);
  useEffect(() => {
    const pending = focusAfter.current;
    if (pending === null || items.some((item) => roundKeyId(item) === pending.key)) return;
    focusAfter.current = null;
    const next = focusIndexAfterRemoval(pending.index, items.length);
    document.getElementById(next === null ? fallbackFocusId : `${ids}-${next}`)?.focus();
  }, [items, ids, fallbackFocusId]);
  if (items.length === 0) return null;
  return (
    <fieldset className={styles.section} aria-labelledby={`${ids}-title`}>
      <div className={styles.labelRow}>
        <span id={`${ids}-title`} className={styles.legend}>
          {t("dialog.staleTiebreakTitle")}
        </span>
        <InfoHint id={`${ids}-hint`} subject={t("dialog.staleTiebreakTitle")}>
          {t("dialog.staleTiebreakHint")}
        </InfoHint>
      </div>
      <ul className={styles.stale}>
        {items.map((item, index) => {
          const label = roundLabel(item);
          return (
            <li key={roundKeyId(item)} className={styles.staleItem}>
              <span>{t("dialog.staleTiebreakItem", { round: label, map: visibleText(item.map) })}</span>
              <button
                type="button"
                id={`${ids}-${index}`}
                className="btn ghost"
                aria-label={t("dialog.staleTiebreakRemoveLabel", { round: label })}
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  void run(async () => {
                    await putJson(`/api/admin/tournaments/${tournamentId}/round-tiebreak`, {
                      phaseId: item.phaseId,
                      bracket: item.bracket,
                      roundNumber: item.roundNumber,
                      map: null,
                    });
                    onWritten(item);
                    focusAfter.current = { key: roundKeyId(item), index };
                    showSuccess(t("dialog.tiebreakRemoved"));
                  });
                }}
              >
                {t("dialog.staleTiebreakRemove")}
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * Cartes et bans d'un tournoi (`docs/features/ROUND_MAPS.md`) : règles de ban
 * du tournoi, puis cartes d'un **tour du tournoi** — générés ou à venir —, un
 * créneau à une carte l'impose, à plusieurs c'est un pool. Cartes prises dans la
 * liste d'Overwatch ou saisies à la main ; copie vers un tour ou vers tous ;
 * « Réinitialiser le tour » rend la saisie match par match. Réglable à tout
 * moment par le staff (permission `tournaments`) ; le serveur refait chaque
 * contrôle. Les boutons restent focalisables pendant l'envoi (`aria-disabled`).
 */
export function RoundMapsDialog({
  detail,
  initialRound,
  onClose,
}: Readonly<{ detail: TournamentDetail; initialRound?: RoundKey | null; onClose: () => void }>) {
  const { t } = useRoundMapsText();
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { showError, showSuccess, showInfo } = useToast();
  const roundLabel = useRoundLabel(detail, t);
  const ids = useId();
  const tournamentId = detail.card.id;
  const rules = detail.mapRules;
  const overwatch = detail.card.game !== "MR";
  // Les tours ne changent pas à chaque instantané : sans cette stabilité, chaque image du flux
  // redonnerait de nouvelles références au tour affiché et relancerait les effets qui en dépendent.
  const rounds = useStableRounds(detail);

  // Une seule annonce Discord par série d'enregistrements : à la fermeture de
  // l'écran on demande son envoi tout de suite, en listant les tours écrits ici
  // — une série qu'un autre membre du staff règle encore n'est pas devancée.
  // Un accélérateur : sans lui (onglet fermé), le serveur envoie quand sa
  // fenêtre de silence est échue. Un tour n'entre dans la liste qu'une fois
  // **tous** les lots d'une écriture passés : un écran démonté en plein envoi
  // n'annonce pas une série à moitié écrite.
  const writtenRounds = useRef(new Set<string>());
  useEffect(
    () => () => {
      const rounds = [...writtenRounds.current];
      if (rounds.length === 0 || rounds.length > ROUND_MAPS_FLUSH_ROUNDS_MAX) return;
      void fetch(`/api/admin/tournaments/${tournamentId}/round-maps/flush`, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rounds }),
      }).catch(() => undefined);
    },
    [tournamentId],
  );

  const [firstBan, setFirstBan] = useState<FirstBanRule>(rules.firstBan);
  const [nextBan, setNextBan] = useState<NextBanRule>(rules.nextBan);
  const [roundId, setRoundId] = useState(() => {
    const start = initialRound ?? rounds[0] ?? null;
    return start ? roundKeyId(start) : "";
  });
  const round = findRound(rounds, roundId);
  const [slots, setSlots] = useState<string[][]>(() => slotsToEdit(rules.rounds, round));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [copyTarget, setCopyTarget] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // Saisie non enregistrée du champ de la map de départage (remontée par son formulaire).
  const [tiebreakDirty, setTiebreakDirty] = useState(false);
  // Saisie non enregistrée des points du tour (format Duel / Arcade).
  const [pointsDirty, setPointsDirty] = useState(false);
  // Créneau que désigne un refus (créneau vide entre deux cartes, carte de trop) ;
  // `null` : le refus du serveur ne dit pas lequel, il vise la liste entière.
  const [errorSlot, setErrorSlot] = useState<number | null>(null);
  const slotToggleId = (number: number) => `${ids}-slot-${number}`;
  const slotsListId = `${ids}-slots`;
  const fieldErrors = useFieldErrors<RoundField>(SLOT_FIELD_ERRORS, {
    slots: errorSlot === null ? slotsListId : slotToggleId(errorSlot),
    copy: `${ids}-copy`,
    applyAll: `${ids}-apply-all`,
  });
  const clearSlotError = fieldErrors.clear;
  // Un refus ne survit pas à ce qui l'a causé : cartes, cible, tour affiché ou réglages du serveur changés.
  // Un instantané qui ne change aucune carte enregistrée (tour affiché, cible de copie…) laisse le refus.
  const storedKey = useMemo(() => storedRoundsSignature(rules.rounds), [rules.rounds]);
  useEffect(() => clearSlotError(), [slots, copyTarget, roundId, storedKey, clearSlotError]);

  // L'instantané change sous la fenêtre (autre membre du staff, ou son propre
  // envoi) : règles et cartes suivent le serveur tant qu'elles n'ont pas été
  // modifiées ici ; une saisie en cours n'est jamais écrasée.
  const synced = useRef({ firstBan: rules.firstBan, nextBan: rules.nextBan, rounds: rules.rounds, round });
  useEffect(() => {
    const before = synced.current;
    synced.current = { firstBan: rules.firstBan, nextBan: rules.nextBan, rounds: rules.rounds, round };
    setFirstBan((current) => (current === before.firstBan ? rules.firstBan : current));
    setNextBan((current) => (current === before.nextBan ? rules.nextBan : current));
    // Changement de tour : `changeRound` a déjà posé ses créneaux.
    if (before.round !== null && round !== null && roundKeyId(before.round) !== roundKeyId(round)) return;
    setSlots((current) => {
      const next = resyncSlots(current, before.rounds, rules.rounds, round);
      return next === current ? current : next.map((slot) => [...slot]);
    });
  }, [rules.firstBan, rules.nextBan, rules.rounds, round]);

  // Le tour affiché a quitté la liste (format changé par un autre membre du staff,
  // plateau régénéré) : retour au premier tour, et plus de confirmation orpheline
  // qui reparaîtrait si le tour revenait.
  const fallbackRoundId = vanishedRoundFallback(rounds, roundId);
  useEffect(() => {
    if (fallbackRoundId === null) return;
    // La confirmation de fermeture ne tient pas au tour : elle reste.
    setPending((current) => (current?.kind === "close" ? current : null));
    setRoundId(fallbackRoundId);
    setActiveSlot(null);
    setCopyTarget("");
    setSlots(slotsToEdit(rules.rounds, findRound(rounds, fallbackRoundId)));
  }, [fallbackRoundId, rounds, rules.rounds]);

  // Retirer un créneau le démonte avec son bouton : le focus passe au créneau voisin.
  const focusAfterSlotRemoval = useRef<number | null>(null);
  useEffect(() => {
    const removed = focusAfterSlotRemoval.current;
    if (removed === null) return;
    focusAfterSlotRemoval.current = null;
    const next = focusIndexAfterRemoval(removed, slots.length);
    if (next !== null) document.getElementById(`${ids}-slot-${next + 1}`)?.focus();
  }, [slots, ids]);

  const rulesDirty = firstBan !== rules.firstBan || nextBan !== rules.nextBan;
  const roundDirty = slotsDirty(slots, rules.rounds, round);

  const saved = round ? roundMapsOf(rules.rounds, round) : null;
  const maxMaps = round ? roundMaxMaps(detail.card, round.roundNumber) : null;
  const slotCap = maxMaps ?? ROUND_MAP_SLOTS_MAX;
  const toSave = slotsToSave(slots);
  // Un tour déjà enregistré au-dessus du plafond (le serveur n'en impose pas) peut être retouché sans
  // grossir : l'avertissement et le refus partagent ce seuil, l'un ne promet pas ce que l'autre laisse passer.
  const effectiveMax = maxMaps === null ? null : Math.max(maxMaps, saved?.slots.length ?? 0);
  const overMax = effectiveMax !== null && toSave.length > effectiveMax;
  // « Réinitialiser » ne touche pas la map de départage : le toast le dit quand elle reste.
  const tiebreakKept =
    round !== null && (roundTiebreakOf(rules.tiebreaks, round) !== null || roundTiebreakOf(rules.staleTiebreaks, round) !== null);
  const clearedText = t(tiebreakKept ? "dialog.roundClearedTiebreakKept" : "dialog.roundCleared");

  const run: RunTask = async (task, onRefused) => {
    if (busy) return false;
    setBusy(true);
    try {
      await task();
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      return true;
    } catch (error) {
      const code = (error as Error).message;
      const text = launchErrorText(actionText, errorsText, code);
      showError(text);
      onRefused?.(code, text);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const tiebreakTournament = {
    format: detail.card.format,
    matchFormat: detail.card.matchFormat,
    endurancePlayoffFormat: detail.card.endurancePlayoffFormat,
    phases: detail.phases ?? detail.card.phases,
  };
  const tiebreakAllowed = round !== null && roundAllowsTiebreak(tiebreakTournament, round);
  // Un flux qui change le format du tour pendant la saisie ne démonte pas la
  // section (focus sur le body, texte perdu) : elle reste, grisée, avec son message.
  const { showTiebreak, staleTiebreaks } = useTiebreakSection(rules.staleTiebreaks, round, tiebreakAllowed);

  const optionLabel = (key: RoundKey) => {
    const config = roundMapsOf(rules.rounds, key);
    const tiebreak = roundTiebreakOf(rules.tiebreaks, key) === null ? "" : ` · ${t("dialog.summaryTiebreak")}`;
    if (!config) return `${roundLabel(key)} · ${t("dialog.summaryNone")}${tiebreak}`;
    const { maps, pools } = roundMapsSummary(config.slots);
    return `${roundLabel(key)} · ${t("dialog.summarySet", { maps, pools })}${tiebreak}`;
  };

  /** Applique l'édition au créneau ; `false` si elle est refusée (notification, saisie conservée). */
  const editSlot = (index: number, edit: (slot: readonly string[]) => SlotEdit): boolean => {
    const result = edit(slots[index] ?? []);
    if (result.refused === "EMPTY") showError(t("dialog.mapEmpty"));
    else if (result.refused === "TOO_LONG") showError(t("dialog.mapTooLong"));
    else if (result.refused === "POOL_FULL") showError(t("dialog.poolFull"));
    else {
      setSlots((current) => current.map((slot, at) => (at === index ? [...result.slot] : slot)));
      return true;
    }
    return false;
  };

  const saveRules = (event: FormEvent) => {
    event.preventDefault();
    // Rien de modifié : rien à envoyer, ni « Règles enregistrées » annoncé sur des règles qui n'ont pas bougé.
    if (busy || !rulesDirty) return;
    void run(async () => {
      // La règle « carte suivante » n'est plus proposée (`NextPickRule`) : la valeur en place est renvoyée telle quelle.
      await putJson(`/api/admin/tournaments/${tournamentId}/map-rules`, { firstBan, nextBan, nextPick: rules.nextPick });
      showSuccess(t("dialog.rulesSaved"));
    });
  };

  // Au-delà de ROUND_MAPS_BULK_MAX tours, une écriture par lot (le serveur borne chaque requête).
  // `field` : où se rattache un refus du serveur (la liste du tour, ou le geste de copie qui a visé d'autres tours).
  const sendRounds = (targets: readonly RoundKey[], payload: string[][], success: string, field: RoundField = "slots") =>
    run(
      async () => {
        // Tours que le tournoi ne porte plus (phase supprimée entre-temps) : le serveur les saute et les compte.
        let skipped = 0;
        for (const chunk of chunkRounds(targets, ROUND_MAPS_BULK_MAX)) {
          const answer = await putJson(`/api/admin/tournaments/${tournamentId}/round-maps`, { rounds: chunk, slots: payload });
          skipped += Number(answer.skipped ?? 0) || 0;
        }
        for (const key of targets) writtenRounds.current.add(roundKeyId(key));
        // Pas un succès entier : le staff ne doit pas croire tous les tours réglés.
        if (skipped > 0) showInfo(t("dialog.roundsSkipped", { count: skipped }));
        else showSuccess(success);
      },
      (code, text) => {
        // Le serveur refuse sans dire quelle carte : le refus vise la liste, pas le premier créneau.
        setErrorSlot(null);
        if (fieldErrors.report(code, text) && field !== "slots") fieldErrors.flag(field, text);
      },
    );

  /** Un créneau vide entre deux cartes décalerait les suivantes : refusé avant l'envoi, et rattaché au créneau. */
  const gapRefused = () => {
    const gap = slotGap(slots);
    if (gap !== null) {
      const text = t("dialog.slotGap", { number: gap });
      showError(text);
      setErrorSlot(gap);
      fieldErrors.flag("slots", text);
    }
    return gap !== null;
  };

  /** Plus de cartes que le format n'en joue : refusé avant l'envoi, et rattaché à la première carte de trop. */
  const overMaxRefused = () => {
    const over = slotOverMax(slots, effectiveMax);
    if (over === null) return false;
    const text = t("dialog.overMaxMaps", { max: maxMaps ?? 0 });
    showError(text);
    setErrorSlot(over);
    fieldErrors.flag("slots", text);
    return true;
  };

  const saveRound = (event: FormEvent) => {
    event.preventDefault();
    // Rien de modifié : ni envoi, ni « Tour réinitialisé » annoncé sur un tour qui n'a pas bougé.
    if (!round || busy || !roundDirty || gapRefused() || overMaxRefused()) return;
    void sendRounds([round], toSave, toSave.length === 0 ? clearedText : t("dialog.roundSaved"));
  };

  /**
   * Un tour cible joue moins de cartes que la sélection : refusé avant l'envoi, en nommant ce tour
   * et son plafond effectif, et rattaché au champ qui l'a désigné (`field`).
   */
  const targetOverMaxRefused = (targets: readonly RoundKey[], field: "copy" | "applyAll") => {
    const limitOf = (key: RoundKey) => {
      const max = roundMaxMaps(detail.card, key.roundNumber);
      return max === null ? null : Math.max(max, roundMapsOf(rules.rounds, key)?.slots.length ?? 0);
    };
    const target = firstTargetOverMax(targets, toSave.length, limitOf);
    if (target === null) return false;
    const text = t("dialog.overMaxTarget", { round: roundLabel(target), max: limitOf(target) ?? 0 });
    showError(text);
    fieldErrors.flag(field, text);
    return true;
  };

  const applyAll = () => {
    if (busy || toSave.length === 0 || gapRefused() || targetOverMaxRefused(rounds, "applyAll")) return;
    const others = rounds.filter((key) => roundKeyId(key) !== roundId);
    const overwritten = overwrittenRounds(rules.rounds, others, toSave).length;
    if (overwritten > 0) setPending({ kind: "applyAll", overwritten });
    else void sendRounds(rounds, toSave, t("dialog.appliedAll"), "applyAll");
  };

  const copy = () => {
    const target = findRound(rounds, copyTarget);
    if (busy || !target || toSave.length === 0 || gapRefused() || targetOverMaxRefused([target], "copy")) return;
    if (overwrittenRounds(rules.rounds, [target], toSave).length > 0) setPending({ kind: "copy", target });
    else void sendRounds([target], toSave, t("dialog.copied", { round: roundLabel(target) }), "copy");
  };

  const changeRound = (id: string) => {
    if (id === roundId) return;
    // Des cartes saisies et non enregistrées seraient perdues en silence : on le demande.
    if (roundDirty || tiebreakDirty || pointsDirty) setPending({ kind: "switch", id });
    else selectRound(id);
  };

  const selectRound = (id: string) => {
    setRoundId(id);
    setActiveSlot(null);
    setCopyTarget("");
    setSlots(slotsToEdit(rules.rounds, findRound(rounds, id)));
  };

  // Fermer (Échap, voile, « Fermer ») jetterait les saisies non enregistrées : on le demande, comme au changement de tour.
  const requestClose = () => {
    if (roundDirty || rulesDirty || tiebreakDirty || pointsDirty) setPending({ kind: "close" });
    else onClose();
  };

  const confirmation = (() => {
    if (!pending) return null;
    if (pending.kind === "close") {
      return {
        title: t("dialog.closeConfirm.title"),
        body: t("dialog.closeConfirm.body"),
        confirm: t("dialog.closeConfirm.confirm"),
        action: async () => {
          onClose();
          return true;
        },
      };
    }
    if (!round) return null;
    if (pending.kind === "reset") {
      return {
        title: t("dialog.resetConfirm.title"),
        body: t("dialog.resetConfirm.body", { round: roundLabel(round) }),
        confirm: t("dialog.resetConfirm.confirm"),
        action: async () => {
          const ok = await sendRounds([round], [], clearedText);
          if (ok) setSlots([[]]);
          return ok;
        },
      };
    }
    if (pending.kind === "switch") {
      const next = pending.id;
      return {
        title: t("dialog.switchConfirm.title"),
        body: t("dialog.switchConfirm.body", { round: roundLabel(round) }),
        confirm: t("dialog.switchConfirm.confirm"),
        action: async () => {
          selectRound(next);
          return true;
        },
      };
    }
    if (pending.kind === "applyAll") {
      return {
        title: t("dialog.applyAllConfirm.title"),
        body: t("dialog.applyAllConfirm.body", { count: pending.overwritten }),
        confirm: t("dialog.applyAllConfirm.confirm"),
        action: () => sendRounds(rounds, toSave, t("dialog.appliedAll"), "applyAll"),
      };
    }
    const target = pending.target;
    return {
      title: t("dialog.copyConfirm.title"),
      body: t("dialog.copyConfirm.body", { round: roundLabel(target) }),
      confirm: t("dialog.copyConfirm.confirm"),
      action: () => sendRounds([target], toSave, t("dialog.copied", { round: roundLabel(target) }), "copy"),
    };
  })();

  const titleId = `${ids}-title`;
  return (
    <>
      <TournamentDialogFrame titleId={titleId} maxWidth={640} zIndex={90} deferMount busy={busy} onClose={requestClose}>
        <div className={styles.titleRow}>
          <h3 id={titleId} className={styles.title}>
            {t("dialog.title")}
          </h3>
          <InfoHint id={`${ids}-hint`} subject={t("dialog.title")}>
            {t("dialog.hint")}
          </InfoHint>
        </div>

        <form onSubmit={saveRules} aria-busy={busy}>
          <fieldset className={styles.section}>
            <legend className={styles.legend}>{t("dialog.rulesTitle")}</legend>
            <div className="field">
              <label htmlFor={`${ids}-first`}>{t("dialog.firstBan")}</label>
              <select id={`${ids}-first`} value={firstBan} onChange={(event) => setFirstBan(event.target.value as FirstBanRule)}>
                {FIRST_BAN_RULES.map((rule) => (
                  <option key={rule} value={rule}>
                    {t(`dialog.firstBanOptions.${rule}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${ids}-next`}>{t("dialog.nextBan")}</label>
              <select id={`${ids}-next`} value={nextBan} onChange={(event) => setNextBan(event.target.value as NextBanRule)}>
                {NEXT_BAN_RULES.map((rule) => (
                  <option key={rule} value={rule}>
                    {t(`dialog.nextBanOptions.${rule}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.actions}>
              <UnsavedNote dirty={rulesDirty} text={t("dialog.unsaved")} />
              <button type="submit" className="btn ghost" aria-disabled={busy || !rulesDirty || undefined}>
                {t("dialog.saveRules")}
              </button>
            </div>
          </fieldset>
        </form>

        {round && (
          <form onSubmit={saveRound} aria-busy={busy}>
            <fieldset className={styles.section}>
              <legend id={`${ids}-round-legend`} className={styles.legend}>
                {t("dialog.roundTitle")}
              </legend>
              <div className="field">
                <div className={styles.labelRow}>
                  <label htmlFor={`${ids}-round`}>{t("dialog.round")}</label>
                  <InfoHint id={`${ids}-scale`} subject={t("dialog.round")}>
                    {t("dialog.scaleHint")}
                  </InfoHint>
                </div>
                <select id={`${ids}-round`} value={roundId} onChange={(event) => changeRound(event.target.value)}>
                  {rounds.map((item) => (
                    <option key={roundKeyId(item)} value={roundKeyId(item)}>
                      {optionLabel(item)}
                    </option>
                  ))}
                </select>
              </div>
              {maxMaps !== null && (
                // `<output>` : région d'état, le passage au dépassement est annoncé (et dit en mots, pas seulement en couleur).
                <output className={overMax ? styles.warn : styles.muted}>
                  {t(overMax ? "dialog.overMaxMaps" : "dialog.maxMaps", { max: maxMaps })}
                </output>
              )}
              <ol
                id={slotsListId}
                className={styles.slots}
                tabIndex={-1}
                aria-labelledby={`${ids}-round-legend`}
                aria-describedby={errorSlot === null && fieldErrors.message("slots") ? fieldErrorId(slotsListId) : undefined}
              >
                {slots.map((slot, index) => (
                  <SlotEditor
                    // L'ordre des créneaux est leur identité (carte 1, carte 2…).
                    key={`slot-${index + 1}`}
                    number={index + 1}
                    slot={slot}
                    open={activeSlot === index}
                    removable={slots.length > 1}
                    busy={busy}
                    overwatch={overwatch}
                    toggleId={slotToggleId(index + 1)}
                    errorAria={errorSlot === index + 1 ? fieldErrors.aria("slots") : {}}
                    errorMessage={errorSlot === index + 1 ? fieldErrors.message("slots") : null}
                    onToggle={() => setActiveSlot(activeSlot === index ? null : index)}
                    onRemoveSlot={() => {
                      focusAfterSlotRemoval.current = index;
                      setSlots((current) => current.filter((_, at) => at !== index));
                      setActiveSlot(null);
                    }}
                    onRemoveMap={(map) =>
                      setSlots((current) => current.map((item, at) => (at === index ? removeMapFromSlot(item, map) : item)))
                    }
                    onEdit={(edit) => editSlot(index, edit)}
                  />
                ))}
              </ol>
              <FieldErrorText fieldId={slotsListId} message={errorSlot === null ? fieldErrors.message("slots") : null} />
              {slots.length < slotCap ? (
                <div>
                  <button
                    type="button"
                    className="btn ghost"
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      if (busy) return;
                      setSlots((current) => [...current, []]);
                      setActiveSlot(slots.length);
                    }}
                  >
                    {t("dialog.addSlot")}
                  </button>
                </div>
              ) : (
                <p className={styles.muted}>{t("dialog.slotsLimit", { max: slotCap })}</p>
              )}
              <div className={styles.actions}>
                <UnsavedNote dirty={roundDirty} text={t("dialog.unsaved")} />
                {/* Toujours monté : après une réinitialisation il n'y a plus rien à réinitialiser, mais un
                    bouton démonté laisserait tomber le focus sur le <body> (WCAG 2.4.3). */}
                <button
                  type="button"
                  className="btn ghost"
                  aria-disabled={busy || !saved || undefined}
                  onClick={() => {
                    if (!busy && saved) setPending({ kind: "reset" });
                  }}
                >
                  {t("dialog.clearRound")}
                </button>
                <button type="submit" className="btn" aria-disabled={busy || !roundDirty || undefined}>
                  {t("dialog.saveRound")}
                </button>
              </div>
              {rounds.length > 1 && (
                <div className={styles.copyRow}>
                  <div className={`field ${styles.grow}`}>
                    <label htmlFor={`${ids}-copy`}>{t("dialog.copyLabel")}</label>
                    <select
                      id={`${ids}-copy`}
                      value={copyTarget}
                      {...fieldErrors.aria("copy")}
                      onChange={(event) => setCopyTarget(event.target.value)}
                    >
                      <option value="">—</option>
                      {rounds
                        .filter((item) => roundKeyId(item) !== roundId)
                        .map((item) => (
                          <option key={roundKeyId(item)} value={roundKeyId(item)}>
                            {optionLabel(item)}
                          </option>
                        ))}
                    </select>
                    <FieldErrorText fieldId={`${ids}-copy`} message={fieldErrors.message("copy")} />
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    aria-disabled={busy || copyTarget === "" || toSave.length === 0 || undefined}
                    onClick={copy}
                  >
                    {t("dialog.copy")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    id={`${ids}-apply-all`}
                    {...fieldErrors.aria("applyAll")}
                    aria-disabled={busy || toSave.length === 0 || undefined}
                    onClick={applyAll}
                  >
                    {t("dialog.applyAll")}
                  </button>
                </div>
              )}
              <FieldErrorText fieldId={`${ids}-apply-all`} message={fieldErrors.message("applyAll")} />
            </fieldset>
          </form>
        )}

        {round && showTiebreak && (
          <TiebreakForm
            key={roundKeyId(round)}
            tournamentId={tournamentId}
            round={round}
            saved={roundTiebreakOf(rules.tiebreaks, round)}
            allowed={tiebreakAllowed}
            overwatch={overwatch}
            busy={busy}
            run={run}
            onWritten={() => writtenRounds.current.add(roundKeyId(round))}
            onDirtyChange={setTiebreakDirty}
          />
        )}

        {round && detail.card.mapPointTarget != null && (
          <RoundPointsForm
            key={`points-${roundKeyId(round)}`}
            tournamentId={tournamentId}
            round={round}
            tournamentTarget={detail.card.mapPointTarget}
            saved={roundPointTargetOf(rules.pointTargets, round)}
            locked={roundPointsLocked(detail.matches, round)}
            busy={busy}
            run={run}
            onDirtyChange={setPointsDirty}
          />
        )}

        <StaleTiebreaks
          items={staleTiebreaks}
          roundLabel={roundLabel}
          tournamentId={tournamentId}
          busy={busy}
          run={run}
          onWritten={(key) => writtenRounds.current.add(roundKeyId(key))}
          fallbackFocusId={`${ids}-close`}
        />

        <div className={styles.footer}>
          <button
            id={`${ids}-close`}
            type="button"
            className="btn ghost"
            onClick={() => {
              if (!busy) requestClose();
            }}
            aria-disabled={busy || undefined}
          >
            {t("dialog.close")}
          </button>
        </div>
      </TournamentDialogFrame>
      {confirmation && (
        <ConfirmActionDialog
          title={confirmation.title}
          confirmLabel={confirmation.confirm}
          pendingLabel={t("dialog.pending")}
          tone={pending?.kind === "reset" || pending?.kind === "switch" || pending?.kind === "close" ? "danger" : "primary"}
          onClose={() => setPending(null)}
          onConfirm={confirmation.action}
        >
          <p>{confirmation.body}</p>
        </ConfirmActionDialog>
      )}
    </>
  );
}
