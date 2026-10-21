import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, fatalityByDeltaV, getStats, impactAfterBlind, runToEnd, safeBlindSec } from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("tunnel").params;
  const a = getStats(runToEnd(createSim(p, "phone")));
  const b = getStats(runToEnd(createSim(p, "phone")));
  assert.deepEqual(a, b);
});

test("致死率の曲線は ΔV 40 km/h で約 2%、80 km/h で 50%", () => {
  assert.ok(Math.abs(fatalityByDeltaV(40) - 0.02) < 1e-6);
  assert.ok(Math.abs(fatalityByDeltaV(80) - 0.5) < 1e-6);
  assert.equal(fatalityByDeltaV(0), 0);
});

test("目を離していられる時間の上限を超えると、追突速度が急に立ち上がる", () => {
  const limit = safeBlindSec(85, 180, 1, 4.5);
  assert.ok(limit > 3 && limit < 5, `limit ${limit}`);
  assert.equal(impactAfterBlind(85, 180, limit - 0.05, 1, 4.5), 0);
  assert.ok(impactAfterBlind(85, 180, limit + 1, 1, 4.5) > 30);
  // 見通しが長いほど、許される時間も長い
  assert.ok(safeBlindSec(85, 400, 1, 4.5) > 12);
  // 13 秒見ていなければ、180 m 先の最後尾にはまったく減速せずに突っ込む
  assert.equal(impactAfterBlind(85, 180, 13, 1, 4.5), 85);
});

test("前を見ている世界では、止まった列の最後尾に追突しない", () => {
  for (const id of ["tunnel", "straight"]) {
    const a = aggregate(getScenario(id).params, "eyes", 10);
    assert.equal(a.crashes, 0, id);
    assert.ok(a.reached > 100);
  }
});

test("トンネル: スマホを見る人がいると追突が起き、見る時間が長いほど増える", () => {
  const p = getScenario("tunnel").params;
  const short = aggregate({ ...p, phoneSec: 2 }, "phone", 20);
  const mid = aggregate({ ...p, phoneSec: 6 }, "phone", 20);
  const long = aggregate({ ...p, phoneSec: 13 }, "phone", 20);
  assert.equal(short.crashes, 0);
  assert.ok(mid.crashes > 0);
  assert.ok(long.crashes > mid.crashes, `${long.crashes} > ${mid.crashes}`);
  assert.ok(long.expectedDeaths > mid.expectedDeaths);
});

test("見通しのよい直線は、同じながらスマホでもトンネルよりずっと軽く済む", () => {
  const t = aggregate(getScenario("tunnel").params, "phone", 20);
  const s = aggregate(getScenario("straight").params, "phone", 20);
  assert.ok(s.expectedDeaths < t.expectedDeaths * 0.2);
});

test("自動ブレーキは追突速度と死亡の期待値を下げる", () => {
  const off = aggregate(getScenario("tunnel").params, "phone", 20);
  const on = aggregate(getScenario("aeb").params, "phone", 20);
  assert.ok(on.avgImpactKmh < off.avgImpactKmh);
  assert.ok(on.expectedDeaths < off.expectedDeaths * 0.6);
});
