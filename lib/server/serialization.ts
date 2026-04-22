import { TEAM_ROLES } from "@/lib/shared/constants";
import type { TeamRole } from "@/lib/shared/types";

export function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function clampInt(value: unknown, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function parseRoles(value: unknown): TeamRole[] {
  if (Array.isArray(value)) {
    return value.filter((candidate): candidate is TeamRole =>
      typeof candidate === "string" && TEAM_ROLES.includes(candidate as TeamRole),
    );
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((candidate): candidate is TeamRole =>
          typeof candidate === "string" && TEAM_ROLES.includes(candidate as TeamRole),
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

export function normalizePseudo(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function slugifyPseudo(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40);
}

export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

export function generateSeedOrder(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];
  const previous = generateSeedOrder(size / 2);
  const result: number[] = [];
  for (const seed of previous) {
    result.push(seed);
    result.push(size + 1 - seed);
  }
  return result;
}
