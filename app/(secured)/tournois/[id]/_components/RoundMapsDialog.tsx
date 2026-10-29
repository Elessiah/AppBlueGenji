"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint } from "@/components/ui/info-hint";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import { FIRST_MAP_MAX_LENGTH } from "@/lib/shared/match-referee";
import type { FieldAria } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { filterOverwatchMaps } from "@/lib/shared/overwatch-maps";
import {
  FIRST_BAN_RULES,
  NEXT_BAN_RULES,
  ROUND_MAP_SLOTS_MAX,
  ROUND_MAPS_BULK_MAX,
  roundKeyId,
  roundKeysOf,
  roundMapsOf,
  roundMapsSummary,
  type FirstBanRule,
  type NextBanRule,
  type RoundKey,
} from "@/lib/shared/round-maps";
import { plannedRoundKeys, roundMaxMaps } from "@/lib/shared/round-plan";
import type { BracketType, TournamentDetail } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import {
  addMapToSlot,
  blocksImplicitSubmit,
  chunkRounds,
  findRound,
  overwrittenRounds,
  removeMapFromSlot,
  resyncSlots,
  slotGap,
  slotHasMap,
  slotsDirty,
  slotsToEdit,
  slotsToSave,
  toggleMapInSlot,
  type SlotEdit,
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

/** Refus du serveur rattachés à la liste des cartes du tour (`useFieldErrors`). */
const SLOT_FIELD_ERRORS = { INVALID_ROUND_MAPS: "slots" } as const satisfies Record<string, "slots">;

/** Témoin d'un formulaire modifié et pas encore enregistré, annoncé au lecteur d'écran. */
function UnsavedNote({ dirty, text }: Readonly<{ dirty: boolean; text: string }>) {
  return (
    <p className={`${styles.muted} ${styles.unsaved}`} role="status">
      {dirty ? text : ""}
    </p>
  );
}

async function putJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "UNKNOWN");
}

type Pending = { kind: "reset" } | { kind: "switch"; id: string } | { kind: "applyAll"; overwritten: number } | { kind: "copy"; target: RoundKey };

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
  onEdit: (edit: (slot: readonly string[]) => SlotEdit) => void;
}>) {
  const { t } = useRoundMapsText();
  const ids = useId();
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const groups = overwatch ? filterOverwatchMaps(query) : [];
  const addCustom = () => {
    onEdit((current) => addMapToSlot(current, custom));
    setCustom("");
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
  onEdit: (edit: (slot: readonly string[]) => SlotEdit) => void;
}>) {
  const { t } = useRoundMapsText();
  const pickerId = useId();
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
          {slot.map((map) => (
            <li key={map} className={styles.chip}>
              <span>{map}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t("dialog.removeMap", { map, number })}
                onClick={() => onRemoveMap(map)}
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
  const { showError, showSuccess } = useToast();
  const roundLabel = useRoundLabel(detail, t);
  const ids = useId();
  const tournamentId = detail.card.id;
  const rules = detail.mapRules;
  const overwatch = detail.card.game !== "MR";
  const rounds = useMemo(() => dialogRounds(detail), [detail]);

  // Une seule annonce Discord par série d'enregistrements : à la fermeture de
  // l'écran on demande son envoi tout de suite. Un accélérateur — sans lui
  // (onglet fermé), le serveur envoie quand sa fenêtre de silence est échue.
  const savedRounds = useRef(false);
  useEffect(
    () => () => {
      if (!savedRounds.current) return;
      void fetch(`/api/admin/tournaments/${tournamentId}/round-maps/flush`, { method: "POST", keepalive: true }).catch(
        () => undefined,
      );
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
  // Créneau que désigne un refus (créneau vide entre deux cartes, ou refus du serveur : le premier).
  const [errorSlot, setErrorSlot] = useState(1);
  const slotToggleId = (number: number) => `${ids}-slot-${number}`;
  const fieldErrors = useFieldErrors(SLOT_FIELD_ERRORS, { slots: slotToggleId(errorSlot) });
  const clearSlotError = fieldErrors.clear;
  useEffect(() => clearSlotError(), [slots, clearSlotError]);

  // L'instantané change sous la fenêtre (autre membre du staff, ou son propre
  // envoi) : règles et cartes suivent le serveur tant qu'elles n'ont pas été
  // modifiées ici ; une saisie en cours n'est jamais écrasée.
  const synced = useRef({ firstBan: rules.firstBan, nextBan: rules.nextBan, rounds: rules.rounds, round });
  useEffect(() => {
    const before = synced.current;
    synced.current = { firstBan: rules.firstBan, nextBan: rules.nextBan, rounds: rules.rounds, round };
    if (before.round !== null && round !== null && roundKeyId(before.round) !== roundKeyId(round)) return;
    setFirstBan((current) => (current === before.firstBan ? rules.firstBan : current));
    setNextBan((current) => (current === before.nextBan ? rules.nextBan : current));
    setSlots((current) => {
      const next = resyncSlots(current, before.rounds, rules.rounds, round);
      return next === current ? current : next.map((slot) => [...slot]);
    });
  }, [rules.firstBan, rules.nextBan, rules.rounds, round]);

  const rulesDirty = firstBan !== rules.firstBan || nextBan !== rules.nextBan;
  const roundDirty = slotsDirty(slots, rules.rounds, round);

  const saved = round ? roundMapsOf(rules.rounds, round) : null;
  const maxMaps = round ? roundMaxMaps(detail.card, round.roundNumber) : null;
  const slotCap = maxMaps ?? ROUND_MAP_SLOTS_MAX;
  const toSave = slotsToSave(slots);
  const overMax = maxMaps !== null && toSave.length > maxMaps;

  const run = async (task: () => Promise<void>, onRefused?: (code: string, text: string) => void): Promise<boolean> => {
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

  const optionLabel = (key: RoundKey) => {
    const config = roundMapsOf(rules.rounds, key);
    if (!config) return `${roundLabel(key)} · ${t("dialog.summaryNone")}`;
    const { maps, pools } = roundMapsSummary(config.slots);
    return `${roundLabel(key)} · ${t("dialog.summarySet", { maps, pools })}`;
  };

  const editSlot = (index: number, edit: (slot: readonly string[]) => SlotEdit) => {
    const result = edit(slots[index] ?? []);
    if (result.refused === "EMPTY") showError(t("dialog.mapEmpty"));
    else if (result.refused === "TOO_LONG") showError(t("dialog.mapTooLong"));
    else if (result.refused === "POOL_FULL") showError(t("dialog.poolFull"));
    else setSlots((current) => current.map((slot, at) => (at === index ? [...result.slot] : slot)));
  };

  const saveRules = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      // La règle « carte suivante » n'est plus proposée (`NextPickRule`) : la valeur en place est renvoyée telle quelle.
      await putJson(`/api/admin/tournaments/${tournamentId}/map-rules`, { firstBan, nextBan, nextPick: rules.nextPick });
      showSuccess(t("dialog.rulesSaved"));
    });
  };

  // Au-delà de ROUND_MAPS_BULK_MAX tours, une écriture par lot (le serveur borne chaque requête).
  const sendRounds = (targets: readonly RoundKey[], payload: string[][], success: string) =>
    run(
      async () => {
        for (const chunk of chunkRounds(targets, ROUND_MAPS_BULK_MAX)) {
          await putJson(`/api/admin/tournaments/${tournamentId}/round-maps`, { rounds: chunk, slots: payload });
          savedRounds.current = true;
        }
        showSuccess(success);
      },
      (code, text) => {
        setErrorSlot(1);
        fieldErrors.report(code, text);
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

  const saveRound = (event: FormEvent) => {
    event.preventDefault();
    if (!round || gapRefused()) return;
    void sendRounds([round], toSave, t(toSave.length === 0 ? "dialog.roundCleared" : "dialog.roundSaved"));
  };

  const applyAll = () => {
    if (busy || toSave.length === 0 || gapRefused()) return;
    const others = rounds.filter((key) => roundKeyId(key) !== roundId);
    const overwritten = overwrittenRounds(rules.rounds, others, toSave).length;
    if (overwritten > 0) setPending({ kind: "applyAll", overwritten });
    else void sendRounds(rounds, toSave, t("dialog.appliedAll"));
  };

  const copy = () => {
    const target = findRound(rounds, copyTarget);
    if (busy || !target || toSave.length === 0 || gapRefused()) return;
    if (overwrittenRounds(rules.rounds, [target], toSave).length > 0) setPending({ kind: "copy", target });
    else void sendRounds([target], toSave, t("dialog.copied", { round: roundLabel(target) }));
  };

  const changeRound = (id: string) => {
    if (id === roundId) return;
    // Des cartes saisies et non enregistrées seraient perdues en silence : on le demande.
    if (roundDirty) setPending({ kind: "switch", id });
    else selectRound(id);
  };

  const selectRound = (id: string) => {
    setRoundId(id);
    setActiveSlot(null);
    setCopyTarget("");
    setSlots(slotsToEdit(rules.rounds, findRound(rounds, id)));
  };

  const confirmation = (() => {
    if (!pending || !round) return null;
    if (pending.kind === "reset") {
      return {
        title: t("dialog.resetConfirm.title"),
        body: t("dialog.resetConfirm.body", { round: roundLabel(round) }),
        confirm: t("dialog.resetConfirm.confirm"),
        action: async () => {
          const ok = await sendRounds([round], [], t("dialog.roundCleared"));
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
        action: () => sendRounds(rounds, toSave, t("dialog.appliedAll")),
      };
    }
    const target = pending.target;
    return {
      title: t("dialog.copyConfirm.title"),
      body: t("dialog.copyConfirm.body", { round: roundLabel(target) }),
      confirm: t("dialog.copyConfirm.confirm"),
      action: () => sendRounds([target], toSave, t("dialog.copied", { round: roundLabel(target) })),
    };
  })();

  const titleId = `${ids}-title`;
  return (
    <>
      <TournamentDialogFrame titleId={titleId} maxWidth={640} zIndex={90} deferMount busy={busy} onClose={onClose}>
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
              <button type="submit" className="btn ghost" aria-disabled={busy || undefined}>
                {t("dialog.saveRules")}
              </button>
            </div>
          </fieldset>
        </form>

        {round && (
          <form onSubmit={saveRound} aria-busy={busy}>
            <fieldset className={styles.section}>
              <legend className={styles.legend}>{t("dialog.roundTitle")}</legend>
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
                <p className={overMax ? styles.warn : styles.muted}>
                  {t(overMax ? "dialog.overMaxMaps" : "dialog.maxMaps", { max: maxMaps })}
                </p>
              )}
              <ol className={styles.slots}>
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
                {saved && (
                  <button
                    type="button"
                    className="btn ghost"
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      if (!busy) setPending({ kind: "reset" });
                    }}
                  >
                    {t("dialog.clearRound")}
                  </button>
                )}
                <button type="submit" className="btn" aria-disabled={busy || undefined}>
                  {t("dialog.saveRound")}
                </button>
              </div>
              {toSave.length > 0 && rounds.length > 1 && (
                <div className={styles.copyRow}>
                  <div className={`field ${styles.grow}`}>
                    <label htmlFor={`${ids}-copy`}>{t("dialog.copyLabel")}</label>
                    <select id={`${ids}-copy`} value={copyTarget} onChange={(event) => setCopyTarget(event.target.value)}>
                      <option value="">—</option>
                      {rounds
                        .filter((item) => roundKeyId(item) !== roundId)
                        .map((item) => (
                          <option key={roundKeyId(item)} value={roundKeyId(item)}>
                            {optionLabel(item)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    aria-disabled={busy || copyTarget === "" || undefined}
                    onClick={copy}
                  >
                    {t("dialog.copy")}
                  </button>
                  <button type="button" className="btn ghost" aria-disabled={busy || undefined} onClick={applyAll}>
                    {t("dialog.applyAll")}
                  </button>
                </div>
              )}
            </fieldset>
          </form>
        )}

        <div className={styles.footer}>
          <button type="button" className="btn ghost" onClick={onClose} aria-disabled={busy || undefined}>
            {t("dialog.close")}
          </button>
        </div>
      </TournamentDialogFrame>
      {confirmation && (
        <ConfirmActionDialog
          title={confirmation.title}
          confirmLabel={confirmation.confirm}
          pendingLabel={t("dialog.pending")}
          tone={pending?.kind === "reset" || pending?.kind === "switch" ? "danger" : "primary"}
          onClose={() => setPending(null)}
          onConfirm={confirmation.action}
        >
          <p>{confirmation.body}</p>
        </ConfirmActionDialog>
      )}
    </>
  );
}
