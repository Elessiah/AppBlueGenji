"use client";

import { FormEvent } from "react";
import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";
import { fromBracketMatch, isScoreEditLocked } from "@/lib/shared/match-lock";
import { matchFormatLabel, matchWinsRequired } from "@/lib/shared/match-format";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import { canReportOwnMatch, isMyTeamTeam1, teamLabel } from "@/lib/shared/match-card-viewer";
import { useMatchFormat } from "../_lib/match-format-context";
import { useIssueReport } from "../_lib/issue-report-context";
import { useLiveControls } from "../_lib/live-context";
import { useHighlightedMatch } from "../_lib/match-anchor-context";
import { MatchLiveStrip } from "./MatchLiveStrip";
import { MatchLaunchStrip } from "./MatchLaunchStrip";
import { MatchReplayStrip } from "./MatchReplayStrip";
import { EntrantName } from "./EntrantName";

const CARD_W = 210;
const BORDER = "var(--border, #444)";

interface MatchRowProps {
  match: BracketMatch;
  reportable: boolean;
  adminResolvable: boolean;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  myScore: string;
  opponentScore: string;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
  allMatches: BracketMatch[];
  roundNumber: number;
  format: TournamentFormat;
}

export function MatchRow({
  match,
  reportable,
  adminResolvable,
  onScoreChange,
  myScore,
  opponentScore,
  onSubmit,
  onOpenAdminModal,
  allMatches,
  roundNumber,
  format,
}: MatchRowProps) {
  // Format du tournoi (BO5, FT3…) : rappelé au-dessus des champs et appliqué
  // comme borne haute, pour que la saisie ne parte pas hors format.
  const matchFormat = useMatchFormat(match);
  // Signalement : réservé aux engagés du tournoi, et seulement sur une manche
  // dont les deux adversaires sont connus — il n'y a rien à arbitrer sur une
  // case encore vide. Réservé de plus au **match du lecteur** : le bouton
  // d'en-tête couvre déjà le reste du plateau, et répéter le bouton sur cent
  // vingt-sept cartes qui ne concernent pas le lecteur ne fait que les
  // alourdir toutes.
  const { canReport, openReport } = useIssueReport();
  // Engagé du lecteur : déjà porté par `LiveContext` (diffusion, casting) — on
  // le relit ici plutôt que d'en garder une seconde copie sur le contexte de
  // signalement, qui décrirait la même donnée depuis deux sources.
  const { myTeamId } = useLiveControls();
  const canReportMatch = canReportOwnMatch(canReport, myTeamId, match.team1Id, match.team2Id);
  // Le formulaire de score liste ses deux champs dans l'ordre de la carte
  // (équipe 1 en haut, équipe 2 en bas), quelle que soit la place du lecteur —
  // sans cela, « Moi » apparaissait toujours en premier et l'ordre des champs
  // pouvait être l'inverse de celui des noms juste au-dessus.
  const myTeamIsTeam1 = isMyTeamTeam1(myTeamId, match.team1Id);
  // Cible d'une ancre `#match-[id]` : la carte est surlignée quelques secondes
  // à l'arrivée. Sans ce repère, la page s'ouvre défilée au bon endroit mais le
  // lecteur ne sait pas laquelle des cartes visibles il venait voir.
  const isAnchorTarget = useHighlightedMatch() === match.id;
  const maxScore = matchFormat ? matchWinsRequired(matchFormat) : 99;

  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
  const hasWinner = match.winnerTeamId !== null;

  // Match **nul** : clos, sans vainqueur, et pas par forfait. Une rencontre
  // jouée qui ne teinte aucune des deux lignes se lit exactement comme une
  // rencontre à venir — d'où la mention, seule chose qui distingue « 2 – 2 »
  // de « pas encore joué ».
  const isDraw = isMatchDrawn(match);

  // Double forfait : jouée, sans vainqueur, et perdue par les deux. Même besoin
  // que le nul — rien ne teinte les lignes — mais pas le même mot : « Match
  // nul » y annoncerait une rencontre disputée et partagée.
  const isDoubleForfeit = isMatchDoubleForfeit(match);

  // Même règle que le garde-fou serveur (`lib/shared/match-lock.ts`) : le score
  // n'est plus éditable dès que la manche suivante porte une saisie.
  const scoreLocked = isScoreEditLocked(
    fromBracketMatch(match),
    allMatches.map(fromBracketMatch),
    format,
  );

  const rowStyle = (win: boolean): React.CSSProperties => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "5px 8px",
    background: win ? "rgba(79,224,162,0.15)" : hasWinner ? "rgba(255,255,255,0.03)" : undefined,
    color: win ? "var(--text-0)" : hasWinner ? "var(--text-2)" : "var(--text-1)",
    fontWeight: win ? 600 : 400,
  });

  const team1Display = teamLabel(
    match.team1Name,
    match.team1Placeholder,
    roundNumber === 1 && match.team1Id === null && match.team2Id !== null ? "BYE" : "TBD",
  );
  const team2Display = teamLabel(
    match.team2Name,
    match.team2Placeholder,
    roundNumber === 1 && match.team2Id === null && match.team1Id !== null ? "BYE" : "TBD",
  );

  // Les deux champs du formulaire, dans l'ordre de la carte (équipe 1 puis
  // équipe 2) et nommés par l'équipe : l'aria-label garde tout de même la
  // distinction « mon score »/« score adverse », que le seul nom d'équipe ne
  // porte pas pour qui n'a pas vu la carte au-dessus. La paire clé/valeur/mine
  // n'est écrite qu'une fois chacune, pour qu'un futur champ (`disabled`, un
  // autre `aria-label`) n'ait pas quatre branches à tenir à jour ensemble.
  const myField = { key: "myScore" as const, value: myScore, mine: true };
  const opponentField = { key: "opponentScore" as const, value: opponentScore, mine: false };
  const topField = { ...(myTeamIsTeam1 ? myField : opponentField), label: team1Display };
  const bottomField = { ...(myTeamIsTeam1 ? opponentField : myField), label: team2Display };

  const isBye = match.team1Id === null || match.team2Id === null;
  // « FF » dès que le forfait est *enregistré*, sans attendre qu'il soit tranché :
  // l'arbitrage peut noter un forfait sans valider le résultat, et le score plein
  // porté en face (3-0 en FT3) se lisait alors comme une rencontre jouée et
  // gagnée, sur un match que personne n'a encore remporté.
  const team1Forfeits = !isBye && (isDoubleForfeit || match.forfeitTeamId === match.team1Id);
  const team2Forfeits = !isBye && (isDoubleForfeit || match.forfeitTeamId === match.team2Id);
  const team1Score = team1Forfeits ? "FF" : (match.team1Score ?? "-");
  const team2Score = team2Forfeits ? "FF" : (match.team2Score ?? "-");

  return (
    <div
      // Ancre du lien profond `/tournois/[id]#match-[id]`, posée ici parce que
      // `MatchRow` est le passage unique de toutes les vues (arbre, survie,
      // suisse, endurance) : une carte de match a donc toujours son identifiant,
      // sans qu'aucune vue ait à y penser.
      id={matchAnchorId(match.id)}
      className={isAnchorTarget ? "match-anchor-target" : undefined}
      // Hors de l'ordre de tabulation, mais focalisable par programme : à
      // l'arrivée d'une ancre, `useMatchAnchor` y pose le focus pour qu'un
      // lecteur d'écran annonce la carte. Sans cela, le défilement et le halo
      // ne disent rien à qui ne voit pas la page — le navigateur en fait autant
      // sur une ancre native, que le flux SSE nous empêche d'utiliser.
      tabIndex={-1}
      style={{
        width: CARD_W,
        background: "var(--surface-1)",
        border: `1px solid ${adminResolvable ? "rgba(89,212,255,0.4)" : BORDER}`,
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 13,
        // Marge de sécurité pour le saut natif du navigateur sur `#match-…`
        // (rechargement d'une URL ancrée) : le défilement piloté par
        // `useMatchAnchor` centre la carte, celui du navigateur la colle en haut.
        scrollMargin: 96,
      }}
    >
      <div style={{ ...rowStyle(team1Win), borderBottom: `1px solid ${BORDER}` }}>
        {/* Emblème compris : il garde sa case même sur une ligne vide (TBD,
            BYE), pour que les deux noms de la carte commencent au même endroit. */}
        <EntrantName
          teamId={match.team1Id}
          name={team1Display}
          title={team1Display}
          truncate
          style={{ flex: 1 }}
        />
        <strong style={{ marginLeft: 8, color: team1Win ? "var(--green)" : team1Forfeits ? "rgba(255,157,46,0.9)" : "var(--text-2)" }}>
          {team1Score}
        </strong>
      </div>
      <div style={rowStyle(team2Win)}>
        <EntrantName
          teamId={match.team2Id}
          name={team2Display}
          title={team2Display}
          truncate
          style={{ flex: 1 }}
        />
        <strong style={{ marginLeft: 8, color: team2Win ? "var(--green)" : team2Forfeits ? "rgba(255,157,46,0.9)" : "var(--text-2)" }}>
          {team2Score}
        </strong>
      </div>

      {(isDraw || isDoubleForfeit) && (
        <p
          style={{
            margin: 0,
            padding: "3px 8px",
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            textAlign: "center",
            // L'ambre des « FF » pour un double forfait : la mention dit la même
            // chose que les deux scores, elle en prend la couleur. Le gris reste
            // au nul, qui n'est ni une faute ni une absence.
            color: isDoubleForfeit ? "rgba(255,157,46,0.9)" : "var(--text-2)",
            background: isDoubleForfeit ? "rgba(255,157,46,0.06)" : "rgba(255,255,255,0.03)",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {isDoubleForfeit ? "Double forfait" : "Match nul"}
        </p>
      )}

      <MatchLiveStrip match={match} />
      <MatchLaunchStrip match={match} />

      <MatchReplayStrip match={match} />

      {reportable && (
        <form
          onSubmit={(e) => onSubmit(match, e)}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: "5px 6px",
            background: "rgba(79,224,162,0.06)",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {matchFormat && (
            <p
              style={{
                width: "100%",
                margin: 0,
                fontSize: 10,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-2)",
              }}
            >
              {matchFormatLabel(matchFormat)} · premier à {maxScore}
            </p>
          )}
          {[topField, bottomField].map((field) => (
            <input
              key={field.key}
              type="number"
              min={0}
              max={maxScore}
              placeholder={field.label}
              aria-label={field.mine ? `Votre score (${field.label})` : `Score de l'adversaire (${field.label})`}
              // Un nom d'équipe long se coupe dans les 52 px du champ : le
              // `title` le rend lisible en entier au survol, comme les deux
              // lignes de noms au-dessus (`EntrantName`, `title={teamDisplay}`).
              title={field.label}
              value={field.value}
              onChange={(e) => onScoreChange(match.id, field.key, e.target.value)}
              style={{ width: 52, fontSize: 12 }}
            />
          ))}
          <button className="btn" type="submit" style={{ padding: "3px 10px", fontSize: 12 }}>
            Envoyer le score
          </button>
        </form>
      )}

      {adminResolvable && !scoreLocked && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "5px 6px",
            background: "rgba(89,212,255,0.08)",
            borderTop: `1px solid rgba(89,212,255,0.25)`,
          }}
        >
          <button
            type="button"
            onClick={() => onOpenAdminModal(match)}
            className="btn"
            style={{ padding: "4px 12px", fontSize: 12, background: "rgba(89,212,255,0.15)", borderColor: "rgba(89,212,255,0.4)" }}
          >
            ✎ Éditer le score
          </button>
        </div>
      )}

      {canReportMatch && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "4px 6px",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <button
            type="button"
            onClick={() => openReport(match)}
            className="btn ghost"
            title="Prévenir le staff d'un problème sur ce match"
            style={{ padding: "3px 10px", fontSize: 11 }}
          >
            ⚠ Signaler un problème
          </button>
        </div>
      )}

      {adminResolvable && scoreLocked && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "5px 6px",
            borderTop: `1px solid ${BORDER}`,
            fontSize: 11,
            color: "var(--text-2)",
          }}
          title="La manche suivante a déjà des scores : le résultat de ce match ne peut plus être modifié."
        >
          <span aria-hidden="true">🔒</span>
          Score verrouillé
        </div>
      )}
    </div>
  );
}
