/**
 * Images d'aperçu d'un tournoi et d'un match partagés
 * (`/og/<langue>/tournament-<id>.png`, `/og/<langue>/tournament-<tid>-match-<mid>.png`,
 * `docs/features/SHARE_EMBEDS.md`).
 *
 * **Publiques par construction** : la route est servie sans session, et la
 * seule donnée lue est la réponse publique mutualisée du tournoi
 * (`publicTournamentShareForRequest`, celle de `/suivre/`, au même plafond de
 * lecture). Un tournoi non publié, introuvable ou illisible — ou un match qui
 * n'est pas le sien — rend la carte **neutre** du site, jamais une erreur :
 * elle ne dit pas si le tournoi existe.
 *
 * **Cache.** Le PNG est gardé en mémoire (`cachedShareImage`, réserve
 * `embed`) sous une clé qui porte l'**empreinte de ce qu'il dessine** : un
 * score saisi change l'empreinte, donc la clé — la carte suivante est rendue à
 * neuf, sans attendre la fin d'une fenêtre. L'adresse publiée par l'encart
 * porte la même empreinte (`?v=`), pour que Discord ou X ne resservent pas
 * leur ancienne copie ; le paramètre reçu, lui, n'est jamais lu : un robot qui
 * en invente ne fait pas rendre une carte de plus.
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
import { publicTournamentShareForRequest } from "./spectator-request";
import { TEAM_SHARE_LOGO_SIZE } from "./share-team";
import type { Locale } from "@/lib/shared/locales";
import { matchEmbedCard, tournamentEmbedCard } from "@/lib/shared/share-embed-cards";
import {
  matchShareVersion,
  parseEmbedShareCardKey,
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

/** Fenêtre d'une carte en mémoire : son empreinte est dans sa clé, la fenêtre ne borne que la mémoire. */
export const EMBED_CARD_TTL_MS = 5 * 60_000;

/** Carte neutre d'un tournoi ou d'un match sans aperçu : celle de l'accueil. */
const NEUTRAL_CARD_KEY = "home";

/** La carte neutre, servie en cache court : le tournoi peut être publié entre-temps. */
async function neutralImage(locale: Locale): Promise<Response | null> {
  const image = await renderPageShareImage(NEUTRAL_CARD_KEY, locale);
  if (!image) return null;
  return new Response(image.body, {
    headers: { "content-type": "image/png", "cache-control": EMBED_CARD_CACHE_CONTROL },
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
  const view = await publicTournamentShareForRequest(target.tournamentId).catch(() => null);
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
    headers: { "content-type": "image/png", "cache-control": EMBED_CARD_CACHE_CONTROL },
  });
}

type ShareView = NonNullable<Awaited<ReturnType<typeof publicTournamentShareForRequest>>>;

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
