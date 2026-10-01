# Cycles de revue d'une PR

Règle posée le 2026-10-01, une fois les deux projets arrivés à une version stable (site v1.0.0, bot v3.0.x) : la revue généraliste ne suffit plus, chaque PR qui touche une fonctionnalité est aussi relue sous trois angles nommés. Elle complète l'étape 7 de la « Pipeline Git » (`CLAUDE.md`, détail dans `docs/WORKFLOW.md`) sans rien en retirer : SonarQube, `npm test`, `npm run lint`, `npm run typecheck` et `npm run seed` restent exigés.

## 1. Boucle standard

`/code-review --comment` en boucle : corriger, commiter, pousser, relancer une revue **complète**, jusqu'à un cycle **sans finding**.

**Changements critiques** — textes légaux, authentification, RGPD, sécurité des sauvegardes, CSS globale (`app/globals.css`) : la boucle standard continue jusqu'à **deux cycles consécutifs sans finding** ; tout finding remet le compteur à zéro.

## 2. Cycles thématiques — PR qui ajoute ou modifie une fonctionnalité

Une fois la boucle standard propre, trois cycles thématiques, **chacun relancé jusqu'à revenir sans finding** (corriger, commiter, pousser, relancer le même thème) :

1. **UI/UX** — états (chargement, vide, erreur, désactivé), accessibilité, textes en français, messages par toast (`useToast()`), rendu mobile/responsive, aucune régression visuelle.
2. **Sécurité** — autorisations et permissions (`can(user, …)`), validation des entrées, injections (SQL, HTML, Markdown Discord), secrets, exposition de données (ce qui part dans une réponse, un instantané ou un message Discord), plafonds de débit, CSRF et redirections.
3. **Performance** — requêtes et N+1, cache et invalidation, rendus React inutiles, taille du paquet client, poids des réponses et des instantanés, chemins chauds.

Un cycle thématique se lance avec le skill `code-review` et des arguments qui **nomment le thème**, par exemple :

```
/code-review --comment focus: security review — authz, input validation, injection, secrets, data exposure, rate limits, CSRF/redirects
```

Le thème voyage en **texte libre** dans les arguments du skill, après `--comment` : ne compter un cycle thématique comme fait que si son compte rendu traite bien du thème nommé — une revue revenue généraliste ne vaut pas cycle thématique et se relance.

Une correction faite dans un cycle thématique peut en appeler d'autres : si elle touche du code au-delà du thème, la boucle standard est relancée avant de reprendre.

## 3. Exceptions

- **Renommage seul** (fichier, symbole, libellé, sans changement de comportement) : boucle standard uniquement, **aucun** cycle thématique.
- **Documentation ou textes légaux seulement** : la boucle standard reste due (c'est elle qui vérifie l'exactitude technique d'un `docs/features/*.md`) ; à la place des trois cycles thématiques, **un cycle orienté juridique**, relancé jusqu'à revenir propre — RGPD, LCEN/DSA, recommandations CNIL, cohérence avec `/rgpd`, le registre des traitements (`lib/shared/processing-register.ts`) et `PRIVACY_CHANGES`, aucune donnée personnelle ni aucun secret publié. Exemple :

  ```
  /code-review --comment focus: legal review — GDPR/RGPD, LCEN/DSA, CNIL, consistency with /rgpd, processing register, PRIVACY_CHANGES, no personal data or secrets published
  ```

  Un texte légal reste un changement critique : sa boucle standard exige deux cycles consécutifs propres.
