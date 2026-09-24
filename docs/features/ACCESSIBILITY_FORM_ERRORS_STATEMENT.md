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
  désormais par `mapError` — il en reste que ce registre ne connaît pas, voir
  `ERREUR.txt`.

Au passage aussi, les étiquettes de `/connexion` n'étaient associées à **aucun**
champ (`<label>` sans `htmlFor`) : elles le sont, et le code porte
`inputMode="numeric"` et `autoComplete="one-time-code"`.

## 2. Contraste par défaut de `--ink-dim` (WCAG 1.4.3 · RGAA 3.2)

**Décision : le rendu par défaut ne change pas** (règle du menu d'accessibilité :
tout changement d'apparence est désactivé par défaut). La non-conformité est
**déclarée** (section 3), et le réglage « Contraste renforcé » est le
contournement.

Ce qui a été vérifié : un audit du rendu réel, réglage coché, sur vingt pages
(vitrine, connexion, règles, bot et sa doc, RGPD, recrutement, bénévoles,
mentions légales, annuaires, fiches d'équipe et de joueur, profil, création
d'équipe et de tournoi, fiches de tournoi de plusieurs formats) — couleur
effective du texte, opacités des ancêtres comprises, contre le fond effectif. **Aucun
texte sous 4,5:1** (hors texte en dégradé découpé, que l'outil ne sait pas lire).

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
gêne réellement un visiteur s'y ajoute. Deux entrées (fiche tournoi, titres des
fiches) correspondent aux tâches 9 et 16, prises par une autre session : la PR
qui les règle les retire d'ici.
