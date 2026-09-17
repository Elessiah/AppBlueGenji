import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscordCommunity } from "@/components/cyber/landing/DiscordCommunity";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";

/**
 * Le bloc Discord de l'accueil : un compteur **et** une invitation.
 *
 * Les deux moitiés n'ont pas le même statut, et c'est tout l'objet de ces
 * tests : le chiffre est un argument, l'invitation est la raison d'être du
 * bloc. Discord injoignable retire le premier, jamais la seconde.
 */

function render(stats: Parameters<typeof DiscordCommunity>[0]["stats"]) {
  return renderToStaticMarkup(<DiscordCommunity stats={stats} />);
}

/** Texte visible, balises retirées — ce que le lecteur lit, et ce que la
 *  commande vocale prononce. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

describe("DiscordCommunity", () => {
  it("mène à l'invitation canonique, en nouvel onglet protégé", () => {
    const markup = render({ memberCount: 1284, onlineCount: 213 });

    expect(markup).toContain(`href="${DISCORD_INVITE_URL}"`);
    expect(markup).toContain('target="_blank"');
    // `noopener` : la page ouverte ne doit pas garder la main sur la nôtre.
    expect(markup).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it("affiche les deux compteurs, mis en forme en français", () => {
    const markup = render({ memberCount: 1284, onlineCount: 213 });
    const text = visibleText(markup);

    // `toLocaleString("fr-FR")` insère une espace insécable : on cherche le
    // nombre sans présumer laquelle.
    expect(text).toMatch(/1\s*284/);
    expect(text).toMatch(/213\s*en ligne/);
    expect(text).toContain("Membres Discord");
  });

  it("se tait sur la présence quand Discord ne l'a pas donnée", () => {
    // `onlineCount: 0` sur un serveur actif signifie « champ absent », pas
    // « personne » : l'annoncer serait un contresens.
    expect(visibleText(render({ memberCount: 1284, onlineCount: 0 }))).not.toContain("en ligne");
  });

  it("garde le bouton quand Discord n'a pas répondu", () => {
    const markup = render(null);

    expect(markup).toContain(`href="${DISCORD_INVITE_URL}"`);
    expect(visibleText(markup)).toContain("Rejoindre le Discord");
  });

  it("n'affiche jamais un décompte inventé en l'absence de réponse", () => {
    // La panne à éviter : « 0 membres » sur la page la plus vue du site.
    expect(visibleText(render(null))).not.toMatch(/\b0\b/);
    expect(visibleText(render(null))).not.toContain("Membres Discord");
  });

  it("porte son texte visible dans son nom accessible (WCAG 2.5.3)", () => {
    // Un `aria-label` posé à la main **remplacerait** le texte du lien, et la
    // commande vocale ne répondrait plus à ce qu'on lit dessus. Le bloc n'en
    // pose aucun : son nom accessible est le texte lui-même.
    const markup = render({ memberCount: 1284, onlineCount: 213 });

    expect(markup).not.toContain("aria-label");
    expect(visibleText(markup)).toContain("Rejoindre le Discord");
  });

  it("est un lien unique, sans ancre ni bouton imbriqué", () => {
    // Toute la barre se clique : deux cibles voisines vers la même destination
    // en feraient une de trop, et une ancre dans une ancre casse l'hydratation.
    const markup = render({ memberCount: 1284, onlineCount: 213 });

    expect(markup.match(/<a\b/g)).toHaveLength(1);
    expect(markup).not.toContain("<button");
  });

  it("rend l'emblème en décoration, le mot « Discord » étant déjà écrit", () => {
    const markup = render({ memberCount: 1284, onlineCount: 213 });
    const img = markup.match(/<img\b[^>]*>/g) ?? [];

    expect(img).toHaveLength(1);
    expect(img[0]).toMatch(/alt=""/);
  });

  it("sert l'emblème depuis le dépôt, jamais depuis un CDN Discord", () => {
    // `img-src 'self' data: blob:` : une image tierce serait refusée par la
    // CSP — et ferait partir une requête du navigateur du visiteur vers Discord.
    const markup = render({ memberCount: 1284, onlineCount: 213 });

    expect(markup).not.toMatch(/src="https?:\/\//);
    expect(existsSync(join(__dirname, "..", "..", "public", "discord-white-icon.webp"))).toBe(true);
  });
});
