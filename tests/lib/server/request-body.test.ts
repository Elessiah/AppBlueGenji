import { beforeEach, describe, expect, it } from "@jest/globals";

import {
  IMAGE_UPLOAD_BODY_MAX_BYTES,
  PAYLOAD_TOO_LARGE,
  isPayloadTooLarge,
  readBodyBytes,
  readFormDataBody,
  readImageUploadForm,
  readJsonBody,
} from "@/lib/server/request-body";
import { IMAGE_UPLOAD_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shared/uploads";

/**
 * `req.json()` et `req.formData()` lisaient tout le corps avant le moindre
 * contrôle — sur des routes anonymes, sur un Raspberry Pi. La lecture est
 * désormais bornée, par la taille annoncée **et** par la taille lue.
 */

/** Un corps fragmenté, sans `Content-Length` : n'annonce rien de sa taille. */
function chunkedRequest(chunks: Uint8Array[], onPull?: () => void): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
  return new Request("http://localhost/api/test", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("readBodyBytes", () => {
  it("rend le corps entier sous la borne", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST", body: "bonjour" });
    await expect(readBodyBytes(req, 64)).resolves.toEqual(new TextEncoder().encode("bonjour"));
  });

  it("refuse sur la taille annoncée, sans lire le corps", async () => {
    const req = chunkedRequest([new Uint8Array(10)]);
    const announced = new Request(req, { headers: { "content-length": "1000000" } });
    await expect(readBodyBytes(announced, 64)).rejects.toThrow(PAYLOAD_TOO_LARGE);
    expect(announced.bodyUsed).toBe(false);
  });

  it("arrête la lecture d'un corps fragmenté dès qu'il dépasse la borne", async () => {
    let pulled = 0;
    const chunks = Array.from({ length: 100 }, () => new Uint8Array(16));
    const req = chunkedRequest(chunks, () => {
      pulled += 1;
    });
    await expect(readBodyBytes(req, 40)).rejects.toThrow(PAYLOAD_TOO_LARGE);
    // Trois morceaux de 16 octets suffisent à franchir 40 : le reste n'est jamais lu.
    expect(pulled).toBeLessThan(10);
  });

  it("rend un corps vide pour une requête sans corps", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST" });
    await expect(readBodyBytes(req, 64)).resolves.toHaveLength(0);
  });

  it("ignore un Content-Length illisible, la lecture restant bornée", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: "x".repeat(100),
      headers: { "content-length": "abc" },
    });
    await expect(readBodyBytes(req, 64)).rejects.toThrow(PAYLOAD_TOO_LARGE);
  });
});

describe("readJsonBody", () => {
  it("analyse un corps JSON sous la borne", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify({ a: 1 }) });
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it("rejette un corps illisible, comme req.json()", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST", body: "{" });
    await expect(readJsonBody(req)).rejects.toThrow(SyntaxError);
  });

  it("refuse au-delà de la borne donnée", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ description: "x".repeat(200) }),
    });
    const error = await readJsonBody(req, 100).catch((caught: unknown) => caught);
    expect(isPayloadTooLarge(error)).toBe(true);
  });
});

describe("readFormDataBody", () => {
  it("rend le formulaire, fichier compris", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    form.set("crop", "0,0,1,1");
    const req = new Request("http://localhost/api/test", { method: "POST", body: form });

    const read = await readFormDataBody(req);
    const file = read.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(3);
    expect(read.get("crop")).toBe("0,0,1,1");
  });

  it("laisse passer une image au plafond, enveloppe du multipart comprise", () => {
    expect(IMAGE_UPLOAD_BODY_MAX_BYTES).toBeGreaterThan(IMAGE_UPLOAD_MAX_BYTES);
  });
});

describe("readImageUploadForm", () => {
  beforeEach(() => resetRateLimit(IMAGE_UPLOAD_RULE.name));

  function upload(size: number): Request {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(size)], "a.png", { type: "image/png" }));
    return new Request("http://localhost/api/test", { method: "POST", body: form });
  }

  it("rend le formulaire d'un envoi ordinaire", async () => {
    const form = await readImageUploadForm(upload(10), 7);
    expect(form).toBeInstanceOf(FormData);
  });

  it("dit IMAGE_TOO_LARGE d'un corps au-delà de la borne, sans le lire", async () => {
    const response = await readImageUploadForm(upload(IMAGE_UPLOAD_BODY_MAX_BYTES + 1), 7);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    await expect((response as Response).json()).resolves.toEqual({ error: "IMAGE_TOO_LARGE" });
  });

  it("dit FILE_MISSING d'un corps illisible", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: "pas un multipart",
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    const response = await readImageUploadForm(req, 7);
    await expect((response as Response).json()).resolves.toEqual({ error: "FILE_MISSING" });
  });

  it("plafonne les envois d'un même compte", async () => {
    for (let i = 0; i < IMAGE_UPLOAD_RULE.limit; i += 1) {
      expect(await readImageUploadForm(upload(1), 7)).toBeInstanceOf(FormData);
    }
    const refused = await readImageUploadForm(upload(1), 7);
    expect((refused as Response).status).toBe(429);
    // Un autre compte n'en paie pas le prix.
    expect(await readImageUploadForm(upload(1), 8)).toBeInstanceOf(FormData);
  });
});
