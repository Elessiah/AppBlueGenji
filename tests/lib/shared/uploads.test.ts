import { describe, expect, it } from "@jest/globals";
import { toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";

describe("toServedUploadUrl", () => {
  it("maps a disk path to the served api path", () => {
    expect(toServedUploadUrl("/uploads/sponsors/a.webp")).toBe("/api/uploads/sponsors/a.webp");
  });

  it("leaves non-upload paths untouched", () => {
    expect(toServedUploadUrl("https://cdn/x.png")).toBe("https://cdn/x.png");
  });
});

describe("toDiskUploadPath", () => {
  it("maps a served api path back to the disk path", () => {
    expect(toDiskUploadPath("/api/uploads/sponsors/a.webp")).toBe("/uploads/sponsors/a.webp");
  });

  it("passes a legacy disk path through unchanged", () => {
    expect(toDiskUploadPath("/uploads/sponsors/a.webp")).toBe("/uploads/sponsors/a.webp");
  });

  it("returns null for external urls", () => {
    expect(toDiskUploadPath("https://cdn/x.png")).toBeNull();
  });

  it("returns null for empty/nullish input", () => {
    expect(toDiskUploadPath(null)).toBeNull();
    expect(toDiskUploadPath(undefined)).toBeNull();
    expect(toDiskUploadPath("")).toBeNull();
  });
});
