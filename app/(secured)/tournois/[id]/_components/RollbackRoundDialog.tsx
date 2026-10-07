"use client";

import { FormEvent, useState, type ReactNode } from "react";
import { ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { richNodes } from "@/components/i18n/shell-text";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import type { TournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import { localizedPlaceholder } from "@/lib/shared/tournament-page-text";
import { teamLabel } from "@/lib/shared/match-card-viewer";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import type { BracketMatch } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";

interface RollbackRoundDialogProps {
  tournamentId: number;
  /**
   * Libellé du stade défait, **article compris** (« la manche 4 », « le tour 2
   * des play-offs », « la manche 3 de la phase 2 ») : le genre change d'un
   * format à l'autre, et les textes sont tournés pour n'accorder avec lui ni
   * article ni participe.
   */
  stageLabel: string;
  /**
   * Clé de ce stade. Renvoyée au serveur, qui refuse le geste si le stade
   * courant a bougé entre l'ouverture et le clic : le dialogue *montre* les
   * rencontres qu'il efface, et c'est là toute la sauvegarde de l'arbitre — il
   * ne doit pas en effacer d'autres.
   */
  stageKey: string;
  /** Rencontres de ce stade, telles qu'elles sont au moment du rendu. */
  matches: BracketMatch[];
  /**
   * Le tournoi est **terminé** : ce retour en arrière le rouvrira.
   *
   * C'est la seule conséquence du geste qui déborde du plateau, et elle mérite
   * d'être annoncée avant le clic : le palmarès publié disparaît, et le tournoi
   * repasse « en cours » jusqu'à ce que le stade rouvert soit rejoué.
   */
  tournamentFinished: boolean;
  onClose: () => void;
  /** Reçoit le libellé que le **serveur** dit avoir effacé, pas celui affiché. */
  onRolledBack: (stageLabel: string) => void;
}

/** Score affiché d'une rencontre, ou son absence, en une chaîne relisible. */
function scoreLabel(text: TournamentDialogsText, match: BracketMatch): string {
  // Avant le test des scores : un double forfait n'en porte aucun, et « aucun
  // score saisi » cacherait qu'un résultat va être effacé.
  if (isMatchDoubleForfeit(match)) return text.t("rollback.doubleForfeit");
  if (match.team1Score === null && match.team2Score === null) return text.t("rollback.noScore");
  const score = `${match.team1Score ?? "—"} – ${match.team2Score ?? "—"}`;
  if (match.forfeitTeamId !== null) return text.t("rollback.forfeit", { score });
  if (isMatchDrawn(match)) return text.t("rollback.draw", { score });
  return score;
}

/**
 * Confirmation du retour en arrière : effacer le dernier stade joué.
 *
 * Le dialogue ne se contente pas d'avertir, il **montre ce qui va disparaître** :
 * chaque rencontre du stade y figure avec son score. C'est la seule sauvegarde
 * possible avant le geste — le site ne garde aucune archive d'un résultat
 * effacé, et l'avertissement « pense à noter les scores » sans les scores sous
 * les yeux enverrait l'arbitre les chercher dans un plateau qu'il s'apprête à
 * vider.
 *
 * Le bouton ne s'arme qu'une fois la case cochée, pour la même raison que la
 * recopie du nom sur la suppression : l'action est irréversible, elle ne doit
 * pas partir d'un clic distrait.
 *
 * Voile, cadre et portail : `TournamentDialogFrame`, monté après le premier
 * rendu comme la suppression.
 */
export function RollbackRoundDialog({
  tournamentId,
  stageLabel,
  stageKey,
  matches,
  tournamentFinished,
  onClose,
  onRolledBack,
}: Readonly<RollbackRoundDialogProps>) {
  const { showError } = useToast();
  const mapError = useMapError();
  const text = useDialogsText();
  const { t } = text;
  // Libellés d'attente (« Gagnant match 1 du tableau perdants… ») : rédigés en
  // français par le serveur, redits dans la langue de la page (lot 8a-2).
  const pageText = useTournamentPageText();
  const strong = (children: ReadonlyArray<ReactNode>) => <strong style={{ color: "var(--ink)" }}>{richNodes(children)}</strong>;
  const strongInk = (children: ReadonlyArray<ReactNode>) => <strong>{richNodes(children)}</strong>;
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!acknowledged || busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedStage: stageKey }),
      });
      const payload = (await res.json()) as {
        error?: string;
        rolledBack?: { label: string };
      };
      if (!res.ok) throw new Error(payload.error || "ROLLBACK_FAILED");
      // Le stade annoncé est celui que le serveur dit avoir effacé : le nôtre
      // pouvait être périmé, et un message qui nomme la mauvaise manche serait
      // pire qu'aucun message. Le serveur le rédige en français : sous `/en`,
      // c'est le nôtre qui est annoncé — le serveur ayant refusé tout stade
      // autre que `expectedStage`, il désigne la même manche.
      onRolledBack(text.locale === "fr" ? payload.rolledBack?.label ?? stageLabel : stageLabel);
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <TournamentDialogFrame
      titleId="rollback-round-title"
      maxWidth={520}
      border="1px solid var(--red-live, #ff4d4d)"
      zIndex={90}
      deferMount
      busy={busy}
      onClose={onClose}
    >
      <h3
        id="rollback-round-title"
        style={{ margin: 0, fontSize: 18, color: "var(--red-live, #ff4d4d)" }}
      >
        {t("rollback.title", { stage: stageLabel })}
      </h3>

      <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)", lineHeight: 1.55 }}>
        {richNodes(text.rich("rollback.erases", { stage: stageLabel }, { strong }))}
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)", lineHeight: 1.55 }}>
        {t("rollback.repeat")}
      </p>

      {tournamentFinished && (
        <div
          role="note"
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: "var(--r-cy-sm, 8px)",
            border: "1px solid color-mix(in srgb, var(--red-live, #ff4d4d) 45%, transparent)",
            background: "color-mix(in srgb, var(--red-live, #ff4d4d) 8%, transparent)",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--ink, #e7ecf3)",
          }}
        >
          🏁 {richNodes(text.rich("rollback.reopen", {}, { strong: strongInk }))}
        </div>
      )}

      <div
        role="note"
        style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: "var(--r-cy-sm, 8px)",
          border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)",
          background: "color-mix(in srgb, var(--amber) 8%, transparent)",
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--ink, #e7ecf3)",
        }}
      >
        ⚠️ {richNodes(text.rich("rollback.noteScores", {}, { strong: strongInk }))}
      </div>

      {/* Une manche à seize équipes déborde des 220 pixels : la zone passe par
          `ScrollArea`, comme toute zone défilante du projet — c'est ce qui lui
          donne sa barre discrète et, surtout, l'accès au clavier qu'un
          `overflow: auto` posé à la main ne donne pas. La liste garde ses
          propres sémantiques à l'intérieur. */}
      <ScrollArea
        orientation="y"
        ariaLabel={t("rollback.listAria")}
        style={{ maxHeight: 220, marginTop: 12 }}
      >
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {matches.map((match) => (
            <li
              key={match.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 12.5,
                padding: "6px 10px",
                borderRadius: "var(--r-cy-sm, 8px)",
                background: "var(--cyber-bg-3, #1b2029)",
              }}
            >
              <span style={{ color: "var(--ink-quiet, #9aa4b2)" }}>
                {teamLabel(match.team1Name, localizedPlaceholder(pageText, match.team1Placeholder), t("rollback.tbd"))} vs{" "}
                {teamLabel(match.team2Name, localizedPlaceholder(pageText, match.team2Placeholder), t("rollback.tbd"))}
              </span>
              <span
                className="mono"
                style={{ color: "var(--ink, #e7ecf3)", whiteSpace: "nowrap" }}
              >
                {scoreLabel(text, match)}
              </span>
            </li>
          ))}
        </ul>
      </ScrollArea>

      <form onSubmit={submit}>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 16,
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--ink-quiet, #9aa4b2)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={busy}
            style={{ marginTop: 2 }}
          />
          {/* NOSONAR S6772 — label en flex avec `gap` */}
          {t("rollback.acknowledge")}
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={busy}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {t("score.cancel")}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={!acknowledged || busy}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              borderColor: "var(--red-live, #ff4d4d)",
              color: acknowledged && !busy ? "var(--red-live, #ff4d4d)" : undefined,
            }}
          >
            {/* Neutre, et pas « cette manche » : le stade peut être un *tour*
                d'arbre final, et le libellé se serait trompé de genre une fois
                sur deux. Le titre du dialogue, lui, porte déjà le nom exact. */}
            {busy ? t("rollback.pending") : t("rollback.confirm")}
          </button>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
