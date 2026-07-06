# Pages légales du bot Discord (bilingues)

Deux pages publiques exposent les documents légaux du bot Discord *BlueGenji Bot*,
chacune disponible en **français** et en **anglais** avec un basculement de langue
immédiat.

| Route | Document |
| --- | --- |
| `/terms-of-service-bot` | Conditions d'Utilisation / Terms of Service |
| `/privacy-policy-bot` | Politique de Confidentialité / Privacy Policy |

## Source du contenu

Le texte provient de `blueGenjiBot/LegalTerms` (versions FR + EN des `.md`). Il est
transcrit dans un unique module de données partagé :
[`lib/shared/bot-legal-content.ts`](../../lib/shared/bot-legal-content.ts).

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

Les documents du bot ne dupliquent pas les coordonnées de l'hébergeur : chaque page
se termine par un bloc renvoyant vers la section **Hébergement** des mentions légales
du site via l'ancre partagée `HEBERGEUR_HREF` = `/mentions-legales#hebergement`.

La section correspondante de [`app/mentions-legales/page.tsx`](../../app/mentions-legales/page.tsx)
porte l'`id="hebergement"` pour servir de cible d'ancre.

## Tests

[`tests/app/bot-legal-pages.test.ts`](../../tests/app/bot-legal-pages.test.ts) vérifie
le parallélisme FR/EN (mêmes sections, numérotation alignée), l'absence de bloc vide,
la présence des contacts, la cible de l'ancre hébergeur, et le câblage des pages.
