# Registre des traitements publié

Le RGPD (article 30) demande de tenir un **registre des activités de
traitement**, que la CNIL peut réclamer à tout moment. Plutôt qu'un tableur tenu
à part, il est **publié** par le site, et chacun le récupère seul — la CNIL, un
joueur, le staff — sans demande à faire :

| Adresse | Contenu |
| --- | --- |
| `/rgpd/registre` | Le registre en page : acteurs, puis une fiche par traitement |
| `/rgpd/registre.csv` | Le même en tableur (une ligne par traitement) |
| `/rgpd`, section « Registre des traitements » | Une ligne par fiche (finalité, base légale, conservation, lien vers la fiche), bouton de téléchargement et lien vers la page |

## Source unique

`lib/shared/processing-register.ts` (pur) porte tout : le responsable
(`registerController` : l'association sous sa dénomination statutaire et son siège, contact tiré de `lib/shared/legal-contact.ts` — personne à contacter pour les demandes relatives aux données (l'hébergeur technique, rubrique `dataContact`, qui a remplacé « Délégué à la protection des données » : ce n'en est pas un), renvoi aux coordonnées de la politique de confidentialité et des mentions légales, formulaire, **aucune adresse en clair**, un tableur ne sachant pas la révéler au clic),
la liste `PROCESSING_ACTIVITIES` et l'export `registerToCsv`. La page et le
tableur en descendent tous deux : ils ne peuvent pas se contredire.

Les rubriques sont celles du modèle de registre de la CNIL — finalité principale
et sous-finalités, catégories de personnes et de données, données sensibles,
durées de conservation, destinataires, transferts hors UE, mesures de sécurité —
plus la **base légale**, que le modèle ne demande pas mais qu'on attend de
retrouver en cas de contrôle. Chaque traitement a une référence stable (`T01`…),
qui sert d'ancre (`/rgpd/registre#t09`) et de repère dans une réponse à la CNIL.

## Ce que le registre couvre — et ce qu'il ne couvre pas encore

`/rgpd` ne recopie pas le registre : sa section « Registre des traitements »
**le lit** (`PROCESSING_ACTIVITIES.map`), si bien qu'une fiche ajoutée paraît
d'elle-même dans la politique. Elle ne couvrait qu'une partie des traitements
tant qu'elle les résumait à la main.

Le registre ne se dit plus exhaustif. `REGISTER_SCOPE` le borne au site et au
bot Discord, et `REGISTER_SCOPE_DETAIL` dit ce qui l'entoure : le portail de
support Spiceworks (`T15`, tickets supprimés un mois après leur clôture —
`SUPPORT_TICKET_RETENTION_MONTHS`), la retransmission des matchs (`T16`) et les
journaux d'accès nginx (`T17`, 14 jours — `WEB_ACCESS_LOG_RETENTION_DAYS`, à
poser en production : `docs/DEPLOYMENT.md`) y ont une fiche ; la gestion des
adhésions **ne relève pas du site** (décision de l'association) et n'y figure
pas. Spiceworks est sous-traitant (son accord de traitement des données) et la
retransmission n'emporte aucun transfert de la part du site (voir « Transferts »
ci-dessous) ; ce qui resterait inconnu s'écrit « décision requise », jamais
deviné (voir `ERREUR.txt`).
Les deux constantes servent `/rgpd` et `/rgpd/registre`.

L'hébergeur technique est sous-traitant : son contrat au sens de l'article 28
est rédigé dans `docs/legal/contrat-sous-traitance-hebergement.md`, **non
signé** — `HOST_PROCESSING_AGREEMENT` le dit ainsi dans la rubrique de
l'hébergeur et dans `T09`. Le courriel de l'association est une messagerie
Gmail : Google en est destinataire (`T11`, `ASSOCIATION_GMAIL_FRAMEWORK`), et
une demande reçue par ce courriel ou par le téléphone de l'association suit la
règle des demandes RGPD (durée du traitement, puis 30 jours après la clôture).
Les contacts présentés au lancement d'un match reposent sur l'exécution des
conditions d'utilisation (`T04`), l'exposition du tag certifié à
l'organisation restant fondée sur le consentement.

`T13` décrit la preuve d'acceptation des conditions d'utilisation
(`bg_terms_acceptances`), table qui gardait une donnée personnelle sans fiche.

## Transferts : un mécanisme par destinataire

`TRANSFER_RECIPIENTS` rattache chaque destinataire hors UE à **son** mécanisme —
Google, Microsoft, Apple, Mozilla, Discord et Spiceworks (Ziff Davis, Inc.) à
la décision d'adéquation
(UE) 2023/1795 (EU-U.S. Data Privacy Framework), Blizzard aux clauses
contractuelles types —, et `transferBasis([...])` en rédige la phrase, regroupée
par mécanisme, pour le registre comme pour `/rgpd`. La formule d'avant
(« adéquation pour un destinataire certifié, à défaut clauses contractuelles
types ») ne disait pour aucun sur quoi il reposait. Un destinataire ajouté
demain s'ajoute au registre avec son mécanisme, vérifié sur la liste officielle
du DPF. Spiceworks, sous-traitant du portail de support (T15), garde en
repli les clauses contractuelles types de son accord de traitement des données
(`SPICEWORKS_SCC_FALLBACK`). Les sauvegardes n'ont plus de transfert : elles
sont stockées chez Hetzner, en Allemagne (`HETZNER_BACKUP_FRAMEWORK`, T09), voir
`BACKUP_DATA_PROTECTION.md`. La retransmission des matchs (T16) n'en a pas non
plus : le site ne fait que lier les chaînes, sans lecteur intégré, et chaque
plateforme traite les données de ses spectateurs en responsable.

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

Rien dans l'export ne dépend de l'environnement du serveur : le contact est une
constante du code (`lib/shared/legal-contact.ts`), si bien que la route
(`app/rgpd/registre.csv/route.ts`) peut être rendue à la compilation. Elle ne
porte donc plus de `force-dynamic`, qui n'existait que pour une adresse de
contact lue dans la configuration.

## Entretien

**Un traitement ajouté au site s'ajoute au registre dans la même PR** — une
table qui garde une donnée personnelle, un envoi vers un tiers — et
`REGISTER_UPDATED_AT` avance. Le registre ne contient aucune donnée personnelle :
le publier ne pose aucun problème, c'est même ce qui le rend vérifiable.

## Points à surveiller

Ce que le registre dit honnêtement et qui mériterait une décision :

- **Mesure d'audience (T06)** : le détail des visites est effacé au bout de
  `SITE_VISIT_DETAIL_RETENTION_DAYS` jours (31), après report dans un compteur
  par jour, et aucune visite ne garde l'identifiant d'un compte (seul un
  indicateur « visiteur connecté »). Reste une empreinte par visiteur, sans page
  ni date, gardée **sans limite** pour le compte des visiteurs uniques depuis la
  mise en service. Pour la mesure d'audience, la CNIL recommande une
  conservation des données collectées de **25 mois** au plus — les 13 mois
  qu'on cite souvent sont la durée de vie des **traceurs** (le site n'en pose
  qu'un pour compter les visites, une marque `sessionStorage` qui meurt avec
  l'onglet). L'empreinte illimitée est ce qui mériterait une décision.
- **Journal Discord du staff (T05)** : aucune purge automatique du salon.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Registre des traitements publié** (`lib/shared/processing-register.ts` pur → `/rgpd/registre` + `/rgpd/registre.csv`, bouton sur `/rgpd`) : le registre de l'article 30, tenu dans le code et récupérable par tous sans demande (CNIL, joueurs, staff) — une fiche par traitement aux rubriques du modèle CNIL, plus la base légale. **Un traitement ajouté au site (table qui garde une donnée personnelle, envoi vers un tiers) s'ajoute au registre dans la même PR**, et `REGISTER_UPDATED_AT` avance. Les durées citées sont les **constantes** du code : `SESSION_RETENTION_DAYS` et `DISCORD_CODE_VALIDITY_MINUTES` y vivent et sont importées par `auth.ts` / `users-service.ts`, si bien que le registre ne peut pas annoncer une durée que le serveur ne tient pas. Export CSV `;` + BOM UTF-8 (Excel), cellules protégées contre l'injection de formule. Voir `docs/features/PROCESSING_REGISTER.md`.
