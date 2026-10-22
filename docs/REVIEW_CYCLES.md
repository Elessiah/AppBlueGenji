# Cycles de revue d'une PR

Règle posée le 2026-10-01, une fois les deux projets arrivés à une version stable (site v1.0.0, bot v3.0.x) : la revue généraliste ne suffit plus, chaque PR qui touche une fonctionnalité est aussi relue sous des angles nommés. Allégée le 2026-10-22 pour tenir le coût en jetons (boucles de dix passes et plus sur des détails) : un seul cycle propre suffit, les findings mineurs sont consignés sans être corrigés. Elle complète l'étape 7 de la « Pipeline Git » (`CLAUDE.md`, détail dans `docs/WORKFLOW.md`) : SonarCloud, `npm test`, `npm run lint`, `npm run typecheck` et `npm run seed` restent exigés.

## 1. Règles communes à tous les cycles

- **Un cycle propre suffit** : chaque boucle (standard, thématique, juridique) s'arrête au **premier** cycle sans finding majeur, changements critiques compris. Aucun plafond de passes tant que des findings majeurs remontent.
- **Majeur ou mineur** : est **majeur** un vrai bug, un problème de sécurité ou juridique, une promesse faite à l'utilisateur non tenue, un coût de performance net. Le reste est **mineur** (formulation, style, préférence, détail sans effet observable) : il est consigné dans `ERREUR.txt` (format habituel, sans doublon) — dans `ACCESSIBILITE.md` s'il touche l'accessibilité — et **n'est pas corrigé** dans la PR. Un finding majeur se corrige dans la PR, même s'il préexiste, dès qu'il porte sur le code ou les routes que la PR touche ; hors de cette zone, il va dans `ERREUR.txt`. Un cycle qui ne remonte **que** des findings mineurs compte pour propre : on les consigne et la boucle s'arrête.
- **Un agent neuf par type de revue** quand le lot est confié à des agents, lancés l'un après l'autre (standard, puis UI/UX, performance, sécurité, juridique s'il y a lieu) : aucun relecteur ne porte le contexte ni le biais des passes précédentes, et le relecteur ne réimplémente pas. L'implémentation est faite par un autre agent. Une petite PR menée dans une seule session (correctif d'une ligne, doc seule) enchaîne ses cycles dans la session, sans agent supplémentaire.
- Une correction faite dans un cycle est vérifiée par le cycle suivant **du même type** ; elle ne relance pas la boucle standard ni les autres thèmes.

## 2. Boucle standard

`/code-review --comment` en boucle : corriger les findings majeurs, commiter, pousser, relancer une revue **complète**, jusqu'au premier cycle propre.

## 3. Cycles thématiques — PR qui ajoute ou modifie une fonctionnalité

Une fois la boucle standard propre, un cycle par thème, **jamais fusionnés en une seule passe**, chacun relancé jusqu'à revenir propre :

1. **UI/UX** — états (chargement, vide, erreur, désactivé), accessibilité, textes FR et EN, messages par toast (`useToast()`), rendu mobile/responsive, aucune régression visuelle. **Facultatif** quand la PR ne change aucun écran (pages, composants, CSS, textes affichés) ; la seule formulation d'une notification ou d'un message Discord ne l'impose pas.
2. **Performance** — requêtes et N+1, cache et invalidation, rendus React inutiles, taille du paquet client, poids des réponses et des instantanés, chemins chauds.
3. **Sécurité** — autorisations et permissions (`can(user, …)`), validation des entrées, injections (SQL, HTML, Markdown Discord), secrets, exposition de données (ce qui part dans une réponse, un instantané ou un message Discord), plafonds de débit, CSRF et redirections. Une PR qui change ce que le site collecte, qui le lit, combien de temps il le garde ou ce qu'une suppression emporte y est aussi relue pour ses **déclarations** : entrée `PRIVACY_CHANGES`, fiche du registre des traitements avec `REGISTER_UPDATED_AT` avancée, mise à jour de `/rgpd`. Ces déclarations sont écrites par l'implémentation ; la revue ne fait que les confirmer.

Un cycle thématique se lance avec le skill `code-review` et des arguments qui **nomment le thème**, par exemple :

```
/code-review --comment focus: security review — authz, input validation, injection, secrets, data exposure, rate limits, CSRF/redirects
```

Le thème voyage en **texte libre** dans les arguments du skill, après `--comment` : ne compter un cycle thématique comme fait que si son compte rendu traite bien du thème nommé — une revue revenue généraliste ne vaut pas cycle thématique et se relance.

## 4. Exceptions

- **Renommage seul** (fichier, symbole, libellé, sans changement de comportement) : boucle standard uniquement, **aucun** cycle thématique.
- **Documentation de processus ou de fonctionnalité seule** (`CLAUDE.md`, `docs/*.md`, `docs/features/*.md`, sans texte légal) : boucle standard uniquement — c'est elle qui vérifie l'exactitude technique — **aucun** cycle thématique ni juridique.
- **Textes légaux** (pages légales, `/rgpd`, registre, `PRIVACY_CHANGES`, conditions, déclaration d'accessibilité, pages légales du bot) : la boucle standard, puis **un cycle orienté juridique** à la place des cycles thématiques, relancé jusqu'à revenir propre — RGPD, LCEN/DSA, recommandations CNIL, cohérence avec `/rgpd`, le registre des traitements (`lib/shared/processing-register.ts`, `REGISTER_UPDATED_AT` avancée) et `PRIVACY_CHANGES`, toute date ou version affichée d'un texte modifié avancée avec lui (par exemple `TERMS_VERSION` **et** `TERMS_UPDATED_AT` pour les conditions d'utilisation, `ACCESSIBILITY_STATEMENT_DATE` pour la déclaration d'accessibilité, les dates françaises et anglaises des pages légales du bot dans `lib/shared/bot-legal-content.ts`), aucune donnée personnelle ni aucun secret publié. Seul le **fond** compte comme finding (traitement, destinataire, donnée, durée ou base légale non déclarés, entrée de registre ou `PRIVACY_CHANGES` manquante, contradiction FR/EN ou texte/code) ; la formulation n'en est jamais un. Exemple :

  ```
  /code-review --comment focus: legal review — GDPR/RGPD, LCEN/DSA, CNIL, consistency with /rgpd, processing register, PRIVACY_CHANGES, no personal data or secrets published
  ```
