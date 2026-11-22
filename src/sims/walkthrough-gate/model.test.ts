import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, laneKinds, runToEnd } from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("rush").params;
  const a = getStats(runToEnd(createSim(p, "oneMixed")));
  const b = getStats(runToEnd(createSim(p, "oneMixed")));
  assert.deepEqual(a, b);
});

test("通路の種類の割り当て", () => {
  assert.deepEqual(laneKinds("oneMixed", 4), ["mixed", "touch", "touch", "touch"]);
  assert.deepEqual(laneKinds("halfDedicated", 6).filter((k) => k === "wtOnly").length, 3);
  assert.ok(laneKinds("allMixed", 5).every((k) => k === "mixed"));
});

test("来た人はほぼ全員が通過するか精算へ回る (人が消えない)", () => {
  const s = runToEnd(createSim(getScenario("rush").params, "oneDedicated"));
  const queued = s.lanes.reduce((n, l) => n + l.queue.length, 0);
  assert.equal(s.passed + s.adjust + queued, s.pax.length);
});

test("1 通路 (共用) は、いまの改札より少しだけ待ちが短い", () => {
  const p = getScenario("rush").params;
  const now = aggregate(p, "touchOnly", 15);
  const one = aggregate(p, "oneMixed", 15);
  assert.ok(one.avgWait < now.avgWait);
  assert.ok(one.avgWait > now.avgWait * 0.85, `${one.avgWait} vs ${now.avgWait}`);
});

test("普及率が低いうちは、専用通路のほうが全体の待ちが長い", () => {
  const p = getScenario("rush").params;
  const mixed = aggregate(p, "oneMixed", 15);
  const ded = aggregate(p, "oneDedicated", 15);
  assert.ok(ded.avgWait > mixed.avgWait);
  assert.ok(ded.gateStops > mixed.gateStops * 2);
});

test("全員が対応すれば、全通路対応で待ちは大きく減る", () => {
  const p = { ...getScenario("rush").params, wtShare: 1 };
  const now = aggregate(p, "touchOnly", 10);
  const all = aggregate(p, "allMixed", 10);
  assert.ok(all.avgWait < now.avgWait * 0.65, `${all.avgWait} vs ${now.avgWait}`);
});

test("1 通路だけだと、普及しても歩いて通れる人は一部にとどまる", () => {
  const p = getScenario("future").params;
  const one = aggregate(p, "oneMixed", 10);
  assert.ok(one.wtUsedShare < 0.6);
});
