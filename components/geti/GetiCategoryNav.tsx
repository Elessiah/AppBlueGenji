import { ArrowLeftRight, ClipboardList, Mic, Swords, UserPlus, Users, type LucideIcon } from "lucide-react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { formatLocalNumber } from "@/lib/shared/dates";
import type { GetiCategory } from "@/lib/shared/geti";
import { GETI_CATEGORY_ORDER, getiCategoryPath } from "@/lib/shared/geti/page";
import { getiText, type GetiMessages } from "@/lib/shared/geti/page-text";
import type { Locale } from "@/lib/shared/locales";
import styles from "./geti.module.css";

/** Icône de chaque catégorie — les mêmes que ses cartes d'aperçu (`GETI_SHARE_CARD_STYLES`). */
export const GETI_CATEGORY_ICONS: Readonly<Record<GetiCategory, LucideIcon>> = {
  lfs: Swords,
  lfp: UserPlus,
  lft: Users,
  lfsub: ArrowLeftRight,
  lfstaff: ClipboardList,
  lfcast: Mic,
};

/**
 * Sélecteur de catégorie de la page des annonces (`docs/features/GETI_INFO.md`
 * § Sélecteur) : « Je cherche : » puis une case par catégorie — icône, libellé,
 * nombre d'annonces affichées par défaut quand il est connu.
 *
 * Des **liens** (une adresse par catégorie), pas un `tablist` : chaque case
 * recharge la page à son adresse, la courante porte `aria-current="page"`.
 * Elle se distingue autrement que par la couleur : bordure pleine, barre
 * basse, icône sur fond plein, graisse.
 */
export function GetiCategoryNav({
  text,
  locale,
  current,
  counts,
  filtered = false,
}: Readonly<{
  text: GetiMessages["tabs"];
  locale: Locale;
  current: GetiCategory;
  /** Annonces affichées par défaut dans chaque catégorie ; `null` : inconnu, aucun nombre n'est rendu. */
  counts: Readonly<Record<GetiCategory, number>> | null;
  /** Des filtres sont actifs : le nombre de la case courante (sans filtre) le dit à la lecture vocale. */
  filtered?: boolean;
}>) {
  return (
    <nav className={styles.tabs} aria-label={text.label}>
      <p className={styles.tabsLabel} aria-hidden="true">
        {text.heading}
      </p>
      <ul className={styles.tabList} data-tap-zone="">
        {GETI_CATEGORY_ORDER.map((entry) => {
          const Icon = GETI_CATEGORY_ICONS[entry];
          const active = entry === current;
          return (
            <li key={entry}>
              <LocaleLink
                href={getiCategoryPath(entry)}
                className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                aria-current={active ? "page" : undefined}
              >
                <span className={styles.tabIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className={styles.tabName}>{text[entry]}</span>
                {counts ? (
                  <span className={styles.tabCount}>
                    <span aria-hidden="true">{formatLocalNumber(counts[entry], locale)}</span>
                    <span className="sr-only">
                      , {getiText(locale, active && filtered ? text.countUnfiltered : text.count, { count: counts[entry] })}
                    </span>
                  </span>
                ) : null}
              </LocaleLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
