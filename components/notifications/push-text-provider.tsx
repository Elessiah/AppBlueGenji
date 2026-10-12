"use client";

import type frPush from "@/messages/fr/push.json";
import { createScopedTextSlot } from "@/components/i18n/scoped-text-context";

/**
 * Le fournisseur des textes `push`, **sans** leur français (revue de
 * performance du lot 9-2) : posé par la mise en page de `/profil` (anglais
 * sérialisé sous `/en` seulement) et par la fenêtre de lancement d'un match
 * (anglais dans son morceau chargé à la demande). Le français voyage avec le
 * panneau (`push-text.ts`).
 */
export const pushTextSlot = createScopedTextSlot<typeof frPush>();

export const PushTextProvider = pushTextSlot.Provider;
