export const ACTIVITY = [
  12, 18, 9, 14, 22, 31, 27,
  19, 24, 16, 21, 33, 41, 38,
  28, 34, 29, 22, 19, 26, 35,
  44, 39, 31, 28, 36, 42, 48,
  37, 46,
];

export const SCRIMS = [
  2, 3, 1, 2, 4, 6, 5,
  3, 4, 3, 2, 5, 7, 6,
  4, 5, 4, 3, 3, 4, 6,
  8, 7, 5, 4, 6, 7, 9,
  6, 8,
];

export const SERVERS = [
  { rank: 1, name: "Overwatch FR — Officiel", members: 8420, relays: 142, status: "ok", trend: [3,4,5,4,6,7,5,8,9,8], c: "#5ac8ff" },
  { rank: 2, name: "Marvel Rivals France", members: 5210, relays: 98, status: "ok", trend: [2,3,4,3,5,6,5,7,8,9], c: "#f5a524" },
  { rank: 3, name: "BlueGenji · Asso", members: 4212, relays: 88, status: "ok", trend: [4,5,4,6,5,7,8,7,9,8], c: "#8fd5ff" },
  { rank: 4, name: "Tank Mains FR", members: 2840, relays: 47, status: "ok", trend: [1,2,3,2,4,3,5,4,6,5], c: "#b48fff" },
  { rank: 5, name: "Support Café", members: 1920, relays: 31, status: "lag", trend: [2,3,2,4,3,2,4,3,5,4], c: "#6bd48a" },
  { rank: 6, name: "DPS Diff Club", members: 1540, relays: 24, status: "ok", trend: [1,2,2,3,2,4,3,4,3,5], c: "#ff8aa8" },
  { rank: 7, name: "Genji Mains Hideout", members: 1180, relays: 18, status: "ok", trend: [1,1,2,2,3,2,3,4,3,4], c: "#5ac8ff" },
  { rank: 8, name: "Coaches Atelier", members: 860, relays: 14, status: "off", trend: [1,2,1,2,1,3,2,1,2,1], c: "#f5a524" },
];

export const FEED = [
  { ts: "00:42:18", tag: "relay", msg: "Overwatch FR → BlueGenji · Asso · scrim posté" },
  { ts: "00:42:01", tag: "auth", msg: "Lien Discord OAuth · kairos#7421" },
  { ts: "00:41:33", tag: "scrim", msg: "Match proposé · Neon Drift vs Static Wolves · BO3" },
  { ts: "00:41:12", tag: "recr", msg: "Recrutement · Tank flex recherché par Ion Break" },
  { ts: "00:40:48", tag: "relay", msg: "Marvel Rivals FR → 4 serveurs · tournoi annoncé" },
  { ts: "00:40:21", tag: "auth", msg: "Renouvellement token · void.pulse" },
  { ts: "00:39:57", tag: "scrim", msg: "Annulation · Paper Tigers indisponible" },
  { ts: "00:39:33", tag: "relay", msg: "Support Café → Coaches Atelier · coaching ouvert" },
  { ts: "00:39:02", tag: "warn", msg: "Rate-limit · DPS Diff Club (12 msg/min)" },
  { ts: "00:38:41", tag: "recr", msg: "Annonce staff · Arbitre Rivals · 2 candidatures" },
  { ts: "00:38:14", tag: "auth", msg: "Lien Discord OAuth · blue.hour" },
  { ts: "00:37:48", tag: "relay", msg: "BlueGenji · Asso → 8 serveurs · résultat publié" },
  { ts: "00:37:22", tag: "scrim", msg: "Confirmation · Kairos vs Midnight Koi" },
];

export const MODULES = [
  { tag: "01 · ANNONCES", title: "Relais inter-serveurs", desc: "Synchronisation des channels affiliés pour diffuser scrims, recrutements et événements à la communauté entière.", on: true, meta: "1 248 relais · 30j", icon: "relay" },
  { tag: "02 · SCRIMS", title: "Matchmaking d'équipes", desc: "Système de proposition et de matching automatique pour organiser tes scrimmages par niveau.", on: true, meta: "94 matchs · 30j", icon: "swords" },
  { tag: "03 · RECRUTEMENT", title: "Staff & joueurs", desc: "Poste ta recherche d'équipe, de coach ou de staff sur plusieurs serveurs en une commande.", on: true, meta: "37 annonces actives", icon: "user" },
  { tag: "04 · NOTIFICATIONS", title: "Tournois en direct", desc: "Reçois un ping au démarrage de ton bracket et suis les résultats en temps réel sur ton serveur.", on: true, meta: "Live · sub 800ms", icon: "bell" },
  { tag: "05 · AUTHENTIFICATION", title: "Discord OAuth", desc: "Connexion unifiée en deux clics au site BlueGenji via ton compte Discord, sans mot de passe.", on: true, meta: "2 380 comptes liés", icon: "key" },
  { tag: "06 · STATISTIQUES", title: "Analytics & ranking", desc: "Tableau de bord des matchs, wins/losses et progression sur 30 jours pour chaque joueur lié.", on: false, meta: "Beta · opt-in", icon: "chart" },
];

export const COMMANDS = [
  { glyph: "›", syntax: "/ping", desc: "Vérifie la latence et la connexion du bot.", key: "PUBLIC" },
  { glyph: "⚔", syntax: "/scrim <jeu> <niveau>", desc: "Propose ton équipe pour un scrimmage.", key: "PUBLIC" },
  { glyph: "✺", syntax: "/recrute <rôle>", desc: "Publie une recherche d'équipe ou de staff.", key: "PUBLIC" },
  { glyph: "↯", syntax: "/link", desc: "Lie ton compte Discord à ton profil BlueGenji.", key: "PUBLIC" },
  { glyph: "▦", syntax: "/stats [joueur]", desc: "Affiche tes stats — ou celles d'un autre.", key: "PUBLIC" },
  { glyph: "?", syntax: "/help", desc: "Liste toutes les commandes disponibles.", key: "PUBLIC" },
  { glyph: "✦", syntax: "/relay <channel>", desc: "Configure un channel de relais inter-serveurs.", key: "ADMIN" },
  { glyph: "⚙", syntax: "/config <module>", desc: "Active ou désactive un module du bot.", key: "ADMIN" },
];
