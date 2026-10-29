# Origine du BattleTag

`bg_users.overwatch_battletag` a deux écrivains : la saisie du joueur sur
`/profil`, et Blizzard (rattachement `writeLinkedIdentity`, connexion
`createOrGetBlizzardUser`). `bg_users.overwatch_battletag_typed` dit lequel a
écrit la valeur en place (`lib/server/battletag-origin.ts`).

## Règle (décision de l'utilisateur D3, 2026-10-29)

| Geste | `overwatch_battletag` | `overwatch_battletag_typed` |
|---|---|---|
| Battle.net donne un BattleTag | le sien, à la place de la saisie | `0` |
| Battle.net n'en donne aucun | **inchangé** (la saisie reste) | `1` |
| Saisie sur `/profil` (champ ouvert) | la saisie | `1` |
| Suppression du compte | `NULL` | `0` |

Les deux écrivains Blizzard partagent une seule affectation
(`BLIZZARD_BATTLETAG_SET_SQL`).

**Vérifié** = Battle.net rattaché, `overwatch_battletag_typed = 0` et un
BattleTag non vide (`battletagFromBlizzard` / `verifiedBattletagSql`). Seul un
BattleTag vérifié : porte la pastille « BattleTag vérifié » de la fiche
(`getFullProfile`), compte comme contact certifié (`pickLaunchContacts`,
invitation à certifier), remplit l'identité du cast et de l'arbitrage
(`casterIdentityOf`, `CAST_ELIGIBLE_SQL`), et **verrouille** le champ du profil
(`checkBattletagEdit({ linked, verified })`). Un BattleTag tapé sous un
Battle.net rattaché reste donc modifiable.

La condition d'inscription « compte Battle.net rattaché »
(`registration-eligibility.ts`) ne lit que `blizzard_sub` : le rattachement, pas
le BattleTag.

## Profil

`updateOwnProfile` affecte `overwatch_battletag_typed` **avant**
`overwatch_battletag`, sous la même condition `verifiedBattletagSql()` : la
colonne ne change que là où le BattleTag change, si bien que la condition
rejouée sur la ligne déjà mise à jour (MySQL et MariaDB appliquent les `SET` de
gauche à droite) donne la même réponse.

## Lignes antérieures

`0` par défaut, **sans remplissage** : on ne sait pas lesquelles ont été tapées.
Elles gardent la règle d'avant (Battle.net rattaché et un BattleTag) jusqu'à la
prochaine connexion Battle.net, qui réécrit la colonne.

## Données personnelles

Entrée `PRIVACY_CHANGES` `2026-10-battletag-tape-garde-non-verifie` (31 octobre)
et `/rgpd` § Données collectées (FR + EN). Registre T04 (FR + EN) : la catégorie BattleTag dit que sa provenance
d'un compte Battle.net rattaché est vérifiée pour caster ou arbitrer ; `/rgpd`
dit de même pour l'inscription comme caster.

## Seed

`Test_BattletagTape` : Battle.net rattaché, BattleTag tapé, sans pastille.

## Tests

`tests/lib/server/battletag-origin.test.ts`, `tests/lib/shared/battletag-lock.test.ts`,
`tests/lib/server/users-service.blizzard.test.ts`, `tests/lib/server/account-identities.test.ts`.
