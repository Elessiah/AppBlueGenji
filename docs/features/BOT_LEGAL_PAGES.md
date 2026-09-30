# Pages légales du bot Discord (bilingues)

Deux pages publiques exposent les documents légaux du bot Discord *BlueGenji Bot*,
chacune disponible en **français** et en **anglais** avec un basculement de langue
immédiat.

| Route | Document |
| --- | --- |
| `/terms-of-service-bot` | Conditions d'Utilisation / Terms of Service |
| `/privacy-policy-bot` | Politique de Confidentialité / Privacy Policy |

## Source du contenu

Le module [`lib/shared/bot-legal-content.ts`](../../lib/shared/bot-legal-content.ts)
est la **source unique** des deux textes. Ils venaient de `blueGenjiBot/LegalTerms`,
dont les fichiers ont divergé et ne font plus foi (13 ans, « 72 heures ou au
redémarrage », aucun responsable du traitement — voir `ERREUR.txt`, lot bot).

Ils décrivent le bot **d'après son code** (`blueGenjiBot`, branche `main`), relu
table par table : relais d'annonces, scrims et recrutement, exclusions, liaison
`/link`, configuration des serveurs, rappels programmés, messages remis pour le site,
journaux, sauvegardes. Une durée que le code du bot n'applique pas ne s'écrit pas :
là où aucune purge n'existe, le texte dit « aucune suppression automatique à ce
jour » plutôt qu'une durée inventée.

Ce qu'ils réutilisent au lieu de le recopier :

| Fait | Source |
| --- | --- |
| Responsable du traitement, siège | `ASSOCIATION_NAME`, `ASSOCIATION_SEAT` (`legal-contact.ts`) |
| Hébergeur technique, machine | `SITE_HOST` (`site-host.ts`) |
| Durée des sauvegardes | `BACKUP_RETENTION_DAYS` (`account-deletion-journal.ts`) |
| Transfert vers Discord | `DPF_ADEQUACY_DECISION` (`processing-register.ts`) |
| Durées propres au bot | `BOT_RELAY_RETENTION_DAYS`, `BOT_LINK_CODE_VALIDITY_MINUTES` (`processing-register.ts`) |
| Âge minimal | `BOT_MINIMUM_AGE` (15 ans, `bot-legal-content.ts`) |

Les durées propres au bot vivent dans un autre dépôt : aucune importation ne peut les
tenir alignées. Elles sont recopiées **une fois**, avec leur fichier source, dans
`processing-register.ts`, que la fiche T08 du registre lit aussi — un changement du bot
se reporte là, et les deux pages le suivent. Aucune adresse électronique n'y est écrite :
le courriel de l'association se lit au clic sur les mentions légales, vers lesquelles
les textes renvoient.

Chaque document est un `BilingualDoc` (`{ fr, en }`). Un `LegalDoc` contient un
en-tête (eyebrow, titre, date de mise à jour, intro) et une liste de `LegalSection`,
elles-mêmes composées de `LegalBlock` (`p`, `subhead`, `bullets`). Les chaînes
acceptent une syntaxe inline minimale :

- `**gras**` → `<strong>`
- `[texte](url)` → `<a>` (les liens internes `/…` passent par `next/link`, les liens
  externes ouvrent un nouvel onglet avec `rel="noreferrer"`).

## Rendu

[`components/legal/BotLegalDoc.tsx`](../../components/legal/BotLegalDoc.tsx) est un
composant **client** qui :

- porte l'état de langue (`useState<Lang>`, FR par défaut) ;
- affiche un *segmented control* accessible (`role="group"`, `aria-pressed`) pour
  basculer FR ⇄ EN ;
- rend l'intro, les sections et un petit moteur de rendu inline.

Il ne rend **pas** `PublicHeader` / `PublicFooter` (qui importent du code serveur) :
ces layouts restent dans les pages serveur qui l'enveloppent, ce qui évite de tirer
`lib/server/*` (mysql2, `next/headers`) dans le bundle client.

## Partie « hébergeur »

Les documents du bot ne dupliquent pas les coordonnées de l'hébergeur (ils ne le
nomment, avec sa machine, qu'à travers `SITE_HOST`) : chaque page
se termine par un bloc renvoyant vers la section **Hébergement** des mentions légales
du site via l'ancre partagée `HEBERGEUR_HREF` = `/mentions-legales#hebergement`.

La section correspondante de [`app/mentions-legales/page.tsx`](../../app/mentions-legales/page.tsx)
porte l'`id="hebergement"` pour servir de cible d'ancre.

## Tests

[`tests/app/bot-legal-pages.test.ts`](../../tests/app/bot-legal-pages.test.ts) vérifie
le parallélisme FR/EN (mêmes sections, numérotation alignée), l'absence de bloc vide,
la présence des contacts, la cible de l'ancre hébergeur, et le câblage des pages.
