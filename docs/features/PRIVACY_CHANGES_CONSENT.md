# Changements du traitement des données — acceptation et annonce

Quand la façon dont le site traite les données personnelles change, chaque
compte existant doit en être **informé** et doit pouvoir **refuser** — refuser
voulant dire ne plus avoir de compte, puisque le site ne fonctionne pas sans les
données qu'il décrit. Ce document décrit le mécanisme qui s'en charge.

## Déclencher : ajouter une entrée au registre

C'est **le seul geste** à faire, et il est fait pour être fait par un agent dans
la PR même qui change le traitement :

```ts
// lib/shared/privacy-changes.ts — à la FIN de PRIVACY_CHANGES
{
  id: "2026-11-historique-des-visites",   // stable, minuscules et tirets, ≤ 80
  publishedAt: "2026-11-04",              // date de mise en production prévue
  title: "Historique des visites raccourci",
  summary: "Une ou deux phrases qui disent l'essentiel (reprises sur Discord).",
  details: [
    "Une puce par règle, tutoiement, sans jargon.",
  ],
},
```

Tout le reste suit seul :

| Effet | Où |
| --- | --- |
| Modale à la prochaine page de chaque compte concerné | `app/layout.tsx` → `components/privacy/PrivacyChangesModal.tsx` |
| Message privé Discord aux comptes joignables | `lib/server/privacy-change-notifications.ts` |
| « Dernière mise à jour » de `/rgpd` | `privacyPolicyUpdatedLabel()` |

**Règles du registre** (tenues par `tests/lib/shared/privacy-changes.test.ts`) :
ajout seul, dans l'ordre des dates ; un identifiant publié ne se renomme ni ne
se retire (il est en base chez chaque compte qui l'a accepté — le renommer ferait
réapparaître la modale à tous) ; une coquille se corrige sur place, un changement
de fond est une **nouvelle** entrée. Penser aussi à mettre `/rgpd` à jour : la
modale résume, la politique fait foi.

## Qui voit quoi

`pendingPrivacyChanges` : un changement est dû à un compte s'il ne l'a pas
accepté **et** s'il a été publié **après le jour de création** du compte — un
compte créé le jour même ou après a consenti à la politique déjà à jour en
s'inscrivant. La comparaison porte sur le jour (`AAAA-MM-JJ`, en chaînes) : aucun
fuseau n'entre en jeu.

Les changements **se cumulent** : un joueur absent pendant trois changements les
lit tous les trois dans la même modale, sous un titre qui les compte, et une seule
acceptation les acquitte tous.

Limite assumée : un compte créé entre `publishedAt` et le déploiement effectif ne
verra pas le changement. D'où la consigne de poser la date de mise en production
prévue plutôt que celle de la rédaction.

## La modale

Rendue **côté serveur** par la mise en page racine, comme la mise en avant du
recrutement : la liste est dans le HTML initial, sans aller-retour. La lecture
(`loadPendingPrivacyChanges`) est une seule requête par page d'un visiteur
connecté, et une panne de lecture n'empêche pas la page de s'afficher (la modale
reviendra).

- **« J'accepte »** → `POST /api/profile/privacy-changes` avec les identifiants
  **montrés**, jamais « tout ce qui est dû » : un changement publié entre
  l'affichage et le clic n'est pas accepté par qui ne l'a pas lu. Le serveur
  refuse un identifiant inconnu (`UNKNOWN_PRIVACY_CHANGE`) plutôt que de
  l'ignorer, et une demande mal formée (`INVALID_PRIVACY_CHANGES`), en 400.
  `INSERT IGNORE` : accepter deux fois n'est pas une erreur, la première date
  fait foi. L'insertion ne se pose que sur un compte vivant (`is_deleted = 0`).
- **« Je refuse, je supprime mon compte »** → une seconde étape, en
  `alertdialog`, qui décrit ce que la suppression va faire : même aperçu
  (`GET /api/profile/deletion`) et mêmes phrases (`accountDeletionConfirmation`)
  que `/profil`, l'avertissement que rien ne sera récupérable, et un lien qui
  **télécharge** l'export (`/api/profile/export`) — `/profil` serait couvert par
  la même modale, son bouton d'export inatteignable. La suppression passe par la
  route ordinaire (`DELETE /api/profile`), donc tout part comme depuis `/profil`.
- **Ni Échap ni clic à côté ne la ferment** : Échap ramène seulement de la
  confirmation à la lecture. Ne rien choisir la fait revenir au chargement
  suivant.

Elle se tait sur `/rgpd` (elle y couvrirait la politique qu'elle invite à lire)
et fait taire la **modale** de recrutement tant qu'un choix est dû — deux modales
ne se superposent pas ; la banderole de recrutement, elle, reste.

## L'annonce Discord

`dispatchPrivacyChangeNotifications`, entraînée par le trafic depuis la mise en
page racine (jamais attendue), étranglée à une minute et à vol unique, comme les
rappels de match. Même canal côté bot (`POST /internal/notify/dm`) : aucune route
nouvelle, le bot n'écrit qu'aux membres du serveur BlueGenji.

- **Destinataires** : comptes vivants avec un identifiant Discord, ou un tag
  **certifié** — un tag non certifié n'est qu'une saisie, peut-être celle d'un
  autre ; on n'écrit pas à un inconnu au sujet du compte de quelqu'un.
- **Pas de spam — Discord est le seul canal de l'association.** Chaque
  déploiement qui touche aux données ajoute une entrée, et une annonce par
  entrée apprendrait aux joueurs à rendre le bot muet, rappels de match
  compris. Deux règles, dans le module pur :
  - **délai de la modale** (`PRIVACY_DM_SETTLE_DAYS`, 7 jours) : un compte n'est
    prévenu que lorsque son plus ancien changement dû a une semaine. Un joueur
    qui revient sur le site dans l'intervalle accepte dans la modale et ne
    reçoit **rien** — le message ne sert qu'à qui ne revient pas ;
  - **un message par mois au plus** (`PRIVACY_DM_MIN_INTERVAL_DAYS`, 30 jours,
    jugé en base sur `sent_at`) : un changement publié le lendemain d'un
    message attend le suivant.

  Le message porte alors **tous** les changements dus, récents compris
  (`privacyDmBatch`, tout ou rien) : trois entrées publiées sur trois jours
  partent ensemble, là où attendre le délai de chacune ferait trois messages.
  Les deux filtres sont posés **dans la requête**, avant la limite du lot — des
  comptes écartés après coup occuperaient ses vingt places à chaque balayage.
  Leur somme reste sous la fenêtre de 60 jours (tenu par un test), sans quoi un
  changement retenu en sortirait sans avoir été annoncé.

  **Le revers, assumé** : un joueur qui ne revient pas sur le site apprend un
  changement jusqu'à un mois plus tard, y compris un changement qui élargit qui
  lit ses données (les contacts présentés au lancement d'un match, par
  exemple). La modale reste l'information de référence et n'attend jamais ;
  le message privé n'est qu'un rappel pour qui ne la verra pas. Le choix
  inverse — un drapeau par entrée qui court-circuite délai et intervalle —
  rouvrirait le spam au premier changement qu'on jugerait important.

  Le balayage suppose **un seul processus** (pm2 en mode `fork`, voir
  `docs/DEPLOYMENT.md`) : l'intervalle est lu avant la réservation, et deux
  processus concurrents pourraient tous deux l'enjamber.
- **Un message par compte**, qui résume (titre, date, résumé) tous les
  changements qu'il n'a ni acceptés ni déjà reçus, et renvoie au site pour
  décider. Borné à 1 800 caractères (plafond du bot) : au-delà, les derniers
  changements sont comptés plutôt que coupés.
- **Réservation avant l'envoi** (`bg_privacy_change_notifications`, clé primaire
  `(user_id, change_id)`) : c'est elle qui interdit le doublon. Bot injoignable
  → réservation rendue, le lot repartira ; membre introuvable ou messages privés
  fermés → réservation gardée, la modale prend le relais. « Injoignable »
  comprend le bot qui ne voit **aucun** serveur BlueGenji (`503`) : avant
  blueGenjiBot#23, il répondait `200` en déclarant tout le monde introuvable, et
  la première mise en production a ainsi marqué « prévenus » des comptes à qui
  rien n'était parti — réparation : supprimer les lignes antérieures au
  redémarrage du bot corrigé. Coupe-circuit ouvert →
  rien n'est lu ni réservé.
- **Par lots de 20 comptes**, pour que le bot, qui écrit en série, réponde dans
  son délai — un dépassement ferait rendre puis renvoyer un lot déjà parti.
- **Fenêtre de 60 jours** (`PRIVACY_DM_WINDOW_DAYS`) : le message est une
  annonce, pas le consentement. Un compte qui rattache Discord un an après un
  changement ne reçoit pas une nouvelle d'un an ; la modale, elle, n'a pas de
  limite.

## Données

| Table | Contenu | Suppression du compte |
| --- | --- | --- |
| `bg_privacy_acknowledgments` | `(user_id, change_id, accepted_at)` — la trace du consentement | Cascade à l'effacement ; conservée à l'anonymisation (un identifiant et une date) |
| `bg_privacy_change_notifications` | `(user_id, change_id, sent_at)` | Idem |

Les acceptations figurent dans l'export RGPD (`privacyAcknowledgments`).

## Mise en production initiale

Deux entrées ouvrent le registre, datées du 23 septembre 2026 :

1. **`2026-09-recapitulatif-rgpd`** — le récapitulatif des règles en vigueur
   (plus d'adresse e-mail, rattachement des connexions par le joueur seul,
   exposition d'un tag Discord certifié, BattleTag écrit par Blizzard, avatars
   copiés chez nous, effacement ou anonymisation, cookies techniques).
2. **`2026-09-sauvegardes-chiffrees`** — sauvegardes chiffrées et journal des
   suppressions rejoué à la restauration (`docs/features/BACKUP_DATA_PROTECTION.md`).
   Ses durées sont lues sur `BACKUP_RETENTION_DAYS` et
   `ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS`, celles que `/rgpd` affiche : la
   modale ne peut pas annoncer une autre durée que la politique. Changer ces
   constantes est un nouveau changement du traitement, donc une nouvelle entrée.
