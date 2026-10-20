import { describe, expect, it, jest } from "@jest/globals";
import {
  browserOptedOut,
  recruitmentModalShownHere,
  sendRecruitmentModalChoice,
} from "@/app/(secured)/profil/_components/RecruitmentModalField";
import { RECRUITMENT_MODAL_OFF_EVENT } from "@/lib/shared/recruitment";
import { readSource } from "../helpers/read-source";

/** « Mon profil » : réglage de la fenêtre d'arrivée du recrutement (`RecruitmentModalField`). */

type Request = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

function reply(ok: boolean, body: unknown) {
  return jest.fn<Request>().mockResolvedValue({ ok, json: () => Promise.resolve(body) });
}

describe("browserOptedOut", () => {
  it("lit le cookie de ce navigateur, valeur « 1 » seulement", () => {
    expect(browserOptedOut(() => "a=b; bg_recr_off=1; c=d")).toBe(true);
    expect(browserOptedOut(() => "bg_recr_off=0")).toBe(false);
    expect(browserOptedOut(() => "bg_recr_off_x=1")).toBe(false);
    expect(browserOptedOut(() => "")).toBe(false);
  });

  it("cookies illisibles : tenu pour absent", () => {
    expect(
      browserOptedOut(() => {
        throw new Error("SecurityError");
      }),
    ).toBe(false);
  });
});

describe("recruitmentModalShownHere", () => {
  it("cochée sauf refus du compte ou de ce navigateur", () => {
    expect(recruitmentModalShownHere(false, false)).toBe(true);
    expect(recruitmentModalShownHere(true, false)).toBe(false);
    // Vieux cookie d'ici, compte réaffiché ailleurs : fermée ici, la case le dit.
    expect(recruitmentModalShownHere(false, true)).toBe(false);
  });
});

describe("sendRecruitmentModalChoice", () => {
  it("cochée : DELETE (réafficher), décochée : POST (comme « Ne plus afficher »)", async () => {
    const on = reply(true, { account: true });
    expect(await sendRecruitmentModalChoice(true, on)).toBeNull();
    expect(on).toHaveBeenCalledWith("/api/recruitment/modal-dismiss", { method: "DELETE" });
    const off = reply(true, { account: true });
    expect(await sendRecruitmentModalChoice(false, off)).toBeNull();
    expect(off).toHaveBeenCalledWith("/api/recruitment/modal-dismiss", { method: "POST" });
  });

  it("rend le code du refus, jamais une phrase", async () => {
    expect(await sendRecruitmentModalChoice(true, reply(false, { error: "ACCOUNT_DELETED" }))).toBe("ACCOUNT_DELETED");
    expect(await sendRecruitmentModalChoice(false, reply(false, { error: "RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE" }))).toBe(
      "RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE",
    );
    expect(await sendRecruitmentModalChoice(true, reply(false, "<html>"))).toBe("PROFILE_UPDATE_FAILED");
  });

  it("session finie depuis le chargement (`account: false`) : refus de session", async () => {
    expect(await sendRecruitmentModalChoice(false, reply(true, { account: false }))).toBe("UNAUTHORIZED");
  });

  it("réseau coupé : repli de sauvegarde", async () => {
    const down = jest.fn<Request>().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await sendRecruitmentModalChoice(true, down)).toBe("PROFILE_UPDATE_FAILED");
  });
});

describe("modale ouverte sur « Mon profil »", () => {
  it("le « Ne plus afficher » gardé émet l'événement que la case écoute (décochée sans rechargement)", () => {
    const modal = readSource("components/recruitment-highlight.tsx");
    expect(modal).toMatch(/window\.dispatchEvent\(new Event\(RECRUITMENT_MODAL_OFF_EVENT\)\)/);
    const field = readSource("app/(secured)/profil/_components/RecruitmentModalField.tsx");
    expect(field).toMatch(/addEventListener\(RECRUITMENT_MODAL_OFF_EVENT/);
    expect(field).toMatch(/removeEventListener\(RECRUITMENT_MODAL_OFF_EVENT/);
    // Fin d'envoi : le cookie d'ici a le dernier mot (POST refusé qui le repose, opt-out arrivé pendant l'envoi).
    expect(field).toContain("if (shownRef.current && browserOptedOut()) setShown(false);");
    // Choix enregistré : la mise en page racine est relue (`router.refresh()` passé par la page).
    expect(field).toContain("if (outcome.stored) onSaved?.();");
    expect(RECRUITMENT_MODAL_OFF_EVENT).toBe("bg:recruitment-modal-off");
  });
});
