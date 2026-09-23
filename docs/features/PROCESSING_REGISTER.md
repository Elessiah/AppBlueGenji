# Registre des traitements publié

Le RGPD (article 30) demande de tenir un **registre des activités de
traitement**, que la CNIL peut réclamer à tout moment. Plutôt qu'un tableur tenu
à part, il est **publié** par le site, et chacun le récupère seul — la CNIL, un
joueur, le staff — sans demande à faire :

| Adresse | Contenu |
| --- | --- |
| `/rgpd/registre` | Le registre en page : acteurs, puis une fiche par traitement |
| `/rgpd/registre.csv` | Le même en tableur (une ligne par traitement) |
| `/rgpd`, section « Registre des traitements » | Bouton de téléchargement et lien vers la page |

## Source unique

`lib/shared/processing-register.ts` (pur) porte tout : le responsable
(`registerController`, contact passé en argument depuis `RGPD_CONTACT_EMAIL`),
la liste `PROCESSING_ACTIVITIES` et l'export `registerToCsv`. La page et le
tableur en descendent tous deux : ils ne peuvent pas se contredire.

Les rubriques sont celles du modèle de registre de la CNIL — finalité principale
et sous-finalités, catégories de personnes et de données, données sensibles,
durées de conservation, destinataires, transferts hors UE, mesures de sécurité —
plus la **base légale**, que le modèle ne demande pas mais qu'on attend de
retrouver en cas de contrôle. Chaque traitement a une référence stable (`T01`…),
qui sert d'ancre (`/rgpd/registre#t09`) et de repère dans une réponse à la CNIL.

## Les durées ne peuvent pas mentir

Le registre cite une durée ; le code en applique une. Pour qu'elles soient la
même, **chaque durée qui existe en constante est citée par sa constante** :
sauvegardes (`BACKUP_RETENTION_DAYS`), journal des suppressions
(`ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS`), fenêtre de visite
(`SITE_VISIT_WINDOW_MINUTES`). Deux durées écrites en dur côté serveur ont été
**déplacées ici** et y sont importées : `SESSION_RETENTION_DAYS` (cookie et
ligne de session, `lib/server/auth.ts`) et `DISCORD_CODE_VALIDITY_MINUTES`
(validité d'un code de connexion, `lib/server/users-service.ts`). Changer l'une
change le registre du même coup.

## Format de l'export

CSV, parce qu'il s'ouvre partout (Excel, LibreOffice, Google Sheets) sans
dépendance, et que la CNIL n'impose aucun format — seulement les rubriques :

- séparateur `;`, celui qu'un tableur réglé en français attend ;
- BOM UTF-8 en tête, sans lequel Excel lit les accents en Windows-1252 ;
- plusieurs éléments d'une rubrique = une ligne chacun dans la même cellule ;
- une cellule commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe :
  un tableur l'exécuterait sinon comme une formule (injection CSV) ;
- nom de fichier daté par `REGISTER_UPDATED_AT`.

La route est rendue à la demande (`force-dynamic`) pour que l'adresse de contact
suive la configuration du serveur et non celle de la machine qui a compilé.

## Entretien

**Un traitement ajouté au site s'ajoute au registre dans la même PR** — une
table qui garde une donnée personnelle, un envoi vers un tiers — et
`REGISTER_UPDATED_AT` avance. Le registre ne contient aucune donnée personnelle :
le publier ne pose aucun problème, c'est même ce qui le rend vérifiable.

## Points à surveiller

Ce que le registre dit honnêtement et qui mériterait une décision :

- **Mesure d'audience (T06)** : les visites ne sont jamais purgées, et une visite
  garde l'identifiant du compte connecté tant que celui-ci existe. La CNIL
  recommande 13 mois au plus pour ce type de statistiques.
- **Journal Discord du staff (T05)** : aucune purge automatique du salon.
- **Hébergement du serveur** : le registre ne nomme pas son pays. À compléter
  une fois confirmé.
