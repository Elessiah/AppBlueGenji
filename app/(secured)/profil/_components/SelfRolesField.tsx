"use client";

import { useEffect, useRef, useState } from "react";
import { Coche } from "@/components/Coche";
import { useProfileText, type ProfileText } from "@/components/i18n/profile-text";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useToast } from "@/components/ui/toast";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { CodedError, errorCode, SELF_ROLES_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  PLATFORM_ROLES,
  diffPlatformRoles,
  roleChangeNeedsConfirmation,
  roleChangeTone,
  type PlatformRole,
  type PlatformRoleChange,
} from "@/lib/shared/permissions";
import type { ProfileSection as Section } from "../_lib/profile-sections";
import { ProfileSection } from "./ProfileSection";
import s from "../profil.module.css";

const ADMIN_FIELD_ID = "profile-role-ADMIN";
const ADMIN_HINT_ID = "profile-role-admin-hint";
const LEGEND_ID = "profile-roles-legend";
const HINT_ID = "profile-roles-hint";

/** Les refus de la route des rôles qui ont leur phrase, dans la langue de la page. */
const SELF_ROLES_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CANNOT_MODIFY_SELF",
  "CANNOT_REMOVE_OWN_ADMIN",
  "INVALID_PAYLOAD",
  "USER_NOT_FOUND",
  "ROLES_CHANGED",
] as const;
type SelfRolesErrorCode = (typeof SELF_ROLES_ERROR_CODES)[number];

/**
 * Les refus qui ne se lèvent pas en réessayant : la session ou le droit a changé
 * depuis l'affichage. La confirmation se ferme et la session est relue.
 */
const DEFINITIVE_REFUSALS: ReadonlySet<string> = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CANNOT_MODIFY_SELF",
  "USER_NOT_FOUND",
]);

/** Phrase d'un refus ; repli générique pour tout autre code (jamais le code brut). */
export function selfRolesErrorMessage(code: string, text: ProfileText): string {
  return (SELF_ROLES_ERROR_CODES as readonly string[]).includes(code)
    ? text.t(`platformRoles.errors.${code as SelfRolesErrorCode}`)
    : text.t("platformRoles.errors.fallback");
}

/**
 * Ses propres rôles de plateforme, depuis « Mon profil » (ADMIN-SELF-ROLES).
 *
 * Rendu pour un **administrateur** seulement (la page en décide ; la route
 * refuse tout autre compte en `CANNOT_MODIFY_SELF`). La case « Administrateur »
 * reste cochée : on ne se retire pas l'administration, un autre administrateur
 * le fait (`CANNOT_REMOVE_OWN_ADMIN`, rattaché à cette case s'il revenait du
 * serveur). Elle reste focalisable (`aria-disabled`, pas `disabled`), pour
 * qu'un lecteur d'écran l'entende, la raison avec.
 *
 * Tout écart passe par une confirmation qui dit ce que l'on gagne et perd ;
 * l'enregistrement relit la session (`router.refresh()`), la barre de
 * navigation lisant les rôles.
 */
export function SelfRolesField({
  userId,
  roles,
  onSaved,
  onAdminLost,
}: Readonly<{
  userId: number;
  roles: readonly PlatformRole[];
  onSaved: (roles: PlatformRole[]) => void;
  /** L'administration n'est plus (403) : la page retire la section sans attendre une relecture. */
  onAdminLost?: () => void;
}>): React.ReactElement {
  const text = useProfileText();
  const { t } = text;
  const router = useLocaleRouter();
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(SELF_ROLES_FIELD_ERRORS, { admin: ADMIN_FIELD_ID });
  const [selected, setSelected] = useState<PlatformRole[]>(() => [...roles]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PlatformRoleChange | null>(null);
  // Une case verrouillée tapée en rafale ne doit pas empiler la même notification.
  const lastLockedNotice = useRef(0);

  // Resynchronise la sélection quand les rôles **enregistrés** changent — sur
  // leur contenu, pas sur l'identité du tableau : toute autre mise à jour du
  // profil (pseudo, préférences) en recrée un, et effaçait une case cochée
  // mais pas encore enregistrée.
  const savedKey = roles.join(",");
  useEffect(() => {
    setSelected(savedKey ? (savedKey.split(",") as PlatformRole[]) : []);
  }, [savedKey]);

  const toggle = (role: PlatformRole) => {
    if (busy) return;
    if (role === "ADMIN") {
      // La case reste cochée : au toucher, il n'y a ni curseur « interdit » ni « i » ouvert,
      // donc le geste refusé dit sa raison.
      const now = Date.now();
      if (now - lastLockedNotice.current > 1500) {
        lastLockedNotice.current = now;
        showError(t("platformRoles.adminLocked"));
      }
      return;
    }
    // Une erreur rattachée à la case Administrateur ne survit pas à un nouveau choix.
    fieldErrors.clear();
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  /**
   * Relit ses rôles enregistrés (`/api/profile`) après un `ROLES_CHANGED` : la
   * page les reçoit (`onSaved`), les cases s'y resynchronisent. Plus
   * administrateur entre-temps : la section se retire.
   */
  const reloadSavedRoles = async (): Promise<void> => {
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { isAdmin?: boolean; roles?: PlatformRole[] };
      if (payload.isAdmin === false) onAdminLost?.();
      else if (Array.isArray(payload.roles)) onSaved(payload.roles);
    } catch {
      // Relecture impossible : la notification a dit de relire, la page le fera au rechargement.
    }
  };

  const save = async (): Promise<boolean> => {
    setBusy(true);
    fieldErrors.clear();
    try {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Les rôles affichés : un autre administrateur qui les a changés depuis
        // fait refuser l'envoi (`ROLES_CHANGED`) au lieu d'être effacé.
        body: JSON.stringify({ roles: selected, expectedRoles: roles }),
      });
      const payload = (await res.json().catch(() => ({}))) as { roles?: PlatformRole[]; error?: string };
      if (!res.ok) {
        const code = payload.error || "ROLES_UPDATE_FAILED";
        throw new CodedError(code, selfRolesErrorMessage(code, text));
      }
      // Les rôles confirmés par le serveur, jamais ceux cochés à l'écran : une réponse
      // sans corps lisible vaut échec, pas succès.
      if (!Array.isArray(payload.roles)) {
        // L'enregistrement a peut-être abouti sans que la réponse le dise : la session est relue.
        router.refresh();
      }
      if (!Array.isArray(payload.roles)) throw new CodedError("ROLES_UPDATE_FAILED", t("platformRoles.errors.fallback"));
      showSuccess(t("platformRoles.saved"));
      onSaved(payload.roles);
      router.refresh();
      return true;
    } catch (e) {
      const message = e instanceof CodedError ? e.message : t("platformRoles.errors.fallback");
      const code = errorCode(e) ?? "ROLES_UPDATE_FAILED";
      showError(message);
      if (code === "ROLES_CHANGED") {
        // La confirmation annonçait un écart périmé : elle se ferme, et les
        // rôles enregistrés sont relus pour que les cases les montrent.
        setPending(null);
        await reloadSavedRoles();
        return true;
      }
      if (DEFINITIVE_REFUSALS.has(code)) {
        // Rien ne sert de rester sur une confirmation qui ne peut plus aboutir.
        setPending(null);
        // Les cases cochées ne valent plus rien : retour aux rôles enregistrés.
        setSelected([...roles]);
        // Plus administrateur : « Mes rôles » n'a plus d'objet. Le profil est
        // tenu par la page (pas par la session que `refresh` relit) : elle le
        // corrige elle-même.
        if (code === "FORBIDDEN" || code === "CANNOT_MODIFY_SELF") onAdminLost?.();
        router.refresh();
        return true;
      }
      // Le focus doit aller à la case, pas derrière la confirmation encore ouverte.
      if (code === "CANNOT_REMOVE_OWN_ADMIN") setPending(null);
      fieldErrors.report(code, message);
      return code === "CANNOT_REMOVE_OWN_ADMIN";
    } finally {
      setBusy(false);
    }
  };

  const change = diffPlatformRoles(roles, selected);
  const dirty = roleChangeNeedsConfirmation(change);

  return (
    <div className="field">
      <InfoHintRow>
        <span className="field-label" id={LEGEND_ID}>
          {t("platformRoles.legend")}
        </span>
        <InfoHint id={HINT_ID} subject={t("platformRoles.legend")}>
          <p>{t("platformRoles.hint")}</p>
        </InfoHint>
      </InfoHintRow>
      <fieldset className={s.rolesList} aria-labelledby={LEGEND_ID}>
        {PLATFORM_ROLES.map((role) => {
          const locked = role === "ADMIN";
          const id = `profile-role-${role}`;
          const descriptionId = `${id}-description`;
          return (
            <div key={role} className={s.roleItem}>
              <InfoHintRow>
                <Coche
                  id={id}
                  label={t(`platformRoles.labels.${role}`)}
                  checked={selected.includes(role)}
                  theme="joueur"
                  // Verrouillée (ADMIN) ou occupée (envoi) : deux états, deux
                  // apparences (`Coche`) ; la case verrouillée n'est jamais « occupée ».
                  aria-busy={(busy && !locked) || undefined}
                  aria-disabled={locked || busy || undefined}
                  {...(locked
                    ? fieldErrors.aria("admin", descriptionId, ADMIN_HINT_ID)
                    : { "aria-describedby": descriptionId })}
                  onChange={() => toggle(role)}
                />
                {locked ? (
                  <InfoHint id={ADMIN_HINT_ID} subject={t("platformRoles.labels.ADMIN")}>
                    <p>{t("platformRoles.adminLocked")}</p>
                  </InfoHint>
                ) : null}
              </InfoHintRow>
              <p id={descriptionId} className={s.hint}>
                {t(`platformRoles.descriptions.${role}`)}
              </p>
              {locked ? <FieldErrorText fieldId={ADMIN_FIELD_ID} message={fieldErrors.message("admin")} /> : null}
            </div>
          );
        })}
      </fieldset>
      <div className={s.rolesActions}>
        <button
          type="button"
          className="btn"
          aria-busy={busy || undefined}
          aria-disabled={busy || !dirty || undefined}
          onClick={() => {
            if (busy) return;
            if (!dirty) {
              showError(t("platformRoles.nothingToSave"));
              return;
            }
            setPending(change);
          }}
        >
          {busy ? t("platformRoles.saving") : t("platformRoles.save")}
        </button>
      </div>
      {pending ? (
        <ConfirmActionDialog
          title={t("platformRoles.confirmTitle")}
          confirmLabel={t("platformRoles.save")}
          pendingLabel={t("platformRoles.saving")}
          tone={roleChangeTone(pending)}
          onClose={() => setPending(null)}
          onConfirm={save}
        >
          <RoleChangeSummary change={pending} text={text} />
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}

/**
 * La section « Mes rôles » : rendue pour un administrateur seulement, rien
 * sinon (la navigation l'écarte déjà, `requires: "adminRoles"`).
 */
export function SelfRolesSection({
  section,
  isAdmin,
  userId,
  roles,
  onSaved,
  onAdminLost,
}: Readonly<{
  section: Section;
  isAdmin: boolean;
  userId: number;
  roles: readonly PlatformRole[];
  onSaved: (roles: PlatformRole[]) => void;
  onAdminLost?: () => void;
}>): React.ReactElement | null {
  if (!isAdmin) return null;
  return (
    <ProfileSection section={section}>
      <SelfRolesField userId={userId} roles={roles} onSaved={onSaved} onAdminLost={onAdminLost} />
    </ProfileSection>
  );
}

/** Ce que l'on gagne et perd, rôle par rôle. */
function RoleChangeSummary({ change, text }: Readonly<{ change: PlatformRoleChange; text: ProfileText }>) {
  const { t } = text;
  const list = (roles: readonly PlatformRole[]) => (
    <ul>
      {roles.map((role) => (
        <li key={role}>
          <strong>{t(`platformRoles.labels.${role}`)}</strong> — {t(`platformRoles.descriptions.${role}`)}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {change.granted.length > 0 ? (
        <>
          <p>{t("platformRoles.gains")}</p>
          {list(change.granted)}
        </>
      ) : null}
      {change.removed.length > 0 ? (
        <>
          <p>{t("platformRoles.loses")}</p>
          {list(change.removed)}
        </>
      ) : null}
    </>
  );
}
