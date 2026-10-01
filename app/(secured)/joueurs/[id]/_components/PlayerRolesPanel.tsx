"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type PlatformRole,
} from "@/lib/shared/permissions";

/**
 * Attribution des rôles de plateforme depuis la fiche d'un joueur (réservée à
 * l'administration ; la page ne la rend ni sur sa propre fiche ni sur celle
 * d'un compte supprimé, que la route refuse).
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

  // Resynchronise la sélection locale à chaque (re)chargement du profil.
  useEffect(() => {
    if (roles) setSelectedRoles(roles);
  }, [roles]);

  const toggleRole = (role: PlatformRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const saveRoles = async () => {
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
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setRolesBusy(false);
    }
  };

  return (
    <div className="ds-block" style={{ marginBottom: 20 }}>
      <div className="ds-section-title blue">
        <h2>Rôles &amp; permissions</h2>
      </div>
      <p style={{ color: "var(--text-2)", fontSize: 13, marginBottom: 16 }}>
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
                <span style={{ display: "block", fontSize: 14, color: "var(--text-0)" }}>{ROLE_LABELS[role]}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--text-2)" }}>{ROLE_DESCRIPTIONS[role]}</span>
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
          onClick={saveRoles}
        >
          {rolesBusy ? "Enregistrement…" : "Enregistrer les rôles"}
        </button>
      </div>
    </div>
  );
}
