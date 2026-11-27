/**
 * Libellés de la page des annonces GETI, dans la langue de la page —
 * `docs/features/GETI_INFO.md` § Page.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { getiClockLabel, type GetiChip } from "@/lib/shared/geti/page";
import type { GetiRank } from "@/lib/shared/geti/types";
import type { Messages } from "@/lib/shared/i18n-messages";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { formatMessage, type MessageValues } from "@/lib/shared/message-format";

export type GetiMessages = Messages["geti"];

/** Les libellés de données (rangs, rôles, régions…) : ce que lisent les étiquettes et les filtres. */
export type GetiDataText = Pick<
  GetiMessages,
  "chips" | "tiers" | "roles" | "subRoles" | "staffRoles" | "levels" | "regions" | "platforms" | "languages" | "days"
>;

/**
 * Ce que lit le panneau de filtres (composant client) : les libellés de données
 * et le seul gabarit de rang des étiquettes — pas le reste des étiquettes.
 */
export type GetiFilterDataText = Omit<GetiDataText, "chips"> & { chips: Pick<GetiDataText["chips"], "rank"> };

/** Extrait les libellés que lit le panneau de filtres (ce qui voyage vers un composant client). */
export function getiFilterDataText(messages: GetiMessages): GetiFilterDataText {
  const { chips, tiers, roles, subRoles, staffRoles, levels, regions, platforms, languages, days } = messages;
  return { chips: { rank: chips.rank }, tiers, roles, subRoles, staffRoles, levels, regions, platforms, languages, days };
}

/** Extrait les libellés de données des messages (ce qui voyage vers un composant client). */
export function getiDataText(messages: GetiMessages): GetiDataText {
  const { chips, tiers, roles, subRoles, staffRoles, levels, regions, platforms, languages, days } = messages;
  return { chips, tiers, roles, subRoles, staffRoles, levels, regions, platforms, languages, days };
}

/** Un message formaté dans la langue de la page. */
export function getiText(locale: Locale, source: string, values?: MessageValues): string {
  return formatMessage(INTL_LOCALE[locale], source, values);
}

/** « Master 3 ». */
export function getiRankLabel(rank: GetiRank, text: GetiFilterDataText, locale: Locale): string {
  return getiText(locale, text.chips.rank, { tier: text.tiers[rank.tier], division: rank.division });
}

function rankRangeLabel(min: GetiRank, max: GetiRank, text: GetiDataText, locale: Locale): string {
  const low = getiRankLabel(min, text, locale);
  if (min.tier === max.tier && min.division === max.division) return low;
  return getiText(locale, text.chips.rankRange, { min: low, max: getiRankLabel(max, text, locale) });
}

/** « jeu. 26 nov. » pour une date « AAAA-MM-JJ ». */
function dateLabel(iso: string, locale: Locale): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Le texte d'une étiquette d'annonce. */
export function getiChipLabel(chip: GetiChip, text: GetiDataText, locale: Locale): string {
  switch (chip.kind) {
    case "rank": {
      const rank = rankRangeLabel(chip.min, chip.max, text, locale);
      return chip.role === null ? rank : getiText(locale, text.chips.rankForRole, { role: text.roles[chip.role], rank });
    }
    case "role":
      return text.roles[chip.value];
    case "subRole":
      return text.subRoles[chip.value];
    case "staffRole":
      return text.staffRoles[chip.value];
    case "level":
      return text.levels[chip.value];
    case "region":
      return text.regions[chip.value];
    case "platform":
      return text.platforms[chip.value];
    case "language":
      return text.languages[chip.value];
    case "day":
      return text.days[chip.value];
    case "time": {
      const from = getiClockLabel(chip.from, locale);
      const time =
        chip.to === null
          ? getiText(locale, text.chips.timeFrom, { from })
          : getiText(locale, text.chips.timeRange, { from, to: getiClockLabel(chip.to, locale) });
      return chip.timezone ? getiText(locale, text.chips.timeZone, { time, zone: chip.timezone }) : time;
    }
    case "date":
      return dateLabel(chip.iso, locale);
    case "team":
      return getiText(locale, text.chips.team, { name: chip.name });
    case "minAge":
      return getiText(locale, text.chips.minAge, { age: chip.age });
  }
}
