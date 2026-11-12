"use client";

import dynamic from "next/dynamic";
import { memo, useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { Coche } from "@/components/Coche";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { teamRoleLabel } from "@/lib/shared/team-role-display";
import { SELF_ASSIGNABLE_ROLES, isLeadingRole } from "@/lib/shared/team-roles";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { RolePills } from "./RolePills";
import { isCheckboxEnter, ownGameRolesToSave } from "../_lib/member-roles";
import styles from "../team.module.css";

// Chargée au clic sur « Ce que fait chaque rôle » : elle embarque le tableau des rôles.
const RoleGuideDialog = dynamic(() => import("./RoleGuideDialog").then((m) => m.RoleGuideDialog), { ssr: false });

interface MyRolesBlockProps {
  /** Rôles actuels du lecteur dans cette équipe. */
  roles: readonly TeamRole[];
  /** Enregistre ses rôles de jeu ; rend `true` sur un succès. */
  onSave: (gameRoles: TeamRole[]) => Promise<boolean>;
}

/**
 * « Mes rôles » : le lecteur, membre de l'équipe, choisit **ses propres** rôles
 * de jeu (Coach, Tank, DPS, Soutien — décision D71), et lit ceux de direction
 * que la gestion lui a donnés. Un bloc à part, titré, loin du formulaire
 * d'invitation : c'est la confusion entre les deux qui l'a fait naître.
 */
export const MyRolesBlock = memo(function MyRolesBlock({ roles, onSave }: Readonly<MyRolesBlockProps>) {
  const { t, locale } = useTeamPageText();
  const saved = SELF_ASSIGNABLE_ROLES.filter((role) => roles.includes(role));
  const leading = roles.filter(isLeadingRole);
  const [selected, setSelected] = useState<TeamRole[]>(saved);
  // Rôles enregistrés changés (enregistrement, ou modale de la gestion) : le
  // brouillon repart d'eux **sans remonter le bloc** — un remontage ferait
  // perdre le focus du bouton « Enregistrer » et refermerait la modale du guide.
  // Sauf s'il a été modifié à la main : une relecture venue d'ailleurs (un
  // gestionnaire, un autre onglet) ne doit pas effacer une sélection en cours.
  const savedKey = saved.join(",");
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    const previous = syncedKey === "" ? [] : (syncedKey.split(",") as TeamRole[]);
    setSyncedKey(savedKey);
    if (ownGameRolesToSave(previous, selected) === null) setSelected(saved);
  }
  const [pending, setPending] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const toSave = ownGameRolesToSave(saved, selected);
  const unchanged = toSave === null;

  const toggle = (role: TeamRole) =>
    setSelected((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));

  const save = async () => {
    if (toSave === null || pending) return;
    setPending(true);
    await onSave(toSave);
    setPending(false);
  };

  return (
    <div className={styles.divider}>
      <InfoHintRow>
        <h3 id="team-my-roles-title" className={styles.subTitle}>
          {t("myRoles.title")}
        </h3>
        <InfoHint id="team-my-roles-help" subject={t("myRoles.title")}>
          <p>{t("myRoles.hint")}</p>
        </InfoHint>
      </InfoHintRow>
      <form
        className={styles.myRoles}
        aria-labelledby="team-my-roles-title"
        onKeyDown={(event) => {
          if (isCheckboxEnter(event.key, event.target)) event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={styles.myRolesLeading}>
          <span className={styles.myRolesLabel}>{t("myRoles.leadingLabel")}</span>
          {leading.length > 0 ? (
            <RolePills roles={leading} label={t("myRoles.leadingLabel")} />
          ) : (
            <span className={styles.joinedAt}>{t("myRoles.noLeading")}</span>
          )}
        </div>
        <fieldset className={styles.roleGroup}>
          <legend className={styles.roleGroupLegend}>{t("myRoles.gameLegend")}</legend>
          <div className={styles.roleGroupOptions} data-tap-zone>
            {SELF_ASSIGNABLE_ROLES.map((role) => (
              <Coche
                key={role}
                label={teamRoleLabel(role, locale)}
                checked={selected.includes(role)}
                theme="equipe"
                onChange={() => toggle(role)}
              />
            ))}
          </div>
        </fieldset>
        <div className={styles.formFooter}>
          <button type="button" className={`btn ghost ${styles.smallButton}`} onClick={() => setGuideOpen(true)}>
            {t("myRoles.guideButton")}
          </button>
          {/* Jamais `disabled` : le bouton garde le focus clavier pendant l'envoi ;
              le gestionnaire ignore tout envoi sans changement. */}
          <button
            type="submit"
            className={`btn ${styles.primaryButton}`}
            aria-disabled={unchanged || pending || undefined}
            aria-busy={pending || undefined}
          >
            {pending ? t("myRoles.saving") : t("myRoles.save")}
          </button>
        </div>
      </form>
      {guideOpen ? <RoleGuideDialog onClose={() => setGuideOpen(false)} /> : null}
    </div>
  );
});
