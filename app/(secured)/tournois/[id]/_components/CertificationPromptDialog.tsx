"use client";

import { useState } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { anotherModalOpen } from "@/lib/shared/dialog-focus";
import { certificationProfileHref, type CertificationPrompt } from "@/lib/shared/certification-prompt";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import s from "./CertificationPromptDialog.module.css";

/** Lignes du tableau, dans l'ordre de lecture. */
const ROWS = ["identity", "matches", "staff", "later"] as const;

interface CertificationPromptDialogProps {
  prompt: CertificationPrompt;
  /**
   * Case « Ne plus voir », tenue par `useCertificationPrompt` : elle survit à
   * un effacement devant une modale urgente.
   */
  neverAgain: boolean;
  onNeverAgainChange: (value: boolean) => void;
  /** Fermeture ; la case cochée vaut pour toute fermeture. */
  onClose: () => void;
}

/**
 * Invitation à certifier son tag Discord et son BattleTag
 * (`docs/features/CERTIFICATION_PROMPT.md`), ouverte d'office sur la fiche
 * d'un tournoi. Elle dit pourquoi elle s'ouvre, ce qui manque encore, puis ce
 * que la certification fait et ne fait pas — un tableau, pour qu'aucune
 * promesse ne se lise sans sa limite en face. Le bouton mène au profil, à la
 * section « Discord » tant que le tag manque, sinon à « Applications
 * connectées » où Battle.net se rattache (`certificationProfileHref`).
 */
export function CertificationPromptDialog({
  prompt,
  neverAgain,
  onNeverAgainChange,
  onClose,
}: Readonly<CertificationPromptDialogProps>) {
  const { t } = useDialogsText();
  // Lu une fois, au montage (morceau chargé côté client seulement) : une
  // modale urgente ouverte entre la décision et l'arrivée du morceau garde la
  // main — celle-ci, montée après, prendrait sinon le dessus de la pile. Le
  // guet de `useCertificationPrompt` l'efface ensuite.
  const [preempted] = useState(() => anotherModalOpen(document, { overYielding: true }));

  // Marvel Rivals : le BattleTag ne sert à rien, la modale ne parle que de Discord.
  const withBattletag = prompt.battletagRelevant;
  const status = [
    { key: "discord", label: t("certification.discord"), ok: prompt.discordVerified },
    ...(withBattletag
      ? [{ key: "battletag", label: t("certification.battletag"), ok: prompt.battletagVerified }]
      : []),
  ];
  // Variante « Discord seul » d'une cellule, là où la ligne parle de Battle.net.
  const rowText = (row: (typeof ROWS)[number], column: "does" | "doesNot") => {
    if (!withBattletag && row === "identity" && column === "does") {
      return t("certification.rows.identity.doesDiscordOnly");
    }
    if (!withBattletag && row === "later") {
      return t(column === "does" ? "certification.rows.later.doesDiscordOnly" : "certification.rows.later.doesNotDiscordOnly");
    }
    return t(`certification.rows.${row}.${column}`);
  };
  let lead = t("certification.leadManager");
  if (prompt.reason === "TEAM_WITHOUT_CONTACT") {
    lead = t(withBattletag ? "certification.leadTeam" : "certification.leadTeamDiscordOnly");
  }

  if (preempted) return null;

  return (
    <TournamentDialogFrame
      titleId="certification-prompt-title"
      describedBy="certification-prompt-lead"
      maxWidth={640}
      zIndex={90}
      busy={false}
      yields
      onClose={onClose}
    >
      {/* Focus d'ouverture sur le titre : la modale se lit avant d'agir, et ses
          contrôles, tout en bas, l'ouvriraient défilée sur un petit écran. */}
      <h3 id="certification-prompt-title" className={s.title} tabIndex={-1} data-autofocus>
        {t(withBattletag ? "certification.title" : "certification.titleDiscordOnly")}
      </h3>
      <p id="certification-prompt-lead" className={s.lead}>
        {lead}
      </p>

      <ul className={s.status} aria-label={t("certification.statusLabel")}>
        {status.map((item) => (
          <li key={item.key} className={s.statusItem}>
            <span>{item.label}</span>
            <span className={`pill ${item.ok ? "pill-success" : "pill-warning"}`}>
              {t(item.ok ? "certification.done" : "certification.missing")}
            </span>
          </li>
        ))}
      </ul>

      {/* Tableau en rôles ARIA, comme le roster d'équipe : sous 560 px les
          lignes passent en cartes, et un vrai <table> remis en bloc perd sa
          sémantique dans Safari (RESPONSIVE_TABLES.md). */}
      <p id="certification-prompt-caption" className={s.caption}>
        {t("certification.tableCaption")}
      </p>
      <div className={s.table} role="table" aria-labelledby="certification-prompt-caption">
        <div role="rowgroup" className={s.head}>
          <div role="row" className={s.row}>
            <span role="columnheader" className="sr-only">
              {t("certification.colTopic")}
            </span>
            <span role="columnheader">{t("certification.colDoes")}</span>
            <span role="columnheader">{t("certification.colDoesNot")}</span>
          </div>
        </div>
        <div role="rowgroup">
          {ROWS.map((row) => (
            <div key={row} role="row" className={s.row}>
              <span role="rowheader" className={s.topic}>
                {t(`certification.rows.${row}.topic`)}
              </span>
              <span role="cell" className={s.does} data-label={t("certification.colDoes")}>
                {rowText(row, "does")}
              </span>
              <span role="cell" className={s.doesNot} data-label={t("certification.colDoesNot")}>
                {rowText(row, "doesNot")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.footer}>
        <label className={s.neverAgain}>
          <input type="checkbox" checked={neverAgain} onChange={(e) => onNeverAgainChange(e.target.checked)} />
          {/* NOSONAR S6772 — label en flex avec `gap` */}
          {t("certification.neverAgain")}
        </label>
        <div className={s.actions}>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("certification.later")}
          </button>
          <LocaleLink href={certificationProfileHref(prompt)} className="btn" onClick={onClose}>
            {t("certification.go")}
          </LocaleLink>
        </div>
      </div>
    </TournamentDialogFrame>
  );
}
