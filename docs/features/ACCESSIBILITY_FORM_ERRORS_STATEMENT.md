# Erreurs rattachées aux champs, contraste renforcé, déclaration d'accessibilité

Anciennes tâches 10, 11 et 12 d'`ACCESSIBILITE.md`.

## 1. Erreurs de formulaire rattachées au champ (WCAG 3.3.1 / 3.3.3 · RGAA 11.10 / 11.11)

**La convention ne change pas** : toute erreur passe par une notification
(`useToast`). Ce qui manquait, c'est **l'endroit** — un lecteur d'écran entendait
« Ce pseudo est déjà pris » puis retrouvait un formulaire dont aucun champ ne se
signalait.

Désormais, un refus qui désigne un champ :

- pose `aria-invalid="true"` sur le contrôle ;
- le décrit par `aria-describedby` : la **phrase du refus d'abord**, puis l'aide
  existante (la règle à respecter) ;
- ramène le **focus** sur le champ, une fois le rendu fait ;
- borde le champ de rouge (`globals.css`, règles placées après celles du focus
  pour gagner à spécificité égale — le champ reste rouge au moment où l'on y
  revient) ;
- se lève dès qu'on retape dans **ce** champ (pas dans un autre).

La phrase n'est **pas** réécrite sous le champ : elle vit dans un texte
`.sr-only` (`components/ui/field-error-text.tsx`). Le voyant a déjà la
notification et le liseré.

### Pièces

| Fichier | Rôle |
| --- | --- |
| `lib/shared/field-errors.ts` | Pur. Tables « code → champ » par formulaire, `fieldAria`, `describedBy`, `firstMisplacedDate`, `CodedError`. |
| `lib/shared/hooks/useFieldErrors.ts` | État (un champ signalé à la fois — le serveur ne rend qu'un refus), focus, `report` / `flag` / `clear` / `aria` / `message`. |
| `components/ui/field-error-text.tsx` | Le texte réservé aux technologies d'assistance. |

### Formulaires câblés

Création d'équipe, équipe fantôme, identité d'une équipe (mode gestion), profil
(pseudo, BattleTag, tag Discord), connexion par code Discord (tag, code),
formulaire de tournoi (nom, effectif, format de match, quatre dates).

Puis, par la tâche 10 (`feature/accessibilite-item-10-72b62f`) : invitation d'un
joueur et attribution d'une fantôme (pseudo), certification du tag Discord (tag,
code), et les réglages de chaque phase d'un tournoi multi-phases. Voir
[§ 1 bis](#1-bis-formulaires-restants--tâche-10).

Trois points :

- **Un code inconnu ne marque rien.** Session expirée, réseau, droits : aucun
  champ n'y peut rien, en signaler un enverrait corriger ce qui est juste. Un
  refus sans champ **efface** le signalement précédent, qui décrivait un envoi
  qui n'est plus le dernier.
- **Les dates d'un tournoi** : le serveur ne rend qu'un code pour les quatre
  (`INVALID_DATES`, `INVALID_DATE_ORDER`). `firstMisplacedDate` relit les
  valeurs envoyées et désigne le premier jalon illisible ou antérieur au
  précédent, avec la même comparaison que `parseTournamentDates` (égalité
  permise).
- **Le code voyage avec sa phrase.** Les pages traduisaient le refus avant de le
  lever ; `CodedError` garde le code à côté du message, pour que le `catch` du
  formulaire retrouve le champ. Au passage, la création d'un tournoi affichait
  le **code brut** en notification (`INVALID_DATE_ORDER`) : elle passe
  désormais par `mapError`.
- **Tous les refus du formulaire ont leur phrase.** `mapError` ne connaissait
  qu'une partie des codes de `validateTournamentInput` (format, jeu, type de
  participants, réglages suisse, survie et endurance, plan de phases) et rendait
  les autres **tels quels**. Les phrases de phase vivent dans
  `PHASE_ERROR_MESSAGES` (`lib/shared/tournament-phases.ts`, à côté de `validatePhases` qui émet ses codes), table unique que lisent
  `phaseErrorMessage` (contrôle local du plan) et `ERROR_MESSAGES` (refus du
  serveur) ; `INVALID_SWISS_ROUNDS` et `INVALID_SURVIVAL_ROUNDS`, émis aussi
  bien pour un tournoi que pour une phase, restent dans `ERROR_MESSAGES` avec
  une phrase qui vaut dans les deux cas. Et un **code** que la table ignore
  retombe désormais sur une phrase générique (`UNKNOWN_ERROR_MESSAGE`) plutôt
  que sur lui-même — ce qui n'a pas la forme d'un code (une phrase déjà rédigée,
  un échec réseau du navigateur) passe inchangé. Un balayage des sources de la
  validation tient la table à jour (`tests/tournois/error-map.test.ts`).

Au passage aussi, les étiquettes de `/connexion` n'étaient associées à **aucun**
champ (`<label>` sans `htmlFor`) : elles le sont, et le code porte
`inputMode="numeric"` et `autoComplete="one-time-code"`.

## 1 bis. Formulaires restants — tâche 10

### Le pseudo d'un joueur (`PlayerPseudoCombobox`)

Invitation dans une équipe (`MembersSection`) et attribution d'une fantôme
(`ClaimGhostTeamDialog`) partagent le même champ et les mêmes refus sur le
pseudo : `PLAYER_PSEUDO_FIELD_ERRORS` (introuvable, compte supprimé, déjà dans
une équipe, déjà invité, pseudo vide). `useMemberManagement` ne remontait que
`true` / `false` : `addMember` prend désormais un `RefusalListener` — le hook
garde la notification, le formulaire y branche `fieldErrors.report`.

**Le piège annoncé** : la liste de suggestions s'ouvre **au focus**, si bien que
ramener le focus sur le champ refusé y aurait fait surgir des suggestions
par-dessus la phrase du refus. `useFieldErrors` ramène donc le focus par
`focusFlaggedField`, qui **marque** le champ le temps de l'appel
(`data-field-error-focus`) — `focus()` déclenche ses évènements pendant l'appel,
`focusin` de React compris — et le combobox, qui lit `isFieldErrorFocus`, ne
s'ouvre pas sur ce focus-là. Un clic, une frappe ou une flèche l'ouvrent comme
avant. La marque vaut pour **tout** contrôle qui réagirait à son focus, pas
seulement celui-ci.

Le combobox reçoit ses attributs par `aria={fieldErrors.aria("pseudo", …)}` (et
non plus un `describedBy` seul) : la phrase du refus s'y joint à l'aide.

### La certification du tag Discord (`DiscordVerificationDialog`)

`DISCORD_VERIFICATION_FIELD_ERRORS` : le tag (invalide, introuvable, appartenant
à un autre compte Discord) et le code (invalide, faux ou expiré). Restent sans
champ les refus du bot et les plafonds de débit — y compris
`BOT_RESOLVE_TIMEOUT`, qui peut tenir au tag comme à la charge du bot. Le code
porte au passage `autoComplete="one-time-code"`, comme celui de `/connexion`.

Un code **brûlé** (cinq essais) ou expiré est rattaché au champ du code, mais ne
se corrige pas en le retapant : la seconde étape offre donc **« Nouveau code »**,
qui ramène à la première, tag conservé — le geste que nomme le refus
(« Recommence la certification »). Changer d'étape démonte le bouton qui vient
d'être activé : le dialogue porte alors le focus sur le champ de la nouvelle
étape (`previousStep`, rien au montage, où `useDialogBehavior` s'en charge),
sans quoi il tombait sur `<body>`. La rangée de trois boutons passe à la ligne à
la largeur d'un téléphone.

### Les phases d'un tournoi multi-phases (`PhaseBuilder`)

`validatePhases` ne rendait qu'un code, sans dire **quelle** phase. La règle est
désormais `findPhaseIssue` (`lib/shared/tournament-phases.ts`), qui situe le
premier défaut — phase en cause et réglage (`format`, `qualifierValue`,
`swissTotalRounds`, cadences de survie) — et `validatePhases` n'en est plus que
le code : serveur et formulaire lisent la même règle. Deux défauts tiennent au
plan entier (nombre, numérotation) et ne désignent aucun champ ; une
qualification qui ne décroît pas désigne la **seconde** phase, celle qui devait
être plus petite.

Ce n'est pas un refus du serveur mais une validation **en direct** : le champ
fautif porte `aria-invalid` et la phrase du défaut tant que le défaut existe,
sans état à lever. La phrase est **située** (`phaseIssueMessage` : « Phase 2 —
… ») dans l'encart comme dans la notification. À l'envoi refusé,
`TournamentForm` incrémente `phaseFocusRequest` : `PhaseBuilder` déplie la phase
en cause (son champ n'existe pas repliée), puis y porte le focus au rendu
suivant. Les `id` des réglages viennent de `phaseFieldId` (`phase-form.ts`),
partagé par la carte qui les pose et le constructeur qui les focalise.

Deux gardes sur cette demande : la dernière servie est relevée **au montage**
(`handledRequest`) — le constructeur se démonte quand on quitte le format
multi-phases, et y revenir rejouait sinon l'ancienne demande, le focus quittant
le sélecteur de format sans aucun envoi ; et un plan **figé** par la fenêtre
d'édition n'en émet aucune, ses champs désactivés ne prenant pas le focus — la
notification reste seule à parler. Le focus passe par `focusFlaggedField`, comme
celui de `useFieldErrors`.

Au passage, deux champs affichaient autre chose que la valeur refusée :
`value={x || 3}` montrait « 3 » pour une cadence de survie à 0, et
`value={x || ""}` un champ vide pour 0 manche suisse — le champ désigné aurait
montré une valeur valide. Ils lisent désormais `??`.

## 2. Contraste par défaut de `--ink-dim` (WCAG 1.4.3 · RGAA 3.2)

**Réglé dans l'apparence par défaut (2026-10-02).** `--ink-dim` passe de
`#55636f` (2,8:1 à 3,3:1 selon le fond) à `#7a8894` : 4,79:1 sur
`--cyber-bg-3`, le fond le plus clair, et davantage ailleurs. La hiérarchie
`--ink` > `--ink-mute` > `--ink-dim` reste lisible (7,8:1 / 5,6:1 sur
`--cyber-bg`). L'ancienne teinte survit sous `--ink-faint`, réservée à ce qui
n'est **pas** un texte à lire : séparateurs (`/`, `·`), pastilles de forme et
de présence, traits en tirets. La limite a donc quitté la déclaration
(`KNOWN_ISSUES`). Une date de jalon de tournoi qui s'atténuait par `opacity`
(4,0:1) lit désormais `--ink-dim`.

Le réglage « Contraste renforcé » reste au-dessus des valeurs par défaut
(`--ink-dim` et `--ink-faint` à `#95a3b1`) — `tests/app/accessibility-styles.test.ts`.

Ce qui a été vérifié : un audit du rendu réel, apparence par défaut, sur les
pages principales (vitrine, connexion, règles, bot et sa doc, RGPD, recrutement,
bénévoles, partenaires, association, mentions légales, accessibilité,
annuaires, fiche d'équipe, profil, signalements, création d'équipe et de
tournoi, fiche de tournoi) — couleur effective du texte, opacités des ancêtres
comprises, contre le fond effectif. **Aucun texte sous 4,5:1** hors les
séparateurs décoratifs `--ink-faint` (et le texte en dégradé découpé, que
l'outil ne sait pas lire).

Les pastilles colorées (rôles, jeux, rubans, `.error`/`.success`) posent un
texte vif sur un **voile translucide** de la même teinte : SonarQube (règle
`css:S7924`) compose ce voile sur du blanc et y voit un échec, alors que sur les
fonds sombres du site le rapport va de 5,1:1 à 13,7:1. Ces voiles passent par
les composantes des jetons (`rgba(var(--violet-400-rgb), 0.05)`, `--amber-rgb`,
`--red-live-rgb`, `--bot-*-rgb` dans `app/bot/bot.css`) — rendu identique.

Le réglage ne tient que par les **jetons** : un texte qui écrirait sa couleur en
dur lui échapperait. `tests/app/contrast-mode-coverage.test.ts` refuse donc
toute couleur de texte littérale (CSS ou style en ligne) qui, sur
`--cyber-bg-3`, resterait sous 4,5:1 sans être un texte foncé posé sur un aplat
clair.

## 3. Déclaration d'accessibilité (`/accessibilite`)

À notre connaissance l'association n'est pas soumise à l'obligation (article 47
de la loi n° 2005-102) ; la déclaration est publiée **volontairement**, au modèle
RGAA 4.1.

- **Le statut se déduit, il ne s'écrit pas** : `conformityStatusFor(taux)` —
  100 % → totalement, ≥ 50 % → partiellement, en dessous **ou sans audit** →
  non conforme. Aucun audit complet n'a été mené : le site est « non
  conforme », quel que soit le soin apporté.
- Contenu dans `lib/shared/accessibility-statement.ts` (pur) : date, limites
  connues avec critère et contournement, aides (reprises du registre du menu,
  jamais recopiées), méthodes, contact, voies de recours.
- La mention « Accessibilité : non conforme » figure au **pied de page public**
  (exigence du référentiel) ; le **menu d'accessibilité** porte aussi le lien,
  seule porte présente sur toutes les pages, espace connecté compris.
- Au sitemap.

**Règle pour la suite** : une PR qui règle un point de `KNOWN_ISSUES` le retire
et avance `ACCESSIBILITY_STATEMENT_DATE` ; une limite laissée pour plus tard qui
gêne réellement un visiteur s'y ajoute. Les formulaires que cette PR ne câble
pas encore (tâche 10, remise dans `ACCESSIBILITE.md` pour sa part restante) y
figurent : la PR qui les règle retire l'entrée — ce qu'a fait celle de la
tâche 10.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Erreurs rattachées aux champs** (`lib/shared/field-errors.ts` pur + `lib/shared/hooks/useFieldErrors.ts` + `components/ui/field-error-text.tsx`) : la notification reste la règle, mais un refus qui désigne un champ y est **aussi** posé — `aria-invalid`, `aria-describedby` (phrase du refus d'abord, puis l'aide existante, par `fieldAria`), focus ramené sur le champ, liseré rouge, levée à la frappe dans **ce** champ. La phrase n'est pas réécrite sous le champ : elle vit dans un texte `.sr-only` (`FieldErrorText`), jamais visible. **Pour un formulaire neuf** : une table « code → champ » dans `field-errors.ts`, `useFieldErrors(table, ids)`, `{...fieldErrors.aria("champ", "id-de-l-aide")}` sur le contrôle (pas d'`aria-describedby` écrit à côté : il remplacerait la décomposition ou serait remplacé par elle), `<FieldErrorText>` à côté, et un `report(code, message)` dans le `catch` — une page qui traduit le refus avant de le lever lève une `CodedError`, sans quoi le code est perdu. Un code inconnu ne marque rien, un refus sans champ efface le signalement précédent. Le focus ramené est **marqué** (`focusFlaggedField` / `isFieldErrorFocus`) : un contrôle qui s'ouvre au focus — la liste de `PlayerPseudoCombobox` — ne s'ouvre pas sur celui-là. Les phases d'un multi-phases valident en direct : `findPhaseIssue` situe le défaut (phase et réglage), `validatePhases` n'en rend que le code. Voir `docs/features/ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`.
- **Déclaration d'accessibilité** (`lib/shared/accessibility-statement.ts` pur → `/accessibilite`, mention « Accessibilité : non conforme » au pied de page public et lien dans le menu d'accessibilité) : publiée volontairement, au modèle RGAA 4.1. Le statut **se déduit** du taux d'un audit (`conformityStatusFor`) et reste « non conforme » tant qu'aucun audit complet n'a été mené. **Une PR qui règle une limite de `KNOWN_ISSUES` la retire et avance `ACCESSIBILITY_STATEMENT_DATE`.** Le contraste par défaut de `--ink-dim`, longtemps déclaré, est réglé depuis le 2026-10-02 (`#7a8894`, ≥ 4,5:1 sur tous les fonds ; `--ink-faint` pour les ornements) ; « Contraste renforcé » reste au-dessus, et `tests/app/contrast-mode-coverage.test.ts` refuse toute couleur de texte littérale pâle, que le réglage ne pourrait pas atteindre — une couleur de texte passe par un jeton.
