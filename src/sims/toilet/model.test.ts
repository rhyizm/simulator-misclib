import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, runToEnd, getStats, aggregate, splitLayout, totalFixtures } from "./model.ts";
import { getScenario, LEGACY, GUIDELINE, FLEX, TOTAL } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("station").params;
  const a = getStats(runToEnd(createSim(p, LEGACY)));
  const b = getStats(runToEnd(createSim(p, LEGACY)));
  assert.deepEqual(a, b);
});

test("比べる配分はどれも便器の総数が同じ", () => {
  for (const l of [LEGACY, GUIDELINE, FLEX]) assert.equal(totalFixtures(l), TOTAL);
  for (let f = 0; f <= TOTAL; f++) assert.equal(totalFixtures(splitLayout("x", TOTAL, f)), TOTAL);
});

test("駅: これまでの配分は女性だけが長く待ち、指針の配分で男女差が縮む", () => {
  const p = getScenario("station").params;
  const legacy = aggregate(p, LEGACY, 10);
  const guide = aggregate(p, GUIDELINE, 10);
  assert.ok(legacy.female.avgWait > legacy.male.avgWait * 5);
  const gapLegacy = Math.abs(legacy.female.avgWait - legacy.male.avgWait);
  const gapGuide = Math.abs(guide.female.avgWait - guide.male.avgWait);
  assert.ok(gapGuide < gapLegacy / 3, `${gapGuide} < ${gapLegacy} / 3`);
});

test("休憩時間: 指針の配分のほうが時間内に済ませられない人が少ない", () => {
  const p = getScenario("intermission").params;
  const legacy = aggregate(p, LEGACY, 10);
  const guide = aggregate(p, GUIDELINE, 10);
  const left = (a: typeof legacy) => a.female.queue + a.male.queue;
  assert.ok(left(guide) < left(legacy), `${left(guide)} < ${left(legacy)}`);
});

test("客層が入れ替わる場面では可変トイレのほうが待ち時間が短い", () => {
  const p = getScenario("stadium").params;
  const fixed = aggregate(p, GUIDELINE, 10);
  const flex = aggregate(p, FLEX, 10);
  const total = (a: typeof fixed) => a.female.avgWait + a.male.avgWait;
  assert.ok(total(flex) < total(fixed), `${total(flex)} < ${total(fixed)}`);
});
