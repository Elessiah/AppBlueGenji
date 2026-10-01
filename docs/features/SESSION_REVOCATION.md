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

## Les flux déjà ouverts

Effacer une ligne de `bg_user_sessions` ne ferme que les **requêtes à venir**.
Le flux SSE d'un tournoi ne lit la session qu'à son ouverture, puis garde le
contexte du lecteur (palier prioritaire, aperçu du plateau d'un arbitre,
tournoi non publié) tant que la connexion tient : un onglet déjà ouvert
continuait donc de recevoir les instantanés après une déconnexion, une
révocation, une suspension ou une suppression de compte.

`lib/server/session-streams.ts` range chaque flux ouvert par compte et par
empreinte de session. Quatre gestes le ferment :

| Geste | Appel | Flux fermés |
| --- | --- | --- |
| Déconnexion (`clearSession`) | `closeSessionStreams(empreinte)` | ceux de cette session |
| « Déconnecter mes autres sessions », détachement d'une porte (`revokeOtherSessions`) | `closeUserStreams(id, { keepTokenHash })` | tous sauf ceux de la session courante |
| Suspension (`suspendAccount`) | `closeUserStreams(id)`, **après le commit** | tous |
| Suppression du compte (`deleteOwnAccount`, deux modes) | `closeUserStreams(id)`, **après le commit** | tous |

Le flux s'inscrit **dès la session lue**, avant les lectures de l'instantané et
du contexte : une révocation qui tombe pendant celles-ci le fait répondre 401
au lieu d'ouvrir. Fermé, le client se reconnecte et la route le refuse — c'est
la porte ordinaire qui décide, pas une seconde règle. Relire la session au
battement de cœur (25 s) aurait coûté une requête par flux et laissé encore
jusqu'à 25 s de lecture.

Le registre vit en mémoire du processus, comme les salles de diffusion qu'il
accompagne : il suppose l'instance unique que le flux suppose déjà.

Une révocation commitée **pendant la lecture de la session** ne trouve pas
encore le flux à fermer. Elle laisse donc une trace datée (`revocationMark` /
`revokedSince`, gardée une minute) : la route prend un repère avant de lire la
session et, une fois le flux inscrit, refuse en 401 si une révocation
postérieure vise son compte ou sa session. Enfin, une lecture d'ouverture qui
lève désinscrit le flux — le registre est global, et une reconnexion en boucle
pendant une panne de base le ferait sinon grossir sans fin.

## Hors champ

- La liste détaillée des sessions (appareil, date, lieu) : la table ne garde ni
  user-agent ni IP, et les ajouter serait une collecte nouvelle, à déclarer.
- Fermer une seule session parmi d'autres, pour la même raison.
