# Casts : journal et avis au caster

Lot LOGS-NOTIFS, PR ln-1 (décisions de l'utilisateur du 2026-10-27). Code :
`lib/server/tournaments/cast-notices.ts` (déclenchement, après le commit),
`lib/shared/cast-notices.ts` (motifs, pur), `lib/server/tournaments/cast-release-message.ts`
(message privé FR/EN),
`formatCastChangeLog` (`lib/shared/bot-logs.ts`), `castReleasedPush`
(`lib/shared/push-messages.ts`). Appelé par `claimMatchCast`,
`releaseMatchCast` et `releaseIneligibleCast` (`match-launch.ts`).

## Ce qui part, à qui

| Changement | Journal du staff (Discord) | Caster prévenu (DM + push `CAST_RELEASED`) |
|---|---|---|
| Inscription sur un match libre | « 🎙️ Cast réservé » | — |
| Place reprise à un titulaire inéligible | « 🎙️ Cast repris » | l'ancien titulaire, motif `REPLACED` |
| Le caster retire son inscription | « 🎙️ Cast libéré » | — (il sait) |
| Le staff la retire (`tournaments`, pas le caster lui-même) | « 🎙️ Cast retiré », par le staff | motif `STAFF` |
| Retrait d'office : conditions du cast plus remplies | « 🎙️ Cast retiré d'office » | motif `INELIGIBLE` |
| Retrait d'office : il joue le match (son équipe, ou son entrée solo) | « 🎙️ Cast retiré d'office » | motif `JOINED_TEAM` |

- Une inscription rejouée (déjà titulaire) ou refusée ne s'annonce pas ; un
  retrait sur un match sans caster non plus.
- Le retrait `JOINED_TEAM` naît aussi au fond d'une transaction, quand
  l'appariement qui arrive compte l'équipe du caster (`adoptCurrentPairing` :
  « Prêt », lancement forcé, entretien des lancements). Il y est **noté**
  (`queueCastChange`) et n'est annoncé qu'après le commit (`flushCastChanges`,
  appelé par `inTransaction`, `flushBotLogs` et l'entretien de la modale) ;
  une transaction annulée le jette (`discardCastChanges`).
- Retrait d'office : si le caster est à la fois inéligible et devenu joueur du
  match, le motif dit les conditions du cast (`INELIGIBLE`). Le blocage lu
  (`loadCastBlocks`) précise le motif : permission `live` perdue
  (`INELIGIBLE_PERMISSION`) ou identité de caster manquante (`INELIGIBLE_IDENTITY`).
- Inscriptions et retraits du caster lui-même, en rafale sur un même match,
  sont regroupés (`lib/server/coalescer.ts`, 60 s sans geste, 5 min au plus) :
  une seule ligne, l'état final, et aucune si le caster revient à l'état de départ.
  Un retrait par le staff, d'office, ou une reprise de place sur ce caster fait
  d'abord partir sa rafale : le journal garde l'ordre et finit sur l'état réel.
- Les **joueurs du match ne sont pas prévenus** (décision 3).
- Sur la carte de match, « Retirer le caster » (staff) passe par une
  `ConfirmActionDialog` qui dit que le caster sera prévenu, avec le motif
  « décision du staff » : l'avis ne se reprend pas. « Ne plus caster » (le
  caster lui-même, qui n'est prévenu de rien) part sans confirmation.
- La case « Messages privés Discord de mes matchs » (`/profil`) coupe aussi ce
  message privé : son aide (`matchDms.hint`, FR et EN) le dit.

## Confidentialité

- **Personne n'est nommé**, ni sur Discord ni dans pm2 (décision 4) : « un
  caster », « le caster », « le staff » ; en tournoi individuel, « un joueur »
  au journal (`entrantLabel`) et « un match » au caster. Aucun
  `publishStaffAction` : la ligne part par `sendBotLog` seul.
- Échec d'un avis (destinataire illisible, annonce non partie, rafale qui
  lève) : la ligne `[cast]` ou `[coalescer]` de pm2 ne porte que le code de
  l'erreur (`failureReason`, `lib/server/failure-reason.ts`, même règle que
  `[staff-log]`), jamais le message de mysql2, qui peut citer une valeur lue.
- Message privé : `loadNotificationRecipients(…, "certified", { matchDm: true })`
  — un tag Discord certifié seulement, coupé par la case « Messages privés
  Discord de mes matchs » de « Mon profil » (droit d'opposition). Le push a son
  sujet propre, `CAST_RELEASED` (audience `live`), réglable sur `/profil` ; un
  caster qui a perdu la permission `live` n'en voit plus le réglage : il ne
  reçoit que le message privé (`notifyUsers` filtre le push d'un sujet réservé).
- Textes : le motif, le match (noms d'équipe passés par `discordInline`,
  « TBD » pour une place vide), le tournoi, la manche et le lien de la fiche du
  match (`/en` pour un compte anglais). Langue du compte de chaque caster.
- Légal : registre T04 (finalité, base, destinataires), T05 (journal), T12
  (push) ; `/rgpd#messages-de-match` (FR et EN) ; entrée
  `2026-10-avis-de-retrait-du-cast` de `PRIVACY_CHANGES` (public `LIVE_STAFF`).
  Aucune clause des conditions d'utilisation n'est touchée.

## Robustesse

`announceCastChange` ne lève jamais et n'est pas attendu : le geste répond sans
attendre le bot. Match disparu entre-temps : rien ne part. Bot injoignable :
`sendBotLog` se tait, le push part quand même.

## L'arbitrage des matchs (MATCH-REFEREE) réutilisera

`CastChange` / `CastReleaseReason` sont des unions ouvertes : un nouveau motif
s'ajoute aux deux tables de textes (`DM_REASONS`, `castReleased.reason.*` des
`pushMessages.json`) et à `CAST_LOG_WORDING`.

## Tests

`tests/lib/server/cast-notices.test.ts` (routage, solo, TBD, match disparu,
erreur avalée, rafales regroupées), `tests/lib/server/cast-release-message.test.ts`
(clés de motif, textes FR/EN, longueurs, noms piégés),
`tests/lib/server/coalescer.test.ts` (fenêtre, plafond),
`tests/lib/server/match-launch.test.ts` (déclenchement après chaque geste, et
silence sinon).
