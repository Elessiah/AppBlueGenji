# Risques de dépendances (npm audit / SonarQube « Dependency risks »)

SonarQube Cloud reprend les avis de `npm audit`. Ce document consigne ceux qui restent et pourquoi.

## Avis restant : `braces` (GHSA-vfj7-8cjw-p6xm)

- Toutes les versions de `braces` (≤ 3.0.3) sont visées et **aucun correctif n'existe** : la seule issue est de ne plus en dépendre.
- Chaîne restante, **outillage de lint seulement** (rien n'est livré au navigateur ni exécuté en production) :
  `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob@3.3.1` (version **épinglée**, y compris en 16.x) → `micromatch` → `braces`.
- `npm audit` y compte 5 constats (`braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`). Ne **pas** lancer `npm audit fix --force` : il rétrograde `eslint-config-next` en 14.2.35, incompatible avec `next` 15.5.
- Levée attendue : un `@next/eslint-plugin-next` qui quitte `fast-glob` (ou le passage à Next 16 s'il le fait), ou l'abandon de `next lint` au profit d'une configuration ESLint sans ce greffon.

## Avis restant : `deepmerge` 4.3.1

- Signalé par SonarQube Cloud ; **aucune version corrigée publiée**. Arrive par `jest-config` (outillage de test seulement, rien n'est livré ni exécuté en production). À lever dès qu'un correctif paraît ou que Jest s'en passe.

## Réglés

- `uri-js` 4.4.1 (via `ajv` 6 ← ESLint, dev) : non maintenu, sans correctif → surcharge npm `"uri-js": "npm:uri-js-replace@^1.0.1"` (fork à API identique, un seul mainteneur, dernière publication 2024 — à surveiller). Lint inchangé.
- `sprintf-js` 1.0.3 (via `argparse` 1 ← `@istanbuljs/load-nyc-config`, dev) → surcharge `^1.1.3` ; couverture (`npm run test:coverage`) vérifiée.
- `next` 15.5.25 → 15.5.27 (plancher de plage relevé, `eslint-config-next` déjà en 15.5.27) et `source-map-js` 1.2.1 → 1.2.2 (via `postcss`, dans la plage).

- `@typescript-eslint/*` 8.32 → 8.71 (passés à `tinyglobby`) : 5 constats retirés. Ils suivent la plage `^8` d'`eslint-config-next`, aucune surcharge nécessaire.
- `eslint-config-next` 15.3.2 → 15.5.27, aligné sur `next` ^15.5 (pas la 16).

## Règle

Après toute modification du lockfile sous Windows, vérifier que `git diff package-lock.json` ne retire ni entrée `@emnapi/*` ni champ `libc` : npm sous Windows les élague et `npm ci` casse alors sur la CI Linux.
