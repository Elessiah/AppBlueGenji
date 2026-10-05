"use client";

import { useEffect, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  diffPlatformRoles,
  roleChangeNeedsConfirmation,
  type PlatformRole,
  type PlatformRoleChange,
} from "@/lib/shared/permissions";

/**
 * Attribution des rôles de plateforme depuis la fiche d'un joueur (réservée à
 * l'administration ; la page ne la rend ni sur sa propre fiche ni sur celle
 * d'un compte supprimé, que la route refuse).
 *
 * Tout enregistrement qui accorde ou retire un rôle passe par une modale qui
 * dit ce que le joueur gagne et perd (`ADMIN_CONFIRMATIONS.md`). Retirer son
 * propre accès est impossible ici : le panneau n'est jamais rendu sur sa
 * propre fiche, et la route refuse en `CANNOT_MODIFY_SELF`.
 */
export function PlayerRolesPanel({
  userId,
  pseudo,
  roles,
  onSaved,
}: Readonly<{
  userId: string;
  pseudo: string;
  roles: PlatformRole[] | undefined;
  onSaved: () => Promise<void> | void;
}>) {
  const { showError, showSuccess } = useToast();
  const [rolesBusy, setRolesBusy] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<PlatformRole[]>([]);
  const [pendingChange, setPendingChange] = useState<PlatformRoleChange | null>(null);

  // Resynchronise la sélection locale à chaque (re)chargement du profil.
  useEffect(() => {
    if (roles) setSelectedRoles(roles);
  }, [roles]);

  const toggleRole = (role: PlatformRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const saveRoles = async (): Promise<boolean> => {
    setRolesBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roles: selectedRoles }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "ROLES_UPDATE_FAILED");
      showSuccess("Rôles mis à jour.");
      await onSaved();
      return true;
    } catch (e) {
      showError((e as Error).message);
      return false;
    } finally {
      setRolesBusy(false);
    }
  };

  const requestSave = () => {
    const change = diffPlatformRoles(roles ?? [], selectedRoles);
    if (roleChangeNeedsConfirmation(change)) setPendingChange(change);
    else void saveRoles();
  };

  return (
    <div className="ds-block" style={{ marginBottom: 20, borderColor: "rgba(var(--violet-400-rgb), 0.3)" }}>
      <div className="ds-section-title purple">
        <h2>Rôles &amp; permissions</h2>
      </div>
      <p style={{ color: "var(--ink-quiet)", fontSize: 13, marginBottom: 16 }}>
        Les rôles sont cumulables. Un administrateur dispose de tous les droits, dont l&apos;attribution des rôles.
      </p>
      <fieldset className="native-group" aria-label="Rôles de permission" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {PLATFORM_ROLES.map((role) => {
          const checked = selectedRoles.includes(role);
          return (
            <label // NOSONAR S6853 — label englobant : la case et le texte (ROLE_LABELS) sont à l'intérieur
              key={role}
              style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: rolesBusy ? "default" : "pointer" }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={rolesBusy}
                onChange={() => toggleRole(role)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ display: "block", fontSize: 14, color: "var(--ink)" }}>{ROLE_LABELS[role]}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--ink-mute)" }}>{ROLE_DESCRIPTIONS[role]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button
          type="button"
          className="btn"
          style={{ padding: "9px 18px", fontSize: 13 }}
          disabled={rolesBusy}
          aria-busy={rolesBusy}
          aria-label={`Enregistrer les rôles de ${pseudo}`}
          onClick={requestSave}
        >
          {rolesBusy ? "Enregistrement…" : "Enregistrer les rôles"}
        </button>
      </div>
      {pendingChange ? (
        <ConfirmActionDialog
          title={`Modifier les rôles de ${pseudo} ?`}
          confirmLabel="Enregistrer les rôles"
          pendingLabel="Enregistrement…"
          tone={pendingChange.removed.length > 0 || pendingChange.granted.includes("ADMIN") ? "danger" : "primary"}
          onClose={() => setPendingChange(null)}
          onConfirm={saveRoles}
        >
          <RoleChangeSummary change={pendingChange} />
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}

function RoleList({ roles }: Readonly<{ roles: readonly PlatformRole[] }>) {
  return (
    <ul>
      {roles.map((role) => (
        <li key={role}>
          <strong>{ROLE_LABELS[role]}</strong> — {ROLE_DESCRIPTIONS[role]}
        </li>
      ))}
    </ul>
  );
}

/** Ce que le joueur gagne et perd, rôle par rôle, avec le périmètre de chacun. */
function RoleChangeSummary({ change }: Readonly<{ change: PlatformRoleChange }>) {
  return (
    <>
      {change.granted.length > 0 ? (
        <>
          <p>Il gagne :</p>
          <RoleList roles={change.granted} />
        </>
      ) : null}
      {change.removed.length > 0 ? (
        <>
          <p>Il perd :</p>
          <RoleList roles={change.removed} />
        </>
      ) : null}
      {change.granted.includes("ADMIN") ? (
        <p>
          <strong>Administrateur donne tous les droits</strong>, dont celui d&apos;accorder et de retirer les rôles
          des autres — les tiens compris.
        </p>
      ) : null}
      {change.removed.includes("ADMIN") ? (
        <p>
          <strong>Il perd l&apos;administration</strong> : il ne garde que les droits des rôles encore cochés.
        </p>
      ) : null}
    </>
  );
}
