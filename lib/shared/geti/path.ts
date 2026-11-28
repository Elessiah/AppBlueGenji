/**
 * Adresse de la page des annonces GETI, sans préfixe de langue.
 *
 * Module sans aucune dépendance : l'en-tête de chaque page (`PublicNavMenu`)
 * l'importe sans charger les filtres de `page.ts`. Une seule source pour le
 * menu, l'encart de l'accueil et la page.
 */
export const GETI_PAGE_PATH = "/geti-info";

/**
 * Adresse canonique de la liste par défaut (`/geti-info/lfs`, celle que déclare
 * `/geti-info`) : le menu et l'encart de l'accueil y mènent tous deux, une seule
 * adresse pour une même liste. Écrite ici en clair pour la même raison que
 * `GETI_PAGE_PATH` ; un test la tient égale à
 * `getiCategoryPath(GETI_DEFAULT_CATEGORY)`.
 */
export const GETI_DEFAULT_LIST_PATH = `${GETI_PAGE_PATH}/lfs`;
