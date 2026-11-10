# Cycles de revue d'une PR

Règle posée le 2026-10-01, une fois les deux projets arrivés à une version stable (site v1.0.0, bot v3.0.x) : la revue généraliste ne suffit plus, chaque PR qui touche une fonctionnalité est aussi relue sous des angles nommés. Allégée le 2026-10-22 pour tenir le coût en jetons (boucles de dix passes et plus sur des détails) : un seul cycle propre suffit, les findings mineurs sont consignés sans être corrigés. Elle complète l'étape 4 de la « Pipeline Git » (`CLAUDE.md`, détail dans `docs/WORKFLOW.md`) : SonarCloud, `npm test`, `npm run lint`, `npm run typecheck` et `npm run seed` restent exigés.

## 1. Règles communes à tous les cycles

- **Règles du 2026-11-10** (remplacent « premier cycle propre » et l'envoi des mineurs dans `ERREUR.txt`) :
  - **Majeur** = faille de sécurité ou RGPD exploitable, perte ou corruption de données, résultat faux pour l'utilisateur dans un parcours normal, plantage, texte légal rendu faux. Chaque majeur est donné avec un **scénario concret** d'échec ; sans scénario, il est mineur. Tout le reste est **mineur**.
  - **Cycle 1** relit toute la PR ; à partir du **cycle 2**, un cycle ne relit **que le diff depuis le cycle précédent** (`git diff <sha-du-cycle-précédent>..HEAD`).
  - Un cycle **sans majeur** clôt la boucle : ses mineurs sont corrigés **une fois**, avec tests, **sans nouveau cycle**, puis la PR se fusionne (CI et SonarCloud verts). Un cycle avec un majeur : correction avec tests, puis cycle suivant.
  - **4 cycles au plus par type** : un majeur encore présent au 4e cycle arrête la boucle et remonte à l'utilisateur (c'est en général une question de conception).
  - **Pas d'aller-retour** : chaque relecteur lit les notes des cycles précédents ; un finding qui demande de défaire une correction antérieure ou une décision de l'utilisateur est rejeté et noté.
  - Dans la zone touchée, aucun finding (majeur ou mineur) n'est consigné dans `ERREUR.txt` : il se corrige. Hors zone, seul un **vrai** problème y est consigné (pas une préférence) — dans `ACCESSIBILITE.md` s'il touche l'accessibilité.
  - Un lot de correction d'`ERREUR.txt` prend **~20–30 entrées** par PR, pas davantage.
- **Un agent neuf par type de revue** quand le lot est confié à des agents, lancés l'un après l'autre (standard, puis UI/UX, performance, sécurité, juridique s'il y a lieu) : aucun relecteur ne porte le contexte ni le biais des passes précédentes, et le relecteur ne réimplémente pas. L'implémentation est faite par un autre agent. Une petite PR menée dans une seule session (correctif d'une ligne, doc seule) enchaîne ses cycles dans la session, sans agent supplémentaire.
- Une correction faite dans un cycle avec majeur est vérifiée par le cycle suivant **du même type** ; elle ne relance pas la boucle standard ni les autres thèmes. Le cycle **sécurité** passe **en dernier**, après les corrections UI/UX et performance.

## 2. Boucle standard

**Aucun commentaire sur la PR** : une revue ne passe jamais `--comment` et ne poste aucun finding, ni en ligne ni en commentaire général. Les findings vont au compte rendu de l'agent et aux correctifs ; seul un vrai problème hors zone va dans `ERREUR.txt`.

`/code-review` en boucle selon les règles du § 1 : cycle 1 complet, puis le seul diff depuis le cycle précédent, jusqu'au premier cycle sans majeur (4 au plus).

## 3. Cycles thématiques — PR qui ajoute ou modifie une fonctionnalité

Une fois la boucle standard propre, un cycle par thème, **jamais fusionnés en une seule passe**, chacun relancé selon les règles du § 1, la sécurité en dernier :

1. **UI/UX** — états (chargement, vide, erreur, désactivé), accessibilité, textes FR et EN, messages par toast (`useToast()`), rendu mobile/responsive, aucune régression visuelle. **Facultatif** quand la PR ne change aucun écran (pages, composants, CSS, textes affichés) ; la seule formulation d'une notification ou d'un message Discord ne l'impose pas.
2. **Performance** — requêtes et N+1, cache et invalidation, rendus React inutiles, taille du paquet client, poids des réponses et des instantanés, chemins chauds.
3. **Sécurité** — autorisations et permissions (`can(user, …)`), validation des entrées, injections (SQL, HTML, Markdown Discord), secrets, exposition de données (ce qui part dans une réponse, un instantané ou un message Discord), plafonds de débit, CSRF et redirections. Une PR qui change ce que le site collecte, qui le lit, combien de temps il le garde ou ce qu'une suppression emporte y est aussi relue pour ses **déclarations** : entrée `PRIVACY_CHANGES`, fiche du registre des traitements avec `REGISTER_UPDATED_AT` avancée, mise à jour de `/rgpd`. Ces déclarations sont écrites par l'implémentation ; la revue ne fait que les confirmer.

Un cycle thématique se lance avec le skill `code-review` et des arguments qui **nomment le thème**, par exemple :

```
/code-review focus: security review — authz, input validation, injection, secrets, data exposure, rate limits, CSRF/redirects
```

Le thème voyage en **texte libre** dans les arguments du skill : ne compter un cycle thématique comme fait que si son compte rendu traite bien du thème nommé — une revue revenue généraliste ne vaut pas cycle thématique et se relance.

## 4. Exceptions

- **Renommage seul** (fichier, symbole, libellé, sans changement de comportement) : boucle standard uniquement, **aucun** cycle thématique.
- **Documentation de processus ou de fonctionnalité seule** (`CLAUDE.md`, `docs/*.md`, `docs/features/*.md`, sans texte légal) : boucle standard uniquement — c'est elle qui vérifie l'exactitude technique — **aucun** cycle thématique ni juridique.
- **Textes légaux** (pages légales, `/rgpd`, registre, `PRIVACY_CHANGES`, conditions, déclaration d'accessibilité, pages légales du bot) : la boucle standard, puis **un cycle orienté juridique** à la place des cycles thématiques, relancé jusqu'à revenir propre — RGPD, LCEN/DSA, recommandations CNIL, cohérence avec `/rgpd`, le registre des traitements (`lib/shared/processing-register.ts`, `REGISTER_UPDATED_AT` avancée) et `PRIVACY_CHANGES`, toute date ou version affichée d'un texte modifié avancée avec lui (par exemple `TERMS_VERSION` **et** `TERMS_UPDATED_AT` pour les conditions d'utilisation, `ACCESSIBILITY_STATEMENT_DATE` pour la déclaration d'accessibilité, les dates françaises et anglaises des pages légales du bot dans `lib/shared/bot-legal-content.ts`), aucune donnée personnelle ni aucun secret publié. Seul le **fond** compte comme finding (traitement, destinataire, donnée, durée ou base légale non déclarés, entrée de registre ou `PRIVACY_CHANGES` manquante, contradiction FR/EN ou texte/code) ; la formulation n'en est jamais un. Exemple :

  ```
  /code-review focus: legal review — GDPR/RGPD, LCEN/DSA, CNIL, consistency with /rgpd, processing register, PRIVACY_CHANGES, no personal data or secrets published
  ```
