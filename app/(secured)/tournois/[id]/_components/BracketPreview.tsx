"use client";

import { Pill, ScrollArea } from "@/components/cyber";
import {
  SEEDING_SOURCE_LABELS,
  type PreviewPairing,
  type PreviewPairingKind,
  type TournamentPreview,
} from "@/lib/shared/tournament-preview";
import { useParticipantWording } from "../_lib/entrant-link";

interface BracketPreviewProps {
  preview: TournamentPreview;
  /** Vrai si le viewer peut aussi réordonner le seeding (permission `tournaments`). */
  canReorder: boolean;
}

/**
 * Ce qu'affiche la place de l'adversaire quand il n'y en a pas. Formulations
 * neutres : l'engagé est une équipe ou un joueur selon le tournoi.
 *
 * `BARRAGE` complète le tableau — un barrage oppose toujours deux engagés, sa
 * place vide n'existe donc pas en pratique, et le libellé du round le dit déjà.
 */
const KIND_LABELS: Record<Exclude<PreviewPairingKind, "MATCH">, string> = {
  BYE: "Passe le tour",
  BARRAGE: "Barrage",
  REST: "Ne joue pas",
};

/**
 * Quatre colonnes fixes : rang, engagé, séparateur, engagé. Les colonnes de
 * `.table-row` (1.6fr 1fr 1fr 1fr) donneraient au rang la part la plus large.
 *
 * La nature de la ligne (exemption, repos) occupe la place de l'adversaire
 * absent plutôt qu'une cinquième colonne : sur mobile, une colonne de plus
 * écraserait les deux noms à quelques pixels.
 */
const ROW_GRID = "28px minmax(0, 1fr) 24px minmax(0, 1fr)";

function EntrantCell({ pairing, side }: { pairing: PreviewPairing; side: "A" | "B" }) {
  const entrant = side === "A" ? pairing.teamA : pairing.teamB;

  // Emplacement vide : dire ce qui se passe vaut mieux qu'un tiret muet.
  if (!entrant) {
    return (
      <span style={{ color: "var(--text-2)", fontStyle: "italic" }}>
        {pairing.kind === "MATCH" ? "—" : KIND_LABELS[pairing.kind]}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
      <span className="num" style={{ fontSize: 11, color: "var(--text-2)" }}>
        #{entrant.seed}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entrant.teamName}</span>
    </span>
  );
}

/**
 * Aperçu du plateau pendant les inscriptions (staff et cast).
 *
 * Affiche l'appariement que produirait un lancement immédiat, recalculé à
 * chaque inscription — le détail du tournoi étant déjà rafraîchi en direct par
 * le flux d'événements. Rien n'est écrit : ce n'est pas le plateau, c'est ce
 * qu'il serait.
 */
export function BracketPreview({ preview, canReorder }: BracketPreviewProps) {
  const wording = useParticipantWording();

  return (
    <section
      aria-label="Aperçu du plateau avant lancement"
      style={{
        border: "1px dashed var(--line-strong-cy, rgba(90,200,255,0.35))",
        borderRadius: "var(--r-cy-md, 10px)",
        padding: "16px 18px",
        background: "rgba(90,200,255,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          className="eyebrow"
          style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--text-1)" }}
        >
          Aperçu — non joué
        </span>
        <Pill variant="blue">{SEEDING_SOURCE_LABELS[preview.seedingSource]}</Pill>
        {preview.bracketSize !== null && <Pill variant="blue">Plateau de {preview.bracketSize}</Pill>}
        {preview.rounds !== null && (
          <Pill variant="blue">
            {preview.rounds} manche{preview.rounds > 1 ? "s" : ""}
          </Pill>
        )}
        <Pill variant="blue">
          {preview.entrants.length} {preview.entrants.length > 1 ? wording.many : wording.one}
        </Pill>
      </div>

      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
        Voici les appariements qu&apos;un lancement immédiat produirait. Ils se recalculent à
        chaque inscription et à chaque changement de seeding
        {canReorder ? ", que vous pouvez ajuster dans le bloc « Seeding » ci-dessous" : ""}.
      </p>

      {canReorder && preview.seedingSource === "RANKING" && (
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
          Ce format se seede sur le classement du site : l&apos;ordre affiché dans le bloc
          « Seeding » est celui des inscriptions et ne prendra effet qu&apos;au premier
          réordonnancement.
        </p>
      )}

      {preview.phasePlan && preview.phasePlan.length > 0 && (
        <ul
          style={{
            margin: "0 0 14px",
            padding: "0 0 0 18px",
            fontSize: 12,
            color: "var(--text-1)",
            lineHeight: 1.7,
          }}
        >
          {preview.phasePlan.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {preview.notes.length > 0 && (
        <ul
          style={{
            margin: "0 0 14px",
            padding: "0 0 0 18px",
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.7,
          }}
        >
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {preview.pairings.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-2)",
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            {preview.roundLabel}
          </div>

          <ScrollArea
            orientation="y"
            fade
            ariaLabel={`Appariements prévus — ${preview.roundLabel}`}
            style={{ maxHeight: 420 }}
          >
            <div className="table-like">
              {preview.pairings.map((pairing) => (
                <div
                  key={pairing.position}
                  className="table-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: ROW_GRID,
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                  }}
                >
                  <span className="num" style={{ minWidth: 28, color: "var(--text-2)" }}>
                    {pairing.position}
                  </span>
                  <EntrantCell pairing={pairing} side="A" />
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-2)",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pairing.kind === "MATCH" || pairing.kind === "BARRAGE" ? "vs" : "·"}
                  </span>
                  <EntrantCell pairing={pairing} side="B" />
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      {preview.pairings.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
          Aucun appariement à afficher pour l&apos;instant : il faut au moins deux inscriptions.
        </p>
      )}
    </section>
  );
}
