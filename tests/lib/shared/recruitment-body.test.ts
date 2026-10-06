import { describe, expect, it } from "@jest/globals";

import { recruitmentAdInputFromBody } from "@/lib/shared/recruitment";

describe("recruitmentAdInputFromBody", () => {
  it("garde les champs du bon type", () => {
    const body = {
      title: "T",
      titleEn: "T en",
      rolesEn: "DPS en",
      bodyEn: "B en",
      teamName: "E",
      domain: "ESPORT",
      roles: "DPS",
      body: "B",
      contactUrl: "https://exemple.invalid",
      contactDiscord: "d",
      contactDiscordId: "1",
      contactPreferred: "AUTO",
      priority: "PRIORITY",
      active: false,
    };
    expect(recruitmentAdInputFromBody(body)).toEqual(body);
  });

  it("remplace un champ de type inattendu ou absent par son défaut", () => {
    expect(
      recruitmentAdInputFromBody({ title: 3, titleEn: 4, teamName: 1, domain: [], roles: {}, active: "true", priority: 2 }),
    ).toEqual({
      title: "",
      titleEn: null,
      rolesEn: null,
      bodyEn: null,
      teamName: null,
      domain: undefined,
      roles: null,
      body: null,
      contactUrl: null,
      contactDiscord: null,
      contactDiscordId: null,
      contactPreferred: undefined,
      priority: undefined,
      active: undefined,
    });
  });

  it("une chaîne vide reste une chaîne", () => {
    expect(recruitmentAdInputFromBody({ title: "", teamName: "" })).toMatchObject({ title: "", teamName: "" });
  });
});
