# Changements du traitement des données — information et annonce

Quand la façon dont le site traite les données personnelles change, chaque
compte existant doit en être **informé** (RGPD, art. 12 à 14, et 13.3 pour une
finalité nouvelle). Ce document décrit le mécanisme qui s'en charge.

## Informer, pas faire accepter

Le mécanisme demandait d'abord d'**accepter** chaque changement, le refus
menant à la suppression du compte (« J'accepte » / « Je refuse, je supprime
mon compte »). Un audit juridique l'a écarté, pour deux raisons qui valent
chacune pour une famille de traitements :

- **Intérêt légitime ou exécution du service** : le RGPD impose d'informer, pas
  de faire accepter. La contrepartie est le **droit d'opposition** (art. 21),
  décrit sur `/rgpd` et exercé par le formulaire de signalement (catégorie RGPD)
  — jamais la suppression du compte.
- **Consentement** : un accord dont le refus coûte le compte n'est pas libre
  (art. 7.4). Il se recueille par un **réglage du site**, refusable sans rien
  perdre d'autre (case décochée par défaut, geste réversible : « Tag Discord »,
  « Certifier mon tag », notifications push…), et l'entrée qui annonce le
  changement nomme ce réglage.

La modale n'a donc plus qu'un bouton, **« J'ai pris connaissance »**, et aucune
issue vers la suppression. Corollaire pour le registre : un changement qui
élargirait un traitement fondé sur le consentement **sans** réglage pour le
refuser n'est pas publiable en l'état — il faut d'abord le réglage.

**Décision requise** (hors du code) : la base légale des contacts présentés au
lancement d'un match (`2026-09-lancement-des-matchs` — tag Discord certifié et
BattleTag montrés à l'adversaire et au caster). Si c'est l'exécution du service
(il faut se joindre pour jouer le match), l'information suffit ; si c'est le
consentement donné en certifiant son tag, il faut un réglage qui refuse ce
public-là sans retirer la certification — aujourd'hui, le seul refus possible
est de retirer son tag.

## Déclencher : ajouter une entrée au registre

C'est **le seul geste** à faire, et il est fait pour être fait par un agent dans
la PR même qui change le traitement :

```ts
// lib/shared/privacy-changes.ts — à la FIN de PRIVACY_CHANGES
{
  id: "2026-11-historique-des-visites",   // stable, minuscules et tirets, ≤ 80
  publishedAt: "2026-11-04",              // date de mise en production prévue (jour de Paris)
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
| « Dernière mise à jour » de `/rgpd` | `privacyPolicyUpdatedLabel(today)` |

**Règles du registre** (tenues par `tests/lib/shared/privacy-changes.test.ts`) :
ajout seul, dans l'ordre des dates ; un identifiant publié ne se renomme ni ne
se retire (il est en base chez chaque compte qui l'a lu — le renommer ferait
réapparaître la modale à tous) ; une coquille se corrige sur place, un changement
de fond est une **nouvelle** entrée. Penser aussi à mettre `/rgpd` à jour : la
modale résume, la politique fait foi.

## Qui voit quoi

`pendingPrivacyChanges` : un changement est dû à un compte s'il n'en a pas pris
connaissance, s'il est **publié** (`publishedAt <= aujourd'hui`) **et** s'il a
été publié **après le jour de création** du compte — un compte créé le jour même
ou après s'est inscrit sous la politique déjà à jour. La comparaison porte sur le
jour (`AAAA-MM-JJ`, en chaînes), « aujourd'hui » étant le **jour de Paris**
(`privacyChangeDay`) : le jour UTC serait encore la veille entre minuit et deux
heures.

**Une entrée datée du futur reste muette** jusqu'à sa date
(`publishedPrivacyChanges`) : ni modale, ni message Discord, ni « Dernière mise à
jour » de `/rgpd`, et la route refuse d'en enregistrer la lecture
(`UNKNOWN_PRIVACY_CHANGE`). Présentée aussitôt, elle annonçait « Nos règles ont
changé » daté du lendemain, pour une règle qui ne s'appliquait pas encore.

Les changements **se cumulent** : un joueur absent pendant trois changements les
lit tous les trois dans la même modale, sous un titre qui les compte, et un seul
clic les acquitte tous.

Limite assumée : un compte créé entre `publishedAt` et le déploiement effectif ne
verra pas le changement. D'où la consigne de poser la date de mise en production
prévue plutôt que celle de la rédaction.

## Entrées ciblées

Par défaut une entrée s'adresse à **tout** compte antérieur à sa publication.
Deux champs facultatifs servent le cas d'une information qui ne concerne qu'une
partie des comptes :

- `audience` (`PrivacyAudience`) restreint les comptes concernés. Seule valeur :
  `GOOGLE_LINKED`, un compte qui porte une identité Google (`google_sub`). La
  règle est écrite deux fois, parce qu'elle est lue deux fois — en mémoire
  (`privacyChangeReachesAccount`, pour la modale et pour le message) et en base
  (`privacyAudienceSql`, pour la sélection des destinataires de l'annonce
  Discord, sans quoi des comptes non concernés occuperaient le lot). Un fait
  inconnu vaut **faux** : dans le doute, une entrée ciblée se tait.
- `links` : liens vers les écrans où agir, rendus par la modale sous le détail.
  Suivre l'un d'eux vaut prise de connaissance — la modale ne se tait que sur
  `/rgpd`, elle couvrirait sinon l'écran même où elle envoie. Le message Discord
  ne les porte pas.

Première entrée ciblée : `2026-09-comptes-google-anterieurs`, le reliquat de la
connexion Google sans nom réel. Depuis le 30 septembre 2026 un compte créé par
Google reçoit un pseudo neutre et sa photo importée naît masquée ; les comptes
d'avant gardent le pseudo et la photo que Google leur a donnés. Décision de
l'association : **rien n'est modifié d'office**, le titulaire est informé une fois
et invité à les changer. Le site ne sait pas par quelle porte un compte est
**né**, seulement quelles identités il porte : un compte né par Discord puis
relié à Google est donc compté, d'où une entrée rédigée au conditionnel. Sa date
est celle de la règle et non celle du déploiement de l'entrée — c'est elle qui
sépare les comptes concernés, `publishedAt` bornant la création.

## La modale

Rendue **côté serveur** par la mise en page racine, comme la mise en avant du
recrutement : la liste est dans le HTML initial, sans aller-retour. La lecture
(`loadPendingPrivacyChanges`) est une seule requête par page d'un visiteur
connecté, et une panne de lecture n'empêche pas la page de s'afficher (la modale
reviendra).

- **« J'ai pris connaissance »**, seul bouton → `POST /api/profile/privacy-changes`
  avec les identifiants **montrés**, jamais « tout ce qui est dû » : un
  changement publié entre l'affichage et le clic n'est pas acquitté par qui ne
  l'a pas lu. Le serveur refuse un identifiant inconnu ou pas encore publié
  (`UNKNOWN_PRIVACY_CHANGE`) plutôt que de l'ignorer, et une demande mal formée
  (`INVALID_PRIVACY_CHANGES`), en 400. `INSERT IGNORE` : acquitter deux fois
  n'est pas une erreur, la première date fait foi. L'insertion ne se pose que
  sur un compte vivant (`is_deleted = 0`).
- **Aucun refus, aucune suppression** : l'introduction dit qu'aucun accord n'est
  demandé, et le pied renvoie aux réglages de « Mon profil » (ce qui repose sur
  le consentement) et à `/rgpd` (opposition et autres droits). La suppression du
  compte reste où elle a toujours été, sur `/profil`.
- **Ni Échap ni clic à côté ne la ferment** : ne rien faire la fait revenir au
  chargement suivant.

Elle se tait sur `/rgpd` (elle y couvrirait la politique qu'elle invite à lire)
et fait taire la **modale** de recrutement tant qu'une lecture est due — deux
modales ne se superposent pas ; la banderole de recrutement, elle, reste. La
modale défile elle-même (`overflow-y: auto`) : bloquante, elle doit garder son
bouton atteignable sur un écran bas (téléphone en paysage).

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
    qui revient sur le site dans l'intervalle lit la modale et ne
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
  changements qu'il n'a ni lus sur le site ni déjà reçus, et renvoie au site
  pour le détail — en disant qu'aucun accord n'est demandé. Borné à 1 800 caractères (plafond du bot) : le balayage n'envoie et
  ne **réserve** que les changements qu'un message peut nommer tous
  (`privacyChangesForOneMessage`), et le reste part au message suivant — un mois plus tard au plus tôt, l'intervalle minimal valant pour lui aussi (revers : un premier message parti tard dans la fenêtre de 60 jours peut en laisser sortir ce reste avant le suivant ; la modale, elle, l'a présenté). Le
  repli qui *compte* les derniers (« … et 1 autre ») ne suffit pas à l'envoi :
  réservés avant l'envoi, ils étaient tenus pour annoncés sans que leur titre
  ait été écrit — et c'était toujours le plus récent qui tombait. Le registre
  entier ne tient plus dans un message depuis sa huitième entrée.
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
- **Fenêtre de 60 jours** (`PRIVACY_DM_WINDOW_DAYS`) : le message n'est qu'un
  relais de la modale. Un compte qui rattache Discord un an après un
  changement ne reçoit pas une nouvelle d'un an ; la modale, elle, n'a pas de
  limite.

## Données

| Table | Contenu | Suppression du compte |
| --- | --- | --- |
| `bg_privacy_acknowledgments` | `(user_id, change_id, accepted_at)` — la trace de l'information (la colonne garde son nom d'origine) | Cascade à l'effacement ; effacée aussi à l'anonymisation (`anonymizeAccount` : elle ne concerne plus personne) |
| `bg_privacy_change_notifications` | `(user_id, change_id, sent_at)` | Idem |

Les prises de connaissance figurent dans l'export RGPD (`privacyAcknowledgments`,
champ `acceptedAt` inchangé pour ne pas casser le format). Registre : T10, base
« obligation légale d'information ».

## Dates corrigées

`2026-10-retrait-google-one-tap` portait `publishedAt: "2026-10-01"` alors que
le retrait a été mergé le 29 septembre 2026 dans l'après-midi (#278), puis mis
en ligne : sa date est ramenée au **30 septembre**, comme les deux entrées
livrées avec lui (#272, mesure d'audience). Le lendemain de la mise en ligne et
non son jour : un compte né le 29 **avant** le déploiement s'est inscrit sous
l'ancienne politique, et `createdDay < publishedAt` le priverait pour toujours
de ces changements — dont celui qui lui apprend que son tag a été certifié
automatiquement. L'erreur inverse (un compte né le 29 après le déploiement lit
un changement déjà en vigueur) est sans dommage. Octobre, lui, n'avait pas de
raison d'être. L'identifiant, déjà publié, garde son « 2026-10 ».

Règle qui en découle : quand l'heure du déploiement n'est pas connue, dater
une entrée du **lendemain** de sa mise en ligne.

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
