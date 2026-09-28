import { describe, expect, it } from "@jest/globals";

import {
  CROSS_SITE_REQUEST,
  UNSUPPORTED_CONTENT_TYPE,
  requestOriginRefusal,
  type RequestOriginSignals,
} from "@/lib/shared/request-origin";

/**
 * La provenance d'une requête qui ouvre ou ferme une session : le CSRF de
 * connexion (un formulaire d'un autre site posant le jeton de l'attaquant)
 * passait parce que ni la provenance ni le type du corps n'étaient regardés.
 */

const SITE = ["bluegenji.example", "localhost:3000"];

function signals(overrides: Partial<RequestOriginSignals> = {}): RequestOriginSignals {
  return {
    secFetchSite: null,
    origin: null,
    contentType: "application/json",
    siteHosts: SITE,
    ...overrides,
  };
}

const json = { requireJson: true };
const bare = { requireJson: false };

describe("requestOriginRefusal — provenance", () => {
  it.each(["same-origin", "none", "SAME-ORIGIN"])("admet Sec-Fetch-Site: %s", (secFetchSite) => {
    expect(requestOriginRefusal(signals({ secFetchSite }), json)).toBeNull();
  });

  it.each(["cross-site", "same-site", "inconnu"])("refuse Sec-Fetch-Site: %s", (secFetchSite) => {
    expect(requestOriginRefusal(signals({ secFetchSite }), json)).toBe(CROSS_SITE_REQUEST);
  });

  it("se fie à Sec-Fetch-Site quand il est posé, même si Origin manque", () => {
    expect(requestOriginRefusal(signals({ secFetchSite: "same-origin", origin: null }), json)).toBeNull();
  });

  it("retombe sur Origin sans Sec-Fetch-Site : hôte du site admis", () => {
    expect(requestOriginRefusal(signals({ origin: "https://bluegenji.example" }), json)).toBeNull();
    expect(requestOriginRefusal(signals({ origin: "http://localhost:3000" }), json)).toBeNull();
  });

  it("compare l'hôte sans égard à la casse ni au schéma (TLS terminé au relais)", () => {
    expect(requestOriginRefusal(signals({ origin: "http://BlueGenji.Example" }), json)).toBeNull();
  });

  it.each([
    ["un autre domaine", "https://attaquant.example"],
    ["un suffixe trompeur", "https://bluegenji.example.attaquant.example"],
    ["un autre port", "http://localhost:4000"],
    ["une origine opaque", "null"],
    ["une origine illisible", "pas une url"],
    ["un schéma exotique", "file:///etc/passwd"],
  ])("refuse Origin sur %s", (_label, origin) => {
    expect(requestOriginRefusal(signals({ origin }), json)).toBe(CROSS_SITE_REQUEST);
  });

  it("n'admet rien quand le site ne connaît aucun de ses hôtes", () => {
    expect(
      requestOriginRefusal(signals({ origin: "https://bluegenji.example", siteHosts: [] }), json),
    ).toBe(CROSS_SITE_REQUEST);
  });

  it("laisse passer une requête sans aucun en-tête de provenance (client hors navigateur)", () => {
    expect(requestOriginRefusal(signals(), json)).toBeNull();
  });
});

describe("requestOriginRefusal — type du corps", () => {
  it.each(["application/json", "application/json; charset=utf-8", "Application/JSON"])(
    "admet %s",
    (contentType) => {
      expect(requestOriginRefusal(signals({ contentType }), json)).toBeNull();
    },
  );

  it.each([
    ["text/plain (le formulaire forgé)", "text/plain"],
    ["un formulaire urlencodé", "application/x-www-form-urlencoded"],
    ["un formulaire multipart", "multipart/form-data; boundary=x"],
    ["un type absent", null],
  ])("refuse %s", (_label, contentType) => {
    expect(requestOriginRefusal(signals({ contentType }), json)).toBe(UNSUPPORTED_CONTENT_TYPE);
  });

  it("ne regarde pas le type quand la route ne lit aucun corps", () => {
    expect(requestOriginRefusal(signals({ contentType: null }), bare)).toBeNull();
  });

  it("nomme la provenance avant le type quand les deux sont en faute", () => {
    expect(
      requestOriginRefusal(signals({ secFetchSite: "cross-site", contentType: "text/plain" }), json),
    ).toBe(CROSS_SITE_REQUEST);
  });
});
