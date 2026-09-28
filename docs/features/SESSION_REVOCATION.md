# Fermer ses autres sessions

## Le problème

Une session (`bg_user_sessions`, jeton haché, 30 jours) ne s'effaçait que de
deux façons : la déconnexion **de l'appareil courant** et la suppression du
compte. Rien ne permettait de fermer une session ouverte ailleurs — un
navigateur oublié sur un poste partagé, ou une session volée —, et détacher un
fournisseur de connexion, réflexe de qui croit son compte Google ou Discord
compromis, laissait vivantes toutes les sessions que ce fournisseur avait
ouvertes. La victime n'avait aucun recours pendant trente jours.

## Ce qui a été fait

- `revokeOtherSessions(userId)` (`lib/server/auth.ts`) efface toutes les
  sessions du compte **sauf celle de la requête**, repérée par l'empreinte de
  son cookie. Les sessions expirées partent avec, dans une première
  instruction, pour que le nombre rendu ne compte que des sessions qui
  ouvraient encore quelque chose. Sans cookie (contournement de
  développement), l'empreinte vaut `""` — jamais celle d'un vrai jeton — et
  **toutes** les sessions du compte sont fermées.
- `countOtherSessions(userId)` compte les autres sessions **valides**.
- `GET /api/profile/sessions` → `{ otherSessions }`, `DELETE` → `{ revoked }`.
  Une panne rend un code nommé (`SESSIONS_READ_FAILED`,
  `SESSIONS_REVOKE_FAILED`), jamais le message brut de la base.
- **Détacher une porte ferme les autres sessions**
  (`DELETE /api/profile/connections/[provider]`), une fois le détachement
  acquis. La réponse porte `revokedSessions` : `null` quand la fermeture a
  échoué — le retrait, lui, est fait et ne s'annonce pas raté ; l'écran dit
  l'échec et renvoie au bouton.
- Sur `/profil`, section « Applications connectées », une ligne
  « Sessions ouvertes » (`OtherSessionsPanel.tsx`) dit combien d'autres
  sessions ouvrent le compte et offre « Déconnecter mes autres sessions ». Elle
  est relue après chaque retrait. Les phrases vivent dans
  `connection-errors.ts` (`otherSessionsSummary`, `sessionsRevokedMessage`,
  `unlinkSuccessMessage`).

## Hors champ

- La liste détaillée des sessions (appareil, date, lieu) : la table ne garde ni
  user-agent ni IP, et les ajouter serait une collecte nouvelle, à déclarer.
- Fermer une seule session parmi d'autres, pour la même raison.
