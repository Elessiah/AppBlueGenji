import type { Metadata } from "next";
import type { RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { requestCache } from "@/lib/server/request-cache";
import {
  loadVisibleTournamentCard,
  tournamentPageMetadata,
  type TournamentMetadataCardLoader,
  type TournamentMetadataRights,
} from "@/lib/server/tournament-metadata";
import { parseEntityPageId } from "@/lib/shared/entity-page-titles";
import { matchPagePath } from "@/lib/shared/match-page";
import { memberTournamentPath, spectatorTournamentPath } from "@/lib/shared/spectator-view";
import type { BracketType } from "@/lib/shared/types";
import { matchPositionText, tournamentPageMessages, tournamentPageText } from "@/lib/shared/tournament-page-text";

/**
 * Lectures serveur de la page d'un match (`docs/features/MATCH_PAGE.md`) :
 * le match existe-t-il dans un tournoi que le lecteur voit (sinon 404), et ce
 * qu'en dit l'encart d'un lien partagé. Rien d'autre n'est lu ici : la page,
 * cliente, reçoit tout le reste du flux de la fiche (ou de la lecture publique).
 */

/** Place d'un match dans son tournoi : sa manche et son numéro. */
export type MatchPagePosition = { bracket: BracketType; roundNumber: number; matchNumber: number };

type PositionRow = RowDataPacket & { bracket: BracketType; round_number: number; match_number: number };

/**
 * La manche et le numéro du match, `null` s'il n'appartient pas à ce tournoi :
 * une lecture par clé primaire, partagée pour la requête (`requestCache`) par la
 * mise en page (404) et par l'encart.
 */
export const getMatchPagePosition = requestCache(readMatchPagePosition);

async function readMatchPagePosition(tournamentId: number, matchId: number): Promise<MatchPagePosition | null> {
  const [rows] = await withConnection((connection) =>
    connection.query<PositionRow[]>(
      "SELECT bracket, round_number, match_number FROM bg_matches WHERE id = ? AND tournament_id = ? LIMIT 1",
      [matchId, tournamentId],
    ),
  );
  const row = rows[0];
  return row
    ? { bracket: row.bracket, roundNumber: Number(row.round_number), matchNumber: Number(row.match_number) }
    : null;
}

/**
 * La page existe-t-elle pour ce lecteur ? Identifiants valides, tournoi qu'il
 * voit (règle de la fiche : `canViewTournament`), match de ce tournoi. Une base
 * injoignable n'est pas un 404 : `"unavailable"`, et la page dira son erreur.
 */
export async function matchPageExists(
  rawTournamentId: string,
  rawMatchId: string,
  rights: TournamentMetadataRights,
): Promise<boolean | "unavailable"> {
  const tournamentId = parseEntityPageId(rawTournamentId);
  const matchId = parseEntityPageId(rawMatchId);
  if (tournamentId === null || matchId === null) return false;
  try {
    const card = await loadVisibleTournamentCard(tournamentId, rights);
    if (!card) return false;
    return (await getMatchPagePosition(tournamentId, matchId)) !== null;
  } catch {
    return "unavailable";
  }
}

/** Préfixe le titre de l'encart du tournoi (« Manche 2 · Match 3 — … »). */
function prefixedTitle(title: Metadata["title"], prefix: string): string {
  let base = "";
  if (typeof title === "string") base = title;
  else if (title && typeof title === "object" && "absolute" in title) base = title.absolute;
  return base ? `${prefix} — ${base}` : prefix;
}

/**
 * Encart d'un lien de page de match : celui du tournoi (`tournamentPageMetadata`,
 * mêmes droits), adresse canonique sur la page du match et titre précédé de
 * sa manche et de son numéro. Un match introuvable (identifiant illisible, ou
 * match d'un autre tournoi) garde l'encart du tournoi **et sa canonique** —
 * celle de la vue lue (`/suivre/…` sans compte), jamais une page en 404.
 */
export async function matchPageMetadata(
  rawTournamentId: string,
  rawMatchId: string,
  spectator: boolean,
  rights: () => Promise<TournamentMetadataRights | null>,
  loadCard?: TournamentMetadataCardLoader,
): Promise<Metadata> {
  const matchId = parseEntityPageId(rawMatchId);
  const tournamentId = parseEntityPageId(rawTournamentId);
  const granted = await rights().catch(() => null);
  const position =
    matchId === null || tournamentId === null || granted === null
      ? null
      : await getMatchPagePosition(tournamentId, matchId).catch(() => null);
  const tournamentPath = spectator ? spectatorTournamentPath : memberTournamentPath;
  const metadata = await tournamentPageMetadata(
    rawTournamentId,
    (id) => (position === null || matchId === null ? tournamentPath(id) : matchPagePath(id, matchId, spectator)),
    async () => granted,
    loadCard,
  );
  if (!position || metadata.alternates === undefined) return metadata;
  const locale = await requestLocale();
  const text = tournamentPageText(locale, tournamentPageMessages(messagesFor(locale)));
  const prefix = matchPositionText(text, position);
  const title = prefixedTitle(metadata.title, prefix);
  return {
    ...metadata,
    title: { absolute: title },
    openGraph: { ...metadata.openGraph, title },
    twitter: { ...metadata.twitter, title },
  };
}
