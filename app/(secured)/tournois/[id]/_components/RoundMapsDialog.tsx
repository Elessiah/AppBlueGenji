"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/info-hint";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import {
  FIRST_BAN_RULES,
  NEXT_BAN_RULES,
  NEXT_PICK_RULES,
  ROUND_MAP_SLOTS_MAX,
  roundKeyId,
  roundKeysOf,
  roundMapsOf,
  type FirstBanRule,
  type NextBanRule,
  type NextPickRule,
  type RoundKey,
} from "@/lib/shared/round-maps";
import type { BracketType, TournamentDetail } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import styles from "./RoundMapsDialog.module.css";

/** Longueur d'un champ de créneau : un pool entier, cartes séparées par des virgules. */
const SLOT_FIELD_MAX_LENGTH = 1400;

/** Créneaux saisis : une chaîne par carte, cartes du pool séparées par des virgules. */
export function slotsToFields(slots: readonly string[][]): string[] {
  return slots.length > 0 ? slots.map((candidates) => candidates.join(", ")) : [""];
}

/** Champs relus en créneaux ; un champ vide est écarté (le serveur nettoie de même). */
export function fieldsToSlots(fields: readonly string[]): string[][] {
  return fields
    .map((field) => field.split(",").map((name) => name.trim()).filter((name) => name !== ""))
    .filter((slot) => slot.length > 0);
}

/** Libellé d'une manche : phase, tableau (hors tableau principal), numéro. */
function useRoundLabel(detail: TournamentDetail) {
  const pageText = useTournamentPageText();
  return (round: RoundKey) =>
    [
      detail.phases?.find((phase) => phase.id === round.phaseId)?.name ?? null,
      round.bracket === "UPPER" ? null : pageText.t(`page.bracketLabels.${round.bracket as BracketType}`),
      pageText.t("bracket.roundN", { number: round.roundNumber }),
    ]
      .filter(Boolean)
      .join(" · ");
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

/**
 * Cartes et bans d'un tournoi (`docs/features/ROUND_MAPS.md`) : règles de ban
 * du tournoi, puis cartes d'une manche — un créneau à une carte l'impose, à
 * plusieurs c'est un pool. Réglable à tout moment par le staff (permission
 * `tournaments`) ; le serveur refait chaque contrôle. Les boutons restent
 * focalisables pendant l'envoi (`aria-disabled`, `aria-busy`).
 */
export function RoundMapsDialog({
  detail,
  initialRound,
  onClose,
}: Readonly<{ detail: TournamentDetail; initialRound?: RoundKey | null; onClose: () => void }>) {
  const { t } = useDialogsText();
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const roundLabel = useRoundLabel(detail);
  const ids = useId();
  const tournamentId = detail.card.id;
  const rules = detail.mapRules;
  const rounds = useMemo(() => roundKeysOf(detail.matches), [detail.matches]);
  const slotsOf = (key: RoundKey | null | undefined) => slotsToFields(key ? (roundMapsOf(rules.rounds, key)?.slots ?? []) : []);

  const [firstBan, setFirstBan] = useState<FirstBanRule>(rules.firstBan);
  const [nextBan, setNextBan] = useState<NextBanRule>(rules.nextBan);
  const [nextPick, setNextPick] = useState<NextPickRule>(rules.nextPick);
  const [roundId, setRoundId] = useState(() => {
    const start = initialRound ?? rounds[0] ?? null;
    return start ? roundKeyId(start) : "";
  });
  const round = rounds.find((item) => roundKeyId(item) === roundId) ?? null;
  const [fields, setFields] = useState<string[]>(() => slotsOf(round));
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
    } catch (error) {
      showError(launchErrorText(actionText, errorsText, (error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const saveRules = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await putJson(`/api/admin/tournaments/${tournamentId}/map-rules`, { firstBan, nextBan, nextPick });
      showSuccess(t("roundMaps.rulesSaved"));
    });
  };

  const saveRound = (slots: string[][]) => {
    if (!round) return;
    void run(async () => {
      await putJson(`/api/admin/tournaments/${tournamentId}/round-maps`, { ...round, slots });
      showSuccess(t(slots.length === 0 ? "roundMaps.roundCleared" : "roundMaps.roundSaved"));
      if (slots.length === 0) setFields([""]);
    });
  };

  const selectRound = (id: string) => {
    setRoundId(id);
    setFields(slotsOf(rounds.find((item) => roundKeyId(item) === id)));
  };

  const titleId = `${ids}-title`;
  return (
    <TournamentDialogFrame titleId={titleId} maxWidth={560} zIndex={90} deferMount busy={busy} onClose={onClose}>
      <div className={styles.titleRow}>
        <h3 id={titleId} className={styles.title}>
          {t("roundMaps.title")}
        </h3>
        <InfoHint id={`${ids}-hint`} subject={t("roundMaps.title")}>
          {t("roundMaps.hint")}
        </InfoHint>
      </div>

      <form onSubmit={saveRules} aria-busy={busy}>
        <fieldset className={styles.section}>
          <legend className={styles.legend}>{t("roundMaps.rulesTitle")}</legend>
          <div className="field">
            <label htmlFor={`${ids}-first`}>{t("roundMaps.firstBan")}</label>
            <select id={`${ids}-first`} value={firstBan} onChange={(event) => setFirstBan(event.target.value as FirstBanRule)}>
              {FIRST_BAN_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {t(`roundMaps.firstBanOptions.${rule}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-next`}>{t("roundMaps.nextBan")}</label>
            <select id={`${ids}-next`} value={nextBan} onChange={(event) => setNextBan(event.target.value as NextBanRule)}>
              {NEXT_BAN_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {t(`roundMaps.nextBanOptions.${rule}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-pick`}>{t("roundMaps.nextPick")}</label>
            <select id={`${ids}-pick`} value={nextPick} onChange={(event) => setNextPick(event.target.value as NextPickRule)}>
              {NEXT_PICK_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {t(`roundMaps.nextPickOptions.${rule}`)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.actions}>
            <button type="submit" className="btn ghost" aria-disabled={busy || undefined}>
              {t("roundMaps.saveRules")}
            </button>
          </div>
        </fieldset>
      </form>

      {round && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveRound(fieldsToSlots(fields));
          }}
          aria-busy={busy}
        >
          <fieldset className={styles.section}>
            <legend className={styles.legend}>{t("roundMaps.roundTitle")}</legend>
            <div className="field">
              <label htmlFor={`${ids}-round`}>{t("roundMaps.round")}</label>
              <select id={`${ids}-round`} value={roundId} onChange={(event) => selectRound(event.target.value)}>
                {rounds.map((item) => (
                  <option key={roundKeyId(item)} value={roundKeyId(item)}>
                    {roundLabel(item)}
                  </option>
                ))}
              </select>
            </div>
            <ol className={styles.slots}>
              {fields.map((field, index) => {
                const number = index + 1;
                const fieldId = `${ids}-slot-${number}`;
                return (
                  // L'ordre des créneaux est leur identité (carte 1, carte 2…).
                  <li key={`slot-${number}`} className={styles.slot}>
                    <div className={`field ${styles.slotField}`}>
                      <label htmlFor={fieldId}>{t("roundMaps.slot", { number })}</label>
                      <input
                        id={fieldId}
                        type="text"
                        value={field}
                        placeholder={t("roundMaps.slotPlaceholder")}
                        maxLength={SLOT_FIELD_MAX_LENGTH}
                        readOnly={busy}
                        onChange={(event) =>
                          setFields((current) => current.map((value, at) => (at === index ? event.target.value : value)))
                        }
                      />
                    </div>
                    {fields.length > 1 && (
                      <button
                        type="button"
                        className="btn ghost"
                        aria-label={t("roundMaps.removeSlot", { number })}
                        aria-disabled={busy || undefined}
                        onClick={() => {
                          if (!busy) setFields((current) => current.filter((_, at) => at !== index));
                        }}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            {fields.length < ROUND_MAP_SLOTS_MAX ? (
              <div>
                <button
                  type="button"
                  className="btn ghost"
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (!busy) setFields((current) => [...current, ""]);
                  }}
                >
                  {t("roundMaps.addSlot")}
                </button>
              </div>
            ) : (
              <p className={styles.muted}>{t("roundMaps.slotsLimit", { max: ROUND_MAP_SLOTS_MAX })}</p>
            )}
            <div className={styles.actions}>
              <button type="button" className="btn ghost" aria-disabled={busy || undefined} onClick={() => saveRound([])}>
                {t("roundMaps.clearRound")}
              </button>
              <button type="submit" className="btn" aria-disabled={busy || undefined}>
                {t("roundMaps.saveRound")}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      <div className={styles.footer}>
        <button type="button" className="btn ghost" onClick={onClose} aria-disabled={busy || undefined}>
          {t("roundMaps.close")}
        </button>
      </div>
    </TournamentDialogFrame>
  );
}
