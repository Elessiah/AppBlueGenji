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
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import { STREAM_NOTICE_LIVE_EN } from "@/lib/shared/legal-text-en";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";

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

// TERMS v7 (report de LOGS-NOTIFS) : le message #live de la soirée liste un
// match avant son début s'il est programmé dans la soirée et une fois terminé —
// pas seulement à son départ ; /rgpd dit que cette liste ne laisse aucune trace.
describe("message #live de la soirée (conditions v7)", () => {
  const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("dit la mention #live avant, pendant et après le match, en français et en anglais", () => {
    expect(STREAM_NOTICE_LIVE).toContain("par un message de soirée qui liste chaque match à son heure — avant son début s'il est programmé dans la soirée, pendant sa diffusion, puis une fois terminé, avec son score —");
    expect(STREAM_NOTICE_LIVE_EN).toContain("by an evening message that lists each match at its time — before it starts if it is scheduled that evening, while it is streamed, then once finished, with its score —");
  });

  it("est reprise par la section « Retransmission des matchs » des conditions (FR et EN)", () => {
    expect(TERMS_SECTIONS.find((s) => s.id === "retransmission")?.paragraphs.join(" ")).toContain(STREAM_NOTICE_LIVE);
    expect(TERMS_SECTIONS_EN.find((s) => s.id === "retransmission")?.paragraphs.join(" ")).toContain(STREAM_NOTICE_LIVE_EN);
  });

  // EF-19 : seul un match en `START_TIME` est listé avant son passage à
  // l'antenne (`loadEveningMatches`) — pas tout match daté de la soirée.
  it("le dit aussi à l'inscription, en équipe comme en individuel, pour un direct réglé sur l'heure de début", () => {
    for (const solo of [true, false]) {
      const notice = registrationStreamNotice(solo);
      expect(notice).toContain("Au début d'un match diffusé — et avant, si sa diffusion doit s'ouvrir à son heure de début dans la soirée, puis une fois terminé —,");
      expect(notice).not.toContain("s'il est programmé dans la soirée");
    }
  });

  it("la mention affichée à l'inscription (FR et EN) dit la même chose que registrationStreamNotice", () => {
    expect([frActions.register.streamNotice.SOLO, frActions.register.streamNotice.TEAM]).toEqual([registrationStreamNotice(true), registrationStreamNotice(false)]);
    for (const notice of Object.values(enActions.register.streamNotice)) {
      expect(notice).toContain("— and before, if its broadcast is set to open at its start time that evening, then once finished —");
    }
  });

  it("dit sur /rgpd qu'un match listé avant son passage à l'antenne ne laisse aucune trace sur le site (FR et EN)", () => {
    expect(readSource("app/rgpd/page.tsx").replace(/\s+/g, " ")).toContain("programmé dans la soirée, ne laisse aucune trace sur le site");
    expect(readSource("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ")).toContain("scheduled that evening, leaves no trace on the site");
  });
});
