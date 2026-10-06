"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  FR_RECRUITMENT_TEXT,
  recruitmentText,
  type RecruitmentClientMessages,
  type RecruitmentText,
} from "@/lib/shared/recruitment-text";
import type { Locale } from "@/lib/shared/locales";

/**
 * Textes des composants du recrutement côté client (`lib/shared/recruitment-text.ts`).
 * Hors fournisseur (tests, écran rendu ailleurs) : le français du paquet.
 */
const RecruitmentTextContext = createContext<RecruitmentText>(FR_RECRUITMENT_TEXT);

export function RecruitmentTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: RecruitmentClientMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une page française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  const value = useMemo(() => recruitmentText(locale, messages), [locale, messages]);
  return <RecruitmentTextContext.Provider value={value}>{children}</RecruitmentTextContext.Provider>;
}

export function useRecruitmentText(): RecruitmentText {
  return useContext(RecruitmentTextContext);
}
