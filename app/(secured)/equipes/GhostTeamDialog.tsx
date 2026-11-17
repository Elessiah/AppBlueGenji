"use client";

import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  TEAM_TAG_MAX_LENGTH,
  TEAM_TAG_MIN_LENGTH,
  normalizeTeamTag,
} from "@/lib/shared/team-tag";
import s from "./GhostTeamDialog.module.css";
import { useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamsText } from "@/components/i18n/teams-text";
import { checkTeamName } from "@/lib/shared/team-name";
import { CodedError, TEAM_IDENTITY_FIELD_ERRORS, errorCode } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FieldErrorText } from "@/components/ui/field-error-text";

const FIELD_IDS = { name: "ghost-team-name", tag: "ghost-team-tag" } as const;

type GhostTeamDialogProps = {
  onClose: () => void;
  /** Appelé après création réussie, pour rafraîchir la liste. */
  onCreated: () => void;
};

/**
 * Création d'une équipe fantôme (staff `tournaments`). L'équipe n'a aucun
 * joueur : seuls un nom et une description facultative sont demandés. Le logo
 * se règle ensuite depuis la fiche de l'équipe, comme pour une équipe réelle.
 */
export function GhostTeamDialog({ onClose, onCreated }: Readonly<GhostTeamDialogProps>) {
  const { showError, showSuccess } = useToast();
  const { t } = useTeamsText();
  const teamErrorMessage = useTeamErrorMessage();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  // Garde synchrone : un double clic créait deux fois (le second refusé par le
  // nom déjà pris, mais avec une erreur au milieu d'un succès).
  const { busy, isBusy, run, hold } = useBusyGuard();
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);
  const fieldErrors = useFieldErrors(TEAM_IDENTITY_FIELD_ERRORS, FIELD_IDS);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isBusy()) return;
    const nameCheck = checkTeamName(name);
    if (!nameCheck.ok) {
      const message = teamErrorMessage(nameCheck.reason);
      fieldErrors.flag("name", message);
      showError(message);
      return;
    }
    fieldErrors.clear();
    await run(async () => {
      try {
        const response = await fetch("/api/teams", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            description: description.trim() || null,
            tag: tag.trim() || null,
            ghost: true,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          const code = payload.error || "GHOST_TEAM_CREATE_FAILED";
          throw new CodedError(code, code);
        }
        showSuccess(t("ghostDialog.created"));
        hold();
        onCreated();
        onClose();
      } catch (e) {
        const message = teamErrorMessage((e as Error).message);
        fieldErrors.report(errorCode(e), message);
        showError(message);
      }
    });
  };

  // Portée dans <body> : rendue dans la page, elle restait dans le contexte
  // d'empilement de `main.page-shell` (`z-index: 1`), sous la barre de
  // navigation (`z-index: 50`), qui restait nette et cliquable par-dessus le voile.
  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={s.backdrop} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ghost-team-title"
        tabIndex={-1}
      >
        <h2 id="ghost-team-title" className={s.title}>
          {t("ghostDialog.title")}
        </h2>
        <p className={s.lede}>{t("ghostDialog.lede")}</p>

        <form className="dim-disabled" onSubmit={submit}>
          <div className="field">
            <label htmlFor="ghost-team-name">{t("identity.name")}</label>
            <input
              id="ghost-team-name"
              value={name}
              // Figés pendant l'envoi (`readOnly`, le focus reste) : ce qui est affiché est ce qui part.
              readOnly={busy}
              onChange={(e) => {
                setName(e.target.value);
                fieldErrors.clear("name");
              }}
              required
              {...fieldErrors.aria("name")}
              // Bornes contrôlées par `checkTeamName` à l'envoi : les
              // `minLength`/`maxLength` natifs comptent des unités UTF-16,
              // la base des caractères.
              data-autofocus
            />
            <FieldErrorText fieldId={FIELD_IDS.name} message={fieldErrors.message("name")} />
          </div>
          <div className="field">
            <label htmlFor="ghost-team-tag">{t("identity.tagOptional")}</label>
            <input
              id="ghost-team-tag"
              value={tag}
              readOnly={busy}
              onChange={(e) => {
                setTag(normalizeTeamTag(e.target.value));
                fieldErrors.clear("tag");
              }}
              minLength={TEAM_TAG_MIN_LENGTH}
              maxLength={TEAM_TAG_MAX_LENGTH}
              pattern="[A-Za-z0-9]*"
              placeholder={t("identity.tagPlaceholder")}
              {...fieldErrors.aria("tag", "ghost-team-tag-help")}
              style={{ textTransform: "uppercase", letterSpacing: "0.12em", maxWidth: 160 }}
            />
            <FieldErrorText fieldId={FIELD_IDS.tag} message={fieldErrors.message("tag")} />
            <p id="ghost-team-tag-help" style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
              {t("identity.tagHelp", { min: TEAM_TAG_MIN_LENGTH, max: TEAM_TAG_MAX_LENGTH })}
            </p>
          </div>
          <div className="field">
            <label htmlFor="ghost-team-description">{t("identity.descriptionOptional")}</label>
            <textarea
              id="ghost-team-description"
              value={description}
              readOnly={busy}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className={s.actions}>
            <BusyButton className="btn ghost" busy={false} blocked={busy} onClick={onClose}>
              {t("ghostDialog.cancel")}
            </BusyButton>
            <BusyButton type="submit" className="btn" busy={busy}>
              <BusyLabel busy={busy} idle={t("ghostDialog.submit")} pending={t("ghostDialog.pending")} />
            </BusyButton>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
