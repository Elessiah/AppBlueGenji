# 🪟 Modales — trois règles pour toutes

Toute modale du site suit trois règles. Chacune répond à un défaut constaté
dans un navigateur, et un balayage des sources les tient
(`tests/app/modal-dialogs.test.ts`).

## 1. Portée dans `document.body`

Une modale rendue dans la page hérite des **contextes d'empilement** et des
**blocs conteneurs** de ses ancêtres, quel que soit son `z-index` :

| Où | Ancêtre fautif | Symptôme |
| --- | --- | --- |
| Accueil / `/association`, section 03 | `.root` en `position: relative; z-index: 1` | les partenaires passaient par-dessus le voile selon le défilement |
| `/association`, bureau | `.section` en `position: relative; z-index: 1` | la section des documents passait par-dessus en bas de page |
| Tout l'espace connecté | `main.page-shell` en `z-index: 1`, sœur de la barre de navigation en `z-index: 50` | la barre restait nette **et cliquable** au-dessus du voile |
| `/profil` | `<section class="fade-in">`, dont l'animation laisse un `transform` | la section devenait la référence de `position: fixed` : la notice BattleTag se centrait au milieu d'un bloc de 2 500 px, hors de l'écran |

D'où `createPortal(…, document.body)`. Une modale n'est montée qu'une fois
ouverte (après un clic), donc jamais au rendu serveur, et `document` est
toujours là. **Exceptions** (liste `NO_PORTAL` du test) : les modales montées
par la mise en page racine, déjà sous `<body>` et parfois rendues côté serveur
(confidentialité, mise en avant du recrutement, lancement de match), et le
consentement RGPD de `/connexion`, rendu côté serveur tant qu'il n'est pas
donné.

## 2. La pile commune `useDialogBehavior`

Focus initial, Échap, piège de tabulation, verrou du défilement et retour du
focus au déclencheur. Un écouteur Échap écrit à la main ne verrouille pas le
défilement (la page défilait sous le voile), ne piège pas la tabulation (le
clavier atteignait la page derrière — y compris le formulaire de connexion
**avant** le consentement RGPD), et un `overflow` sauvegardé puis restauré à la
main est levé sous la modale par la fermeture d'une autre.

Le focus initial va au premier élément focalisable, **sauf** s'il existe un
élément marqué `data-autofocus` : le champ à remplir d'abord n'est pas toujours
le premier (le bureau place un bouton « Couleur aléatoire » avant le champ
Nom).

## 3. Le voile : `useBackdropDismiss`

`onClick={onClose}` sur le voile et `stopPropagation()` sur le panneau ne
protègent de rien : un `click` part vers l'**ancêtre commun** de l'appui et du
relâchement. Une sélection de texte commencée dans un champ et relâchée à côté
du panneau produisait donc un clic sur le voile, et la saisie partait avec la
modale. `useBackdropDismiss(onClose, busy)` ne ferme que si l'appui **et** le
relâchement ont eu lieu sur le voile lui-même (`backdropHandlers`,
`lib/shared/backdrop-dismiss.ts`), jamais pendant un envoi :

```tsx
const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
const backdrop = useBackdropDismiss(onClose, busy);

return createPortal(
  <div role="presentation" className={styles.overlay} {...backdrop}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="…" tabIndex={-1}>
      …
    </div>
  </div>,
  document.body,
);
```

Quatre modales ne se ferment pas au clic à côté, par choix (liste
`NO_BACKDROP_DISMISS`) : un choix de confidentialité, un consentement, un
lancement de match et la notice BattleTag se tranchent par un bouton.

## Pages publiques : `LandingDialog`

Les modales de gestion des pages publiques (chiffres, piliers, partenaires,
contact du pied de page, bureau, bénévoles, annonces de recrutement) passent
par `components/cyber/landing/LandingDialog.tsx`, qui applique les trois
règles et porte le voile ; chaque section ne fournit que l'habillage de son
panneau.
