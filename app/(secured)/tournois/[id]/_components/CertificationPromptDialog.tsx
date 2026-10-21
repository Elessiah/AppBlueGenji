"use client";

import { memo, useState } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { anotherModalOpen } from "@/lib/shared/dialog-focus";
import { isPlainLeftClick } from "@/lib/shared/site-back";
import { certificationProfileHref, type CertificationPrompt } from "@/lib/shared/certification-prompt";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import s from "./CertificationPromptDialog.module.css";

/** Lignes du tableau, dans l'ordre de lecture. */
const ROWS = ["identity", "matches", "messages", "staff", "later"] as const;

/**
 * Variante « Discord seul » (Marvel Rivals) des cellules qui parlent de
 * BattleTag, de Blizzard ou de Battle.net.
 */
const DISCORD_ONLY_CELLS = {
  "identity.does": "certification.rows.identity.doesDiscordOnly",
  "matches.does": "certification.rows.matches.doesDiscordOnly",
  "matches.doesNot": "certification.rows.matches.doesNotDiscordOnly",
  "later.does": "certification.rows.later.doesDiscordOnly",
  "later.doesNot": "certification.rows.later.doesNotDiscordOnly",
} as const satisfies Partial<Record<`${(typeof ROWS)[number]}.${"does" | "doesNot"}`, string>>;
type DiscordOnlyCell = keyof typeof DISCORD_ONLY_CELLS;

interface CertificationPromptDialogProps {
  prompt: CertificationPrompt;
  /**
   * Case « Ne plus voir » : affichée ici, retenue par `useCertificationPrompt`
   * (cochée, elle vaut aussi quand la modale s'efface devant une urgente).
   */
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
function CertificationPromptDialogView({
  prompt,
  onNeverAgainChange,
  onClose,
}: Readonly<CertificationPromptDialogProps>) {
  const { t } = useDialogsText();
  const [neverAgain, setNeverAgain] = useState(false);
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
    const cell = `${row}.${column}` as const;
    if (!withBattletag && cell in DISCORD_ONLY_CELLS) return t(DISCORD_ONLY_CELLS[cell as DiscordOnlyCell]);
    return t(`certification.rows.${row}.${column}`);
  };
  // Le titre ne demande que ce qui manque : Discord déjà certifié, il ne parle
  // plus que du BattleTag, et inversement.
  let title = t("certification.titleDiscordOnly");
  if (withBattletag && !prompt.battletagVerified) {
    title = t(prompt.discordVerified ? "certification.titleBattletagOnly" : "certification.title");
  }
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
      // Focus d'ouverture sur le cadre : la modale se lit avant d'agir, et ses
      // contrôles, tout en bas, l'ouvriraient défilée sur un petit écran.
      initialFocus="container"
      onClose={onClose}
    >
      <h3 id="certification-prompt-title" className={s.title}>
        {title}
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
            {/* L'en-tête garde sa case de grille ; seul son texte est masqué. */}
            <span role="columnheader">
              <span className="sr-only">{t("certification.colTopic")}</span>
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
          <input type="checkbox" checked={neverAgain} onChange={(e) => {
              setNeverAgain(e.target.checked);
              onNeverAgainChange(e.target.checked);
            }} />
          {/* NOSONAR S6772 — label en flex avec `gap` */}
          {t("certification.neverAgain")}
        </label>
        <div className={s.actions}>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("certification.later")}
          </button>
          <LocaleLink
            href={certificationProfileHref(prompt)}
            className="btn"
            onClick={(event) => {
              // Ouvert dans un nouvel onglet (Ctrl, Cmd, Maj, clic du milieu) :
              // la modale reste là, rien n'est retenu.
              if (isPlainLeftClick(event)) onClose();
            }}
          >
            {t("certification.go")}
          </LocaleLink>
        </div>
      </div>
    </TournamentDialogFrame>
  );
}

/**
 * Mémoïsée : la fiche se rend à chaque instantané du flux, et les props de la
 * modale (invitation rejouée telle quelle, rappels stables) ne bougent pas.
 */
export const CertificationPromptDialog = memo(CertificationPromptDialogView);
