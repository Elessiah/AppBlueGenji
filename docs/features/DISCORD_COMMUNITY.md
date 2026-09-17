# Invitation Discord et compteur de membres

Deux choses qui n'en font qu'une : **le site ne connaît qu'un serveur Discord**,
et il dit combien de monde s'y trouve.

## 1. Une invitation, écrite une fois

### Le symptôme

Trois adresses différentes cohabitaient dans le dépôt, réparties sur neuf
fichiers :

| Adresse | Où |
| --- | --- |
| `discord.gg/bluegenji` | accueil (`JoinCTA`, `PublicFooter`), `/association`, `/mentions-legales`, `structured-data.ts`, `contact.ts`, `seed.ts` |
| `discord.gg/VPGZ4eBfwN` | `/connexion` |
| `discord.gg/5kG9DDKx` | pages légales du bot |

Aucune n'était celle de l'association.

### Pourquoi personne ne l'avait vu

C'est la panne la plus silencieuse qui soit : **une invitation périmée
fonctionne**. Elle mène quelque part, aucune page ne rend d'erreur, aucun test
unitaire ne peut la contredire — il n'existe pas d'assertion « ce lien mène au
bon serveur » qu'on puisse écrire sans déjà connaître la réponse. Le visiteur
atterrit ailleurs, et rien ne le signale à personne.

### Le correctif

`lib/shared/discord.ts` porte l'adresse, et elle n'est plus écrite nulle part
ailleurs. Le **code** y est isolé de l'URL parce qu'il sert deux fois : à
composer le lien affiché, et à interroger l'API des invitations pour le
compteur.

Deux constantes qui portaient une copie la **réexportent** désormais plutôt que
de la recopier : `ORGANIZATION_DISCORD_URL` (le `sameAs` du JSON-LD — une
divergence y enverrait les moteurs vers un autre serveur que les visiteurs) et
`DEFAULT_CONTACT.discordUrl` (le secours de la page contact).

### Le contrôle

`tests/lib/shared/discord-invite-single-source.test.ts` **balaie les sources**
(`app`, `components`, `lib` — 420 fichiers) et exige qu'aucun `discord.gg/`
littéral ne subsiste hors de `lib/shared/discord.ts`. C'est le seul contrôle
capable de voir cette panne-là : une quatrième adresse qui apparaîtrait
tomberait ici plutôt qu'en production.

### Le cas qui n'est pas du code

Le lien du pied de page est une **donnée éditable**
(`bg_settings.contact_discord_url`), pas une constante : corriger le code ne
corrige pas une installation où l'ancienne adresse a été enregistrée un jour.
D'où un rattrapage dans `lib/server/database.ts`, qui remplace les
`SUPERSEDED_DISCORD_INVITE_URLS` — **et seulement celles-là**. Une adresse que le
staff a choisie lui appartient ; l'écraser à chaque démarrage ferait de ce champ
un leurre. Après un passage, l'instruction ne trouve plus rien.

## 2. Le compteur de membres

Sur l'accueil, à la suite des trois chiffres du site (joueurs, équipes,
tournois), un quatrième bloc : le nombre de membres du Discord, le nombre de
connectés, et le bouton pour rejoindre.

### Par l'invitation, pas par le bot

`GET https://discord.com/api/v10/invites/{code}?with_counts=true` est public :
ni jeton, ni identifiant de guilde, ni bot présent sur le serveur. Trois raisons
de le préférer au canal interne (`bot-integration.ts`), qui saurait pourtant
répondre :

1. **Le bot peut être injoignable.** Il l'est en développement, et l'accueil
   afficherait alors un trou là où il tient une promesse de communauté.
2. **Discord publie déjà la donnée.** Une route interne de plus pour la
   rapatrier serait du travail pour rien.
3. **Surtout : on compte le serveur que le bouton d'à côté fait rejoindre.** Le
   code de l'invitation est la seule chose que le site connaisse de ce serveur.
   Un identifiant de guilde rangé en parallèle dériverait au premier changement
   d'invitation, et le site annoncerait la fréquentation d'un serveur vers lequel
   il ne mène plus.

Les deux nombres sont **approximatifs**, et c'est le mot de Discord, pas une
précaution de notre part : ses champs s'appellent `approximate_member_count` et
`approximate_presence_count`.

### Jamais d'exception, jamais de zéro

`getDiscordCommunity()` rend `null` au moindre accroc — réseau, délai dépassé,
plafonnement, invitation inconnue, corps illisible. Pour l'appelant, tous ces
cas sont le même fait : on ne sait pas combien nous sommes.

`parseDiscordCommunityStats` applique la même règle à l'étage au-dessus :
`null` plutôt qu'un objet à zéro. « Discord n'a rien dit » et « le serveur est
vide » ne sont pas le même fait, et le second est faux. **Zéro membre affiché
sur la page la plus vue du site serait un mensonge que rien ne corrigerait.**

Un zéro que Discord **dit**, en revanche, est une donnée : il passe.

### Le cache

Clé `discord:community`, cinq minutes, vol unique — et **hors du préfixe
`landing:`**, ce qui n'est pas un détail. `invalidateLandingAggregates()` vide ce
préfixe à chaque écriture de tournoi : un score reporté jetterait sinon le
compteur Discord, qui n'a rien à voir avec le tournoi, et relancerait un appel
sortant.

**Le refus est mis en cache lui aussi**, et c'est voulu. `cached()` ne retient
pas une promesse rejetée, mais ici un refus se traduit par un `null` *résolu*,
donc conservé cinq minutes. C'est exactement ce qu'on veut d'un plafonnement :
retenter à chaque rendu de page ferait durer la sanction au lieu de la purger.

L'accueil étant rendu à chaque visite (`force-dynamic`), sans cette
mutualisation chaque visiteur ferait partir un appel vers Discord — qui nous
plafonnerait, et le compteur s'éteindrait pour tout le monde au moment précis où
il y a du monde.

### Deux chargements, deux dégradations

`loadLandingStats` lance la requête SQL et l'appel Discord **de front**, et les
deux tombent séparément : une base injoignable garde le compteur Discord, un
Discord muet garde les chiffres du site. Les enchaîner ajouterait en plus le
délai de l'appel sortant au rendu d'une page déjà dynamique.

## 3. Le bloc

`components/cyber/landing/DiscordCommunity.tsx`.

**Le bloc entier est le lien.** Pas un chiffre à côté d'un bouton : deux cibles
voisines qui mènent au même endroit, dont une minuscule, c'est une cible ratée
sur mobile. Le libellé « Rejoindre le Discord » lui donne son affordance de
bouton — d'où un `<span>` et non un `<button>` ou un second `<a>`, imbriquer
l'un ou l'autre dans une ancre étant interdit (et, pour l'ancre, une casse
d'hydratation).

**Aucun `aria-label`.** Le nom accessible se compose du texte visible, qui
contient déjà « Rejoindre le Discord ». Un libellé posé à la main **remplace** ce
texte, et la commande vocale ne répond alors plus à ce qu'on lit sur le lien
(WCAG 2.5.3) — le piège que la vitrine a déjà payé deux fois (voir la marque de
l'en-tête et le bouton « Regarder le live »).

**Sans chiffre, la barre reste.** Le bouton est la raison d'être du bloc, le
compteur n'en est que l'argument. Un Discord injoignable retire l'argument, pas
l'invitation : le bloc bascule alors sur « Communauté BlueGenji ».

**La présence ne s'affiche que si elle est > 0.** Le champ de présence peut
manquer là où le total ne manque pas (`onlineCount` vaut alors 0) ; « 0 en
ligne » sur un serveur actif serait un contresens.

### Le blurple

C'est la seule teinte non glacier de la vitrine, et elle est là parce qu'elle
*nomme* : sur une page entièrement bleu-ciel, c'est ce qui fait reconnaître
Discord avant d'avoir lu le mot. Elle reste froide (le système bannit les
chauds), et elle ne sort pas de ce bloc — d'où des variables locales au module
CSS plutôt qu'un token global, qu'un autre écran finirait par emprunter.

### L'emblème

`public/discord-white-icon.webp`, servi depuis le dépôt et rendu par
`next/image` — jamais depuis un CDN Discord. Deux raisons : `img-src 'self'
data: blob:` le refuserait (la CSP est en **application**), et une image tierce
ferait partir une requête du navigateur du **visiteur** vers Discord, à chaque
vue. C'est exactement la fuite refermée pour les avatars Google.

`alt=""` : le mot « Discord » est écrit juste à côté, le répéter le ferait
annoncer deux fois.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `lib/shared/discord.ts` | L'invitation, les adresses périmées, la lecture de la réponse Discord (pur) |
| `lib/server/discord-community.ts` | L'appel sortant et son cache |
| `lib/server/landing-service.ts` | Joint la fréquentation aux compteurs du site |
| `lib/shared/landing.ts` | `LandingStats.discord` |
| `components/cyber/landing/DiscordCommunity.tsx` | Le bloc de l'accueil |
| `components/cyber/landing/Hero.tsx` | L'y pose, sous les trois chiffres |
| `lib/server/database.ts` | Rattrapage du lien stocké en base |
