import { describe, expect, it } from "vitest";
import { nextRadioIndex } from "../../lib/radio-group";

describe("nextRadioIndex", () => {
  it.each(["ArrowRight", "ArrowDown"])("%s moves forward and wraps", (key) => {
    expect(nextRadioIndex(key, 0, 3)).toBe(1);
    expect(nextRadioIndex(key, 1, 3)).toBe(2);
    expect(nextRadioIndex(key, 2, 3)).toBe(0);
  });

  it.each(["ArrowLeft", "ArrowUp"])("%s moves back and wraps", (key) => {
    expect(nextRadioIndex(key, 2, 3)).toBe(1);
    expect(nextRadioIndex(key, 1, 3)).toBe(0);
    expect(nextRadioIndex(key, 0, 3)).toBe(2);
  });

  it("Home and End jump to the first and last option", () => {
    expect(nextRadioIndex("Home", 1, 6)).toBe(0);
    expect(nextRadioIndex("End", 1, 6)).toBe(5);
  });

  it.each(["Tab", " ", "Enter", "a", "Escape", "PageDown"])(
    "ignores %j",
    (key) => {
      expect(nextRadioIndex(key, 1, 3)).toBeNull();
    },
  );

  it("treats no selection (-1) as before the first option", () => {
    expect(nextRadioIndex("ArrowRight", -1, 3)).toBe(0);
    expect(nextRadioIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", -1, 3)).toBe(2);
    expect(nextRadioIndex("ArrowUp", -1, 3)).toBe(2);
    expect(nextRadioIndex("Home", -1, 3)).toBe(0);
    expect(nextRadioIndex("End", -1, 3)).toBe(2);
  });

  it("stays on the only option of a one-option group", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"])
      expect(nextRadioIndex(key, 0, 1)).toBe(0);
  });

  it("returns null for an empty group", () => {
    expect(nextRadioIndex("ArrowRight", -1, 0)).toBeNull();
  });
});
