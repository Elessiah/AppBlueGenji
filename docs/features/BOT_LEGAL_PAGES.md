# Pages légales du bot Discord (bilingues)

Deux pages publiques exposent les documents légaux du bot Discord *BlueGenji Bot*,
chacune en **français** et en **anglais**, **une langue par adresse** (lot 7a,
[`I18N.md`](I18N.md) § Documents légaux du bot) :

| Document | Français | Anglais |
| --- | --- | --- |
| Conditions d'Utilisation / Terms of Service | `/terms-of-service-bot` | `/en/terms-of-service-bot` |
| Politique de Confidentialité / Privacy Policy | `/privacy-policy-bot` | `/en/privacy-policy-bot` |

Les adresses françaises sont celles déclarées au **portail développeur de Discord**
(liens « conditions » et « confidentialité » du bot) : elles n'ont pas changé.

## Source du contenu

Le module [`lib/shared/bot-legal-content.ts`](../../lib/shared/bot-legal-content.ts)
est la **source unique** des deux textes. Ils venaient de `blueGenjiBot/LegalTerms`,
qui en est désormais une **copie générée** (`scripts/generate-legal-terms.py` du
bot, à relancer après chaque changement de ce module).

Ils décrivent le bot **d'après son code** (`blueGenjiBot`, branche `main`), relu
table par table : relais d'annonces, scrims et recrutement (auteur effacé à 30 jours), exclusions (valables pour tout le réseau),
configuration des serveurs (rattrapée au redémarrage quand le bot a été retiré pendant un arrêt), rappels programmés, messages remis pour le site,
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
| Durées propres au bot | `BOT_RELAY_RETENTION_DAYS`, `BOT_ACTIVITY_AUTHOR_RETENTION_DAYS` (`processing-register.ts`) |
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
- `[texte](url)` → `<a>` (les liens internes `/…` passent par `LocaleLink` : sous
  `/en`, le renvoi d'un document à l'autre reste anglais, `/rgpd` et
  `/mentions-legales` gardent leur adresse tant qu'ils ne sont pas traduits ; les
  liens externes ouvrent un nouvel onglet avec `rel="noreferrer"`).

## Rendu

Chaque page lit la langue de la requête (`requestLocale()`) et passe
`doc[locale]` à [`components/legal/BotLegalDoc.tsx`](../../components/legal/BotLegalDoc.tsx),
composant **serveur** (aucun JavaScript envoyé) qui rend l'intro, les sections et un
petit moteur de rendu inline. Le texte légal est rendu **tel quel** : le lot 7a n'a
touché à aucune phrase de `bot-legal-content.ts`, et `TERMS_VERSION` ne bouge pas.

La bascule FR ⇄ EN qu'il portait (un état `useState`, jamais une adresse ni un
paramètre) a cédé la place au sélecteur de langue du site : aucune ancienne adresse
n'est à rediriger. Seul texte d'interface, le surtitre « SECTION nn » et les titres et
descriptions des pages vivent dans `messages/<langue>/bot.json` (`legalPages`) ; les
titres français ont perdu leur moitié anglaise (« … / Privacy Policy ») : la page
n'affiche plus d'anglais. Habillage seulement, le texte légal ne change pas. Carte
d'aperçu par langue
(`/og/<langue>/botPrivacy.png`, `botTerms`).

Il ne rend **pas** `PublicHeader` / `PublicFooter` : la page les pose
(`PublicPageShell`).

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
[`tests/app/bot-legal-lang.test.tsx`](../../tests/app/bot-legal-lang.test.tsx) rend
chaque page dans chaque langue : texte du document mot pour mot et dans l'ordre,
aucune phrase française sous `/en`, `lang` des sections, métadonnées, `hreflang`,
sitemap et liens internes par langue.
