"use client";

import { useId, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  LIVE_PLATFORMS,
  MAX_STREAM_URL_LENGTH,
  PLATFORM_LABELS,
  normalizeStreamUrl,
  streamPlatform,
} from "@/lib/shared/live-streams";
import type { BracketMatch } from "@/lib/shared/types";
import {
  castClaimBody,
  castClaimChoiceKey,
  castClaimChoices,
  type CastClaimBody,
  type CastClaimChoice,
} from "../_lib/cast-claim";
import { useActionsText } from "../_lib/actions-text";
import styles from "./CastClaimDialog.module.css";

const CAST_FIELD_ERRORS = { INVALID_STREAM_URL: "url" } as const;

/** Issue d'une inscription : le refus porte son code et la phrase déjà notifiée. */
export type CastClaimOutcome = { ok: true } | { ok: false; code: string; message: string };

/**
 * S'inscrire pour caster un match qui a déjà un stream (`docs/features/MATCH_LAUNCH.md`
 * § Casters et streams) : rejoindre un stream existant — co-caster, sans lien
 * à donner — ou ouvrir le sien, avec son propre lien (facultatif). Un match
 * sans stream n'ouvre pas cette fenêtre : l'inscription part d'un clic.
 *
 * `onClaim` envoie le corps (`castClaimBody`) et notifie l'issue ; un lien
 * refusé par le serveur est en plus rattaché au champ (`useFieldErrors`).
 */
export function CastClaimDialog({
  match,
  matchLabel,
  onClose,
  onClaim,
}: Readonly<{
  match: Pick<BracketMatch, "streams" | "casters">;
  matchLabel: string;
  onClose: () => void;
  onClaim: (body: CastClaimBody) => Promise<CastClaimOutcome>;
}>) {
  const { t } = useActionsText();
  const name = useId();
  const urlId = useId();
  const hintId = useId();
  const choices = castClaimChoices(match);
  const [choiceKey, setChoiceKey] = useState(castClaimChoiceKey(choices[0]));
  const choice: CastClaimChoice = choices.find((option) => castClaimChoiceKey(option) === choiceKey) ?? choices[0];
  const [url, setUrl] = useState("");
  const fieldErrors = useFieldErrors(CAST_FIELD_ERRORS, { url: urlId });
  const separate = choice.kind === "SEPARATE";
  const urlInvalid = separate && url.trim() !== "" && normalizeStreamUrl(url) === null;
  const platforms = LIVE_PLATFORMS.join(", ");

  const confirm = async (): Promise<boolean> => {
    const outcome = await onClaim(castClaimBody(choice, url));
    if (!outcome.ok) fieldErrors.report(outcome.code, outcome.message);
    return outcome.ok;
  };

  return (
    <ConfirmActionDialog
      title={t("cardActions.claimDialog.title", { match: matchLabel })}
      confirmLabel={t("cardActions.claimDialog.confirm")}
      pendingLabel={t("cardActions.claimDialog.pending")}
      tone="primary"
      focusContent
      disabled={urlInvalid}
      onClose={onClose}
      onConfirm={confirm}
    >
      <fieldset className={styles.choices}>
        <legend className={styles.legend}>{t("cardActions.claimDialog.legend")}</legend>
        {choices.map((option, index) => {
          const key = castClaimChoiceKey(option);
          const platform = option.kind === "JOIN" ? streamPlatform(option.liveUrl) : null;
          let label = t("cardActions.claimDialog.separate");
          if (option.kind === "JOIN") {
            label =
              option.casterPseudos.length > 0
                ? t("cardActions.claimDialog.join", { casters: option.casterPseudos.join(", ") })
                : t("cardActions.claimDialog.joinMatchStream");
          }
          return (
            <label key={key} className={styles.choice}>
              <input
                type="radio"
                name={name}
                value={key}
                checked={key === choiceKey}
                onChange={() => setChoiceKey(key)}
                data-autofocus={index === 0 ? true : undefined}
              />
              <span>
                {label}
                {option.kind === "JOIN" && (
                  <span className={styles.detail}>
                    {" · "}
                    {platform ? PLATFORM_LABELS[platform] : t("cardActions.claimDialog.noLink")}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      {separate && (
        <div className="field">
          <label htmlFor={urlId}>{t("cardActions.claimDialog.url")}</label>
          <input
            id={urlId}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              fieldErrors.clear("url");
            }}
            maxLength={MAX_STREAM_URL_LENGTH}
            inputMode="url"
            placeholder="https://twitch.tv/…"
            {...fieldErrors.aria("url", hintId)}
            // Le lien mal formé se voit avant l'envoi (bouton désarmé, aide en rouge).
            aria-invalid={urlInvalid || fieldErrors.invalidField === "url" ? true : undefined}
          />
          <p id={hintId} className={urlInvalid ? styles.hintInvalid : styles.hint}>
            {urlInvalid
              ? t("cardActions.claimDialog.urlInvalid", { platforms })
              : t("cardActions.claimDialog.urlHint", { platforms })}
          </p>
          <FieldErrorText fieldId={urlId} message={fieldErrors.message("url")} />
        </div>
      )}
    </ConfirmActionDialog>
  );
}
