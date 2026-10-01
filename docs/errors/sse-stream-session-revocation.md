# Flux SSE survivant à la révocation de session

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-09-30] app/api/tournaments/[id]/stream/route.ts:57 + lib/server/auth.ts (revokeOtherSessions, clearSession) + lib/server/account-suspensions.ts (suspendAccount) — un flux SSE de tournoi déjà ouvert survit à la révocation de la session qui l'a ouvert : la session n'est lue qu'à l'ouverture du flux, si bien qu'après une déconnexion, une révocation des autres sessions, une suppression de compte ou désormais une suspension, l'onglet déjà ouvert continue de recevoir les instantanés avec le contexte du lecteur (palier prioritaire, aperçu du plateau pour un arbitre, tournoi non publié) jusqu'au rechargement ou à la coupure du flux ; aucune écriture n'est possible (les routes relisent la session) — piste : un évènement de révocation par compte qui ferme ses flux (`live.ts`), ou une relecture de la session au battement de cœur (25 s) — (rencontré sur : feature/moderation-suspension, PR #326)
