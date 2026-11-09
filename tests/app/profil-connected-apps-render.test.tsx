import { describe, expect, it, jest } from "@jest/globals";

// Le panneau des autres sessions lit l'API au montage : seules les lignes de
// la liste intéressent ces tests.
jest.mock("@/app/(secured)/profil/OtherSessionsPanel", () => ({
  OtherSessionsPanel: () => <div data-testid="sessions" />,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { ConnectedAppsSection } from "@/app/(secured)/profil/ConnectedAppsSection";
import { ToastProvider } from "@/components/ui/toast";
import type { AccountConnection } from "@/lib/shared/account-connections";

/**
 * « Applications connectées », rendue côté serveur : ce que chaque ligne dit
 * et propose selon l'état des rattachements.
 */
function render(connections: AccountConnection[] | null, identity = IDENTITY): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <ConnectedAppsSection identity={identity} connections={connections} reload={async () => undefined} />
    </ToastProvider>,
  );
}

const IDENTITY = {
  discordKnown: true,
  discordHasTag: false,
  discordVerified: false,
  battletagKnown: true,
  battletagFromBlizzard: false,
  onCertifyDiscord: () => undefined,
};

const google = (linked: boolean): AccountConnection => ({ provider: "GOOGLE", linked, method: null, handle: null });
const blizzard = (linked: boolean, handle: string | null = null): AccountConnection => ({
  provider: "BLIZZARD",
  linked,
  method: null,
  handle,
});
const discord = (
  linked: boolean,
  method: AccountConnection["method"] = null,
  handle: string | null = null,
): AccountConnection => ({ provider: "DISCORD", linked, method, handle });

describe("ConnectedAppsSection — rendu des lignes", () => {
  it("annonce le chargement tant que la liste n'est pas lue", () => {
    const html = render(null);
    expect(html).toContain("Chargement…");
    expect(html).not.toContain("table-row");
  });

  it("propose de rattacher un fournisseur absent, avec sa note", () => {
    const html = render([google(true), discord(false), blizzard(false)]);
    expect(html).toContain('aria-label="Lier Discord à mon compte"');
    expect(html).toContain('aria-label="Lier Blizzard à mon compte"');
    expect(html).toContain("Connexion, et ton BattleTag tenu à jour par Blizzard.");
    // La pastille et qui lit un BattleTag masqué : derrière le « i » de la ligne.
    expect(html).toContain('aria-controls="connection-more-blizzard"');
    expect(html).toContain("BattleTag vérifié");
    expect(html).toContain('aria-describedby="connection-details-blizzard"');
  });

  it("dit la dernière porte au lieu du bouton Retirer", () => {
    const html = render([google(true), discord(false), blizzard(false)]);
    expect(html).not.toContain("Retirer Google de mon compte");
    expect(html).toContain('id="connection-details-google"');
    expect(html).toMatch(/color:var\(--amber\)/);
  });

  it("affiche le pseudo du fournisseur et offre le retrait quand d'autres portes restent", () => {
    const html = render([google(true), discord(false), blizzard(true, "Nova#1234")]);
    expect(html).toContain("BattleTag : Nova#1234");
    expect(html).toContain('aria-label="Retirer Blizzard de mon compte"');
    expect(html).toContain('aria-label="Retirer Google de mon compte"');
    expect(html).toContain(">Retirer</button>");
  });

  it("nomme la porte Discord et la joint à la description du bouton", () => {
    const html = render([google(true), discord(true, "OAUTH", "nova"), blizzard(false)]);
    expect(html).toContain("Rattaché par le bouton Discord");
    expect(html).toContain('id="connection-method-discord"');
    expect(html).toContain('aria-describedby="connection-details-discord connection-method-discord"');
  });

  it("rattachement Discord par code : la ligne du bouton propose d'ajouter l'autorisation", () => {
    const html = render([google(true), discord(true, "DM_CODE", "nova"), blizzard(false)]);
    expect(html).toContain(
      "Ton Discord est rattaché par code. Le bouton y ajoute l&#x27;autorisation Discord — avec le même compte Discord.",
    );
    expect(html).toContain('aria-label="Lier Discord à mon compte"');
    expect(html).not.toContain('id="connection-method-discord"');
  });

  it("dit « Rattaché » sans pseudo à afficher", () => {
    const html = render([google(true), discord(false), blizzard(true)]);
    expect(html).toMatch(/id="connection-details-google"[^>]*>Rattaché</);
    expect(html).toMatch(/id="connection-details-blizzard"[^>]*>Rattaché</);
  });

  it("rend la ligne du bot sous celle de Discord, et seulement elle", () => {
    const html = render([google(true), discord(false), blizzard(false)]);
    expect(html.match(/Bot Discord \(code par message privé\)/g)).toHaveLength(1);
    expect(html.indexOf("connection-details-discord")).toBeLessThan(html.indexOf("Bot Discord"));
    expect(html.indexOf("Bot Discord")).toBeLessThan(html.indexOf("connection-details-blizzard"));
  });
});

describe("ConnectedAppsSection — état et geste suivant", () => {
  it("Discord lié, tag à certifier : pastille et bouton Certifier", () => {
    const html = render([google(true), discord(true, "OAUTH", "Tag#1"), blizzard(false)], { ...IDENTITY, discordHasTag: true });
    expect(html).toContain("Lié, à certifier");
    expect(html).toContain('aria-label="Certifier mon tag Discord"');
  });

  it("Discord lié sans tag : le bouton propose d'enregistrer", () => {
    const html = render([google(true), discord(true, "OAUTH")], IDENTITY);
    expect(html).toContain('aria-label="Enregistrer mon tag Discord"');
  });

  it("Discord certifié : pastille Certifié, aucun bouton Certifier", () => {
    const html = render([google(true), discord(true, "OAUTH", "Tag#1")], { ...IDENTITY, discordHasTag: true, discordVerified: true });
    expect(html).toContain("Certifié");
    expect(html).not.toContain('aria-label="Certifier mon tag Discord"');
  });

  it("état Discord pas encore lu : aucun geste de certification", () => {
    const html = render([google(true), discord(true, "OAUTH", "Tag#1")], { ...IDENTITY, discordKnown: false });
    expect(html).not.toContain("Certifier mon tag Discord");
  });

  it("Battle.net lié sans BattleTag de Blizzard : le dit", () => {
    const html = render([google(true), blizzard(true)], IDENTITY);
    expect(html).toContain("Lié, BattleTag non certifié");
    expect(html).toContain("Battle.net ne t&#x27;a donné aucun BattleTag");
  });

  it("Battle.net lié, profil pas encore lu : ni avertissement ni pastille d'alerte", () => {
    const html = render([google(true), blizzard(true)], { ...IDENTITY, battletagKnown: false });
    expect(html).not.toContain("Lié, BattleTag non certifié");
    expect(html).not.toContain("aucun BattleTag");
  });

  it("non lié : pastille Non lié et bouton Lier", () => {
    const html = render([google(true), blizzard(false)], IDENTITY);
    expect(html).toContain("Non lié");
  });
});
