"use client";

import { FormEvent, useState, type ReactNode } from "react";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useToast } from "@/components/ui/toast";
import { richNodes } from "@/components/i18n/shell-text";
import { pageDateTime } from "@/lib/shared/tournament-page-text";
import { toParticipantType } from "@/lib/shared/participants";
import { formatLocalDateTime } from "@/lib/shared/dates";
import {
  advanceTarget,
  willCloseWithoutMatches,
  type AdvanceTarget,
} from "@/lib/shared/tournament-launch";
import { computeTournamentProgress } from "@/lib/shared/tournament-progress";
import type { TournamentCard, TournamentState } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogShell } from "./TournamentDialogShell";

type AdvanceResult = { target: AdvanceTarget; state: TournamentState; entrantCount: number };

interface AdvanceTournamentDialogProps {
  card: TournamentCard;
  onClose: () => void;
  onAdvanced: (result: AdvanceResult) => void;
}

/**
 * Confirmation de « Avancer le tournoi » : l'étape suivante, sur-le-champ.
 *
 * Pas de recopie du nom, contrairement à la suppression : le tournoi n'est pas
 * détruit, il avance — au pire une heure trop tôt. Mais l'action reste sans
 * retour (rien ne rouvre des inscriptions closes), et le dialogue dit donc
 * concrètement ce qui change plutôt qu'un « êtes-vous sûr ? » : le **passage**
 * d'une étape à l'autre, nommé comme sur la frise en bas de la fiche
 * (`tournament-progress.ts`), la date qu'on abandonne, et l'effectif.
 *
 * Le cas du plateau désert est annoncé avant le clic et non découvert après :
 * lancer à moins de deux engagés clôt le tournoi sur-le-champ
 * (`docs/features/UNDERFILLED_TOURNAMENTS.md`), et le bouton le dit alors.
 *
 * Coquille (portail, voile, titre, boutons) : `TournamentDialogShell`.
 */
export function AdvanceTournamentDialog({
  card,
  onClose,
  onAdvanced,
}: Readonly<AdvanceTournamentDialogProps>) {
  const { showError } = useToast();
  const mapError = useMapError();
  const pageText = useTournamentPageText();
  const text = useDialogsText();
  const { t } = text;
  const [busy, setBusy] = useState(false);
  const dateTime = (iso: string) =>
    text.locale === "fr"
      ? formatLocalDateTime(iso)
      : pageDateTime(iso, text.locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const strong = (children: ReadonlyArray<ReactNode>) => <strong style={{ color: "var(--ink)" }}>{richNodes(children)}</strong>;
  const type = toParticipantType(card.participantType);
  const entrantCount = card.registeredTeams;
  // Calculé à l'ouverture et non à chaque rendu : le dialogue reste monté
  // pendant que le flux SSE redessine la page, et voir l'étape annoncée changer
  // sous le curseur pendant qu'on lit la confirmation serait pire que de
  // l'afficher figée le temps d'un clic. Le serveur, lui, rejoue la règle.
  const [plan] = useState(() => ({
    from: computeTournamentProgress(card).current,
    target: advanceTarget(card),
  }));
  // Le bouton d'en-tête n'ouvre ce dialogue que s'il y a une étape suivante ;
  // à défaut (l'heure a tourné entre-temps), on retombe sur le coup d'envoi, que
  // le serveur refusera proprement s'il n'y a vraiment plus rien à avancer.
  const target: AdvanceTarget = plan.target ?? "RUNNING";
  // Titre, bouton et attente de chaque étape : `advance.targets.<étape>.*`.
  const key = target;
  const stageLabel = (stage: typeof plan.from) => pageText.t(`progress.stages.${stage}.label`);
  const passage = `${stageLabel(plan.from)} › ${stageLabel(target)}`;
  const empty = target === "RUNNING" && willCloseWithoutMatches(entrantCount);
  const confirmLabel = empty ? t("advance.closeEmpty") : t(`advance.targets.${key}.confirm`);
  // Ouvrir les inscriptions d'un tournoi masqué le publie au passage : c'est
  // une conséquence visible de tous, elle ne doit pas se cacher dans le
  // passage d'étape (voir `lib/shared/tournament-launch.ts`).
  const publishes = plan.from === "HIDDEN";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${card.id}/advance`, { method: "POST" });
      const payload = (await res.json()) as { error?: string; advanced?: AdvanceResult };
      if (!res.ok || !payload.advanced) {
        throw new Error(payload.error || "TOURNAMENT_ADVANCE_FAILED");
      }
      onAdvanced(payload.advanced);
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <TournamentDialogShell
      titleId="advance-tournament-title"
      summaryId="advance-tournament-summary"
      maxWidth={480}
      title={t(`advance.targets.${key}.title`)}
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={busy ? t(`advance.targets.${key}.busy`) : confirmLabel}
    >
      <p
        id="advance-tournament-summary"
        style={{ marginTop: 10, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)", lineHeight: 1.55 }}
      >
        {target === "REGISTRATION" &&
          richNodes(text.rich("advance.summary.REGISTRATION", { date: dateTime(card.registrationOpenAt) }, { strong }))}
        {target === "LOCKED" &&
          richNodes(
            text.rich(
              "advance.summary.LOCKED",
              { date: dateTime(card.registrationCloseAt), start: dateTime(card.startAt) },
              { strong },
            ),
          )}
        {target === "RUNNING" && richNodes(text.rich("advance.summary.RUNNING", { date: dateTime(card.startAt) }, { strong }))}
      </p>

      <dl
        style={{
          margin: "16px 0 0",
          display: "grid",
          // `auto minmax(0, 1fr)` et non `1fr auto` : la liste des étapes est
          // la valeur la plus longue, et c'est elle qui doit se replier sur
          // une fenêtre étroite plutôt que d'écraser son intitulé.
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: "8px 16px",
          fontSize: 13,
          alignItems: "baseline",
        }}
      >
        <dt style={{ color: "var(--ink-quiet, #9aa4b2)" }}>{t("advance.stage")}</dt>
        <dd
          style={{
            margin: 0,
            fontWeight: 600,
            textAlign: "right",
            overflowWrap: "anywhere",
          }}
        >
          {passage}
        </dd>
        {/* L'effectif ne compte qu'une fois figé : à la clôture des
            inscriptions et au coup d'envoi. Les ouvrir ne le fige pas. */}
        {target !== "REGISTRATION" && (
          <>
            <dt style={{ color: "var(--ink-quiet, #9aa4b2)" }}>
              {target === "RUNNING"
                ? t(`advance.atStart.${type}`, { count: entrantCount })
                : t("advance.finalCount")}
            </dt>
            <dd className="num" style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>
              {entrantCount}
            </dd>
          </>
        )}
      </dl>

      {publishes && (
        <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.55, color: "var(--ink-quiet, #9aa4b2)" }}>
          {t("advance.publishes")}
        </p>
      )}

      {empty && (
        // Rouge assumé : ce n'est pas un lancement mais une clôture, et
        // l'annoncer après coup serait la découvrir à la place du staff.
        <p
          // `role="note"` plutôt qu'une simple couleur : le rouge est la
          // seule chose qui distingue cet avertissement du reste, et il ne
          // dit rien à qui ne le voit pas.
          role="note"
          style={{
            marginTop: 14,
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--red-live, #ff4d4d)",
          }}
        >
          {entrantCount === 1 ? t("advance.emptyOne") : t("advance.empty")}
        </p>
      )}
    </TournamentDialogShell>
  );
}
