import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLICIES,
  aggregate,
  createSim,
  getStats,
  hollowDepth,
  underpassDepth,
  runToEnd,
  HOLLOW_A0,
  HOLLOW_K,
  UP_FLAT,
  UP_SLOPE,
  UP_WIDTH,
} from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("guerrilla").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.now)));
  const b = getStats(runToEnd(createSim(p, POLICIES.now)));
  assert.deepEqual(a, b);
});

test("水の量と水深の換算は逆関数になっている", () => {
  for (const h of [0.1, 0.5, 1.2]) {
    const v = HOLLOW_A0 * h + (HOLLOW_K * h * h) / 2;
    assert.ok(Math.abs(hollowDepth(v) - h) < 1e-9);
    const u = UP_WIDTH * (UP_FLAT * h + (h * h) / UP_SLOPE);
    assert.ok(Math.abs(underpassDepth(u) - h) < 1e-9);
  }
});

test("左右の世界には同じ雨と同じ車が来る", () => {
  const p = getScenario("senjo").params;
  const a = createSim(p, POLICIES.now);
  const b = createSim(p, POLICIES.all);
  assert.deepEqual(a.rain, b.rain);
  assert.deepEqual(a.cars, b.cars);
});

test("夕立なら貯留槽で住宅街はほとんど浸水しない", () => {
  const p = getScenario("shower").params;
  const now = aggregate(p, POLICIES.now, 10);
  const tank = aggregate(p, POLICIES.tank, 10);
  assert.ok(now.overflowM3 > 1000);
  assert.ok(tank.overflowM3 < now.overflowM3 * 0.1);
});

test("長い雨では貯留槽が満杯になり、ゲリラ豪雨ほどは効かない", () => {
  const g = getScenario("guerrilla").params;
  const s = getScenario("senjo").params;
  const cut = (p: typeof g) => {
    const now = aggregate(p, POLICIES.now, 10);
    const tank = aggregate(p, POLICIES.tank, 10);
    assert.ok(tank.tankFill > 0.95, "貯留槽は満杯になる");
    return tank.aboveFloor / now.aboveFloor;
  };
  assert.ok(cut(g) < cut(s), `${cut(g)} < ${cut(s)}`);
});

test("下水道を 65 mm にしてもアンダーパスは 30 cm を超え、車が止まる", () => {
  const p = getScenario("guerrilla").params;
  const a = aggregate(p, POLICIES.pipe65, 10);
  assert.ok(a.maxUnder > 1);
  assert.ok(a.stalled > 1);
});

test("冠水センサーの通行止めで水の中で止まる車がなくなる", () => {
  for (const id of ["shower", "guerrilla", "senjo"]) {
    const p = getScenario(id).params;
    const now = aggregate(p, POLICIES.now, 10);
    const road = aggregate(p, POLICIES.road, 10);
    assert.ok(now.stalled > 0, id);
    assert.equal(road.stalled, 0, id);
    assert.equal(road.trapped, 0, id);
  }
});

test("対策を全部重ねると、あふれる量はほぼ消える", () => {
  const p = getScenario("guerrilla").params;
  const now = aggregate(p, POLICIES.now, 10).overflowM3;
  const cut = (id: keyof typeof POLICIES) => now - aggregate(p, POLICIES[id], 10).overflowM3;
  const sum = cut("pipe65") + cut("tank") + cut("infiltrate");
  assert.ok(cut("all") > Math.min(now, sum) * 0.9, `${cut("all")} vs ${sum}`);
});
