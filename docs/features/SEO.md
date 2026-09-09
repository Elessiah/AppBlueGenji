# Référencement (SEO)

> Modules : `lib/shared/sitemap.ts`, `lib/shared/structured-data.ts` (purs),
> `app/robots.ts`, `app/sitemap.ts`, `components/seo/JsonLd.tsx`,
> `siteCanonicalBase()` dans `lib/server/site-url.ts`.
> Voir aussi `docs/features/SHARE_METADATA.md`, qui traite de l'autre moitié du
> `<head>` — l'aperçu d'un lien collé, pas le référencement.

## Le point de départ

Le site savait déjà se **décrire** : chaque page porte un titre, une description
et un encart de partage (`pageMetadata`), et la fiche d'un tournoi rédige les
siens (`share-metadata.ts`). Ce qu'il ne savait pas, c'est se faire **trouver**.

Trois constats, relevés en production :

- `https://bluegenji-esport.fr/robots.txt` et `/sitemap.xml` répondaient `404`.
  Un moteur n'avait donc aucune porte d'entrée : il devait deviner la vitrine en
  suivant les liens de l'accueil, et rien ne lui disait où passait la limite
  entre ce qui se lit et ce qui demande un compte.
- **L'accueil ne déclarait aucune métadonnée.** Il retombait sur le socle de la
  racine, dont le titre est le seul nom du site : un `<title>` qui ne contient ni
  « tournoi », ni « esport », ni « Overwatch », et **aucune URL canonique** sur la
  page que l'on atteint par le plus d'adresses différentes.
- Les descriptions écrites en dur avaient **dérivé du contenu**, lui éditable
  depuis l'interface (`site-copy.ts`).

## Ce qui a été fait

### `robots.txt` et `sitemap.xml`

Deux routes, rendues **à la demande** (`dynamic = "force-dynamic"`). Ce n'est pas
un détail de performance : préremplies à la compilation, elles emporteraient
l'`APP_URL` de la machine qui compile — `http://localhost:3000` si elle n'en a
pas — et publieraient un sitemap entier que le moteur rejetterait en bloc, sans
que rien sur le site ne le laisse voir. Les deux réponses sont minuscules.

Le registre de ce qui entre au sitemap est **pur** (`lib/shared/sitemap.ts`), pour
que la liste se relise et se teste sans monter un serveur. Trois exclusions,
chacune pour sa raison :

- **l'espace sécurisé** (`/tournois`, `/equipes`, `/joueurs`, `/profil`) porte
  `robots: noindex` : un visiteur non connecté n'y voit qu'une carte « Connexion
  requise », il n'y a rien à référencer. Annoncer au sitemap une page qu'on
  demande par ailleurs d'ignorer est une contradiction que Search Console remonte
  comme une erreur ;
- **`/connexion`** pour la même raison, plus ses variantes `?redirect=` qui
  multiplient l'adresse autant qu'il y a de destinations ;
- **`/partenaires`**, qui n'est plus qu'une redirection permanente vers
  `/#sponsors` : un sitemap annonce des destinations, pas des renvois.

À l'inverse, `robots.txt` **n'interdit pas** l'espace sécurisé, et c'est le
contresens classique qu'on évite : un robot à qui l'on interdit de lire la page
ne lit pas non plus le `noindex` qu'elle porte, et peut donc indexer l'URL seule,
sans titre ni description. On laisse ces pages accessibles pour que la directive
soit lue et obéie. Ne restent interdites que les routes d'API, qui ne rendent
aucune page.

Les pages de règles descendent du **registre des modes** et les pages de doc du
bot de `BOT_DOC_SECTIONS` : ajouter un mode ou une section ajoute son entrée au
sitemap sans qu'on y pense. Une liste recopiée aurait dérivé au premier ajout, et
la panne aurait été muette. `/bot/docs` tout court n'y figure pas : la route rend
la première section et se déclare elle-même canonique sur `/bot/docs/guide` — le
sitemap ne doit pas la contredire.

**Aucune date de dernière modification**, et c'est un choix. Les textes de la
vitrine s'éditent en base sans horodatage par page : il n'existe aucune date
juste à annoncer. Écrire l'instant du rendu annoncerait que tout le site change à
chaque visite — un moteur qui s'en aperçoit cesse d'y croire, y compris le jour
où la date serait vraie.

### Le titre de l'accueil, et un piège de Next

`pageMetadata` gagne un drapeau `selfTitled`. Le gabarit de titre déclaré dans
une mise en page (`%s · BlueGenji Esport`) ne s'applique qu'à ses **segments
enfants** : `app/page.tsx` partage le segment d'`app/layout.tsx`, il ne le reçoit
donc pas. Sans ce drapeau, l'accueil était la seule page du site dont le
`<title>` ne portait pas le nom du site — vérifié, pas déduit. Aucune autre page
n'en a besoin : elles sont toutes des enfants.

Le titre rend désormais « Tournois esport amateurs Overwatch · BlueGenji
Esport » : la marque reste dite, mais elle vient après ce qu'on cherche.

`/connexion`, page cliente, reçoit une mise en page qui n'existe que pour porter
ses métadonnées — elle n'en avait aucune et portait donc le titre **et** la
description de l'accueil, ce qu'un moteur lit comme deux pages qui se disputent
la même requête. Elle est `noindex` **et** `follow` : il n'y a rien à référencer
sur un formulaire de connexion, mais les liens qu'il porte restent des liens du
site. Son URL canonique n'est pas décorative pour autant — c'est elle qui ramène
les variantes `?redirect=` à une seule adresse.

### Données structurées (JSON-LD)

Les métadonnées de partage rédigent pour un **humain** qui verra un encart ;
`schema.org` décrit pour une **machine** qui range. Un moteur qui lit « BlueGenji
Esport » dans un `<title>` ne sait pas s'il a affaire à une association, à un
tournoi ou à une marque de vêtements.

Trois nœuds, tous rendus par le module pur `lib/shared/structured-data.ts` :

- **`SportsOrganization`** — l'association : raison sociale, siège social repris
  des mentions légales, année de fondation, lien Discord. Posée à l'accueil
  **et** sur `/association`, avec la **même identité** (`@id`) : c'est ce qui
  permet à un moteur de reconnaître la structure qu'il connaît déjà plutôt que
  d'en déclarer une seconde.
- **`WebSite`** — le site, distinct de l'association qui l'édite : on peut fermer
  un site sans dissoudre une association. `publisher` fait le lien, par l'`@id`
  du nœud précédent et non par une description recopiée.
- **`BreadcrumbList`** sur `/regles/[slug]` — ce qui remplace, dans un résultat
  de recherche, l'adresse brute par « bluegenji-esport.fr › Règles › Ronde
  suisse ». Une page de règles arrive rarement par l'accueil : elle doit dire
  seule d'où elle vient.

`serializeJsonLd` est la seule partie capable de casser une page, donc la seule
qui se teste vraiment : `JSON.stringify` **n'échappe pas** `<`, et un `</script>`
glissé dans un texte — une description éditée depuis l'interface, un nom d'équipe
— fermerait la balise et rendrait exécutable tout ce qui suit. Les trois
caractères qui permettent de sortir d'un `<script>` (`<`, `>`, `&`) sont réécrits
en séquences d'échappement Unicode : le JSON reste strictement équivalent, mais
plus rien n'y ressemble à du balisage.

### Textes recalés sur la production

Les textes de la vitrine s'éditent depuis l'interface, les descriptions de
référencement étaient écrites en dur : les deux avaient divergé. Le hero de
production annonce une communauté « principalement autour d'Overwatch » et la
page association affiche son objet statutaire — des événements « en ligne et en
LAN », la fédération des équipes, la formation des acteurs.

- `SITE_DESCRIPTION` mettait les deux jeux sur le même plan et taisait la LAN.
- `/association` annonçait « pour Overwatch et Marvel Rivals » quand sa page ne
  mentionne plus Marvel Rivals nulle part.
- `/regles` ne citait que quatre des six modes publiés : « BlueGenji Survie » et
  le multi-phases y manquaient, alors que ce sont justement les deux qu'on
  cherche par leur nom.

Toutes sont tenues sous ~160 caractères : au-delà, le moteur coupe lui-même, et
la coupe tombe où elle veut.

## Ce qui n'a **pas** été fait, et pourquoi

**Les fiches de tournoi ne sont pas référençables, par décision.** Elles vivent
dans l'espace sécurisé : un visiteur non connecté — donc Googlebot — n'y voit
qu'une carte « Connexion requise », et la page déclare `robots: noindex,
nofollow`. Améliorer leur référencement supposait de rendre publique au moins une
synthèse du tournoi ; le choix a été fait de n'exposer **aucun** contenu de
tournoi hors connexion.

Leurs métadonnées de partage restent, elles, complètes et par tournoi (titre,
description, image d'aperçu dédiée) — c'est ce que lisent les robots d'encart de
Discord ou de Twitter, qui ne se soucient pas du `noindex`. Voir
`docs/features/SHARE_METADATA.md`.

## Vérifier

    curl -s https://bluegenji-esport.fr/robots.txt
    curl -s https://bluegenji-esport.fr/sitemap.xml

Les données structurées se contrôlent sur
[validator.schema.org](https://validator.schema.org/) et dans le test des
résultats enrichis de Google, en collant l'URL de l'accueil et celle d'une page
de règles.

## Tests

- `tests/lib/shared/sitemap.test.ts` — ce qui entre, ce qui n'entre pas, et le
  fait que la liste des règles ne peut pas diverger du registre des modes.
- `tests/lib/shared/structured-data.test.ts` — forme des nœuds, stabilité des
  `@id`, et l'échappement d'une balise fermante glissée dans un texte.
- `tests/app/seo-routes.test.ts` — URL absolues, désignation du sitemap, et le
  fait que les deux routes sont rendues à la demande.
- `tests/app/showcase-metadata.test.ts` — titre et canonique de l'accueil,
  `noindex` de la connexion, descriptions recalées.
- `tests/lib/shared/page-metadata.test.ts` — le drapeau `selfTitled`.
