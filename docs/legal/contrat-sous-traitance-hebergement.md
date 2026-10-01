# Contrat de sous-traitance — hébergement technique du site et du bot

**Projet — à relire, compléter et signer.** Ce texte met en forme les clauses
que l'article 28, paragraphe 3, du règlement (UE) 2016/679 (RGPD) exige d'un
contrat entre un responsable du traitement et son sous-traitant. Il n'est **pas
en vigueur** tant qu'il n'est pas daté et signé par les deux parties : le
registre des traitements (`lib/shared/processing-register.ts`,
`HOST_PROCESSING_AGREEMENT`) le dit « rédigé, en attente de signature », et
devra être mis à jour le jour de la signature.

Les passages entre crochets `[…]` sont à compléter.

---

## Entre les soussignés

**Le responsable du traitement** : l'association **Bluegenji Esport**,
association loi 1901, dont le siège est 4 impasse des Cyprès, 51210 Janvilliers,
France, représentée par [nom], en sa qualité de Président·e,
ci-après « l'Association » ;

**Le sous-traitant** : **Keryan Houssin**, particulier, bénévole de
l'association, demeurant 13 rue du Chemin Fourchue, 14000 Caen, France,
ci-après « l'Hébergeur ».

## Article 1 — Objet

L'Hébergeur héberge et administre, pour le compte de l'Association, le site
BlueGenji Esport, son bot Discord et leurs bases de données, sur une machine
(Raspberry Pi) installée à Caen, en France, et en réalise les sauvegardes.
Le présent contrat fixe les conditions dans lesquelles il traite les données
personnelles que l'Association lui confie à ce titre (RGPD, art. 28).

La mission est bénévole ; le présent contrat ne crée aucune rémunération.

## Article 2 — Description du traitement confié

- **Nature des opérations** : hébergement, stockage, sauvegarde, restauration,
  administration technique (mises à jour, surveillance, diagnostic), réponse
  technique aux réquisitions et aux demandes d'exercice des droits sur
  instruction de l'Association.
- **Finalités** : celles des traitements décrits au registre des traitements de
  l'Association (fiches T01 à T17, publiées sur `/rgpd/registre`), pour la
  seule part que l'hébergement technique exige.
- **Catégories de données** : celles décrites au registre (comptes joueurs et
  profils, identifiants de connexion, résultats de tournois, signalements,
  journal des données de connexion, journaux techniques, sauvegardes…). Aucune
  donnée sensible au sens de l'article 9 du RGPD.
- **Personnes concernées** : joueurs, membres d'équipe, staff, visiteurs du
  site, utilisateurs Discord des serveurs où le bot est installé.
- **Durée** : celle de la mission d'hébergement (article 11).

## Article 3 — Instructions documentées (art. 28.3.a)

L'Hébergeur ne traite les données que sur instruction documentée de
l'Association, y compris pour les transferts hors de l'Union européenne. Le
code du site et ses documents (registre, politique de confidentialité,
documentation de déploiement) valent instructions documentées ; toute autre
instruction est donnée par écrit (courriel ou message conservé).

Si l'Hébergeur est tenu par le droit de l'Union ou d'un État membre de
procéder à un traitement, il en informe l'Association avant de le faire, sauf
si ce droit l'interdit. Il l'informe immédiatement si une instruction lui paraît
contraire au RGPD ou à une autre disposition de protection des données.

L'Hébergeur est aussi, par ailleurs, la personne que l'Association a chargée
de recevoir les demandes relatives aux données ; il les transmet à
l'Association, qui reste responsable de la réponse.

## Article 4 — Confidentialité (art. 28.3.b)

L'Hébergeur garantit la confidentialité des données. Toute personne qu'il
autoriserait à y accéder s'engage à la confidentialité ou est soumise à une
obligation légale appropriée de confidentialité. À la date du présent contrat,
l'Hébergeur est la seule personne disposant d'un accès administrateur au
serveur.

## Article 5 — Sécurité (art. 28.3.c et art. 32)

L'Hébergeur met en œuvre les mesures décrites au registre, notamment :

- accès au serveur par clé SSH seulement, bannissement automatique des
  tentatives échouées ;
- chiffrement des échanges (HTTPS) ;
- sauvegardes chiffrées **sur le serveur avant tout envoi** (`age` pour les
  archives de la base, remote `rclone` de type `crypt` pour les images, les
  logos masqués et le journal des suppressions), déposées sur un stockage en
  ligne qui ne reçoit aucune clé ; conservation limitée à la durée annoncée ;
- clés de déchiffrement (clé privée des archives, mot de passe `rclone` et sa
  copie de secours) détenues par l'Hébergeur, Keryan Houssin, seul à les
  détenir, et conservées hors du serveur ;
- rejeu des suppressions de compte avant toute remise en service après une
  restauration.

## Article 6 — Sous-traitants ultérieurs (art. 28.2 et 28.3.d)

L'Association autorise l'Hébergeur à recourir aux services suivants :

| Service | Rôle | Cadre |
|---|---|---|
| Hetzner Online GmbH (Allemagne) — Storage Share (Nextcloud géré) | Stockage des sauvegardes **chiffrées avant envoi** (depuis le 1er octobre 2026) | Contrat de traitement des données de Hetzner (Data Processing Agreement, version 1.2), accepté par l'Hébergeur le 1er octobre 2026 ; traitement exclusivement dans l'Union européenne / l'EEE (§ 3), donc aucun transfert hors de l'Union |

Le contrat signé avec Hetzner est conservé par l'Hébergeur et tenu à la
disposition de l'Association ; il n'est pas reproduit ici. Le stockage
OneDrive (compte Microsoft personnel, sans contrat de sous-traitance) utilisé
jusqu'au 30 septembre 2026 n'est plus un sous-traitant autorisé : l'Hébergeur
en efface définitivement les copies restantes.

L'Hébergeur informe l'Association de tout ajout ou remplacement d'un
sous-traitant ultérieur, qui peut s'y opposer. Il impose à tout sous-traitant
ultérieur les obligations du présent contrat dans la mesure où le service
retenu le permet, et demeure responsable de leur exécution envers
l'Association.

## Article 7 — Droits des personnes (art. 28.3.e)

L'Hébergeur aide l'Association, par des mesures techniques appropriées, à
répondre aux demandes d'exercice des droits (accès, rectification,
effacement, limitation, portabilité, opposition) : export des données d'un
compte, suppression ou anonymisation, extraction du journal des données de
connexion sur réquisition.

## Article 8 — Assistance (art. 28.3.f)

L'Hébergeur aide l'Association à respecter ses obligations des articles 32 à
36 du RGPD, compte tenu des informations dont il dispose. En particulier, il
notifie à l'Association toute violation de données personnelles **dans les
meilleurs délais, et au plus tard [24] heures** après en avoir pris
connaissance, avec les informations dont il dispose (nature de la violation,
données et personnes concernées, conséquences probables, mesures prises), pour
permettre à l'Association de notifier la CNIL dans les 72 heures (art. 33).

## Article 9 — Sort des données en fin de contrat (art. 28.3.g)

Au terme de la mission, l'Hébergeur, au choix de l'Association, lui restitue
toutes les données (export des bases et des fichiers téléversés) ou les
transfère à l'hébergeur qu'elle désigne, puis détruit toutes les copies — y
compris les sauvegardes, à leur échéance au plus tard —, sauf si le droit de
l'Union ou d'un État membre en exige la conservation (notamment le journal des
données de connexion jusqu'à son échéance légale). Il atteste par écrit de la
destruction.

## Article 10 — Audit et information (art. 28.3.h)

L'Hébergeur met à la disposition de l'Association toutes les informations
nécessaires pour démontrer le respect du présent contrat, et permet la
réalisation d'audits par l'Association ou un auditeur qu'elle mandate.

## Article 11 — Durée

Le présent contrat prend effet à sa signature et dure autant que la mission
d'hébergement. Chaque partie peut y mettre fin par écrit avec un préavis de
[un mois], l'article 9 s'appliquant alors.

---

Fait à [lieu], le [date], en deux exemplaires.

| Pour l'Association | L'Hébergeur |
|---|---|
| [nom, qualité] | Keryan Houssin |
| Signature : | Signature : |
