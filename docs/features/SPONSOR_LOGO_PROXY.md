# 🖼️ Logos de partenaires servis depuis notre origine

## Le constat

Google a passé l'accueil au crible (PageSpeed Insights, poste de bureau). Trois
notes sur quatre étaient au maximum ; la quatrième, **« Bonnes pratiques », était
à 78**, et l'écart tenait entièrement à un seul endroit de la page : la vitrine
des partenaires.

Un logo de partenaire se pose de deux façons — **importé** (fichier téléversé,
normalisé en WebP 600×200 sous `public/uploads/sponsors`, servi par
`/api/uploads/...`) ou **collé**, une URL quelconque saisie dans le champ
« … ou colle une URL » de la modale d'édition. Les seconds étaient rendus tels
quels, dans un `<img>` pointant sur le serveur d'autrui. Quatre partenaires,
quatre CDN étrangers, sur la page la plus vue du site :

| Audit                     | Constat                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `third-party-cookies`     | `__cf_bm` et `_cfuvid` posés par Cloudflare au chargement       |
| `inspector-issues`        | le même dépôt de cookie, remonté par le panneau *Issues*        |
| `uses-responsive-images`  | 40 Kio — images à leur taille d'origine dans un cadre de 400 px |
| `modern-image-formats`    | 25 Kio — un PNG là où un WebP suffisait                         |
| `offscreen-images`        | 70 Kio (mobile) — chargées alors qu'elles sont hors écran       |
| `uses-long-cache-ttl`     | durée de cache décidée par le CDN du tiers                      |

Aucun de ces six points n'était réparable sur place : **tout venait de ce que
l'image n'était pas la nôtre**. On ne choisit ni son format, ni sa taille, ni sa
durée de cache, ni ce que son serveur dépose dans le navigateur du visiteur.

## La règle

**Le `src` d'un logo de partenaire est toujours une adresse du site.**

`sponsorLogoSrc` (`lib/shared/sponsor-logo.ts`, pur) est la porte unique :

- logo **importé** → le chemin d'upload (`/api/uploads/...`) ;
- logo **collé** → le chemin du relais (`/api/landing/sponsors/<id>/logo`).

Dans les deux cas l'image devient une image du site, donc une image que
`next/image` sait redimensionner (`srcset` complet), convertir en WebP et mettre
en cache pour vingt-quatre heures — et qui ne fait plus aucune requête vers un
tiers. Les six audits passent d'un coup, et la note « Bonnes pratiques » passe de
**78 à 100**.

## Le relais — `GET /api/landing/sponsors/[id]/logo`

Public, plafonné par `LANDING_READ_RULE` comme les autres lectures de la vitrine.

Ce n'est **pas un relais d'images ouvert** : la route ne prend qu'un identifiant
de partenaire et **relit l'URL en base**. L'espace des adresses atteignables est
exactement celui des lignes que le staff `showcase` a créées — on ne peut pas lui
faire chercher une image arbitraire en lui passant une URL.

Garde-fous, tous rendus en **404** (jamais 500, jamais 403 : pour le navigateur,
« cette ligne n'a pas d'URL exploitable » et « cet identifiant n'existe pas » sont
le même fait — il n'y a pas d'image à cette adresse) :

- identifiant entier strictement positif ;
- logo **importé** → 404 aussi : `/api/uploads/...` le sert déjà, le relais n'a
  rien à faire d'un fichier à nous, et `sponsorLogoSrc` n'y renvoie jamais ;
- **`https` seulement** — une image en clair déclencherait de toute façon un
  avertissement de contenu mixte, et le relais n'a pas à aller chercher en clair
  ce que le site sert en chiffré ;
- **hôte refusé** s'il désigne la machine ou son réseau (`localhost`, `.local`,
  `.internal`, `.home.arpa`, IPv4 privées et lien-local — dont `169.254.169.254`,
  l'adresse des services de métadonnées cloud —, CGNAT, multicast, bouclage et
  adresses uniques locales IPv6). La requête part **depuis le serveur**, là où le
  navigateur la faisait depuis le poste du visiteur : une adresse interne devient
  joignable, ce qu'elle n'était pas. L'URL vient du staff, mais la confiance qu'on
  lui accorde porte sur la vitrine, pas sur le réseau de la machine ;
- **redirections suivies à la main**, trois au plus, l'hôte étant revalidé à
  chaque saut — `fetch` les suit sinon jusqu'à n'importe quelle destination, ce
  qui rendrait le filtre d'hôte contournable par une simple redirection ;
- **type d'image en liste blanche** : PNG, JPEG, WebP, GIF, AVIF. **SVG en est
  volontairement absent** — un SVG est un document scriptable, et le servir depuis
  notre origine reviendrait à laisser un tiers exécuter du script sur
  `bluegenji-esport.fr`. Le format n'est pas accepté à l'import non plus
  (`lib/server/image-upload.ts`) ;
- **5 Mio au plus** (même plafond qu'à l'import), refusé avant lecture quand le
  serveur annonce la taille, et revérifié après — un `Content-Length` peut être
  absent ou menteur ;
- **5 s de délai**, au-delà desquels la requête est abandonnée.

La réponse porte `X-Content-Type-Options: nosniff` et
`Content-Security-Policy: default-src 'none'; sandbox` : l'octet vient d'un
tiers, le navigateur ne doit ni deviner un type plus permissif que celui qu'on
annonce, ni accorder le moindre droit à la ressource si elle était ouverte
directement.

### La durée de cache n'est pas décorative

Le relais annonce `public, max-age=86400`. L'optimiseur d'images de Next la
respecte : **un logo distant n'est rechargé qu'une fois par jour et par
variante**, et non à chaque visite — sans quoi le relais aurait remplacé quatre
requêtes du navigateur par quatre requêtes du serveur, à chaque page vue. Elle
n'est pas `immutable` : le staff peut changer l'URL d'une ligne sans que son
identifiant, lui, ne change.

## Partenaires de secours

`FALLBACK_SPONSORS` (identifiants **négatifs**) n'est pas en base : le relais ne
saurait rien y relire. `sponsorLogoSrc` reste totale et rend alors l'URL telle
quelle plutôt qu'un chemin qui répondrait 404. Ces partenaires n'ont pas de logo
aujourd'hui ; la branche existe pour que la fonction ne mente pas.

## Ce que le relais ne fait pas

Il ne **recopie pas** l'image chez nous. On y a pensé — normaliser à
l'enregistrement, comme le fait l'import de fichier — mais cela n'aurait rien
réparé pour les lignes déjà en base : il aurait fallu que le staff rouvre et
réenregistre chaque partenaire pour que la page cesse d'appeler des CDN
étrangers. Le relais, lui, vaut pour l'existant sans qu'on touche à une ligne.

L'**aperçu** de la modale d'édition, lui, reste un `<img>` brut sur l'URL saisie :
il montre une adresse que personne n'a encore enregistrée, donc qu'aucun
identifiant ne désigne. Il n'est visible que du staff, et jamais dans la page
publique.

## Fichiers

| Fichier                                       | Rôle                                    |
| --------------------------------------------- | --------------------------------------- |
| `lib/shared/sponsor-logo.ts`                   | pur — choix du `src`, filtres d'URL      |
| `app/api/landing/sponsors/[id]/logo/route.ts`  | le relais                                |
| `components/cyber/landing/SponsorsGrid.tsx`    | `<Image fill sizes=…>` sur ce `src`      |
| `tests/lib/shared/sponsor-logo.test.ts`        | logique pure                             |
| `tests/app/api/landing/sponsor-logo-proxy.test.ts` | la route, refus compris              |

Voir aussi [SPONSOR_MANAGEMENT.md](SPONSOR_MANAGEMENT.md).
