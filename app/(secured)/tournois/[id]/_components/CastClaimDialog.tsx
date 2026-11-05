"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useOptionalToast } from "@/components/ui/toast";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { PLATFORM_LABELS, streamPlatform, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import { viewerMayChangeLiveTrigger } from "@/lib/shared/live-trigger-owner";
import { viewerRefereesMatch } from "@/lib/shared/match-referee";
import type { BracketMatch } from "@/lib/shared/types";
import {
  castClaimBody,
  castClaimChoiceKey,
  castClaimChoices,
  type CastClaimBody,
  type CastClaimChoice,
} from "../_lib/cast-claim";
import { useActionsText } from "../_lib/actions-text";
import { useLiveControls } from "../_lib/live-context";
import { useTournamentGame } from "../_lib/match-format-context";
import {
  CastBattletagField,
  CastOrganisationLinkField,
  CastTriggerField,
  CastUrlField,
  castBattletagInvalid,
  castTriggerNeedsDate,
  lockedTrigger,
  castUrlInvalid,
} from "./CastSettingsFields";
import styles from "./CastClaimDialog.module.css";

const CAST_FIELD_ERRORS = { INVALID_STREAM_URL: "url", STREAM_URL_REQUIRED: "url" } as const;

/** Issue d'une inscription : le refus porte son code et la phrase déjà notifiée. */
export type CastClaimOutcome = { ok: true } | { ok: false; code: string; message: string };

/**
 * S'inscrire pour caster un match (`docs/features/CAST_SETTINGS.md`) :
 * rejoindre un stream existant — co-caster, sans lien à donner — ou ouvrir le
 * sien, **avec le lien de sa chaîne** (obligatoire : un stream sans lien
 * n'apparaissait sur aucune vue et n'annonçait rien). Un match sans stream
 * l'ouvre aussi, avec le seul choix « ouvrir mon propre stream ».
 *
 * Ouvrir son propre stream règle du même geste ce que l'ancien bouton
 * « Configurer la diffusion » offrait : le mode de passage à l'antenne du match
 * et, pour la permission `tournaments`, l'origine du lien. Le BattleTag de ce
 * cast suit les deux choix — il parle du caster, non de son stream.
 *
 * Le focus d'ouverture va à « Annuler » (comme la fenêtre de retrait) : un
 * Entrée réflexe sur un bouton radio ne doit pas inscrire un caster.
 *
 * Un stream choisi qui disparaît (son dernier caster parti) démonte son bouton
 * radio : le focus passe au premier choix restant et une annonce
 * (`aria-live`) dit pourquoi « Caster ce match » est désarmé.
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
  match: Pick<
    BracketMatch,
    "id" | "status" | "refereeKey" | "streams" | "casters" | "startAt" | "liveTrigger" | "liveTriggerCasterId"
  >;
  matchLabel: string;
  onClose: () => void;
  onClaim: (body: CastClaimBody) => Promise<CastClaimOutcome>;
}>) {
  const { t, locale } = useActionsText();
  const { canSchedule, viewerUserId, viewerIsAdmin, refereeNames } = useLiveControls();
  // Mode déjà posé par un autre caster : il se lit, il ne se change pas à
  // l'inscription (`LIVE_TRIGGER_NOT_OWNED`) — le corps ne le porte pas.
  const triggerLocked = !viewerMayChangeLiveTrigger(match, {
    userId: viewerUserId,
    isAdmin: viewerIsAdmin,
    manages: canSchedule,
    referees: viewerRefereesMatch(match, refereeNames),
  });
  const game = useTournamentGame();
  const name = useId();
  const urlId = useId();
  const battletagId = useId();
  const choices = castClaimChoices(match);
  const [choiceKey, setChoiceKey] = useState(castClaimChoiceKey(choices[0]));
  // Un stream choisi qui disparaît (son dernier caster parti) ne se remplace
  // pas en silence par un autre : plus rien n'est coché, il faut rechoisir.
  const choice: CastClaimChoice | null =
    choices.find((option) => castClaimChoiceKey(option) === choiceKey) ?? null;
  // Le choix disparu est oublié : un stream qui reviendrait ne se recocherait pas seul.
  if (choice === null && choiceKey !== "") setChoiceKey("");
  const [url, setUrl] = useState("");
  const [battletag, setBattletag] = useState("");
  // Un match déjà casté garde son mode ; sinon « automatique au démarrage »,
  // qui ne demande plus un clic à l'heure dite.
  const [trigger, setTrigger] = useState<MatchLiveTrigger>(match.liveTrigger ?? "AUTO");
  const [organisationLink, setOrganisationLink] = useState(false);
  const fieldErrors = useFieldErrors(CAST_FIELD_ERRORS, { url: urlId });
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const gone = choice === null;
  // Le refus se notifie aussi en bas à gauche (règle des erreurs) : le texte
  // de la modale explique seulement pourquoi « Caster ce match » est désarmé.
  const toast = useOptionalToast();
  const goneMessage = t("cardActions.claimDialog.gone");
  const notifyGone = useRef({ toast, goneMessage });
  notifyGone.current = { toast, goneMessage };
  useEffect(() => {
    if (gone) notifyGone.current.toast?.showError(notifyGone.current.goneMessage);
  }, [gone]);
  useEffect(() => {
    // Le bouton radio qui avait le focus a été démonté : le focus serait tombé
    // sur <body>, derrière la modale. Un focus ailleurs (« Annuler ») reste.
    if (!gone || document.activeElement !== document.body) return;
    fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
  }, [gone]);
  const separate = choice?.kind === "SEPARATE";
  // Lien **obligatoire** : vide, il désarme le bouton comme un lien fautif.
  const urlMissing = separate && url.trim() === "";
  const urlRefused = separate && castUrlInvalid(url);
  const battletagRefused = castBattletagInvalid(battletag);
  // Le mode du match, laissé tel quel, ne se réécrit pas (le serveur l'ignore) :
  // un « à la date de début » sans date, posé par le staff, ne bloque pas
  // l'inscription.
  const triggerRefused = separate && !triggerLocked && trigger !== match.liveTrigger && castTriggerNeedsDate(trigger, match.startAt);
  // « A, B et C » / "A, B, and C" : la conjonction de la langue de la page.
  const casterList = useMemo(() => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }), [locale]);

  const confirm = async (): Promise<boolean> => {
    if (choice === null) return false;
    const outcome = await onClaim(castClaimBody(choice, { url, battletag, trigger: triggerLocked ? undefined : trigger, organisationLink }));
    if (!outcome.ok) fieldErrors.report(outcome.code, outcome.message);
    return outcome.ok;
  };

  return (
    <ConfirmActionDialog
      title={t("cardActions.claimDialog.title", { match: matchLabel })}
      confirmLabel={t("cardActions.claimDialog.confirm")}
      pendingLabel={t("cardActions.claimDialog.pending")}
      tone="primary"
      disabled={choice === null || urlMissing || urlRefused || battletagRefused || triggerRefused}
      onClose={onClose}
      onConfirm={confirm}
    >
      <fieldset ref={fieldsetRef} className={styles.choices}>
        <legend className={styles.legend}>{t("cardActions.claimDialog.legend")}</legend>
        {choices.map((option) => {
          const key = castClaimChoiceKey(option);
          const platform = option.kind === "JOIN" ? streamPlatform(option.liveUrl) : null;
          let label = t("cardActions.claimDialog.separate");
          if (option.kind === "JOIN") {
            label =
              option.casterPseudos.length > 0
                ? t("cardActions.claimDialog.join", { casters: casterList.format(option.casterPseudos) })
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
      <output className={styles.gone} aria-live="polite">
        {gone ? t("cardActions.claimDialog.gone") : ""}
      </output>
      {separate && (
        <>
          <CastUrlField
            id={urlId}
            value={url}
            onChange={(next) => {
              setUrl(next);
              fieldErrors.clear("url");
            }}
            invalid={urlRefused || fieldErrors.invalidField === "url"}
            fieldError={fieldErrors.message("url")}
          />
          <CastTriggerField trigger={lockedTrigger(triggerLocked, match.liveTrigger, trigger)} startAt={match.startAt} onChange={setTrigger} locked={triggerLocked} />
          {canSchedule && url.trim() !== "" && (
            <CastOrganisationLinkField checked={organisationLink} onChange={setOrganisationLink} />
          )}
        </>
      )}
      {/* Le BattleTag n'a de sens qu'en Overwatch, comme celui des contacts. */}
      {game !== null && battletagRelevantFor(game) && (
        <CastBattletagField
          id={battletagId}
          value={battletag}
          onChange={setBattletag}
          invalid={battletagRefused}
        />
      )}
    </ConfirmActionDialog>
  );
}
