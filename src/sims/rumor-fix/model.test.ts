import { test } from "node:test";
import assert from "node:assert/strict";
import { BELIEVER, aggregate, acceptProb, buildNetwork, createSim, getStats, runToEnd, step } from "./model.ts";
import { getScenario, policies } from "./scenarios.ts";

const never = { id: "none", label: "訂正なし", desc: "", delay: Infinity };

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("quake").params;
  const a = getStats(runToEnd(createSim(p, policies[0])));
  const b = getStats(runToEnd(createSim(p, policies[0])));
  assert.deepEqual(a, b);
});

test("訂正を出すまでは、どの世界もまったく同じに広がる", () => {
  const p = getScenario("quake").params;
  const net = buildNetwork(p);
  const sims = [policies[1], policies[2], never].map((pol) => createSim(p, pol, net));
  for (let k = 0; k < 25; k++) for (const s of sims) step(s);
  const counts = sims.map((s) => s.status.filter((v) => v === BELIEVER).length);
  assert.equal(new Set(counts).size, 1);
});

test("信じてから時間が経つほど、訂正を受け入れにくくなる", () => {
  const p = getScenario("quake").params;
  assert.ok(acceptProb(p, 0) > acceptProb(p, 6));
  assert.ok(acceptProb(p, 6) > acceptProb(p, 24));
  assert.ok(Math.abs(acceptProb(p, 1000) - p.acceptStale) < 1e-6);
});

test("訂正が早いほど、信じる人も、最後まで信じている人も少ない", () => {
  const r = aggregate(getScenario("quake").params, [...policies, never], 20);
  for (let i = 0; i < 3; i++) {
    assert.ok(r[i].everBelieved < r[i + 1].everBelieved + 1, `ever ${i}`);
    assert.ok(r[i].believers < r[i + 1].believers, `end ${i}`);
  }
  assert.ok(r[0].everBelieved < r[2].everBelieved / 2);
});

test("翌朝の訂正では、デマはもう行き渡ったあと", () => {
  const [late, none] = aggregate(getScenario("quake").params, [policies[2], never], 20);
  assert.ok(Math.abs(late.everBelieved - none.everBelieved) < none.everBelieved * 0.05);
});

test("分断されていると、早い訂正の効き目が落ちる", () => {
  const a = aggregate(getScenario("quake").params, [policies[0]], 50)[0];
  const b = aggregate(getScenario("split").params, [policies[0]], 50)[0];
  assert.ok(b.believers > a.believers * 1.25, `${b.believers} > ${a.believers} * 1.25`);
});

test("手口を知っている人がいると、デマそのものが広がりにくい", () => {
  const a = aggregate(getScenario("quake").params, [never], 20)[0];
  const b = aggregate(getScenario("prebunk").params, [never], 20)[0];
  assert.ok(b.everBelieved < a.everBelieved * 0.85);
});
