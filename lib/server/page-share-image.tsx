/**
 * Rend l'image d'aperçu d'une page (`/og/<langue>/<clé>.png`,
 * `docs/features/SHARE_METADATA.md` § « Une carte par page »).
 *
 * Toutes les cartes sont **publiques par construction** : la route est servie
 * sans session et sans passer par les mises en page. Seules deux cartes lisent
 * la base, et rien que le classement public : le podium (`/classement`) et la
 * carte nominative d'une équipe (`team-<id>` : nom, logo, cote, bilan de sa
 * ligne au classement). Les autres pages réservées aux membres (annuaires,
 * `/joueurs/[id]`) restent **génériques** — aucun pseudo, aucun avatar.
 */
import { ImageResponse } from "next/og";
import { PodiumShareCard } from "@/components/og/podium-share-card";
import { ShareCard, SHARE_CARD_SIZE } from "@/components/og/share-card";
import { SHARE_ACCENT_COLORS, ShareMotifIcon } from "@/components/og/share-motifs";
import { ShareTeamMark } from "@/components/og/share-team-mark";
import { messagesFor } from "./i18n-messages";
import { shareCardLogo } from "./share-card-logo";
import { shareImageOptions } from "./share-card-fonts";
import { loadSharePodium } from "./share-podium";
import {
  cachedShareImage,
  DEGRADED_SHARE_IMAGE_TTL_MS,
  type ShareImagePool,
  type ShareImageRender,
} from "./share-image-cache";
import { findShareTeam, loadShareTeam, TEAM_SHARE_LOGO_SIZE } from "./share-team";
import { RANKING_TTL_MS } from "./ranking-cache";
import type { Locale } from "@/lib/shared/locales";
import {
  parseTeamShareCardKey,
  podiumShareEntries,
  resolvePageShareCard,
  teamShareCard,
} from "@/lib/shared/page-share-cards";
import { hasRightToLeftLetters, withoutRightToLeftLetters } from "@/lib/shared/graphemes";
import { localizedRuleModes } from "@/lib/shared/tournament-rules";

/**
 * Durée de cache annoncée. Une carte fixe ne change qu'au déploiement : un jour.
 * Le podium et la carte d'une équipe bougent avec les scores : cinq minutes, comme la carte d'un tournoi —
 * les plateformes gardent de toute façon l'image bien plus longtemps.
 * Jamais l'`immutable` d'un an que `ImageResponse` pose par défaut : l'adresse
 * d'une carte ne change pas quand son contenu change.
 */
export const STATIC_CARD_CACHE_CONTROL = "public, max-age=86400";
export const PODIUM_CARD_CACHE_CONTROL = "public, max-age=300";

/** Clé de la carte qui porte le podium. */
const PODIUM_CARD_KEY = "ranking";

/** Carte générique d'une fiche d'équipe : le repli de toute clé `team-<id>`. */
const GENERIC_TEAM_CARD_KEY = "team";

/** Fenêtre d'une carte fixe en mémoire : son texte ne change qu'au déploiement. */
const STATIC_CARD_TTL_MS = 60 * 60_000;

/**
 * Sert la carte `key` dans `locale` (route `/og/<langue>/<clé>.png`) : le PNG
 * gardé en mémoire s'il est frais (`cachedShareImage`), sinon rendu une fois.
 * `null` pour une clé inconnue.
 *
 * - Podium et équipe nominative suivent le classement (`RANKING_TTL_MS`).
 * - Une clé `team-<id>` hors du classement public partage la carte générique
 *   `team` (une seule entrée, quel que soit l'identifiant), servie en cache
 *   court : l'équipe peut y entrer.
 */
export async function renderPageShareImage(key: string, locale: Locale): Promise<Response | null> {
  const teamId = parseTeamShareCardKey(key);
  let cacheKey = key;
  let ttlMs = STATIC_CARD_TTL_MS;
  let cacheControl: string | null = null;
  let pool: ShareImagePool = "fixed";
  // Podium et carte nominative : vidés avec le classement (`invalidateRankingShareImages`).
  let followsRanking = false;
  if (key === PODIUM_CARD_KEY) {
    ttlMs = RANKING_TTL_MS;
    followsRanking = true;
  } else if (teamId !== null) {
    if (await findShareTeam(teamId)) {
      ttlMs = RANKING_TTL_MS;
      pool = "team";
      followsRanking = true;
    } else {
      cacheKey = GENERIC_TEAM_CARD_KEY;
      cacheControl = PODIUM_CARD_CACHE_CONTROL;
    }
  }
  const image = await cachedShareImage(
    `${locale}:${cacheKey}`,
    ttlMs,
    () => drawnPageShareImage(cacheKey, locale),
    pool,
    followsRanking,
  );
  if (!image) return null;
  return new Response(image.body, {
    headers: { "content-type": "image/png", "cache-control": cacheControl ?? image.cacheControl },
  });
}

/** Ce que la carte `key` lit de la base : l'équipe (`team-<id>`) ou le podium. */
export type PageShareData = {
  team?: Awaited<ReturnType<typeof loadShareTeam>>;
  podium?: Awaited<ReturnType<typeof loadSharePodium>>;
};

/** Lit une fois ce que la carte `key` dessine de la base (rien pour une carte au texte fixe). */
async function loadPageShareData(key: string): Promise<PageShareData> {
  const teamId = parseTeamShareCardKey(key);
  if (teamId !== null) return { team: await loadShareTeam(teamId) };
  if (key === PODIUM_CARD_KEY) return { podium: await loadSharePodium() };
  return {};
}

/** Un nom saisi que la carte dessine porte-t-il une lettre de droite à gauche ? */
function drawsRightToLeftName(data: PageShareData): boolean {
  const names = [...(data.team ? [data.team.teamName] : []), ...(data.podium ?? []).map((row) => row.teamName)];
  return names.some(hasRightToLeftLetters);
}

/**
 * Dessine la carte jusqu'au PNG, la base lue **une fois** pour les deux essais.
 * Un échec de rendu sur un nom d'équipe écrit de droite à gauche (Satori
 * répondait 500 sur l'arabe) retente **une fois** sans ces lettres ; un second
 * échec remonte. Sans telle lettre dans un nom dessiné (carte au texte fixe,
 * base injoignable, autre écriture), le nouvel essai ne changerait rien :
 * l'échec remonte aussitôt. La carte de repli n'est gardée que
 * `DEGRADED_SHARE_IMAGE_TTL_MS`.
 */
async function drawnPageShareImage(key: string, locale: Locale): Promise<ShareImageRender | null> {
  const data = await loadPageShareData(key);
  const draw = async (plainNames: boolean): Promise<ShareImageRender | null> => {
    const image = await buildPageShareImage(key, locale, plainNames, data);
    if (!image) return null;
    return { body: await image.arrayBuffer(), cacheControl: image.headers.get("cache-control") ?? "" };
  };
  try {
    return await draw(false);
  } catch (error) {
    if (!drawsRightToLeftName(data)) throw error;
    console.warn("[share-page] rendu en échec, nouvel essai sans écriture de droite à gauche", error);
    const degraded = await draw(true);
    return degraded && { ...degraded, ttlMs: DEGRADED_SHARE_IMAGE_TTL_MS };
  }
}

/**
 * Rend la carte `key` dans `locale`, sans cache ; `null` pour une clé inconnue.
 * `plainNames` retire des noms d'équipe leurs lettres de droite à gauche
 * (repli de {@link drawnPageShareImage}) ; `data`, ce que la base en a déjà
 * rendu (lu ici sinon).
 */
export async function buildPageShareImage(
  key: string,
  locale: Locale,
  plainNames = false,
  data?: PageShareData,
): Promise<ImageResponse | null> {
  const messages = messagesFor(locale);
  const modeTexts = new Map(localizedRuleModes(messages.rules).map((mode) => [mode.slug, mode]));
  const card = resolvePageShareCard(key, messages.share, modeTexts);
  if (!card) return null;

  const logoSrc = await shareCardLogo();
  const loaded = data ?? (await loadPageShareData(key));

  const teamId = parseTeamShareCardKey(key);
  if (teamId !== null) {
    const team = loaded.team ?? null;
    if (team) {
      const teamCard = teamShareCard(
        plainNames ? { ...team, teamName: withoutRightToLeftLetters(team.teamName) } : team,
        messages.share,
      );
      const accent = SHARE_ACCENT_COLORS[card.accent];
      return new ImageResponse(
        <ShareCard
          eyebrow={teamCard.eyebrow}
          title={teamCard.title}
          subtitle={teamCard.subtitle}
          facts={teamCard.facts}
          footer={teamCard.footer}
          accent={accent}
          motif={
            <ShareTeamMark
              logoSrc={team.logoSrc}
              initial={teamCard.initial}
              color={accent}
              size={TEAM_SHARE_LOGO_SIZE}
            />
          }
          logoSrc={logoSrc}
        />,
        await shareImageOptions({ ...SHARE_CARD_SIZE, headers: { "cache-control": PODIUM_CARD_CACHE_CONTROL } }),
      );
    }
  }

  if (key === PODIUM_CARD_KEY) {
    const podium = loaded.podium ?? [];
    const entries = podiumShareEntries(
      plainNames ? podium.map((row) => ({ ...row, teamName: withoutRightToLeftLetters(row.teamName) })) : podium,
      messages.share,
    );
    if (entries) {
      return new ImageResponse(
        <PodiumShareCard
          eyebrow={messages.share.podium.eyebrow}
          title={messages.share.podium.title}
          footer={card.footer}
          entries={entries}
          logoSrc={logoSrc}
        />,
        await shareImageOptions({ ...SHARE_CARD_SIZE, headers: { "cache-control": PODIUM_CARD_CACHE_CONTROL } }),
      );
    }
  }

  const accent = SHARE_ACCENT_COLORS[card.accent];
  return new ImageResponse(
    <ShareCard
      eyebrow={card.eyebrow}
      title={card.title}
      subtitle={card.subtitle}
      footer={card.footer}
      accent={accent}
      motif={card.motif ? <ShareMotifIcon motif={card.motif} color={accent} /> : undefined}
      logoSrc={logoSrc}
    />,
    await shareImageOptions({
      ...SHARE_CARD_SIZE,
      headers: {
        // Sans podium, la carte du classement attend le prochain ; une équipe
        // absente du classement peut y entrer : même durée courte.
        "cache-control":
          key === PODIUM_CARD_KEY || teamId !== null ? PODIUM_CARD_CACHE_CONTROL : STATIC_CARD_CACHE_CONTROL,
      },
    }),
  );
}
