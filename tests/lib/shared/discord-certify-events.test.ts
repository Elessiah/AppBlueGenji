import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CERTIFY_DIALOG_REQUEST_TTL_MS,
  requestCertifyDialog,
  takeCertifyDialogRequest,
} from "@/lib/shared/discord-certify-events";

/**
 * Le dialogue de certification de `/profil` ne s'ouvre qu'à la demande d'une
 * page du site, gardée en mémoire (EF-04) : un lien `?certifier=discord` venu
 * d'ailleurs mène au profil sans l'ouvrir.
 */

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("requestCertifyDialog / takeCertifyDialogRequest", () => {
  it("sans demande : rien", () => {
    takeCertifyDialogRequest();
    expect(takeCertifyDialogRequest(1_000)).toBe(false);
  });

  it("une demande vaut une fois, dans le délai (bornes comprises)", () => {
    requestCertifyDialog(1_000);
    expect(takeCertifyDialogRequest(1_000 + CERTIFY_DIALOG_REQUEST_TTL_MS)).toBe(true);
    expect(takeCertifyDialogRequest(1_000 + CERTIFY_DIALOG_REQUEST_TTL_MS)).toBe(false);
    requestCertifyDialog(1_000);
    expect(takeCertifyDialogRequest(1_000)).toBe(true);
  });

  it("expirée ou datée du futur (horloge reculée) : refusée, et consommée", () => {
    requestCertifyDialog(1_000);
    expect(takeCertifyDialogRequest(1_001 + CERTIFY_DIALOG_REQUEST_TTL_MS)).toBe(false);
    requestCertifyDialog(5_000);
    expect(takeCertifyDialogRequest(4_999)).toBe(false);
    expect(takeCertifyDialogRequest(5_000)).toBe(false);
  });

  it("une nouvelle demande remplace l'ancienne", () => {
    requestCertifyDialog(1_000);
    requestCertifyDialog(1_000 + CERTIFY_DIALOG_REQUEST_TTL_MS);
    expect(takeCertifyDialogRequest(1_000 + 2 * CERTIFY_DIALOG_REQUEST_TTL_MS)).toBe(true);
  });
});

describe("câblage", () => {
  it("le profil consomme la demande à chaque montage et n'ouvre que si elle vient d'ici", () => {
    const hook = source("app/(secured)/profil/useCertifyRequest.ts");
    expect(hook).toMatch(/const requestedHere = takeCertifyDialogRequest\(\);\s*if \(wantsCertifyDialog\(window\.location\.search\)\) \{\s*if \(requestedHere\) setRequested\(true\);/);
  });

  it("les deux fenêtres qui y mènent posent la demande", () => {
    expect(source("app/(secured)/tournois/[id]/_components/CertificationPromptDialog.tsx")).toContain(
      "if (!prompt.discordVerified) requestCertifyDialog();",
    );
    expect(source("components/discord/DiscordCertifyPrompt.tsx")).toMatch(/requestCertifyDialog\(\);\s*router\.push\(CERTIFY_PROFILE_HREF\);/);
  });
});
