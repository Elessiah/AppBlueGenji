"use client";

import { BookOpen, CalendarClock, Plus, SearchX, Trophy } from "lucide-react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { CyberButton } from "@/components/cyber/CyberButton";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import type { ListEmptyKind } from "./_lib/empty-state";
import { pageSectionAnchor } from "./_lib/page-sections";
import s from "./tournois.module.css";

const ICONS = { empty: Trophy, filtered: SearchX, nothingUpcoming: CalendarClock } as const;

const TEXT_KEYS = {
  empty: { title: "list.emptyState.emptyTitle", message: "list.emptyState.emptyMsg" },
  filtered: { title: "list.emptyState.filteredTitle", message: "list.emptyState.filteredMsg" },
  nothingUpcoming: { title: "list.emptyState.nothingUpcomingTitle", message: "list.emptyState.nothingUpcomingMsg" },
} as const;

/**
 * État vide de `/tournois` : un panneau qui dit ce qu'il en est et propose une
 * suite (`docs/features/TOURNOIS_LIST_EMPTY_LOOK.md`) au lieu d'un grand vide
 * noir sous la barre d'outils, ou sous une carte unique.
 *
 * - « Créer un tournoi » n'apparaît que pour le droit `tournaments` (`canManage`),
 *   et jamais sur un résultat de filtre : effacer le filtre est la suite logique.
 * - « Voir les tournois terminés » n'apparaît qu'avec des terminés à montrer.
 */
export function ListEmptyState({
  kind,
  canManage,
  finishedCount = 0,
  onClearFilters,
  onShowFinished,
}: Readonly<{
  kind: ListEmptyKind;
  canManage: boolean;
  finishedCount?: number;
  onClearFilters?: () => void;
  onShowFinished?: () => void;
}>) {
  const { t } = useTournamentsText();
  const Icon = ICONS[kind];
  const keys = TEXT_KEYS[kind];
  const message = <p className={s.emptyMsg}>{t(keys.message)}</p>;

  return (
    <div className={s.emptyState} data-kind={kind}>
      <span className={s.emptyIcon} aria-hidden="true">
        <Icon size={22} strokeWidth={1.6} />
      </span>
      <h2 className={s.emptyTitle}>{t(keys.title)}</h2>
      {kind === "nothingUpcoming" ? (
        <InfoHintRow inline>
          {message}
          <InfoHint id="tournaments-nothing-upcoming-help" subject={t(keys.title)}>
            <p>{t("list.emptyState.nothingUpcomingHint")}</p>
          </InfoHint>
        </InfoHintRow>
      ) : (
        message
      )}
      <div className={s.emptyActions}>
        {kind === "filtered" ? (
          <CyberButton variant="ghost" type="button" onClick={onClearFilters}>
            <SearchX size={14} aria-hidden="true" />
            {t("list.emptyState.clearFilters")}
          </CyberButton>
        ) : (
          <>
            {canManage && (
              <CyberButton asChild variant="primary">
                <LocaleLink href="/tournois/creer">
                  <Plus size={14} aria-hidden="true" />
                  {t("list.create")}
                </LocaleLink>
              </CyberButton>
            )}
            {kind === "nothingUpcoming" && finishedCount > 0 && (
              <CyberButton asChild variant="ghost">
                <a href={`#${pageSectionAnchor("finished")}`} onClick={onShowFinished}>
                  <Trophy size={14} aria-hidden="true" />
                  {t("list.emptyState.finished")}
                </a>
              </CyberButton>
            )}
            <CyberButton asChild variant="ghost">
              <LocaleLink href="/regles">
                <BookOpen size={14} aria-hidden="true" />
                {t("list.emptyState.rules")}
              </LocaleLink>
            </CyberButton>
          </>
        )}
      </div>
    </div>
  );
}
