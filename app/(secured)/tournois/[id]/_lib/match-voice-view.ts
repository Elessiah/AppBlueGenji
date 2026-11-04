import { useEffect, useRef, useState } from "react";
import { useClock } from "@/lib/shared/hooks/useClock";
import { parseMatchVoiceInfo, type MatchVoiceInfo } from "@/lib/shared/match-voice";
import type { BracketMatch } from "@/lib/shared/types";

/**
 * Salons vocaux d'équipe sur la page du match (`docs/features/MATCH_VOICE.md`) :
 * quelle source fait foi — l'instantané du flux ou la relecture REST de
 * secours — et quand relire.
 *
 * Deux portes (`REALTIME_REFRESH.md`) : le nombre arrive dans l'instantané
 * (`BracketMatch.voice`, poussé par le flux à chaque comptage). La page ne
 * relit `GET /api/matches/[id]/voice` que **flux coupé** : flux sain, chaque
 * comptage est déjà publié, et une relecture par lecteur toutes les dix
 * secondes ne ferait que charger le serveur. Le balayage, lui, reste porté par
 * le trafic (listes de tournois, `/api/me/match-launches`).
 */

/** Relecture REST des salons vocaux, flux coupé, tant que le match suit ses salons. */
export const VOICE_POLL_MS = 10_000;

/** Relecture REST rangée avec l'instantané qu'elle a vu : elle ne vaut que pour lui. */
export type PolledMatchVoice = {
  matchId: number;
  /** `voiceStreamKey` de l'instantané au moment de la relecture. */
  streamKey: string;
  /** Ce que la porte REST a répondu ; `null` : le match ne suit plus ses salons. */
  voice: MatchVoiceInfo | null;
};

/** Empreinte d'un état des salons de l'instantané : elle change à chaque comptage publié. */
export function voiceStreamKey(voice: MatchVoiceInfo | null): string {
  if (voice === null) return "none";
  return [voice.team1State, voice.team1Members, voice.team2State, voice.team2Members, voice.pending].join(":");
}

/**
 * La source la plus récente fait foi : flux coupé, une relecture faite sur
 * l'instantané courant le remplace — y compris quand elle répond `null` (match
 * lancé, option éteinte) ; un nouvel instantané, publié après elle, l'emporte à
 * son tour. Flux rétabli, l'instantané seul fait foi : une relecture d'avant la
 * reconnexion ne survit pas à un instantané identique à celui qu'elle a vu.
 * Dérivé au rendu : aucun effet ne remet la relecture à zéro.
 */
export function currentMatchVoice(
  matchId: number,
  streamed: MatchVoiceInfo | null,
  polled: PolledMatchVoice | null,
  streamLive: boolean,
): MatchVoiceInfo | null {
  if (streamLive) return streamed;
  if (polled?.matchId === matchId && polled.streamKey === voiceStreamKey(streamed)) return polled.voice;
  return streamed;
}

/**
 * Faut-il relire la porte REST ? Seulement flux coupé, et tant que la source
 * qui fait foi dit que le match suit ses salons (verrou tenu ou non : un
 * comptage frais vieillit sans écriture).
 */
export function voicePollActive(current: MatchVoiceInfo | null, streamLive: boolean): boolean {
  return !streamLive && current !== null;
}

/**
 * État des salons du match à montrer, relu flux coupé. `enabled` : le lecteur
 * a la section (parties du match et staff, plateau à jour, match pas terminé).
 * L'horloge suit le régime de charge (`useClock`) : onglet caché, aucune relecture.
 */
export function useMatchVoice(
  match: Pick<BracketMatch, "id" | "voice">,
  enabled: boolean,
  streamLive: boolean,
): MatchVoiceInfo | null {
  const [polled, setPolled] = useState<PolledMatchVoice | null>(null);
  const streamed = enabled ? (match.voice ?? null) : null;
  // L'empreinte est lue au départ de la requête, pas en dépendance : un nouvel instantané
  // ne déclenche pas de relecture hors cadence, seule l'horloge le fait.
  const streamKey = useRef(voiceStreamKey(streamed));
  streamKey.current = voiceStreamKey(streamed);
  const voice = enabled ? currentMatchVoice(match.id, streamed, polled, streamLive) : null;
  const active = voicePollActive(voice, streamLive);
  const tick = useClock(VOICE_POLL_MS, active);

  useEffect(() => {
    if (tick === null || !active) return;
    // Rangée avec l'instantané vu au départ : un instantané publié pendant la
    // requête la rend caduque.
    const seen = streamKey.current;
    const controller = new AbortController();
    fetch(`/api/matches/${match.id}/voice`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json().catch(() => ({}))) as { voice?: unknown };
        // Une réponse illisible ne dit rien : seul un `voice` présent (nul compris) fait foi.
        if (!("voice" in body)) return;
        setPolled({ matchId: match.id, streamKey: seen, voice: parseMatchVoiceInfo(body.voice) });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [tick, active, match.id]);

  return voice;
}
