/**
 * Page introuvable **dans l'espace sécurisé** : tout `notFound()` jeté sous
 * `(secured)` — par une mise en page (`/admin/signalements`, `/devdoc`,
 * `/planning`, la page d'un match absent) ou par une page (`/planning`, un
 * chemin inconnu de `/devdoc`) — est rattrapé ici, sous `SiteShell`, qui
 * porte déjà la navigation. La page introuvable de la racine ajoutait son
 * propre en-tête (deux barres de navigation à 375 px) : celle-ci n'affiche que
 * la carte et ses chemins de retour. Une URL qui ne correspond à aucune route
 * reste à `app/not-found.tsx`.
 */
export { NotFoundContent as default, notFoundMetadata as generateMetadata } from "@/components/error-page/NotFoundContent";
