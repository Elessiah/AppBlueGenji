"use client";

import { FormEvent, KeyboardEvent, memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Coche } from "@/components/Coche";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { useShellText } from "@/components/i18n/shell-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import type { PlatformRole } from "@/lib/shared/permissions";
import { IMPERSONABLE_ROLES, PLAYER_VIEW_MAX_HOURS, toggleImpersonatedRole } from "@/lib/shared/player-view";
import s from "./impersonate-role-dialog.module.css";

type ImpersonateRoleDialogProps = {
  /** Fermeture sans geste (Échap, voile, « Annuler »). */
  onClose: () => void;
  /**
   * Incarne les rôles choisis (vides : vue joueur). Rend `true` si la
   * bascule a abouti — la page se relit, la modale reste « en cours » jusqu'à
   * son démontage ; `false` la rend à l'utilisateur (le refus est déjà dit).
   */
  onConfirm: (roles: PlatformRole[]) => Promise<boolean>;
};

type RowProps = {
  role: PlatformRole;
  hintId: string;
  checked: boolean;
  busy: boolean;
  onToggle: (role: PlatformRole) => void;
};

/** Une ligne : la case du rôle, son « i » (ce qu'il change) et ce qu'il ouvre. */
const ImpersonateRoleRow = memo(function ImpersonateRoleRow({ role, hintId, checked, busy, onToggle }: Readonly<RowProps>) {
  const { t } = useShellText();
  const label = t(`impersonate.roles.${role as ImpersonableRole}.label`);
  return (
    <div role="row" className={s.row}>
      <span role="rowheader" className={s.roleCell}>
        <InfoHintRow separated>
          <Coche
            label={label}
            checked={checked}
            theme="joueur"
            onChange={() => onToggle(role)}
            aria-describedby={hintId}
            aria-readonly={busy || undefined}
          />
          <InfoHint id={hintId} subject={label}>
            <p>{t(`impersonate.roles.${role as ImpersonableRole}.hint`)}</p>
          </InfoHint>
        </InfoHintRow>
      </span>
      <span role="cell" className={s.opensCell} data-label={t("impersonate.columnOpens")}>
        {t(`impersonate.roles.${role as ImpersonableRole}.opens`)}
      </span>
    </div>
  );
});

type ImpersonableRole = Exclude<PlatformRole, "ADMIN">;

/**
 * « Incarner un rôle » (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) : un
 * administrateur coche les rôles de plateforme dont il veut **exactement** les
 * droits sur cette session — aucun : vue joueur, aussi à portée d'un seul clic
 * (« Joueur (aucun rôle) »). Chaque rôle porte son « i » (ce qu'il ouvre et
 * ce qu'il n'ouvre pas), comme le tableau des rôles d'équipe.
 *
 * Portail sur `document.body`, `useDialogBehavior` (focus, piège, Échap),
 * voile par `useBackdropDismiss` ; rien ne ferme la modale tant que la
 * bascule est en vol.
 */
export function ImpersonateRoleDialog({ onClose, onConfirm }: Readonly<ImpersonateRoleDialogProps>) {
  const { t } = useShellText();
  const titleId = useId();
  const baseId = useId();
  const [selected, setSelected] = useState<PlatformRole[]>([]);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy, initialFocus: "container" });
  const backdrop = useBackdropDismiss(onClose, busy);
  // Garde synchrone : un double clic n'envoie qu'une bascule.
  const inFlight = useRef(false);

  const toggle = useCallback((role: PlatformRole) => {
    if (inFlight.current) return;
    setSelected((current) => toggleImpersonatedRole(current, role));
  }, []);

  const send = async (roles: PlatformRole[]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const done = await onConfirm(roles);
    // Réussite : la page se relit et démonte la modale, qui reste en attente.
    if (!done) {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Portée dans <body>, la modale reste enfant React de son appelant : la
    // soumission ne remonte pas à un formulaire englobant.
    event.stopPropagation();
    void send(selected);
  };

  if (!mounted) return null;

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ role="presentation" className={s.backdrop} {...backdrop}>
      <form /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef as unknown as React.Ref<HTMLFormElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={s.dialog}
        onSubmit={submit}
        onKeyDown={(event: KeyboardEvent) => {
          // Entrée sur une case ne soumet pas (soumission implicite).
          const target = event.target as HTMLInputElement;
          if (event.key === "Enter" && target.type === "checkbox") event.preventDefault();
        }}
      >
        <h3 id={titleId} className={s.title}>
          {t("impersonate.title")}
        </h3>
        <ScrollArea orientation="y" className={s.body} ariaLabel={t("impersonate.bodyLabel")}>
          <InfoHintRow>
            <button
              type="button"
              className={`btn ghost ${s.player}`}
              onClick={() => void send([])}
              aria-disabled={busy || undefined}
              aria-describedby={`${baseId}-player`}
            >
              {t("impersonate.player")}
            </button>
            <InfoHint id={`${baseId}-player`} subject={t("impersonate.player")}>
              <p>{t("impersonate.playerHint")}</p>
            </InfoHint>
          </InfoHintRow>
          <InfoHintRow>
            <span className={s.lead}>{t("impersonate.lead")}</span>
            <InfoHint id={`${baseId}-lead`} subject={t("impersonate.title")}>
              <p>{t("impersonate.hint", { hours: PLAYER_VIEW_MAX_HOURS })}</p>
            </InfoHint>
          </InfoHintRow>
          <div className={s.tableWrap}>
            <div className={s.table} role="table" aria-label={t("impersonate.tableLabel")}>
              <div role="rowgroup">
                <div role="row" className={`${s.row} ${s.header}`}>
                  <span role="columnheader">{t("impersonate.columnRole")}</span>
                  <span role="columnheader">{t("impersonate.columnOpens")}</span>
                </div>
              </div>
              <div role="rowgroup" className={s.tableBody} data-tap-zone>
                {IMPERSONABLE_ROLES.map((role) => (
                  <ImpersonateRoleRow
                    key={role}
                    role={role}
                    hintId={`${baseId}-${role}`}
                    checked={selected.includes(role)}
                    busy={busy}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
        <div className={s.actions}>
          <button type="button" className="btn ghost" onClick={() => !busy && onClose()} aria-disabled={busy || undefined}>
            {t("impersonate.cancel")}
          </button>
          <button type="submit" className="btn" aria-describedby={`${baseId}-lead`} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            {busy ? t("impersonate.pending") : t("impersonate.confirm")}
          </button>
          {/* Le libellé d'un bouton focalisé qui change n'est pas annoncé. */}
          <output className="sr-only" aria-live="polite">
            {busy ? t("impersonate.pending") : ""}
          </output>
        </div>
      </form>
    </div>,
    document.body,
  );
}
