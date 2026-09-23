# Journaux Discord et mesure d'audience sans données nominatives

Deux traitements gardaient plus que ce dont ils avaient besoin.

## Mesure d'audience — une empreinte qui ne remonte à personne

`bg_site_visits` rangeait `user_id` à côté de chaque visite d'un compte
connecté : qui avait vu quelle page, et à quelle heure, tant que le compte
vivait. La mesure d'audience n'en a jamais eu besoin — elle compte des
visiteurs **uniques**, pas des personnes.

- **La colonne `user_id` disparaît.** Seul reste `authenticated` (0/1) : « cette
  visite venait d'un compte connecté », sans dire lequel. `identifiedVisitors`
  se compte désormais sur les empreintes marquées connectées.
- **L'empreinte** reste un SHA-256 de `sel:source` (`u:<id>` pour un compte,
  `a:<ip>|<navigateur>` sinon) : même empreinte pour le même visiteur, d'où
  l'unicité. **C'est le sel qui la rend irréversible**, pas le hachage : un
  identifiant de compte se devine en quelques milliers d'essais, une IPv4 en
  quatre milliards. Le sel (`VISIT_HASH_SALT`, à défaut `BOT_INTERNAL_TOKEN`) est
  un secret du serveur, absent de la base **et de ses sauvegardes** : une table
  lue ailleurs ne se rapproche d'aucune personne.
- **Sans secret en production, on ne compte pas** (`visitHashSalt` rend `null`,
  une erreur est journalisée une fois) plutôt que de compter avec la constante de
  repli, que n'importe qui pourrait renverser.
- **Migration** (`lib/server/database.ts`) : `authenticated` est ajoutée, reportée
  depuis `user_id IS NOT NULL`, puis `user_id` est retirée. Si le `DROP` est
  refusé, la colonne est **vidée** — c'est l'effacement qui est urgent.
- **La suppression de compte** n'a plus rien à détacher : les visites ne
  désignent aucun compte.

Limite connue : qui détient à la fois la base **et** le secret du serveur peut
encore retrouver un compte par énumération des identifiants. C'est la borne de
tout comptage d'uniques déterministe ; le secret ne quitte pas le serveur.

## Journaux Discord — aucun joueur, aucun membre du staff nommé

Le canal de logs, les alertes arbitre et les signalements partent dans un salon
Discord : un tiers, hébergé hors de l'Union européenne, et sans purge
automatique. Règle, écrite une fois dans `lib/shared/log-privacy.ts` :

| Qui | Sur Discord | Dans pm2 |
| --- | --- | --- |
| Une **équipe** | son nom | — |
| Un **joueur** | « un joueur » — ni pseudo, ni `#id` (qui mène à `/joueurs/<id>`) | — |
| Un engagé de **tournoi individuel** | « un joueur » : son nom *est* un pseudo | — |
| Un membre du **staff** | « le staff » | `[staff-audit] <ligne Discord> — auteur : <pseudo> (#<id>)` |

- **Un rédacteur ne reçoit jamais un nom nu** : les formateurs prennent un
  `LogEntrant` (`{ name, participantType }`) et le rendent par `entrantLabel`.
  C'est ce qui empêche une ligne ajoutée demain de publier un pseudo par mégarde
  — y compris par un libellé de match « A vs B » en tournoi individuel.
- **Inscription d'un joueur** : « 👋 Nouveau joueur — compte créé via Google. »,
  sans pseudo ni identifiant.
- **Signalements** : l'auteur est « un joueur de l'équipe X » (« un joueur » en
  individuel) ; la requête ne lit même plus `bg_users`.
- **Gestes du staff** (retrait d'un engagé, retour en arrière, suppression d'un
  tournoi, création d'un tournoi) : « par le staff » sur Discord, et la même
  ligne avec l'auteur sur la sortie standard, que pm2 range dans ses journaux —
  `publishStaffAction` (`lib/server/staff-audit.ts`) écrit l'audit **avant**
  l'envoi, qui reste au meilleur effort. Pour la modération :

  ```bash
  pm2 logs bluegenji --lines 1000 | grep staff-audit
  ```

- Le **motif d'une pénalité** est saisi librement par l'arbitre et repris tel
  quel : il ne doit pas nommer de joueur.

L'historique du salon, écrit avant cette règle, est vidé à la main par
l'association.

## Ailleurs

Le registre des traitements (`/rgpd/registre`, fiches T05 et T06) et le
récapitulatif présenté aux joueurs (`lib/shared/privacy-changes.ts`) disent la
nouvelle règle.
