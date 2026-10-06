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
import { loadSharePodium } from "./share-podium";
import { loadShareTeam, TEAM_SHARE_LOGO_SIZE } from "./share-team";
import type { Locale } from "@/lib/shared/locales";
import {
  parseTeamShareCardKey,
  podiumShareEntries,
  resolvePageShareCard,
  teamShareCard,
} from "@/lib/shared/page-share-cards";
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

/** Rend la carte `key` dans `locale` ; `null` pour une clé inconnue. */
export async function renderPageShareImage(key: string, locale: Locale): Promise<ImageResponse | null> {
  const messages = messagesFor(locale);
  const modeTexts = new Map(localizedRuleModes(messages.rules).map((mode) => [mode.slug, mode]));
  const card = resolvePageShareCard(key, messages.share, modeTexts);
  if (!card) return null;

  const logoSrc = await shareCardLogo();

  const teamId = parseTeamShareCardKey(key);
  if (teamId !== null) {
    const team = await loadShareTeam(teamId);
    if (team) {
      const teamCard = teamShareCard(team, messages.share);
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
        { ...SHARE_CARD_SIZE, headers: { "cache-control": PODIUM_CARD_CACHE_CONTROL } },
      );
    }
  }

  if (key === PODIUM_CARD_KEY) {
    const entries = podiumShareEntries(await loadSharePodium(), messages.share);
    if (entries) {
      return new ImageResponse(
        <PodiumShareCard
          eyebrow={messages.share.podium.eyebrow}
          title={messages.share.podium.title}
          footer={card.footer}
          entries={entries}
          logoSrc={logoSrc}
        />,
        { ...SHARE_CARD_SIZE, headers: { "cache-control": PODIUM_CARD_CACHE_CONTROL } },
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
    {
      ...SHARE_CARD_SIZE,
      headers: {
        // Sans podium, la carte du classement attend le prochain ; une équipe
        // absente du classement peut y entrer : même durée courte.
        "cache-control":
          key === PODIUM_CARD_KEY || teamId !== null ? PODIUM_CARD_CACHE_CONTROL : STATIC_CARD_CACHE_CONTROL,
      },
    },
  );
}
