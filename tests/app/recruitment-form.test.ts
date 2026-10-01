import { describe, expect, it } from "@jest/globals";

import {
  EMPTY_RECRUITMENT_FORM,
  recruitmentFormFromAd,
  recruitmentRequestBody,
} from "@/app/recrutement/recruitment-form";
import type { RecruitmentAd } from "@/lib/shared/recruitment";

const ad = {
  id: 7,
  title: "Cherche DPS",
  teamName: null,
  domain: "ESPORT",
  roles: null,
  body: "Texte",
  contactUrl: null,
  contactDiscord: "recruteur",
  contactDiscordId: "123",
  contactPreferred: "DISCORD",
  priority: "IMPORTANT",
  active: false,
} as unknown as RecruitmentAd;

describe("recruitmentFormFromAd", () => {
  it("remplace les champs absents par une chaîne vide", () => {
    expect(recruitmentFormFromAd(ad)).toEqual({
      title: "Cherche DPS",
      teamName: "",
      domain: "ESPORT",
      roles: "",
      body: "Texte",
      contactUrl: "",
      contactDiscord: "recruteur",
      contactPreferred: "DISCORD",
      priority: "IMPORTANT",
      active: false,
    });
  });
});

describe("recruitmentRequestBody", () => {
  it("rogne les textes et envoie null pour un champ vide", () => {
    const body = recruitmentRequestBody(
      { ...EMPTY_RECRUITMENT_FORM, title: "  Titre ", teamName: "   ", roles: " Tank " },
      { pseudo: "", id: null },
    );
    expect(body).toMatchObject({ title: "Titre", teamName: null, roles: "Tank", body: null, contactDiscord: null });
    expect(body.contactDiscordId).toBeNull();
  });

  it("garde l'identifiant Discord tant que le pseudo n'a pas changé", () => {
    const form = { ...EMPTY_RECRUITMENT_FORM, title: "T", contactDiscord: " recruteur " };
    expect(recruitmentRequestBody(form, { pseudo: "recruteur", id: "123" }).contactDiscordId).toBe("123");
  });

  it("abandonne l'identifiant Discord quand le pseudo a été remplacé ou effacé", () => {
    const snapshot = { pseudo: "recruteur", id: "123" };
    expect(
      recruitmentRequestBody({ ...EMPTY_RECRUITMENT_FORM, contactDiscord: "autre" }, snapshot).contactDiscordId,
    ).toBeNull();
    expect(recruitmentRequestBody({ ...EMPTY_RECRUITMENT_FORM }, snapshot).contactDiscordId).toBeNull();
  });
});
