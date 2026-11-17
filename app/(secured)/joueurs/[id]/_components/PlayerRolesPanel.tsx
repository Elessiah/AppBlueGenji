"use client";

import { useEffect, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  diffPlatformRoles,
  roleChangeNeedsConfirmation,
  roleChangeTone,
  type PlatformRole,
  type PlatformRoleChange,
} from "@/lib/shared/permissions";
import { useStaffLang } from "@/components/i18n/staff-lang";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { BUSY_REFUSED_MESSAGE } from "@/lib/shared/busy-refused-message";
import { reloadSucceeded } from "@/lib/shared/reload-outcome";
import { rolesErrorMessage } from "../_lib/roles-errors";

/**
 * Attribution des rôles de plateforme depuis la fiche d'un joueur (réservée à
 * l'administration ; la page ne la rend ni sur sa propre fiche ni sur celle
 * d'un compte supprimé, que la route refuse).
 *
 * Tout enregistrement qui accorde ou retire un rôle passe par une modale qui
 * dit ce que le joueur gagne et perd (`ADMIN_CONFIRMATIONS.md`). Le panneau
 * n'est jamais rendu sur sa propre fiche : un administrateur règle les siens
 * depuis « Mon profil » (`SelfRolesField`), sans pouvoir s'y retirer `ADMIN`.
 *
 * Outil de l'administration : il reste **français** sous `/en` (D4), annoncé
 * `lang="fr"` — panneau, confirmation et notifications.
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
  /** Relit la fiche ; `false` : relecture échouée, les rôles affichés sont peut-être périmés. */
  onSaved: () => Promise<boolean | void> | void;
}>) {
  const { showError, showInfo, showSuccess } = useToast();
  const staffLang = useStaffLang();
  const toastLang = staffLang ? { lang: staffLang } : undefined;
  // Un enregistrement à la fois ; pendant l'envoi, les cases gardent le focus
  // (`aria-readonly`, choix ignoré) et le bouton s'annonce occupé (`BUSY_BUTTONS.md`).
  const { busy: rolesBusy, isBusy, run } = useBusyGuard();
  const [selectedRoles, setSelectedRoles] = useState<PlatformRole[]>([]);
  const [pendingChange, setPendingChange] = useState<PlatformRoleChange | null>(null);

  // Resynchronise la sélection locale à chaque (re)chargement du profil.
  useEffect(() => {
    if (roles) setSelectedRoles(roles);
  }, [roles]);

  const toggleRole = (role: PlatformRole) => {
    // Ce qui est coché est ce qui part : une case changée pendant l'envoi est ignorée.
    if (isBusy()) return;
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  // Refusé par la garde (un enregistrement attend encore) : la confirmation
  // reste ouverte, et la notification dit pourquoi.
  const saveRoles = async (): Promise<boolean> => {
    const done = await run(sendRoles);
    if (done === undefined) {
      showInfo(BUSY_REFUSED_MESSAGE, { ...toastLang, once: true });
      return false;
    }
    return done;
  };

  // Relecture de la fiche qui échoue : les rôles affichés (et `expectedRoles`
  // du prochain envoi) resteraient périmés sans que rien ne le dise.
  const reloadProfile = async (failureCode: string) => {
    const reloaded = await reloadSucceeded(onSaved);
    if (!reloaded) showError(rolesErrorMessage(failureCode), toastLang);
  };

  const sendRoles = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Les rôles affichés : si un autre réglage a abouti depuis, la route
        // refuse (`ROLES_CHANGED`) au lieu de l'effacer sans le dire.
        body: JSON.stringify({ roles: selectedRoles, expectedRoles: roles }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "ROLES_UPDATE_FAILED");
      showSuccess("Rôles mis à jour.", toastLang);
      await reloadProfile("ROLES_SAVED_RELOAD_FAILED");
      return true;
    } catch (e) {
      const code = (e as Error).message;
      showError(rolesErrorMessage(code), toastLang);
      if (code === "ROLES_CHANGED") {
        // La fiche relit les rôles enregistrés (la sélection s'y resynchronise)
        // et la confirmation, qui annonçait un écart périmé, se ferme.
        await reloadProfile("PROFILE_RELOAD_FAILED");
        return true;
      }
      return false;
    }
  };

  const requestSave = () => {
    if (isBusy()) {
      showInfo(BUSY_REFUSED_MESSAGE, { ...toastLang, once: true });
      return;
    }
    // Sans les rôles enregistrés, rien ne permet de détecter un réglage concurrent.
    if (!roles) return;
    const change = diffPlatformRoles(roles ?? [], selectedRoles);
    if (roleChangeNeedsConfirmation(change)) setPendingChange(change);
    // Aucune case changée : rien à enregistrer (ni requête, ni ligne au journal du staff).
    else showInfo("Aucun rôle n'a changé : rien à enregistrer.", toastLang);
  };

  return (
    <div className="ds-block" style={{ marginBottom: 20, borderColor: "rgba(var(--violet-400-rgb), 0.3)" }} lang={staffLang}>
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
                aria-readonly={rolesBusy || undefined}
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
        <BusyButton
          busy={rolesBusy}
          blocked={!roles}
          className="btn"
          style={{ padding: "9px 18px", fontSize: 13 }}
          aria-label={`Enregistrer les rôles de ${pseudo}`}
          onClick={requestSave}
        >
          {/* Libellé constant : le nom accessible contient le texte visible ; l'attente se dit par `aria-busy`. */}
          Enregistrer les rôles
        </BusyButton>
      </div>
      {pendingChange ? (
        <ConfirmActionDialog
          contentLang={staffLang}
          title={`Modifier les rôles de ${pseudo} ?`}
          confirmLabel="Enregistrer les rôles"
          pendingLabel="Enregistrement…"
          tone={roleChangeTone(pendingChange)}
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
