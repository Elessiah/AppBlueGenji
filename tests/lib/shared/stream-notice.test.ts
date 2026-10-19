import { describe, expect, it } from "@jest/globals";
import {
  REGISTRATION_STREAM_NOTICE_LINK_LABEL,
  STREAM_NOTICE_LIVE,
  STREAM_NOTICE_OBJECTION,
  STREAM_NOTICE_PRIVACY_PATH,
  STREAM_NOTICE_SHOWN,
  registrationStreamNotice,
} from "@/lib/shared/stream-notice";
import { TERMS_SECTIONS, TERMS_VERSION } from "@/lib/shared/terms-of-use";

describe("information sur la retransmission des matchs", () => {
  it("renvoie à la section de /rgpd qui la détaille", () => {
    expect(STREAM_NOTICE_PRIVACY_PATH).toBe("/rgpd#retransmission");
    expect(REGISTRATION_STREAM_NOTICE_LINK_LABEL.length).toBeGreaterThan(0);
  });

  it("dit ce qui est montré, et ce qui ne l'est jamais", () => {
    expect(STREAM_NOTICE_SHOWN).toMatch(/pseudo des joueurs, le nom de leur équipe et leurs résultats et performances en jeu/);
    expect(STREAM_NOTICE_SHOWN).toMatch(/jamais de webcam ni de chat vocal/);
  });

  it("dit le droit d'opposition et la façon de l'exercer", () => {
    expect(STREAM_NOTICE_OBJECTION).toMatch(/s'y opposer/);
    expect(STREAM_NOTICE_OBJECTION).toMatch(/nom neutre/);
    expect(STREAM_NOTICE_OBJECTION).toMatch(/« Signaler un problème », catégorie RGPD/);
  });

  it("ne prête pas d'équipe à un engagé en individuel", () => {
    expect(registrationStreamNotice(false)).toMatch(/le nom de ton équipe/);
    expect(registrationStreamNotice(true)).not.toMatch(/équipe/);
    // L'annonce dans #live nomme l'équipe ; une entrée individuelle, son pseudo (2026-10-14).
    expect(registrationStreamNotice(false)).toMatch(/le nom de ton équipe est aussi annoncé sur le Discord de l'association/);
    expect(registrationStreamNotice(true)).toMatch(/ton pseudo est aussi annoncé sur le Discord de l'association/);
    // S'opposer au pseudo dans #live = ne pas s'inscrire ; une annonce passée reste supprimable (2026-10-14).
    // Base : l'exécution du service — l'annonce fait partie du tournoi auquel on s'inscrit (2026-10-14).
    expect(registrationStreamNotice(true)).toMatch(/cette annonce fait partie du tournoi auquel tu t'inscris, le nom neutre ne s'y applique pas, et elle est supprimée sur demande\./);
    expect(registrationStreamNotice(false)).not.toMatch(/supprimée sur demande/);
    for (const solo of [true, false]) {
      expect(registrationStreamNotice(solo)).toMatch(/diffusés en direct et enregistrés/);
      expect(registrationStreamNotice(solo)).toMatch(/jamais de webcam ni de chat vocal/);
      expect(registrationStreamNotice(solo)).toMatch(/t'y opposer/);
    }
  });
});

describe("conditions d'utilisation — retransmission des matchs", () => {
  const section = TERMS_SECTIONS.find((s) => s.id === "retransmission");

  it("a sa section, qui reprend les phrases partagées et renvoie à /rgpd", () => {
    expect(section).toBeDefined();
    const text = section!.paragraphs.join(" ");
    expect(text).toContain(STREAM_NOTICE_SHOWN);
    expect(text).toContain(STREAM_NOTICE_OBJECTION);
    // Le nom neutre ne couvre pas l'annonce #live d'un tournoi individuel (2026-10-14).
    expect(text).toContain(STREAM_NOTICE_LIVE);
    expect(STREAM_NOTICE_LIVE).toMatch(/en tournoi individuel, les joueurs par leur pseudo public\. Cette annonce fait partie du tournoi individuel auquel le joueur s'inscrit \(exécution du service, et non intérêt légitime\) : le nom neutre ne s'y applique pas, et un joueur qui ne veut pas y être nommé ne s'inscrit pas/);
    expect(section!.links?.map((l) => l.href)).toEqual([STREAM_NOTICE_PRIVACY_PATH]);
  });

  it("sa base légale (exécution du service) est une règle de fond du tournoi : version 4 au moins", () => {
    expect(TERMS_VERSION).toBeGreaterThanOrEqual(4);
  });
});
