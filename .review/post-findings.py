# -*- coding: utf-8 -*-
import io, json, subprocess

SHA = "8bc285b9cd569980d61ee63c1babc5a9587d78aa"
PR = "68"
REPO = "Elessiah/AppBlueGenji"

F = [
 ("lib/server/tournaments/deletion.ts", 105, u"""**Caches de l'accueil non invalides a la suppression** - `correctness`

`publishUpdatedEvent` (`tournaments/notifications.ts:24-27`) n'invalide que `snapshot`, `preview` et `tournaments-list`. Or `landing-service.ts` tient ses propres entrees `cached(...)` que rien n'invalide :

- `landing:stats` (60 s, l. 60) - compte `SELECT COUNT(*) FROM bg_tournaments`
- `landing:leaderboard:*` (60 s, l. 253) - agrege depuis `bg_matches` (l. 406)
- `landing:ticker` (60 s, l. 387) - `FROM bg_tournaments` (l. 428/447)

Apres une suppression, l'accueil affiche donc pendant une minute un compteur de tournois surevalue, un classement incluant les resultats du tournoi efface, et un ticker qui le nomme encore - avec un lien menant a un 404. C'est le contre-exemple direct de la promesse « disparait partout » ecrite dans l'en-tete de ce fichier et dans `TOURNAMENT_DELETION.md`.

Correctif : exposer un `invalidateLandingCaches()` (prefixe `landing:`) et l'appeler ici, ou depuis `publishUpdatedEvent`."""),

 ("app/(secured)/tournois/[id]/page.tsx", 738, u"""**Dialogue de suppression non gate sur `frozen`** - `correctness`

La zone de danger est rendue sous `detail.canDelete && !frozen` (l. 676), mais le dialogue sous `deleteDialogOpen && detail.canDelete` seulement.

Si le flux tombe en echec definitif pendant que le dialogue est ouvert (session expiree, ou tournoi deja supprime par un autre administrateur), la page bascule en `frozen` : toutes les autres actions disparaissent, la zone de danger aussi - mais le dialogue reste ouvert et son bouton reste arme. L'administrateur envoie alors un `DELETE` depuis un ecran dont on vient de lui retirer tout le reste, et recoit un 404 ou un 401 brut.

```suggestion
      {deleteDialogOpen && detail.canDelete && !frozen && (
```"""),

 ("lib/server/tournaments/deletion.ts", 40, u"""**`purgeTournamentRows` duplique les cascades du schema** - `simplification`

Toutes les tables visees portent `REFERENCES bg_tournaments(id) ON DELETE CASCADE` (`database.ts` l. 130, 167, 316, 430, 485, 705), et les auto-references des matchs sont en `ON DELETE SET NULL` (l. 177-179), qu'InnoDB applique seul.

`DELETE FROM bg_tournaments WHERE id = ?` fait donc exactement le meme travail en une requete au lieu de neuf allers-retours dans une transaction - sur un Raspberry Pi, avec un pool de 25 connexions, c'est huit tenues de verrou en trop.

Cout de maintenance : chaque nouvelle table liee au tournoi devra etre ajoutee ici alors que sa cle etrangere la couvrirait deja, et une ligne oubliee dans cette liste ne se verra pas - la cascade la rattrapera silencieusement.

Si l'explicitation est voulue pour l'auditabilite, l'assumer comme telle dans le commentaire plutot que de la justifier par l'ordre des cascades, qui n'est pas en cause."""),

 ("lib/server/tournaments/deletion.ts", 54, u"""**Purge de `phase_teams` redondante, et justification inversee** - `simplification`

L'en-tete du fichier justifie cette requete par « `bg_tournament_phase_teams` n'a d'ailleurs pas de cle etrangere vers le tournoi - elle passe par la phase ».

C'est precisement pourquoi elle est superflue : `fk_bg_phase_teams_phase` est en `ON DELETE CASCADE` vers `bg_tournament_phases` (`database.ts:513-514`), et le `DELETE FROM bg_tournament_phases` de la l. 60 emporte donc ces lignes de lui-meme.

Le raisonnement ecrit conduit a la conclusion opposee a celle qu'il enonce : le prochain lecteur tiendra la l. 54 pour indispensable alors qu'elle ne fait rien."""),

 ("lib/server/tournaments/index.ts", 652, u"""**Quatre booleens de droits positionnels et consecutifs** - `altitude`

La signature devient `(snapshot, userId, isAdmin, canPreview, canManageLive, canDelete)` : quatre booleens consecutifs, tous a `false` par defaut ou derives d'`isAdmin`.

Un appelant qui intervertit les deux derniers - deux lignes voisines dans `stream/route.ts:70-74` et `index.ts:728-733` - accorde le droit de **supprimer un tournoi** a tout porteur de la permission `live`, c'est-a-dire a n'importe quel `CASTER`. Aucun type ne bronche, et les tests (qui verifient l'index 5) ne distinguent pas l'erreur.

Le risque est desormais de nature securitaire, pas seulement ergonomique. Passer un objet nomme - `{ canManage, canPreview, canManageLive, canDelete }` - rend l'inversion impossible."""),

 ("app/api/admin/tournaments/[id]/route.ts", 41, u"""**Erreur MySQL brute affichee au lieu du message francais** - `correctness`

`message` vient de `(error as Error).message` et n'est jamais vide pour une erreur mysql2. Le `|| "TOURNAMENT_DELETE_FAILED"` ne se declenche donc pas, et le client (`payload.error || ...` puis `mapError`) affiche le message tel quel : un toast « Deadlock found when trying to get lock; try restarting transaction » en anglais, dans une interface dont `CLAUDE.md` exige que **tout** le texte soit en francais - et qui expose au passage des details du moteur.

L'entree ajoutee dans `error-map.ts` reste donc lettre morte. Le motif vient de `seeding/route.ts:57`, mais il s'y trompe de la meme facon.

```suggestion
    return fail("TOURNAMENT_DELETE_FAILED", 500);
```"""),

 ("app/(secured)/tournois/[id]/_components/DeleteTournamentDialog.tsx", 99, u"""**Modale sans `maxHeight` alors que le defilement est verrouille** - `correctness`

`useDialogBehavior` pose `document.body.style.overflow = "hidden"` tant que la modale est ouverte. Le contenu - titre, deux paragraphes, champ, indice, boutons - fait environ 420 px avec un nom de tournoi long (la colonne autorise 120 caracteres).

Sur un ecran court (mobile en paysage a 375 px de haut, fenetre reduite, navigateur avec les outils de developpement ouverts), les boutons « Annuler » et « Supprimer definitivement » passent sous le bord de la fenetre et **rien ne defile** : la modale devient impossible a valider comme a annuler autrement qu'avec Echap.

`AdminScoreDialog.tsx:82-83` regle exactement ce cas :

```suggestion
          maxWidth: 480,
          maxHeight: "90vh",
          overflow: "auto",
```"""),

 ("app/(secured)/tournois/[id]/page.tsx", 676, u"""**Garde-fou `frozen` non couvert pour la suppression** - `test-coverage`

`tests/tournois/refresh-wiring.test.ts:134` (« retire les actions quand le suivi est arrete ») enumere les actions retirees en mode `frozen` : `canReport`, `canAdminResolve`, `canForfeit`. C'est, d'apres l'en-tete de ce fichier de test, sa raison d'etre - « un garde-fou de degradation » qu'aucun test de comportement ne peut tenir, faute de DOM en environnement Node.

La zone de danger ajoutee ici depend du meme garde-fou et n'y figure pas. Un remaniement qui laisserait tomber le `!frozen` rendrait la **suppression** accessible depuis un plateau perime sans qu'aucun test ne rougisse, alors que le meme oubli sur un report de score serait detecte.

A ajouter dans ce test :

```ts
expect(detailPage).toMatch(/detail\\.canDelete && !frozen/);
```"""),

 ("lib/server/tournaments/index.ts", 39, u"""**`purgeTournamentRows` exportee sans consommateur** - `reuse`

Le commentaire de `deletion.ts:37-38` annonce « Exportee pour les tests ». Or `tests/lib/server/tournament-deletion-service.test.ts` n'importe que `deleteTournament` et exerce la purge a travers lui.

La fonction n'a donc qu'un seul appelant, interne au module, et se retrouve pourtant dans la surface publique de `lib/server/tournaments` - elargie sans besoin, avec une justification que le prochain lecteur ira verifier pour rien.

```suggestion
export { deleteTournament } from "./deletion";
```"""),

 ("app/(secured)/tournois/[id]/page.tsx", 81, u"""**`deleteDialogOpen` survit au changement de tournoi** - `correctness`

`useTournamentLive` remet tout son etat a zero sur `[tournamentId]`, en documentant pourquoi : « L'App Router reutilise ce composant d'un parametre a l'autre : passer de `/tournois/1` a `/tournois/2` ne le remonte pas. »

La page, elle, garde `deleteDialogOpen`. Une navigation client vers un autre tournoi (lien du ticker, retour arriere) avec le dialogue ouvert le laisse affiche, desormais braque sur le nouveau tournoi dont il affiche le nom.

La recopie obligatoire empeche la suppression du mauvais tournoi, donc l'incident reste ergonomique - mais c'est une modale destructrice qui survit a un changement de cible, et le commentaire voisin sur `matchForLiveId` montre que le probleme est connu de cette page."""),
]

for path, line, body in F:
    payload = {"commit_id": SHA, "path": path, "line": line, "side": "RIGHT", "body": body}
    with io.open(".review/payload.json", "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    r = subprocess.run(
        ["gh", "api", "-X", "POST", "repos/%s/pulls/%s/comments" % (REPO, PR),
         "--input", ".review/payload.json", "--jq", ".html_url"],
        capture_output=True, text=True, encoding="utf-8")
    status = "OK " if r.returncode == 0 else "ERR"
    print(status, path, line, (r.stdout or r.stderr).strip()[:150])
