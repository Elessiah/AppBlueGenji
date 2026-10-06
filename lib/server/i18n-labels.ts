import { getTranslations } from "next-intl/server";

/**
 * Précision du sélecteur de langue (« lire cette page en anglais »), traduite
 * côté serveur dans la langue de la requête, puis passée en prop au composant
 * client : aucun dictionnaire ni code de `next-intl` n'est envoyé au
 * navigateur pour elle (`components/i18n/LanguageSwitcher.tsx`).
 */
export async function languageSwitcherLabel(): Promise<string> {
  const t = await getTranslations("common.languageSwitcher");
  return t("label");
}
