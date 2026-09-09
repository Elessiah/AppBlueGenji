# Aperçu des liens partagés

`lib/shared/share-metadata.ts` (rédaction, pur) + `lib/shared/page-metadata.ts`
(socle d'une page, pur) + `components/og/share-card.tsx` (image) +
`app/**/opengraph-image.tsx` (routes d'image) + `app/(secured)/_shared/AuthGate.tsx`
(ce qui rend l'aperçu atteignable).

## Le problème

Un lien collé dans un salon Discord n'affiche pas la page : il affiche ce que la
page a écrit dans son `<head>`. Le site y écrivait un titre et une phrase
**fixes**, hérités de `app/layout.tsx` :

```
BlueGenji Esport
Plateforme BlueGenji pour l'esport amateur Marvel Rivals: bot Discord,
association et gestion de tournois.
```

Coller trois tournois différents produisait donc trois encarts identiques, sans
image, sans nom de tournoi, sans date. Et la phrase elle-même était fausse :
BlueGenji est d'abord une structure **Overwatch**, Marvel Rivals est venu
ensuite.

Trois manques distincts, qu'il fallait régler ensemble :

1. **Aucune page ne se décrivait.** `metadataBase` n'était pas réglée (donc
   aucune URL d'image absolue possible), aucune carte Twitter, aucune URL
   canonique, aucune image d'aperçu — ni pour la vitrine ni pour un tournoi.
2. **Les pages qui essayaient se tiraient dans le pied.** Cinq pages déclaraient
   un `openGraph` maison. Or `openGraph` n'est **pas fusionné** avec celui de la
   racine : un enfant qui en déclare un remplace le bloc entier. Ces pages
   croyaient compléter le socle ; elles le remplaçaient par une version amputée
   du nom du site.
3. **La fiche d'un tournoi était inatteignable pour un robot d'aperçu.** Voir
   ci-dessous : c'est le point qui commandait tout le reste.

## Pourquoi la garde de l'espace sécurisé a changé

`app/(secured)/layout.tsx` répondait aux visiteurs sans session par
`redirect("/connexion")`, un **307**. Une redirection n'a pas de `<head>` :
Discord la suivait et affichait l'encart de la page de connexion. Aucune
métadonnée écrite sur la fiche d'un tournoi n'aurait jamais été lue — un lien de
tournoi partagé était, du point de vue de l'aperçu, un lien vers `/connexion`.

Le même 307 coûtait aussi au destinataire humain : `redirect("/connexion")` ne
portait **aucun** `?redirect=`, alors que la page de connexion sait le lire
depuis toujours (`/api/auth/google/start?redirect=…`). Le lien déposait donc son
destinataire sur `/tournois`, sans le tournoi qu'on venait de lui envoyer.

La garde rend désormais une carte « Connexion requise » en **200**
(`AuthGate`) :

- **Rien du contenu protégé ne fuit** : la mise en page ne rend pas ses enfants
  du tout. Ce n'est pas une page masquée par du CSS, c'est une page qui n'a pas
  été rendue.
- **Les métadonnées, elles, sont émises.** Next résout `generateMetadata` de
  **tout l'arbre de segments** correspondant à l'URL, indépendamment de ce qu'une
  mise en page choisit de rendre. C'est vérifié, et c'est le pivot de la
  fonctionnalité.
- **L'URL demandée est conservée**, donc le bouton de connexion la repasse en
  `?redirect=` et le visiteur revient là où on l'avait envoyé.
- L'espace sécurisé n'étant plus derrière un 307 qui l'excluait de lui-même de
  l'indexation, il porte maintenant un `robots: noindex, nofollow` explicite.

`requireCurrentUser()` disparaît de `lib/server/auth.ts` du même coup : c'était
son **unique** appelant, et une fonction qui redirige vers `/connexion` ne
décrivait plus le comportement du site.

## La rédaction (`lib/shared/share-metadata.ts`)

Module **pur** : il ne connaît ni Next.js ni Open Graph, il rend des chaînes.
L'appelant décide s'il en fait un `<meta>`, une image ou un message — et c'est ce
qui permet de tester la partie qui se trompe (la rédaction) sans monter de
serveur.

| Fonction | Rend |
| --- | --- |
| `tournamentShareTitle` | « Nom du tournoi · Overwatch » |
| `tournamentShareDescription` | Le texte de l'organisateur (borné), puis les faits |
| `tournamentShareCard` | Surtitre / titre / sous-titre / faits, pour l'image |
| `tournamentShareState` | « Inscriptions ouvertes », « Tournoi en cours »… |
| `truncateForShare` | Coupe sur un mot, aplatit les sauts de ligne |
| `formatShareDate` / `…Short` | « 14 septembre 2026 à 20:00 » / « 14 sept. 2026 · 20:00 » |

Trois décisions à connaître :

- **Le fuseau est écrit en dur (`Europe/Paris`).** Ailleurs
  (`_lib/header-meta.ts`) les dates voyagent en ISO jusqu'au navigateur, la mise
  en forme dépendant du fuseau du lecteur. Un encart de partage **n'a pas de
  lecteur** : il est rédigé une fois, côté serveur, et le même texte est servi à
  tout le monde. Faute de fuseau du lecteur, on prend celui du public visé.
- **Le texte libre passe avant les faits, mais il est borné** (160 caractères sur
  les 300 que Discord affiche). C'est la seule partie que quelqu'un a écrite pour
  être lue ; une description de trois paragraphes noierait la date et l'effectif,
  qui sont justement ce qu'on vient chercher dans un encart.
- **L'échéance annoncée dépend de l'état.** Un tournoi terminé n'a plus de coup
  d'envoi, un tournoi dont les inscriptions n'ont pas ouvert n'a pas de clôture à
  annoncer : `schedule()` rend l'intitulé *et* la date, séparés, parce que les
  deux rendus les assemblent autrement — la description en fait une phrase
  (« Inscriptions jusqu'au 16 septembre 2026 à 13:35 »), l'image en fait un
  intitulé de case et sa valeur.

## L'image (`components/og/share-card.tsx`)

Un encart sans image se réduit à trois lignes grises dans un salon ; avec image,
il occupe la largeur du salon. La carte est rendue en PNG 1200×630 par Satori
(`next/og`), côté serveur.

**Ce n'est pas un composant de l'application** — il n'est jamais monté dans un
navigateur. D'où trois contraintes qui ne sont pas des maladresses :

- tout est en `display: flex` : Satori n'implémente ni le flux normal ni la
  grille, et un `<div>` à plusieurs enfants sans `display` explicite lève ;
- les couleurs sont écrites en dur, pas en `var(--cyber-bg)` : la feuille de
  style du site n'est pas chargée pendant le rendu ;
- la taille du titre est choisie d'après sa longueur, Satori ne sachant pas
  rétrécir un texte pour qu'il tienne — un nom de tournoi va de « OW Cup » à
  soixante caractères.

Deux routes la servent :

| Route | Portée |
| --- | --- |
| `app/opengraph-image.tsx` | La carte du site |
| `app/(secured)/tournois/[id]/opengraph-image.tsx` | La carte d'un tournoi |

**Piège vérifié : la convention `opengraph-image` ne vaut que pour son propre
segment.** Contrairement à `icon`, celle de la racine n'habille que `/` — les
pages imbriquées repartaient sans image. L'image par défaut est donc désignée
explicitement, par la route qu'elle expose (`DEFAULT_SHARE_IMAGE`) : dans la mise
en page racine, pour que **toute** page en hérite (`/connexion`, qui est une page
cliente sans métadonnées à elle, en fait partie), et dans `pageMetadata`, dont le
bloc `openGraph` remplacerait sinon celui de la racine. Un segment qui pose la
sienne — la fiche d'un tournoi — garde la sienne.

Le formulaire d'édition (`[id]/modifier`) est l'exception qui confirme la règle :
il vit sous `[id]/`, donc il héritait de l'encart **du tournoi** — même titre,
`og:url` pointant sur une autre page — sans hériter de son image. Il pose un
`openGraph: null` / `twitter: null` : un écran de travail n'a pas d'encart.

La route d'un tournoi est **servie sans passer par les mises en page**, donc sans
la garde de l'espace sécurisé : elle porte sa propre application de la règle de
visibilité, par la même porte que la fiche
(`getVisibleTournamentSnapshot`, voir `TOURNAMENT_VISIBILITY_ACCESS.md`). Un
tournoi illisible retombe sur la carte du site — une image d'erreur ferait un
encart cassé, et une 404 laisserait Discord afficher un encart sans image.
`revalidate = 300` : l'effectif engagé figure sur la carte, elle vieillit.

## Le socle d'une page (`lib/shared/page-metadata.ts`)

Un appel écrit les cinq choses qui vont ensemble — titre, description, image
d'aperçu, encart de partage, URL canonique — pour qu'aucune page ne puisse en
oublier une :

```ts
export const metadata: Metadata = pageMetadata({
  title: "Règles des tournois",       // sans le nom du site : le gabarit l'ajoute
  description: "…",                    // référencement
  shareDescription: "…",               // encart, si la phrase ci-dessus est trop technique
  path: "/regles",
});
```

Le gabarit de titre vit à la racine (`%s · BlueGenji Esport`), d'où la
disparition du préfixe « BlueGenji - » que chaque page recopiait. L'encart, lui,
n'hérite d'aucun gabarit : `pageMetadata` écrit le nom du site dans son
`og:title`, sans quoi « Bénévoles » collé seul ne dirait pas de qui il parle. La
fiche d'un tournoi coupe le gabarit (`title.absolute`) : son titre porte déjà le
nom du tournoi et son jeu, et `og:site_name` annonce le reste.

## Où lire `APP_URL`

`lib/server/site-url.ts` est désormais la lecture racine ; `tournaments/app-url.ts`
en descend. Deux fonctions, deux exigences :

- `siteBaseUrl()` rend `null` quand la variable n'est pas réglée — un message
  Discord préfère ne pas porter de lien qu'en porter un inventé (règle
  inchangée) ;
- `siteMetadataBase()` doit rendre une URL **toujours**, `metadataBase` n'acceptant
  pas l'absence : sans elle, Next avertit à chaque page et sert des `og:image`
  relatives, que les robots d'aperçu ne savent pas résoudre.

**`APP_URL` doit être réglée au moment du `npm run build`**, pas seulement au
démarrage : les pages pré-rendues (`/`, `/connexion`, `/regles/[slug]`) figent
leurs URL absolues à la compilation. Bâtir sans elle produirait des encarts
pointant sur `http://localhost:3000` — visible nulle part dans les journaux, et
seulement une fois le lien collé quelque part. `start.sh` construit sur le
serveur, où le `.env` est présent : la condition est déjà remplie.

## Le vocabulaire corrigé

« BlueGenji, c'est surtout Overwatch puis Marvel Rivals » : `SITE_DESCRIPTION`
nomme les deux jeux, Overwatch en premier, et les deux introductions des textes
légaux du bot (FR et EN) ne présentent plus le projet comme une communauté Marvel
Rivals. Les sélecteurs de jeu de l'interface plaçaient déjà Overwatch en tête.

## Ce qui n'est pas couvert

- **`/connexion`** est une page cliente : elle ne peut pas exporter de
  métadonnées. Elle garde celles de la racine.
- **Les autres pages de l'espace sécurisé** (`/equipes`, `/joueurs`, `/profil`)
  n'ont pas d'encart propre : leur contenu n'est pas public, et un aperçu qui
  décrirait une page que le destinataire ne peut pas ouvrir n'apprend rien.
- **Les fiches d'équipe et de joueur** n'ont pas encore d'encart. Même raison, et
  le même mécanisme leur suffirait le jour où on le voudra.
