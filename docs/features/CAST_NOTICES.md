# Casts : journal et avis au caster

Lot LOGS-NOTIFS, PR ln-1 (décisions de l'utilisateur du 2026-10-27). Code :
`lib/server/tournaments/cast-notices.ts` (déclenchement, après le commit),
`lib/shared/cast-notices.ts` (motifs, message privé FR/EN),
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
- Retrait d'office : si le caster est à la fois inéligible et devenu joueur du
  match, le motif dit les conditions du cast (`INELIGIBLE`).
- Les **joueurs du match ne sont pas prévenus** (décision 3).

## Confidentialité

- **Personne n'est nommé**, ni sur Discord ni dans pm2 (décision 4) : « un
  caster », « le caster », « le staff » ; en tournoi individuel, « un joueur »
  au journal (`entrantLabel`) et « un match » au caster. Aucun
  `publishStaffAction` : la ligne part par `sendBotLog` seul.
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
erreur avalée), `tests/lib/shared/cast-notices.test.ts` (textes FR/EN, motifs,
longueurs, noms piégés), `tests/lib/server/match-launch.test.ts` (déclenchement
après chaque geste, et silence sinon).
