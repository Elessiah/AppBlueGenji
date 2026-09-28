import { describe, expect, it } from "@jest/globals";
import { isPrivateImageHostname, parseIpv6, parseRemoteImageUrl } from "@/lib/shared/remote-image";

/**
 * Le filtre anti-SSRF reconnaissait les adresses IPv6 à leur forme écrite, or
 * le parseur d'URL les réécrit : `[::ffff:127.0.0.1]` ressort `[::ffff:7f00:1]`,
 * que la regex d'origine ne voyait pas. Ces tests passent **par l'URL**, là où la
 * réécriture a lieu, et non par le seul prédicat.
 */
describe("parseRemoteImageUrl — adresses internes réécrites par le parseur d'URL", () => {
  it.each([
    "https://[::ffff:127.0.0.1]/logo.png",
    "https://[::ffff:7f00:1]/logo.png",
    "https://[::ffff:169.254.169.254]/latest",
    "https://[::127.0.0.1]/logo.png",
    "https://[64:ff9b::7f00:1]/logo.png",
    "https://[64:ff9b::a9fe:a9fe]/logo.png",
    "https://[64:ff9b:1::1]/logo.png",
    "https://[2002:7f00:1::1]/logo.png",
    "https://[fec0::1]/logo.png",
    "https://[ff02::1]/logo.png",
    "https://[100::1]/logo.png",
    "https://localhost./logo.png",
    "https://app.localhost./logo.png",
    "https://0x7f.1/logo.png",
    "https://2130706433/logo.png",
  ])("refuse %s", (raw) => {
    expect(parseRemoteImageUrl(raw)).toBeNull();
  });

  it.each([
    "https://[2606:4700::6810:85e5]/logo.png",
    "https://[64:ff9b::808:808]/logo.png",
    "https://[::ffff:8.8.8.8]/logo.png",
    "https://[2002:808:808::1]/logo.png",
    "https://cdn.exemple.fr./logo.png",
  ])("accepte l'adresse publique %s", (raw) => {
    expect(parseRemoteImageUrl(raw)).not.toBeNull();
  });
});

describe("isPrivateImageHostname — adresses rendues par le résolveur", () => {
  it("juge l'IPv4 encapsulée quelle que soit son écriture", () => {
    expect(isPrivateImageHostname("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateImageHostname("::ffff:a00:1")).toBe(true);
    expect(isPrivateImageHostname("0:0:0:0:0:ffff:7f00:1")).toBe(true);
    expect(isPrivateImageHostname("::ffff:1.1.1.1")).toBe(false);
  });

  it("ignore l'identifiant de zone", () => {
    expect(isPrivateImageHostname("fe80::1%eth0")).toBe(true);
  });

  it("refuse une adresse IPv6 illisible plutôt que de la laisser passer", () => {
    expect(isPrivateImageHostname("1::2::3")).toBe(true);
    expect(isPrivateImageHostname("12345::1")).toBe(true);
    expect(isPrivateImageHostname("::ffff:300.0.0.1")).toBe(true);
  });

  it("refuse les plages d'essai et réservées de l'IETF", () => {
    expect(isPrivateImageHostname("198.18.0.1")).toBe(true);
    expect(isPrivateImageHostname("198.19.255.255")).toBe(true);
    expect(isPrivateImageHostname("192.0.0.8")).toBe(true);
    expect(isPrivateImageHostname("198.20.0.1")).toBe(false);
  });

  it("garde publique une adresse IPv6 ordinaire", () => {
    expect(isPrivateImageHostname("2001:4860:4860::8888")).toBe(false);
  });
});

describe("parseIpv6", () => {
  it("développe l'abréviation", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("fe80::")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("convertit une IPv4 pointée en queue", () => {
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it("rend null sur une écriture invalide", () => {
    expect(parseIpv6("1:2:3")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIpv6("1:2:3:4::5:6:7:8")).toBeNull();
    expect(parseIpv6("g::1")).toBeNull();
    expect(parseIpv6("::1::")).toBeNull();
  });
});
