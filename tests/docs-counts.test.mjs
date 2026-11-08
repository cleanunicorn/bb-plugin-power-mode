// Checks that the README feature list matches the code (#16).
// Run: node --test tests/docs-counts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const readme = read("README.md");

test("achievement count matches ACHIEVEMENTS", () => {
  // ACHIEVEMENTS = LEGACY (literal entries) + CATALOG (badge(...) calls).
  const stats = read("lib/power-stats.ts");
  const legacy = stats.slice(stats.indexOf("const LEGACY"), stats.indexOf("];", stats.indexOf("const LEGACY")));
  const catalog = read("lib/achievement-rules.ts");
  const count = (legacy.match(/\bid: "/g) ?? []).length + (catalog.match(/^\s*badge\(/gm) ?? []).length;
  assert.match(readme, new RegExp(`\\*\\*Stats & achievements:\\*\\* ${count} badges`));
});

test("README lists one theme per THEME_IDS entry", () => {
  const src = read("lib/power-store.ts");
  const ids = src.match(/THEME_IDS: readonly ThemeId\[\] = \[([^\]]*)\]/)[1].split(",").filter((s) => s.trim());
  const line = readme.split("\n").find((l) => l.includes("**Themes:**"));
  const names = line.split("**Themes:**")[1].split(",");
  assert.equal(names.length, ids.length);
});

test("ordnance table matches ORDNANCE_COMBO", () => {
  const src = read("lib/power-engine.ts");
  const combos = src.match(/ORDNANCE_COMBO = \[([^\]]*)\]/)[1].split(",").map(Number);
  const rows = [...readme.matchAll(/^\| (\d) \|.*\| \+(\d+) \|$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(rows, combos.map((c, i) => [i + 1, c]));
  assert.match(readme, new RegExp(`across ${combos.length} levels`));
});

test("feature list lives only in the README", () => {
  assert.equal(existsSync(new URL("PLUGIN_OVERVIEW.md", root)), false);
});
