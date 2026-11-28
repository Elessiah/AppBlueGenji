import { describe, expect, it } from "@jest/globals";
import { getiCategoryOfChannel, parseGetiPost, type GetiRawPost } from "@/lib/shared/geti";
import { GETI_TEXT_MAX, getiDisplayText, getiFlagCodes, prepareGetiText } from "@/lib/shared/geti/normalize";
import {
  GETI_FAKE_AUTHOR_ID,
  GETI_FAKE_BOT_ID,
  GETI_FAKE_OTHER_ID,
  getiRawPost,
  getiRelayPost,
  parsedGetiPost,
  GETI_TRAILER_TRUSTED_BOTS,
  GETI_TRUSTED_BOTS,
} from "@/tests/helpers/geti";

// Écrits par leur point de code : un caractère invisible ne se relit pas dans un source.
const cp = (code: number) => String.fromCodePoint(code);
const ZERO_WIDTH_SPACE = cp(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = cp(0x202e);

/** Valeur lue d'un JSON : rien n'y garantit la forme attendue. */
function untyped(json: string): GetiRawPost {
  return JSON.parse(json);
}

describe("getiDisplayText", () => {
  it("une valeur qui n'est pas un texte rend un texte vide", () => {
    expect(getiDisplayText(42)).toBe("");
    expect(getiDisplayText(null)).toBe("");
  });

  it("retire les invisibles et les commandes de direction, ligne par ligne", () => {
    const raw = `LFT${ZERO_WIDTH_SPACE} dps\n${RIGHT_TO_LEFT_OVERRIDE}d3`;

    expect(getiDisplayText(raw)).toBe("LFT dps\nd3");
  });

  it("garde les sauts de ligne mais réduit les lignes vides en rafale", () => {
    expect(getiDisplayText("a\r\n\n\n\nb")).toBe("a\n\nb");
  });

  it("réduit les suites d'espaces d'une ligne", () => {
    expect(getiDisplayText("lft    dps")).toBe("lft dps");
  });

  it("garde un texte à la longueur maximale et coupe au-delà", () => {
    expect(getiDisplayText("a".repeat(GETI_TEXT_MAX))).toHaveLength(GETI_TEXT_MAX);
    expect(getiDisplayText("a".repeat(GETI_TEXT_MAX + 1))).toHaveLength(GETI_TEXT_MAX);
  });
});

describe("prepareGetiText — server emoji", () => {
  it("a server emoji name is read in plain and lower but not in clean", () => {
    const prepared = prepareGetiText("<:Grandmaster:123456789012345678> ELDRAVEN");

    expect(prepared.plain).toContain("Grandmaster");
    expect(prepared.lower).toContain("grandmaster");
    expect(prepared.clean).not.toContain("Grandmaster");
  });

  it("a text without server emoji gives the same clean and plain when it has no accent", () => {
    const prepared = prepareGetiText("LFT **tank** diamond");

    expect(prepared.plain).toBe(prepared.clean);
  });

  it("an accented text without server emoji keeps clean accented and plain without", () => {
    const prepared = prepareGetiText("Équipe");

    expect(prepared.clean).toBe("Équipe");
    expect(prepared.plain).toBe("Equipe");
  });
});

describe("prepareGetiText", () => {
  it("retire liens, mentions, balisage et pictogrammes", () => {
    const prepared = prepareGetiText("**LFP** https://discord.gg/fauxcode <@100000000000000001> \u{1F525} tank");

    expect(prepared.lower.trim().split(/\s+/u)).toEqual(["lfp", "tank"]);
  });

  it("ramène les lettres de fantaisie à leur forme courante", () => {
    const fancy = [0x1d403, 0x1d422, 0x1d41a, 0x1d426].map(cp).join("");

    expect(prepareGetiText(fancy).lower).toBe("diam");
  });

  it("garde casse et accents dans « clean », les retire dans « lower »", () => {
    const prepared = prepareGetiText("Équipe Maître");

    expect(prepared.clean).toBe("Équipe Maître");
    expect(prepared.plain).toBe("Equipe Maitre");
    expect(prepared.lower).toBe("equipe maitre");
  });
});

describe("getiFlagCodes", () => {
  it("rend le code de chaque drapeau, dans l'ordre", () => {
    const flags = [0x1f1eb, 0x1f1f7, 0x1f1ec, 0x1f1e7].map(cp).join("");

    expect(getiFlagCodes(`lft ${flags}`)).toEqual(["FR", "GB"]);
  });

  it("sans drapeau, rend une liste vide", () => {
    expect(getiFlagCodes("lft fr")).toEqual([]);
  });
});

describe("getiCategoryOfChannel", () => {
  it("rend la catégorie d'un salon source", () => {
    expect(getiCategoryOfChannel("679323814106103819")).toBe("lfstaff");
  });

  it("rend null pour un salon inconnu ou une valeur qui n'est pas un identifiant", () => {
    expect(getiCategoryOfChannel("100000000000000050")).toBeNull();
    expect(getiCategoryOfChannel(undefined)).toBeNull();
  });
});

describe("parseGetiPost — message d'un joueur", () => {
  it("l'auteur est celui du message : pseudo et identifiant", () => {
    const parsed = parseGetiPost(getiRawPost("lft dps"));

    expect(parsed).toMatchObject({ authorTag: "fauxjoueur", authorId: GETI_FAKE_AUTHOR_ID, relayed: false });
  });

  it("un ancien pseudo garde son suffixe", () => {
    const raw = getiRawPost("lft", { author: { id: GETI_FAKE_AUTHOR_ID, username: "VieuxCompte", discriminator: "4821" } });

    expect(parseGetiPost(raw).authorTag).toBe("VieuxCompte#4821");
  });

  it("le suffixe « 0000 » d'un compte migré n'est pas ajouté", () => {
    const raw = getiRawPost("lft", { author: { id: GETI_FAKE_AUTHOR_ID, username: "fauxjoueur", discriminator: "0000" } });

    expect(parseGetiPost(raw).authorTag).toBe("fauxjoueur");
  });

  it("le pseudo perd ses invisibles et son « @ » de tête", () => {
    const raw = getiRawPost("lft", { author: { id: GETI_FAKE_AUTHOR_ID, username: `@faux${ZERO_WIDTH_SPACE}joueur` } });

    expect(parseGetiPost(raw).authorTag).toBe("fauxjoueur");
  });

  it("un pseudo est gardé jusqu'à 32 caractères et coupé au-delà", () => {
    const raw = getiRawPost("lft", { author: { id: GETI_FAKE_AUTHOR_ID, username: "a".repeat(33) } });

    expect(parseGetiPost(raw).authorTag).toBe("a".repeat(32));
  });

  it("un pseudo fait seulement d'invisibles rend null", () => {
    const raw = getiRawPost("lft", { author: { id: GETI_FAKE_AUTHOR_ID, username: ZERO_WIDTH_SPACE } });

    expect(parseGetiPost(raw).authorTag).toBeNull();
  });

  it("un identifiant qui n'est pas un identifiant Discord rend null", () => {
    const raw = getiRawPost("lft", { author: { id: "<script>", username: "fauxjoueur" } });

    expect(parseGetiPost(raw).authorId).toBeNull();
  });

  it("l'encart d'aperçu d'un lien n'est pas lu comme l'annonce", () => {
    const raw = getiRawPost("lft dps", { embeds: [{ description: "tank gm1" }] });

    const parsed = parseGetiPost(raw);

    expect(parsed.roles).toEqual(["DPS"]);
    expect(parsed.ranks.min).toBeNull();
  });

  it("le texte rendu est nettoyé de ses invisibles, jamais interprété", () => {
    const raw = getiRawPost(`<b>lft</b>${ZERO_WIDTH_SPACE} dps${RIGHT_TO_LEFT_OVERRIDE}`);

    expect(parseGetiPost(raw).text).toBe("<b>lft</b> dps");
  });

  it("une date de publication valide est rendue en ISO, la modification signalée", () => {
    const raw = getiRawPost("lft", { postedAt: "2026-11-20T19:30:00+01:00", editedAt: "2026-11-20T19:40:00+01:00" });

    expect(parseGetiPost(raw)).toMatchObject({ postedAt: "2026-11-20T18:30:00.000Z", edited: true });
  });

  it("une date illisible rend null, sans modification", () => {
    const raw = getiRawPost("lft", { postedAt: "hier", editedAt: null });

    expect(parseGetiPost(raw)).toMatchObject({ postedAt: null, edited: false });
  });
});

describe("parseGetiPost — relais d'un bot", () => {
  const OUR_TRAILER = `\n\n*Sent from : [Faux Serveur](https://discord.gg/fauxcode)* by <@${GETI_FAKE_OTHER_ID}>`;

  it("l'auteur est lu dans l'encart, pas le bot", () => {
    const parsed = parseGetiPost(getiRelayPost(`lft dps d3${OUR_TRAILER}`), GETI_TRAILER_TRUSTED_BOTS);

    expect(parsed).toMatchObject({ relayed: true, authorTag: "fauxpseudo", authorId: GETI_FAKE_OTHER_ID });
  });

  it("la ligne de relais est retirée du texte et donne le serveur d'origine", () => {
    const parsed = parseGetiPost(getiRelayPost(`lft dps d3${OUR_TRAILER}`), GETI_TRAILER_TRUSTED_BOTS);

    expect(parsed.text).toBe("lft dps d3");
    expect(parsed.originServer).toBe("Faux Serveur");
  });

  it("le nom du serveur d'origine perd ses échappements de crochets", () => {
    const description = "lft\n\n*Sent from : [Faux \\[FR\\] Serveur](https://discord.gg/fauxcode)* by <@100000000000000002>";

    expect(parseGetiPost(getiRelayPost(description), GETI_TRAILER_TRUSTED_BOTS).originServer).toBe("Faux [FR] Serveur");
  });

  it("la ligne d'auteur « Nom (@pseudo) » est un nom d'affichage libre : aucun pseudo", () => {
    expect(parseGetiPost(getiRelayPost("lft", "Faux Nom (@faux.pseudo)"), GETI_TRUSTED_BOTS).authorTag).toBeNull();
  });

  it("la ligne d'auteur à l'ancien format garde son suffixe", () => {
    expect(parseGetiPost(getiRelayPost("lft", "fauxpseudo#4821"), GETI_TRUSTED_BOTS).authorTag).toBe("fauxpseudo#4821");
  });

  it("sans ligne d'auteur, le pseudo est nul : celui du bot n'est jamais rendu", () => {
    expect(parseGetiPost(getiRelayPost("lft", null), GETI_TRUSTED_BOTS).authorTag).toBeNull();
  });

  it("sans ligne de relais, l'auteur est la mention derrière un libellé", () => {
    const description = `lft dps, duo avec <@100000000000000003>\nContact : <@${GETI_FAKE_OTHER_ID}>`;

    expect(parseGetiPost(getiRelayPost(description), GETI_TRUSTED_BOTS).authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("sans libellé, une mention seule ne désigne personne : elle peut viser un tiers", () => {
    expect(parseGetiPost(getiRelayPost(`lft dps <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS).authorId).toBeNull();
    expect(parseGetiPost(getiRelayPost(`lft dps, duo avec <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS).authorId).toBeNull();
  });

  it("« by <@id> » en tête de ligne désigne l'auteur", () => {
    expect(parseGetiPost(getiRelayPost(`lft dps
by <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS).authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("« Auteur : <@id> » dans la ligne désigne l'auteur", () => {
    expect(parseGetiPost(getiRelayPost(`lft dps — Auteur : <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS).authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("« posté par <@id> » désigne l'auteur", () => {
    expect(parseGetiPost(getiRelayPost(`lft dps, posté par <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS).authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("« remplaçant de <@id> » ne désigne pas l'auteur", () => {
    const description = `Remplaçant de <@${GETI_FAKE_OTHER_ID}> recherché, dps`;

    expect(parseGetiPost(getiRelayPost(description), GETI_TRUSTED_BOTS).authorId).toBeNull();
  });

  it("« remplacé par <@id> » dans une phrase ne désigne pas l'auteur", () => {
    const description = `lft dps, notre tank remplacé par <@${GETI_FAKE_OTHER_ID}>`;

    expect(parseGetiPost(getiRelayPost(description), GETI_TRUSTED_BOTS).authorId).toBeNull();
  });

  it("un libellé collé à un mot ne compte pas (« lobby <@id> »)", () => {
    expect(parseGetiPost(getiRelayPost(`Je viens du lobby <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS).authorId).toBeNull();
  });

  it("plusieurs mentions sans libellé ne désignent personne", () => {
    const description = `lft <@${GETI_FAKE_OTHER_ID}> et <@100000000000000003> en duo`;

    expect(parseGetiPost(getiRelayPost(description), GETI_TRUSTED_BOTS).authorId).toBeNull();
  });

  it("sans mention, l'identifiant est nul : celui du bot n'est jamais rendu", () => {
    const parsed = parseGetiPost(getiRelayPost("lft dps"), GETI_TRUSTED_BOTS);

    expect(parsed.authorId).toBeNull();
    expect(parsed.authorId).not.toBe(GETI_FAKE_BOT_ID);
  });

  it("le titre et les champs de l'encart font partie du texte analysé", () => {
    const raw: GetiRawPost = {
      author: { id: GETI_FAKE_BOT_ID, username: "FauxBot", bot: true },
      embeds: [
        {
          authorName: "fauxpseudo",
          title: "LFT",
          fields: [
            { name: "Rôle", value: "Tank" },
            { name: "Rang", value: "" },
            { name: "", value: "Master 3" },
          ],
        },
      ],
    };

    const parsed = parseGetiPost(raw);

    expect(parsed.text).toBe("LFT\nRôle : Tank\nRang\nMaster 3");
    expect(parsed).toMatchObject({ category: "lft", roles: ["TANK"] });
  });

  it("un relais sans encart est lu dans son contenu", () => {
    const raw: GetiRawPost = { content: "lfp tank", author: { id: GETI_FAKE_BOT_ID, bot: true } };

    expect(parseGetiPost(raw)).toMatchObject({ relayed: true, authorTag: null, roles: ["TANK"] });
  });
});

describe("parseGetiPost — entrées douteuses", () => {
  it("une valeur qui n'est pas un objet rend une annonce vide", () => {
    const expected = parsedGetiPost({ category: null, authorTag: null, authorId: null, oneEvening: false });

    expect(parseGetiPost(untyped("null"))).toEqual(expected);
  });

  it("des champs du mauvais type sont ignorés sans erreur", () => {
    const raw = untyped('{"content":42,"author":"x","embeds":"y","postedAt":7,"channelId":[]}');
    const expected = parsedGetiPost({ category: null, authorTag: null, authorId: null, oneEvening: false });

    expect(parseGetiPost(raw)).toEqual(expected);
  });

  it("des encarts et des champs mal formés sont ignorés", () => {
    const raw = untyped(
      '{"author":{"bot":true},"embeds":[null,7,{"description":"lft tank","fields":[null,{"name":3,"value":"gm1"}]}]}',
    );

    expect(parseGetiPost(raw)).toMatchObject({ text: "lft tank\ngm1", roles: ["TANK"] });
  });
});


describe("parseGetiPost — en-tête d'un relais GETI", () => {
  const HEADER = `<@${GETI_FAKE_OTHER_ID}>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)`;

  it("l'en-tête donne l'auteur, son pseudo et le serveur d'origine", () => {
    const parsed = parseGetiPost(getiRelayPost(`${HEADER}\n\n> lft dps d3 eu`, null), GETI_TRUSTED_BOTS);

    expect(parsed).toMatchObject({
      relayed: true,
      authorId: GETI_FAKE_OTHER_ID,
      authorTag: "fauxpseudo",
      originServer: "Faux Serveur",
      roles: ["DPS"],
      regions: ["EU"],
    });
  });

  it("l'en-tête est retiré du texte : seul le texte cité reste", () => {
    expect(parseGetiPost(getiRelayPost(`${HEADER}\n\n> lft dps`, null), GETI_TRUSTED_BOTS).text).toBe("> lft dps");
  });

  it("le nom du serveur n'apporte ni rôle, ni rang, ni région, ni équipe", () => {
    const header = `<@${GETI_FAKE_OTHER_ID}>*(heal_m1)* sur [Overwatch France EU - Team Phoenix Tank Diamond](https://discord.gg/a)`;
    const parsed = parseGetiPost(getiRelayPost(`${header}\n\n> lft dps`, null), GETI_TRUSTED_BOTS);

    expect(parsed).toMatchObject({ roles: ["DPS"], ranks: { min: null, max: null }, regions: [], teamName: null });
  });

  it("un pseudo aux caractères échappés est rendu sans ses échappements", () => {
    const header = `<@${GETI_FAKE_OTHER_ID}>*(faux\\_pseudo)* sur [S](https://discord.gg/a)`;

    expect(parseGetiPost(getiRelayPost(`${header}\n\n> lft`, null), GETI_TRUSTED_BOTS).authorTag).toBe("faux_pseudo");
  });

  it("l'auteur de l'en-tête passe avant une mention « contact » du texte cité", () => {
    const description = `${HEADER}\n\n> LFT tank m2\n> contact <@999999999999999999>`;

    expect(parseGetiPost(getiRelayPost(description, null), GETI_TRUSTED_BOTS).authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("sans en-tête, une mention « contact » dans une citation ne désigne pas l'auteur", () => {
    expect(parseGetiPost(getiRelayPost("lft\n> contact <@999999999999999999>", null), GETI_TRUSTED_BOTS).authorId).toBeNull();
  });

  it("une mention qui n'ouvre pas la description n'est pas un en-tête", () => {
    const description = `lft dps ${HEADER}`;

    expect(parseGetiPost(getiRelayPost(description, null), GETI_TRUSTED_BOTS)).toMatchObject({ authorId: null, originServer: null });
  });
});
