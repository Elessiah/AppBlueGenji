import { LocaleLink } from "@/components/i18n/locale-navigation";
import { CyberButton, CyberCard } from "@/components/cyber";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { landingServerText } from "@/lib/server/i18n-landing";
import { GETI_CATEGORY_ORDER, GETI_DEFAULT_CATEGORY, getiCategoryPath } from "@/lib/shared/geti/page";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import styles from "./GetiSpotlight.module.css";

/**
 * Encart de l'accueil vers les annonces GETI (`/geti-info`), fonction
 * principale du site : une phrase d'appel, un bouton vers la page et un
 * raccourci par catégorie (`docs/features/GETI_INFO.md` § Navigation).
 *
 * Le bouton vise l'adresse canonique de la catégorie par défaut (`/geti-info/lfs`,
 * celle que `/geti-info` déclare) : l'encart ne donne qu'une adresse par liste.
 * Les raccourcis disent **ce que la liste contient** (« Équipes qui recrutent »),
 * pas l'intention de l'auteur de l'annonce : « Je cherche un joueur » mènerait
 * un capitaine aux annonces d'autres équipes.
 *
 * Composant serveur, sans lecture de données : il ne dépend ni des annonces en
 * base ni de Discord, et s'affiche donc même quand le relais est muet.
 */
export function GetiSpotlight({ locale = DEFAULT_LOCALE }: Readonly<{ locale?: Locale }>) {
  const { t } = landingServerText(locale);
  return (
    <section className={styles.root} aria-labelledby="geti-spotlight-title">
      <CyberCard ticks className={styles.card}>
        <div className={styles.inner}>
          <div className={styles.copy}>
            <span className="eyebrow">{t("geti.eyebrow")}</span>
            <h2 id="geti-spotlight-title" className={`display ${styles.title}`}>
              {t("geti.titleLead")} <span className={styles.accent}>{t("geti.titleAccent")}</span>
            </h2>
            <div className={styles.ledeRow}>
              <InfoHintRow inline>
                <p className={styles.lede}>{t("geti.lede")}</p>
                <InfoHint id="geti-spotlight-hint" subject={t("geti.hintSubject")}>
                  {t("geti.hint")}
                </InfoHint>
              </InfoHintRow>
            </div>
          </div>

          <div className={styles.side}>
            <CyberButton variant="primary" className={styles.cta} asChild>
              <LocaleLink href={getiCategoryPath(GETI_DEFAULT_CATEGORY)}>{t("geti.cta")}</LocaleLink>
            </CyberButton>
            <p id="geti-spotlight-categories" className={styles.categoriesLabel}>
              {t("geti.categoriesLabel")}
            </p>
            <ul className={styles.categories} aria-labelledby="geti-spotlight-categories">
              {GETI_CATEGORY_ORDER.map((category) => (
                <li key={category}>
                  <LocaleLink href={getiCategoryPath(category)} className={styles.category}>
                    {t(`geti.categories.${category}`)}
                  </LocaleLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CyberCard>
    </section>
  );
}
