import { describe, expect, it } from "vitest";
import { formatDuration, formatTimeRange } from "./labels";

describe("formatDuration", () => {
  it("écrit les durées comme on les dit", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(65)).toBe("1 h 05");
  });
});

describe("formatTimeRange", () => {
  it("calcule l'heure de fin", () => {
    expect(formatTimeRange("14:00", 180)).toBe("14:00 – 17:00 (3 h)");
    expect(formatTimeRange("23:30", 60)).toBe("23:30 – 00:30 (1 h)");
  });
  it("sans durée ni heure", () => {
    expect(formatTimeRange("09:15", null)).toBe("09:15");
    expect(formatTimeRange(null, 60)).toBeNull();
  });
});
