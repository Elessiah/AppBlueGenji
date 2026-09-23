import { afterEach, describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { BotHero } from "@/components/bot/BotHero";
import { BotInviteCard } from "@/components/bot/BotInviteCard";
import { BotStatusStrip } from "@/components/bot/BotStatusStrip";
import { BOT_INVITE_SCOPES } from "@/lib/server/bot-invite";

/**
 * Les derniers restes de la maquette de `/bot` : des valeurs que rien ne
 * mesure et que le site affichait comme des faits. Chaque cas vérifie
 * l'absence de l'invention **et** la présence de ce qui la remplace — un
 * `not.toContain` seul passerait aussi sur une case vide.
 */
const originalPermissions = process.env.DISCORD_BOT_PERMISSIONS;

afterEach(() => {
  if (originalPermissions === undefined) delete process.env.DISCORD_BOT_PERMISSIONS;
  else process.env.DISCORD_BOT_PERMISSIONS = originalPermissions;
});

describe("BotStatusStrip — ne publie aucune mesure inventée", () => {
  const html = renderToStaticMarkup(<BotStatusStrip status={null} />);

  it("ne promet aucune disponibilité sur 90 jours", () => {
    expect(html).not.toContain("99.97");
    expect(html).not.toContain("90 derniers jours");
    expect(html).toContain("Depuis le dernier démarrage");
  });

  it("ne nomme ni hébergeur ni sharding que le bot ne fait pas", () => {
    expect(html).not.toContain("Gravelines");
    expect(html).not.toContain("Auto-sharding");
    expect(html).toContain("Passerelle Discord");
  });
});

describe("BotHero — ne se donne ni identifiant ni statut inventés", () => {
  const html = renderToStaticMarkup(<BotHero />);

  it("n'affiche plus de discriminant ni de « vérifié »", () => {
    expect(html).not.toContain("#8242");
    expect(html).not.toContain("VÉRIFIÉ");
    // Le badge d'application, lui, est vrai : c'est un bot.
    expect(html).toContain("APP");
  });

  it("habille ses deux appels à l'action par des classes qui existent", () => {
    expect(html).not.toMatch(/btn-(primary|ghost)/);
    expect(html).toContain('href="/bot/docs"');
    expect(html).toContain("Inviter sur mon serveur");
  });
});

describe("Scopes — affichés depuis la liste que l'URL envoie", () => {
  it("dit dans le héros et la carte les scopes de l'invitation", () => {
    const label = BOT_INVITE_SCOPES.map((s) => s.toUpperCase()).join(" + ");
    expect(renderToStaticMarkup(<BotHero />)).toContain(`OAUTH2 · ${label} · GRATUIT`);
    expect(renderToStaticMarkup(<BotInviteCard />)).toContain(`SCOPES · ${label}`);
  });
});

describe("BotInviteCard — les permissions se lisent sur l'entier envoyé", () => {
  it("affiche ce que le défaut demande réellement", () => {
    delete process.env.DISCORD_BOT_PERMISSIONS;
    const html = renderToStaticMarkup(<BotInviteCard />);
    expect(html).toContain("Exclure temporairement des membres");
    expect(html).toContain("MODERATE_MEMBERS");
    expect(html).toContain("1099511627776");
    // …et plus aucune des cinq lignes écrites à la main.
    expect(html).not.toContain("Mentionner @everyone");
    expect(html).not.toContain("READ_HISTORY");
  });

  it("suit la variable d'environnement", () => {
    process.env.DISCORD_BOT_PERMISSIONS = String((1 << 11) | (1 << 17));
    const html = renderToStaticMarkup(<BotInviteCard />);
    expect(html).toContain("Envoyer des messages");
    expect(html).toContain("Mentionner @everyone");
    expect(html).not.toContain("MODERATE_MEMBERS");
  });

  it("dit qu'une valeur est illisible plutôt que d'annoncer « aucune permission »", () => {
    process.env.DISCORD_BOT_PERMISSIONS = "administrateur";
    const html = renderToStaticMarkup(<BotInviteCard />);
    expect(html).toContain("Valeur de permissions illisible");
    expect(html).not.toContain("Aucune permission de serveur");
  });

  it("dit qu'aucune permission n'est demandée sur zéro", () => {
    process.env.DISCORD_BOT_PERMISSIONS = "0";
    const html = renderToStaticMarkup(<BotInviteCard />);
    expect(html).toContain("Aucune permission de serveur");
  });

  it("décrit le message de bienvenue pour ce qu'il est", () => {
    const html = renderToStaticMarkup(<BotInviteCard />);
    // Pas d'assistant dans le serveur : un message privé au propriétaire.
    expect(html).not.toContain("wizard");
    expect(html).not.toContain("90 SECONDES");
    expect(html).toContain("en privé au propriétaire du serveur");
    // …sans promettre un message que des messages privés fermés arrêtent.
    expect(html).toContain("s&#x27;il accepte les messages privés");
  });
});
