# ℹ️ Textes explicatifs derrière le bouton « i » (`<InfoHint>`)

Les explications longues (effets, conséquences, qui voit quoi) remplissaient des
pages entières — `/connexion`, `/profil` — et faisaient paraître compliqué ce qui
ne l'est pas. Elles passent derrière un petit bouton rond « i », posé juste
après le libellé qu'elles expliquent, et se réécrivent **court**.

## Règle

- Une explication permanente de plus d'une phrase courte (≈ 100 caractères) va
  derrière `<InfoHint>`. Elle se rédige en **1 à 2 phrases** simples (une liste
  est permise pour « qui le voit »), exactes au regard du code (qui, quand,
  quoi), avec le même sens en français et en anglais (glossaire de `I18N.md`).
- **Information en couches** (RGPD art. 12-13, approche « par niveaux » de la
  CNIL) : une information due à la collecte ou qui annonce un droit garde **une
  ligne visible** avec l'essentiel — la finalité sous le champ BattleTag, « sans
  le certifier : personne ne le voit » sous la connexion par Discord — et le
  « i » porte le reste.
- Restent visibles : une ligne d'**état** (verrou, lecture en cours, échec, tag
  non certifié coché visible, messages de match injoignables), un avertissement,
  une aide courte (< ≈ 100 caractères) qui n'est pas dans une grappe.
- Hors champ : le texte d'une modale (déjà à la demande), les libellés de cases
  légales, les erreurs (toujours `FieldErrorText` / toast, **jamais** dans le
  « i »), les états vides, les pages légales.

## Composant (`components/ui/info-hint.tsx`)

```tsx
<InfoHintRow>
  <label htmlFor="profile-battletag">{t("games.battletag")}</label>
  <InfoHint id="profile-battletag-more" subject={t("games.battletag")}>
    <p>{t("games.blizzardNotice")}</p>
    <AudienceList lines={hiddenBattletagAudienceText(text)} />
  </InfoHint>
</InfoHintRow>
<input id="profile-battletag" aria-describedby="profile-battletag-hint profile-battletag-more" />
```

- **Divulgation, pas modale** : `<button type="button" aria-expanded aria-controls>`.
  Nom accessible « Plus d'infos : {subject} » / « More info: {subject} »
  (`common.infoHint.label`, langue lue par `useAppLocale` — le bouton sert sous
  plusieurs espaces de messages, chacun avec son fournisseur ;
  `lib/shared/info-hint.ts`). L'icône Lucide `Info` est décorative.
- **L'explication s'ouvre dans le flux**, sous la rangée du libellé, sur toute
  sa largeur (`InfoHintRow` passe à la ligne ; le conteneur du composant est en
  `display: contents`). Pas de bulle superposée : les `.ds-block` sont en
  `overflow: hidden` (une bulle y serait rognée) et les sections `.fade-in`
  gardent un `transform` (contextes d'empilement : la section suivante la
  recouvrirait). Dans le flux, elle ne dépasse jamais son conteneur — aucun
  défilement horizontal à 375 px. Aucune largeur maximale sur le panneau
  lui-même (`flex: 0 0 100%`) : bornée, sa base redevenait assez étroite pour
  se loger **à côté** d'un libellé court sur une rangée large ; la mesure de
  lecture (68ch) se pose sur son contenu (`.panel > *`).
- **Jamais dans un groupe à la largeur de son contenu** (`inline-flex`, élément
  d'une barre en `space-between`) : ouverte, l'explication élargit le groupe,
  qui change de place — et le bouton qu'on vient de cliquer fuit le pointeur.
  Poser alors le `InfoHint` dans la barre elle-même, après le groupe (pastille
  « Spectateur » de l'en-tête : le groupe `.viewer` garde la pastille, le « i »
  le suit, `margin-inline-start: auto` cale le groupe à droite).
- **Fermée, elle reste dans le DOM** (`hidden`) avec son `id` : un champ qui la
  cite dans son `aria-describedby` garde sa description entière.
- Se referme par **Échap** (focus rendu au bouton ; écouté sur le composant
  seul, pour ne pas voler l'Échap d'une modale ; déplié dans une modale, il
  porte `data-escape-owner` et `escapeBelongsElsewhere` lui laisse la touche —
  sans quoi l'écouteur de la modale, en capture, la fermait saisie comprise ; un clic sur le texte de l'explication rend le focus au bouton, qui garde ainsi la touche — seulement si le focus était parti au conteneur qui le porte, la modale (`infoHintFocusLeftToContainer`), et sans défiler (`preventScroll`) ; sur une page ordinaire il reste où il est), par un **clic ailleurs**, par
  un **second clic**. Le clic ailleurs ferme au `click` et non au `pointerdown` :
  replier l'explication à l'appui ferait remonter le contrôle visé sous le
  pointeur, et le relâchement tomberait à côté (clic perdu). Cliquer un autre
  « i » est un clic ailleurs : il referme celui qui était ouvert. Le clic donne
  le focus au bouton (Safari, macOS et iOS, ne le fait pas de lui-même) : sans
  lui, Échap, écouté sur le composant, ne porterait pas après une ouverture à la
  souris.
- Cible de 24 × 24 px (WCAG 2.5.8), anneau de focus `--blue-500`, texte 12 px
  `--ink-soft`, aucun ambre, aucune animation ni transition.
- Un lien est permis dans l'explication (`/connexion` : « rejoins le nôtre ») ;
  il suit le bouton dans l'ordre de tabulation.

## Listes « qui le voit »

Le paragraphe recopié six fois (560–900 caractères) est remplacé par **deux
listes** courtes, rédigées une fois dans `lib/shared/identity-sharing.ts` :
`DISCORD_TAG_AUDIENCE` (tag Discord certifié) et `HIDDEN_BATTLETAG_AUDIENCE`
(BattleTag masqué : fenêtre « Contacts » et fenêtre de lancement nommées). Chaque
espace qui les montre (`profile`, `login`, `players`) porte la même forme sous
`audience.discord.*` / `audience.battletag.*` ; `lib/shared/identity-audience.ts`
les assemble, `<AudienceList>` les rend. Tests : le français de chaque espace
égale le module, l'anglais est le même d'un espace à l'autre
(`tests/app/profile-i18n.test.tsx`, `tests/lib/shared/battletag-hidden-warning.test.ts`).

Les verrous des champs (`discordTagLockNotice`, `battletagLockNotice`) rendent
`{ status, details }` (et `audience` pour Discord) : la ligne d'état visible,
le détail pour le « i ».

## Écrans couverts

- `/connexion` : notes des portes Discord et Blizzard, prérequis du code par
  message privé, annonce du tag enregistré par le code ; avertissements iOS /
  navigateur intégré raccourcis mais visibles.
- `/profil` : BattleTag, tag Discord, cases de visibilité, recrutement, ligne
  Battle.net des applications connectées, sujets des notifications push, langue
  des notifications, messages privés de match, fenêtre de recrutement.
- `/joueurs/[id]` : BattleTag masqué, pour son titulaire.
- Formulaire de tournoi (`/tournois/creer`, `/tournois/[id]/modifier`) : intro
  des conditions d'inscription (« i » du titre de section), exigences Discord et
  Battle.net, fonctionnement de la Survie et de la ronde suisse (« i » du libellé
  « Format », `formatExplainText`), réglages de BG Survie (effectif des play-offs,
  manches maximum, sortie anticipée, égalités, format des play-offs), cartes
  « Phase de lancement » et « Matchs planifiés par l'arbitrage ». La raison d'une
  case grisée (sortie anticipée, égalités) reste visible **à la place** du « i »,
  sous le même identifiant. Le conseil Marvel Rivals reste visible.
- Fiche `/tournois/[id]` : mention de retransmission **en couches** (ligne
  visible avec le droit d'opposition, mention entière au « i » —
  `LIVE_STREAMS.md`), pastille « Spectateur », cases de l'en-tête qui portaient
  une explication (format des matchs, conditions d'inscription), explication de
  l'ordre des inscrites suivant le classement du site, planification par
  l'arbitrage allumée, aperçu de la manche suivante (côtés à confirmer, note de
  bas de panneau).
- `/equipes/[id]` : aide de l'invitation (champ pseudo).
- `/signalements/[id]` : le droit de contester reste visible, les exemples
  passent au « i ».

### Ce qui est resté visible (raccourci), et pourquoi

- Zones de danger (retour en arrière, suppression du tournoi, équipe fantôme) :
  des **avertissements** de gestes sans retour — raccourcis, jamais repliés.
- Avertissements et états : planification qui défait des lancements, phase
  qualificative incertaine, verrous de l'ordre, ligne « Modifiable jusqu'à… »
  des cartes d'option.
- Sélecteur d'image : les aides sont dans un `<button>` et dans des `<label>`
  de radios, où un bouton ne se pose pas ; l'aide du point de cadrage est le
  mode d'emploi au clavier d'un `role="application"`.
- Contacts Discord du staff, aide des rôles de manager (une `<legend>` ne peut
  pas porter le bouton), retour dû et conservation de `/admin/signalements`
  (dossier non migré : français en dur, obligation légale du staff).
- `title` gardés : cartes et bandeau de `/equipes` (la carte entière est un lien
  — un bouton n'y entre pas ; les points restent lus par `sr-only`), liens et
  pastilles de `/joueurs/[id]` (redondants avec leur texte), pastille « Admin ».

### Cartes d'option du formulaire

« Phase de lancement » et « Matchs planifiés par l'arbitrage » étaient un
`<label>` englobant la carte. Un bouton ne se pose pas dans un `<label>` : la
carte est désormais un `<div class="checkbox-card">` (`CHECKBOX_CARD_LAYOUT`,
`_lib/form-styles.ts`), son titre le `<label>` de la case, suivi du « i ». Un
clic sur le cadre hors case et titre ne coche plus ; la case cite le « i » puis
la ligne d'état dans son `aria-describedby`.

Tests : `tests/components/info-hint.test.tsx` (balisage, nom FR/EN, gestes,
feuille de style), `tests/app/info-hints-account.test.ts` et
`tests/app/info-hints-tournaments.test.tsx` (lignes visibles ≤ 140 caractères,
câblage des `aria-describedby`). Un test qui vérifie qu'un écran n'offre
« aucun geste » retire d'abord les boutons « i » du balisage
(`tests/helpers/info-hint-markup.ts`).
