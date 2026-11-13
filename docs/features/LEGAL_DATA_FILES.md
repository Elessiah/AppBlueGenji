# Fichiers de données juridiques sans duplication

Les textes juridiques bilingues — registre des traitements
(`lib/shared/processing-register.ts`), documents du bot
(`lib/shared/bot-legal-content.ts`) — s'écrivent **une seule fois pour les deux
langues**. Avant ce lot (LEGAL-FILES-DEDUP), chaque langue répétait la même
structure ligne à ligne : SonarCloud, qui remplace le contenu des chaînes par un
jeton unique avant de comparer, y voyait du code dupliqué, et la moindre
retouche d'une phrase faisait échouer la barrière de duplication de la PR.

## Disposition

- `lib/shared/bilingual.ts` (pur, sans importation) : `frEn(fr, en)` écrit une
  valeur qui change d'une langue à l'autre ; `localize(valeur, "fr" | "en")`
  remplace chaque paire par sa moitié (tableaux, objets et ordre des clés
  recopiés) ; `inBothLanguages(valeur)` rend `{ fr, en }`. `Localizable<T>` est
  la forme bilingue d'un type : chaque nœud est commun ou une paire complète.
- **Registre** : les fiches sont rangées dans `ACTIVITIES`, sous leur référence
  (`T01: { … }` ; la clé devient `ref`, via `registerActivities`).
  `PROCESSING_ACTIVITIES` et `PROCESSING_ACTIVITIES_EN` en sont tirés ; les
  textes anglais de cadre (`transferBasisEn`, `registerControllerEn`, clauses
  contractuelles…) vivent dans le même fichier, sous le bloc « English
  versions ». `processing-register-en.ts` ne fait plus que **réexporter**
  l'anglais (ses importateurs n'ont pas changé).
- **Documents du bot** : `TERMS_OF_SERVICE` et `PRIVACY_POLICY` sont chacun un
  seul `LegalDoc` bilingue passé à `inBothLanguages`. Les sections sont nommées
  dans l'ordre de lecture (`numberedSections({ publisher, access, … })`), qui
  leur donne leur numéro (`"01"`, `"02"`…).
- **Politique `/rgpd`** (`rgpd-policy.ts`) : les bases légales et la durée
  répétées sont des constantes (`CONTRAT`, `CONSENTEMENT`, `INTERET_LEGITIME`,
  `OBLIGATION_LEGALE`, `DUREE_DU_COMPTE`). `rgpd-policy-en.ts` et les
  conditions d'utilisation n'avaient pas de duplication : inchangés.
- **Journal des changements** (`privacy-changes.ts`, `privacy-changes-en.ts`) :
  reste **exclu** de la détection de duplication (`.sonarcloud.properties`).
  Ses entrées publiées sont immuables, toutes de même forme, et le module
  français est importé par des composants client : l'anglais ne peut pas y
  entrer (il est déjà rangé à part, par identifiant).

Le rendu est resté **identique à l'octet** en français et en anglais (pages,
CSV, objets exportés comparés avant et après) ; les références françaises
`tests/fixtures/legal-fr/*.txt` n'ont pas bougé.

## Retoucher un texte

- **Changer une phrase** : modifier la ligne française **et** la ligne anglaise
  du même `frEn(` — le français sur la ligne de l'appel, l'anglais sur la
  suivante. Une valeur identique dans les deux langues (un nom, un nombre, une
  constante) s'écrit une fois, sans `frEn`.
- **Textes encore écrits en deux constantes** (pas de `frEn` à côté) : le
  jumeau anglais est à reprendre dans le même commit. Règle générale : tout nom
  en `…_EN` / `…En` a un jumeau français à reprendre avec lui — y compris les
  jumeaux importés d'autres fichiers (`DATA_CONTACT_ROLE(_EN)`, `REPORT_FORM_NAME(_EN)`,
  `WEB_ACCESS_LOG_FIELDS(_EN)`, `copyrightNoticeElementsText(En)`,
  `SITE_HOST.status/statusEn`, `machine/machineEn`) ; la liste ci-dessous n'est
  pas exhaustive. Registre : les textes de
  cadre (`HETZNER_BACKUP_FRAMEWORK`, `SPICEWORKS_*`, `OUTLOOK_MAIL_FRAMEWORK`,
  `ASSOCIATION_GMAIL_FRAMEWORK`, `HOST_ARRANGEMENT`,
  `STANDARD_CONTRACTUAL_CLAUSES`, `DPF_ADEQUACY_DECISION`, `REGISTER_SCOPE(_DETAIL)`,
  `registerController`, `transferBasis`) ont leur version `…_EN` / `…En` dans
  le même fichier (sous le bloc « English versions », sauf
  `DPF_ADEQUACY_DECISION_EN`, juste à côté) ; `RGPD_CONTACT_LINE`
  (`legal-contact.ts`) a la sienne, `RGPD_CONTACT_LINE_EN`, dans ce bloc. Bot : les dates
  (`LAST_UPDATED_FR/EN`, `PRIVACY_LAST_UPDATED_FR/EN`) et les puces de contact
  (`CONTACT_ITEMS_FR/EN`, `PRIVACY_CONTACT_ITEMS_FR/EN`).
- **Anglais des documents du bot** : il reste repris du dépôt du bot
  (`BOT_LEGAL_PAGES.md`, « Texte légal anglais figé ») — la retouche s'y décide
  comme une nouvelle version, puis se reporte ici sur la ligne anglaise.
- **Ajouter une fiche au registre** : une clé `T19: { … }` à la fin
  d'`ACTIVITIES`, chaque texte en `frEn`, et `REGISTER_UPDATED_AT` avance
  (`PROCESSING_REGISTER.md`).
- **Ajouter une section à un document du bot** : une clé nommée à sa place dans
  `numberedSections({ … })` — les numéros suivants se décalent seuls, **mais
  pas les renvois écrits dans le texte** (« section 02 », « section 03 » et,
  dans les puces de contact, « sections 04 et 05 » de la politique, épinglés par
  `legal-files-dedup.test.ts`) : les reprendre, et
  avancer les dates du document (`BOT_LEGAL_PAGES.md`).
- Une liste entière peut s'écrire `frEn(listeFr, listeEn)` (puces de contact du
  bot), mais une liste homogène d'une quinzaine d'éléments de même forme peut
  redevenir une duplication : préférer une paire par élément.

## La règle de SonarCloud

Une duplication est signalée dès **10 lignes et 100 jetons** identiques, une
fois les chaînes et les débuts de modèles de texte remplacés par un même jeton
(commentaires ignorés ; identifiants et nombres comptent). Ce qui casse une
suite : une clé propre (nom de section, référence de fiche), une constante
nommée à la place d'une chaîne répétée, la forme `frEn(` sur deux lignes plutôt
qu'un objet `{ fr, en }` sur quatre.

## Tests

- `tests/lib/shared/bilingual.test.ts` : `frEn`, `isBilingual`, `localize`,
  `inBothLanguages`.
- `tests/lib/shared/legal-files-dedup.test.ts` : aucune paire `{ fr, en }`
  laissée dans le texte résolu, même suite de blocs et même nombre de puces par
  section du bot, mêmes clés de fiche dans le même ordre, renvois « section 0n »
  de la politique du bot, et `processing-register-en.ts` réexporte bien
  l'anglais du module français.
- Références et ordre des fiches (liste T01…T18 épinglée contre une valeur écrite : les deux langues
  sortent du même `ACTIVITIES`), nombres d'éléments par rubrique :
  `tests/lib/shared/privacy-legal-en.test.ts` ; numérotation des sections :
  `tests/app/bot-legal-pages.test.ts`.
- Seul le **français** rendu des pages du site est épinglé à l'octet
  (`tests/fixtures/legal-fr/` : conditions, `/rgpd`, registre, mentions,
  accessibilité — pas les pages du bot) ;
  l'identité de l'anglais a été prouvée une fois, au lot, par comparaison des
  sorties avant et après — un test d'empreinte bloquerait toute retouche.
- Les contrôles qui lisaient la source anglaise du registre lisent son texte
  résolu (`tests/helpers/register-english-text.ts`).
