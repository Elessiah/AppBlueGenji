import { describe, expect, it } from "@jest/globals";
import {
  CONNECTION_LOG_EVENTS,
  CONNECTION_LOG_IP_MAX_LENGTH,
  CONNECTION_LOG_RETENTION_DAYS,
  connectionLogIp,
} from "@/lib/shared/connection-logs";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { DONNEE_CONNEXIONS } from "@/lib/shared/rgpd-policy";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";

describe("journal des données de connexion", () => {
  it("garde un an, durée légale", () => {
    expect(CONNECTION_LOG_RETENTION_DAYS).toBe(365);
  });

  it("nomme une porte par moyen de connexion", () => {
    expect(CONNECTION_LOG_EVENTS).toEqual([
      "LOGIN_GOOGLE",
      "LOGIN_DISCORD",
      "LOGIN_BLIZZARD",
      "LOGIN_DISCORD_CODE",
    ]);
    // La colonne `event_type` est un VARCHAR(32).
    for (const event of CONNECTION_LOG_EVENTS) expect(event.length).toBeLessThanOrEqual(32);
  });

  describe("connectionLogIp", () => {
    it.each<[string, string]>([
      ["203.0.113.7", "203.0.113.7"],
      ["  198.51.100.1 ", "198.51.100.1"],
      ["2001:db8::1", "2001:db8::1"],
      ["::ffff:192.0.2.128", "::ffff:192.0.2.128"],
    ])("garde une adresse lisible (%s)", (raw, expected) => {
      expect(connectionLogIp(raw)).toBe(expected);
    });

    it.each<[string | null | undefined]>([
      [null],
      [undefined],
      [""],
      ["   "],
      ["unknown"],
      ["<script>"],
      ["1234"],
      ["1.2.3.4; DROP TABLE"],
      ["a".repeat(10)],
    ])("écarte ce qui n'a pas la forme d'une adresse (%s)", (raw) => {
      expect(connectionLogIp(raw)).toBeNull();
    });

    it("écarte une valeur plus longue que la colonne", () => {
      const tooLong = "1:".repeat(CONNECTION_LOG_IP_MAX_LENGTH);
      expect(connectionLogIp(tooLong)).toBeNull();
    });
  });

  it("est déclaré au registre comme obligation légale, avec la durée du code", () => {
    const sheet = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T14");
    expect(sheet).toBeDefined();
    expect(sheet?.legalBasis).toMatch(/^Obligation légale/);
    expect(sheet?.retention.join(" ")).toContain(`${CONNECTION_LOG_RETENTION_DAYS} jours`);
    expect(sheet?.recipients.join(" ")).toMatch(/autorités judiciaires/i);
  });

  it("ne laisse plus le registre affirmer que l'adresse IP n'est jamais écrite", () => {
    const text = JSON.stringify(PROCESSING_ACTIVITIES);
    expect(text).not.toMatch(/jamais écrite/);
  });

  it("figure à la politique de confidentialité avec sa base et sa durée", () => {
    expect(DONNEE_CONNEXIONS.base).toBe("Obligation légale");
    expect(DONNEE_CONNEXIONS.duree).toContain(`${CONNECTION_LOG_RETENTION_DAYS} jours`);
  });

  it("est annoncé aux comptes existants", () => {
    const change = PRIVACY_CHANGES.find((entry) => entry.id === "2026-10-journal-connexions");
    expect(change).toBeDefined();
    expect(change?.summary).toContain(`${CONNECTION_LOG_RETENTION_DAYS} jours`);
  });
});
