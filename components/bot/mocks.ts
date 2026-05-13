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
