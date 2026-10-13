import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, runToEnd, getStats, aggregate } from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("rush").params;
  const a = getStats(runToEnd(createSim(p, "walkLane")));
  const b = getStats(runToEnd(createSim(p, "walkLane")));
  assert.deepEqual(a, b);
});

test("ラッシュ時は両側立ちのほうが多く運べる", () => {
  const p = getScenario("rush").params;
  const walk = aggregate(p, "walkLane", 10);
  const both = aggregate(p, "standBoth", 10);
  assert.ok(both.exited > walk.exited, `${both.exited} > ${walk.exited}`);
  assert.ok(both.maxQueue < walk.maxQueue);
});

test("閑散時は片側空けのほうが歩きたい人は早く着く", () => {
  const p = getScenario("offpeak").params;
  const walk = aggregate(p, "walkLane", 10);
  const both = aggregate(p, "standBoth", 10);
  assert.ok(walk.avgTripWalkers < both.avgTripWalkers);
  assert.ok(walk.maxQueue < 5 && both.maxQueue < 5);
});

test("電車の波は両側立ちのほうが早くさばける", () => {
  const p = getScenario("train").params;
  const walk = aggregate(p, "walkLane", 10);
  const both = aggregate(p, "standBoth", 10);
  assert.ok(both.maxQueue < walk.maxQueue, `${both.maxQueue} < ${walk.maxQueue}`);
  assert.ok(both.avgWait < walk.avgWait);
});

test("歩く側に立つ人がいると、歩きたい人の所要時間が伸びる", () => {
  const p = getScenario("blocker").params;
  const withBlockers = aggregate(p, "walkLane", 10);
  const without = aggregate({ ...p, standOnWalkLaneRatio: 0 }, "walkLane", 10);
  assert.ok(withBlockers.avgTripWalkers > without.avgTripWalkers);
  // 両側立ちの世界ではこの設定は意味を持たない
  const bothA = aggregate(p, "standBoth", 3);
  const bothB = aggregate({ ...p, standOnWalkLaneRatio: 0 }, "standBoth", 3);
  assert.deepEqual(bothA, bothB);
});
