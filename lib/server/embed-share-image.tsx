/**
 * Images d'aperçu d'un tournoi et d'un match partagés
 * (`/og/<langue>/tournament-<id>.png`, `/og/<langue>/tournament-<tid>-match-<mid>.png`,
 * `docs/features/SHARE_EMBEDS.md`).
 *
 * **Publiques par construction** : la route est servie sans session, et la
 * seule donnée lue est la réponse publique mutualisée du tournoi
 * (`publicTournamentShareForRequest`, celle de `/suivre/`, au même plafond de
 * lecture) — ou, pour l'image d'un tournoi qui ne peut pas nommer une équipe en
 * tête (individuel, ou pas encore en cours : `tournamentMayHaveLeader`), la
 * seule carte du tournoi, par la lecture légère de l'encart. Un tournoi non publié, introuvable ou illisible — ou un match qui
 * n'est pas le sien — rend la carte **neutre** du site, jamais une erreur :
 * elle ne dit pas si le tournoi existe. La carte neutre part en `no-store` :
 * elle peut venir d'un refus passager (plafond de lecture, places de
 * reconstruction prises, base injoignable), et un robot d'aperçu qui la
 * garderait sous l'adresse versionnée montrerait la carte du site jusqu'au
 * prochain score.
 *
 * **Cache.** Le PNG est gardé en mémoire (`cachedShareImage`, réserve
 * `embed`) sous une clé qui porte l'**empreinte de ce qu'il dessine** : un
 * score saisi change l'empreinte, donc la clé — la carte suivante est rendue à
 * neuf, sans attendre la fin d'une fenêtre. L'adresse publiée par l'encart
 * porte la même empreinte (`?v=`), pour que Discord ou X ne resservent pas
 * leur ancienne copie ; le paramètre reçu, lui, n'est jamais lu : un robot qui
 * en invente ne fait pas rendre une carte de plus. L'empreinte est dans la
 * clé : une carte inchangée reste en mémoire des heures (`EMBED_CARD_TTL_MS`),
 * seule l'éviction de la réserve la chasse.
 *
 * **Copie échue.** Au plafond de lecture, la carte est dessinée depuis la copie
 * échue (150 s au plus) : elle est servie `no-store`, pour qu'un robot ne la
 * garde pas sous l'adresse `?v=` d'un score plus récent.
 */
import { ImageResponse } from "next/og";
import { MATCH_SHARE_LOGO_SIZE, MatchShareCard } from "@/components/og/match-share-card";
import { ShareCard, SHARE_CARD_SIZE } from "@/components/og/share-card";
import { SHARE_ACCENT_COLORS, ShareMotifIcon } from "@/components/og/share-motifs";
import { ShareTeamMark } from "@/components/og/share-team-mark";
import { messagesFor } from "./i18n-messages";
import { renderPageShareImage } from "./page-share-image";
import { shareCardLogo } from "./share-card-logo";
import { shareImageOptions } from "./share-card-fonts";
import { cachedShareImage } from "./share-image-cache";
import { teamLogoDataUrl } from "./share-podium";
import { publicTournamentCardForRequest, publicTournamentShareForRequest } from "./spectator-request";
import { TEAM_SHARE_LOGO_SIZE } from "./share-team";
import type { Locale } from "@/lib/shared/locales";
import { matchEmbedCard, tournamentEmbedCard } from "@/lib/shared/share-embed-cards";
import {
  matchShareVersion,
  parseEmbedShareCardKey,
  tournamentMayHaveLeader,
  tournamentShareVersion,
  type EmbedShareTarget,
} from "@/lib/shared/share-embeds";
import { matchPositionText, tournamentPageMessages, tournamentPageText } from "@/lib/shared/tournament-page-text";

/**
 * Durée de cache annoncée : cinq minutes, comme le podium. L'adresse publiée
 * change déjà avec le score (`?v=`) ; la durée borne ce qu'un lien sans
 * empreinte (collé à la main) garde d'une carte dépassée.
 */
export const EMBED_CARD_CACHE_CONTROL = "public, max-age=300";

/**
 * Durée d'une carte en mémoire : son empreinte est dans sa clé, une carte
 * inchangée n'a aucune raison d'être rendue de nouveau toutes les cinq minutes
 * (Satori et `sharp` sur le Raspberry). C'est la réserve (`embed`, éviction
 * LRU) qui borne la mémoire.
 */
export const EMBED_CARD_TTL_MS = 6 * 60 * 60_000;

/** En-tête d'une carte dessinée depuis une copie échue : jamais gardée. */
export const STALE_CARD_CACHE_CONTROL = "no-store";

/** Carte neutre d'un tournoi ou d'un match sans aperçu : celle de l'accueil. */
const NEUTRAL_CARD_KEY = "home";

/**
 * En-tête de la carte neutre : jamais gardée. Elle peut répondre à un refus
 * passager, et le tournoi peut être publié entre-temps.
 */
export const NEUTRAL_CARD_CACHE_CONTROL = "no-store";

/** La carte neutre, jamais gardée par un robot (`NEUTRAL_CARD_CACHE_CONTROL`). */
async function neutralImage(locale: Locale): Promise<Response | null> {
  const image = await renderPageShareImage(NEUTRAL_CARD_KEY, locale);
  if (!image) return null;
  return new Response(image.body, {
    headers: { "content-type": "image/png", "cache-control": NEUTRAL_CARD_CACHE_CONTROL },
  });
}

/**
 * Sert l'image d'un tournoi ou d'un match dans `locale` ; `null` pour une clé
 * qui n'en est pas une (la route répond 404). Tout le reste — tournoi non
 * publié, match d'un autre tournoi, base injoignable — rend la carte neutre.
 */
export async function renderEmbedShareImage(key: string, locale: Locale): Promise<Response | null> {
  const target = parseEmbedShareCardKey(key);
  if (!target) return null;
  const view = await readShareView(target);
  if (!view) return neutralImage(locale);
  const match = target.kind === "match" ? view.share.matches.get(target.matchId) : undefined;
  if (target.kind === "match" && !match) return neutralImage(locale);

  const version =
    target.kind === "match" && match
      ? matchShareVersion(view.card, match)
      : tournamentShareVersion(view.card, view.share.leader);
  const image = await cachedShareImage(
    `${locale}:${key}:${version}`,
    EMBED_CARD_TTL_MS,
    () => buildEmbedShareImage(target, view, locale),
    "embed",
  );
  if (!image) return neutralImage(locale);
  return new Response(image.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": view.stale ? STALE_CARD_CACHE_CONTROL : EMBED_CARD_CACHE_CONTROL,
    },
  });
}

type ShareView = NonNullable<Awaited<ReturnType<typeof publicTournamentShareForRequest>>>;

/**
 * Ce que l'image dessine. Un tournoi qui ne peut pas nommer d'équipe en tête
 * n'a besoin que de sa carte (lecture légère, sans reconstruire la réponse
 * publique ni prendre un jeton de plus) ; le reste lit la réponse publique.
 */
async function readShareView(target: EmbedShareTarget): Promise<ShareView | null> {
  if (target.kind === "tournament") {
    const card = await publicTournamentCardForRequest(target.tournamentId).catch(() => null);
    if (!card) return null;
    if (!tournamentMayHaveLeader(card)) return { card, share: { leader: null, matches: new Map() }, stale: false };
  }
  return publicTournamentShareForRequest(target.tournamentId).catch(() => null);
}

/** Rend l'image de `target` depuis la réponse publique, sans cache. */
export async function buildEmbedShareImage(
  target: EmbedShareTarget,
  view: ShareView,
  locale: Locale,
): Promise<ImageResponse | null> {
  const messages = messagesFor(locale);
  const logoSrc = await shareCardLogo();
  const options = await shareImageOptions({
    ...SHARE_CARD_SIZE,
    headers: { "cache-control": EMBED_CARD_CACHE_CONTROL },
  });

  if (target.kind === "tournament") {
    const card = tournamentEmbedCard(view.card, view.share.leader, messages, locale);
    const accent = SHARE_ACCENT_COLORS.cyan;
    const motif = card.leader ? (
      <ShareTeamMark
        logoSrc={await teamLogoDataUrl(card.leader.logoUrl, TEAM_SHARE_LOGO_SIZE)}
        initial={card.leader.initial}
        color={card.leader.winner ? SHARE_ACCENT_COLORS.teal : accent}
        size={TEAM_SHARE_LOGO_SIZE}
      />
    ) : (
      <ShareMotifIcon motif="bracket" color={accent} />
    );
    return new ImageResponse(
      <ShareCard
        eyebrow={card.eyebrow}
        accent={accent}
        state={card.state}
        title={card.title}
        subtitle={card.subtitle}
        facts={card.facts}
        footer={card.footer}
        motif={motif}
        logoSrc={logoSrc}
      />,
      options,
    );
  }

  const match = view.share.matches.get(target.matchId);
  if (!match) return null;
  const position = matchPositionText(tournamentPageText(locale, tournamentPageMessages(messages)), match);
  const card = matchEmbedCard(view.card, match, position, messages);
  const [logo1, logo2] = await Promise.all([
    teamLogoDataUrl(card.team1.logoUrl, MATCH_SHARE_LOGO_SIZE * 2),
    teamLogoDataUrl(card.team2.logoUrl, MATCH_SHARE_LOGO_SIZE * 2),
  ]);
  return new ImageResponse(
    <MatchShareCard
      eyebrow={card.eyebrow}
      state={card.state}
      title={card.title}
      subtitle={card.subtitle}
      team1={{ ...card.team1, logoSrc: logo1 }}
      team2={{ ...card.team2, logoSrc: logo2 }}
      center={card.center}
      maps={card.maps}
      moreMaps={card.moreMaps}
      noCode={messages.share.embed.noCode}
      footer={card.footer}
      logoSrc={logoSrc}
    />,
    options,
  );
}
