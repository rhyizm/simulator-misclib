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

test("転倒シナリオでは負傷者が出て、非常停止後に再開する", () => {
  const p = getScenario("drunk").params;
  for (const policy of ["walkLane", "standBoth"] as const) {
    const s = runToEnd(createSim(p, policy));
    const st = getStats(s);
    assert.ok(st.injuries.length >= 1, policy);
    assert.equal(st.stopped, false);
    assert.ok(st.exited > 0);
  }
});
