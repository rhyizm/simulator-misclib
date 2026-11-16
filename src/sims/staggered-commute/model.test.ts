import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, runToEnd } from "./model.ts";
import { getScenario } from "./scenarios.ts";

const none = { name: "いつも", participation: 0 };
const target = { name: "1 割", participation: 0.1 };

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("weekday").params;
  assert.deepEqual(getStats(runToEnd(createSim(p, target))), getStats(runToEnd(createSim(p, target))));
});

test("全員がいつかは交差点を通り抜け、ずらしても車の台数は変わらない", () => {
  const p = getScenario("weekday").params;
  const a = getStats(runToEnd(createSim(p, none)));
  const b = getStats(runToEnd(createSim(p, target)));
  assert.equal(a.queue, 0);
  assert.equal(a.passed, a.arrived);
  assert.equal(b.passed, a.passed);
  assert.ok(b.shifted > 0);
});

test("参加率が低い人は、高い世界でも同じようにずらす (共通の乱数)", () => {
  const p = getScenario("weekday").params;
  const low = createSim(p, { name: "", participation: 0.01 });
  const high = createSim(p, target);
  const shiftedIds = (s: typeof low) => new Set(s.cars.filter((c) => c.kind !== "normal").map((c) => c.id));
  const hi = shiftedIds(high);
  for (const id of shiftedIds(low)) assert.ok(hi.has(id));
});

test("ピークの 1 割をずらすと、待ちの合計は 1 割よりずっと大きく減る", () => {
  const p = getScenario("weekday").params;
  const a = aggregate(p, none, 20);
  const b = aggregate(p, target, 20);
  const cut = 1 - b.waitHours / a.waitHours;
  assert.ok(cut > 0.3, `cut ${cut}`);
  // 来た台数は約 1 割減る
  const arrivedCut = 1 - b.peakArrived / a.peakArrived;
  assert.ok(arrivedCut > 0.08 && arrivedCut < 0.12, `arrivedCut ${arrivedCut}`);
});

test("渋滞しているあいだ、交差点を通る台数 (交通量) はほとんど変わらない", () => {
  const p = getScenario("weekday").params;
  const a = aggregate(p, none, 10);
  const b = aggregate(p, target, 10);
  assert.ok(Math.abs(b.peakPassed - a.peakPassed) / a.peakPassed < 0.01);
});

test("参加が 1% だと効果は小さい", () => {
  const p = getScenario("weekday").params;
  const a = aggregate(p, none, 10);
  const b = aggregate(p, { name: "", participation: 0.01 }, 10);
  const cut = 1 - b.waitHours / a.waitHours;
  assert.ok(cut > 0 && cut < 0.1, `cut ${cut}`);
});

test("空いた分を同じだけ別の車が埋めると、効果はほぼ消える", () => {
  const p = getScenario("weekday").params;
  const a = aggregate(p, none, 10);
  const b = aggregate({ ...p, rebound: 1 }, target, 10);
  assert.ok(b.waitHours > a.waitHours * 0.9, `${b.waitHours} vs ${a.waitHours}`);
});

test("事故の日は、事故のない日より待ちが長い", () => {
  const a = aggregate(getScenario("weekday").params, none, 5);
  const b = aggregate(getScenario("incident").params, none, 5);
  assert.ok(b.avgWaitMin > a.avgWaitMin * 1.5);
});
