import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, fatalityProb, getStats, resolveEncounter, runToEnd, stoppingDistance } from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("backstreet").params;
  const a = getStats(runToEnd(createSim(p, "limit30")));
  const b = getStats(runToEnd(createSim(p, "limit30")));
  assert.deepEqual(a, b);
});

test("致死率の曲線は 30 km/h で約 0.9%、60 km/h で約 17%", () => {
  assert.ok(Math.abs(fatalityProb(30) - 0.009) < 1e-6);
  assert.ok(Math.abs(fatalityProb(60) - 0.17) < 1e-6);
  assert.equal(fatalityProb(0), 0);
});

test("止まれるかどうかは停止距離と見えた距離の比較で決まる", () => {
  const d = stoppingDistance(30, 1, 6.5);
  assert.equal(resolveEncounter(30 / 3.6, d + 0.1, 1, 6.5).hit, false);
  const r = resolveEncounter(30 / 3.6, d - 1, 1, 6.5);
  assert.ok(r.hit && r.impact > 0 && r.impact < 30 / 3.6);
  // 反応するより前に届いてしまえば、速度はまったく落ちない
  assert.equal(resolveEncounter(10, 5, 1, 6.5).impact, 10);
});

test("住宅街の抜け道: 30 km/h にすると数秒遅れるだけで、死亡の期待値は半分以下になる", () => {
  const p = getScenario("backstreet").params;
  const a = aggregate(p, "limit60", 20);
  const b = aggregate(p, "limit30", 20);
  const delay = b.avgTrip - a.avgTrip;
  assert.ok(delay > 0 && delay < 10, `delay ${delay}`);
  assert.ok(b.expectedDeaths < a.expectedDeaths * 0.5, `${b.expectedDeaths} < ${a.expectedDeaths} / 2`);
  assert.ok(b.avgImpactKmh < a.avgImpactKmh);
});

test("広い農道: 遅れは 1 分を超え、抜け道よりずっと大きい", () => {
  const p = getScenario("farm").params;
  const delay = aggregate(p, "limit30", 10).avgTrip - aggregate(p, "limit60", 10).avgTrip;
  assert.ok(delay > 60, `delay ${delay}`);
});

test("上限を守らない人がいると、30 km/h の効果は薄れる", () => {
  const p = getScenario("school").params;
  const all = aggregate(p, "limit30", 10);
  const some = aggregate({ ...p, compliance: 0.5 }, "limit30", 10);
  assert.ok(some.expectedDeaths > all.expectedDeaths);
  // 60 km/h の世界は守る割合に関係しない
  assert.deepEqual(aggregate(p, "limit60", 3), aggregate({ ...p, compliance: 0.5 }, "limit60", 3));
});
