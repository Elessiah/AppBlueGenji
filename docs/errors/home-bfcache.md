# Accueil `/` — bf-cache non restaurable

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-09] accueil `/` — `bf-cache` échoue (`Cache-Control: private, no-cache, no-store` sur le document) — **non corrigé à dessein, prémisse revérifiée le 2026-09-16** : aucune ligne du dépôt ne pose ce `no-store`, c'est le défaut de Next pour une page rendue à la demande, et toutes le sont désormais (la mise en page racine déclare sa dépendance au nonce, voir `lib/shared/csp.ts`). Le rétablir demanderait d'écraser cet en-tête dans le middleware, ce qui rendrait la page restituable par le retour arrière **après une déconnexion** — pseudo et avatar du compte précédent réaffichés sur un poste partagé. La parade existe (`Clear-Site-Data: "cache"` à la déconnexion) mais son support varie selon les navigateurs, et on échangerait une propriété de confidentialité tenue contre un point d'audit. L'entrée reste donc pour qu'on ne le « répare » pas par distraction — c'est sa seule raison d'être — (rencontré sur : feature/pagespeed-audit-fixes ; prémisse revérifiée sur : fix/erreur-txt-cleanup)
