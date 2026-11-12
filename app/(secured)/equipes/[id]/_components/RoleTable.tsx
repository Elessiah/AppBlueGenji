"use client";

import { memo, useCallback, useId, useRef } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { Coche } from "@/components/Coche";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { TEAM_ROLE_ORDER, teamRoleLabel } from "@/lib/shared/team-role-display";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { RolePills } from "./RolePills";
import styles from "../team.module.css";

interface RoleTableProps {
  /**
   * Rôles cochés. Absent : tableau de **lecture** (« Ce que fait chaque
   * rôle »), sans case.
   */
  selected?: readonly TeamRole[];
  onChange?: (roles: TeamRole[]) => void;
  /** Rôles qui portent une case ; les autres se lisent seulement (`OWNER` ne se coche jamais). */
  checkable?: readonly TeamRole[];
}

/**
 * Rôle sans case. Dans un tableau à cocher (propriétaire) : un libellé, pas la
 * pastille pleine qui dit « a ce rôle » partout ailleurs ; en lecture : la pastille.
 */
function roleLabel(role: TeamRole, label: string, tickMode: boolean) {
  if (tickMode) return <span className={styles.roleTableStatic}>{label}</span>;
  return <RolePills roles={[role]} label={label} />;
}

function roleTableColumns(t: ReturnType<typeof useTeamPageText>["t"]) {
  return {
    team: t("roleGuide.column.team"),
    matches: t("roleGuide.column.matches"),
    messages: t("roleGuide.column.messages"),
  };
}

interface RoleTableRowProps {
  role: TeamRole;
  hintId: string;
  /** La ligne porte une case. */
  tickable: boolean;
  checked: boolean;
  /** Tableau à cocher (et non de lecture) : un rôle sans case se lit en libellé. */
  tickMode: boolean;
  onToggle: (role: TeamRole) => void;
}

/**
 * Une ligne du tableau, mémorisée : textes statiques (une vingtaine de
 * recherches de clé et un « i ») que cocher une autre ligne ne change pas.
 */
const RoleTableRow = memo(function RoleTableRow({ role, hintId, tickable, checked, tickMode, onToggle }: Readonly<RoleTableRowProps>) {
  const { t, locale } = useTeamPageText();
  const label = teamRoleLabel(role, locale);
  const columns = roleTableColumns(t);
  return (
    <div role="row" className={styles.roleTableRow}>
      <span role="rowheader" className={styles.roleTableRole}>
        <InfoHintRow>
          {tickable ? (
            <Coche label={label} checked={checked} theme="equipe" onChange={() => onToggle(role)} aria-describedby={hintId} />
          ) : (
            roleLabel(role, label, tickMode)
          )}
          <InfoHint id={hintId} subject={label}>
            <p>{t(`roleGuide.roles.${role}.hint`)}</p>
          </InfoHint>
        </InfoHintRow>
        {role === "OWNER" && tickMode ? <span className={styles.roleTableNote}>{t("roleGuide.transferOnly")}</span> : null}
      </span>
      <span role="cell" data-label={columns.team}>
        {t(`roleGuide.roles.${role}.team`)}
      </span>
      <span role="cell" data-label={columns.matches}>
        {t(`roleGuide.roles.${role}.matches`)}
      </span>
      <span role="cell" data-label={columns.messages}>
        {t(`roleGuide.roles.${role}.messages`)}
      </span>
    </div>
  );
});

/**
 * Tableau de **tous** les rôles d'équipe : ce que chacun peut faire sur
 * l'équipe, en match, et les messages qu'il reçoit — le « i » de chaque rôle
 * dit qui le donne et ce qu'il ne permet pas.
 *
 * Il remplace les pastilles à cocher du formulaire d'invitation, qu'un joueur
 * avait prises pour ses propres rôles : les rôles d'une invitation se cochent
 * désormais dans une modale, ligne par ligne, avec ce qu'ils ouvrent sous les
 * yeux. Les textes suivent le code (`TEAM_MEMBERS_UX.md` en cite les sources) :
 * un changement de droit ou de destinataire les change aussi.
 *
 * Rôles ARIA de tableau, comme le roster : `.table-row` replie à 920 px de
 * **fenêtre**, trop tard pour une modale ; le repli vit dans `team.module.css`
 * (`roleTable`), en-têtes gardés pour les lecteurs d'écran, `data-label` en
 * libellé visuel seulement.
 */
export function RoleTable({ selected, onChange, checkable = [] }: Readonly<RoleTableProps>) {
  const baseId = useId();
  const { t } = useTeamPageText();
  // Le dernier état, lu à la bascule : `toggle` garde une identité fixe, si bien
  // que cocher un rôle ne refait que **sa** ligne (`RoleTableRow` est mémorisée).
  const latest = useRef({ selected, onChange });
  latest.current = { selected, onChange };
  const toggle = useCallback((role: TeamRole) => {
    const { selected: current, onChange: change } = latest.current;
    if (!current || !change) return;
    change(current.includes(role) ? current.filter((r) => r !== role) : [...current, role]);
  }, []);
  const columns = roleTableColumns(t);

  return (
    <div className={styles.roleTableWrap}>
      <div className={styles.roleTable} role="table" aria-label={t("roleGuide.tableLabel")}>
        <div role="rowgroup">
          <div role="row" className={`${styles.roleTableRow} ${styles.roleTableHeader}`}>
            <span role="columnheader">{t("roleGuide.column.role")}</span>
            <span role="columnheader">{columns.team}</span>
            <span role="columnheader">{columns.matches}</span>
            <span role="columnheader">{columns.messages}</span>
          </div>
        </div>
        <div role="rowgroup" className={styles.roleTableBody} data-tap-zone>
          {TEAM_ROLE_ORDER.map((role) => (
            <RoleTableRow
              key={role}
              role={role}
              hintId={`${baseId}-${role}`}
              tickable={Boolean(selected && onChange) && checkable.includes(role)}
              checked={selected?.includes(role) ?? false}
              tickMode={Boolean(selected)}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>
      <InfoHintRow>
        <span className={styles.roleTableLead}>{t("roleGuide.noticesTitle")}</span>
        <InfoHint id={`${baseId}-notices`} subject={t("roleGuide.noticesTitle")}>
          <p>{t("roleGuide.noticesLine")}</p>
          <p>{t("roleGuide.noticesHint")}</p>
        </InfoHint>
      </InfoHintRow>
    </div>
  );
}
