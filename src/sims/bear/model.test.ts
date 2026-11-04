import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, approachProb, BASELINE, createSim, generateMasts, getStats, runToEnd } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

const params = getScenario("now").params;

test("同じ seed なら結果が一致する (決定的)", () => {
  const a = getStats(runToEnd(createSim(params, POLICIES.both)));
  const b = getStats(runToEnd(createSim(params, POLICIES.both)));
  assert.deepEqual(a, b);
});

test("はじめの 2 年は豊作 → 凶作に固定され、どの世界も同じ実りを経験する", () => {
  const masts = generateMasts(params);
  assert.equal(masts[0], "good");
  assert.equal(masts[1], "poor");
  const a = runToEnd(createSim(params, POLICIES.now, masts));
  const b = runToEnd(createSim(params, POLICIES.all, masts));
  assert.deepEqual(a.years.map((y) => y.mast), b.years.map((y) => y.mast));
});

test("山の餌が少ないほど、また人里を覚えたクマほど下りてきやすい", () => {
  assert.ok(approachProb(params, BASELINE, false, 0.2) > approachProb(params, BASELINE, false, 1));
  assert.ok(approachProb(params, BASELINE, true, 1) > approachProb(params, BASELINE, false, 1) * 5);
});

test("凶作の年は豊作・並作の年より出没が多い", () => {
  const [r] = aggregate(params, [POLICIES.now], 30);
  assert.ok(r.sightingsPoorYear > r.sightingsOtherYear * 1.3);
});

test("柿の木を伐ると、人里を覚えたクマが減る", () => {
  const [now, fruit] = aggregate(params, [POLICIES.now, POLICIES.fruit], 30);
  assert.ok(fruit.finalLearned < now.finalLearned / 2);
  assert.ok(fruit.sightings < now.sightings);
});

test("捕獲を強めると出没は減るが、クマの頭数も大きく減る", () => {
  const [now, cull, both] = aggregate(params, [POLICIES.now, POLICIES.cull, POLICIES.both], 30);
  assert.ok(cull.sightings < now.sightings * 0.6);
  assert.ok(cull.finalBears < now.finalBears * 0.5);
  // 餌を断つ方は頭数を減らさずに出没を減らす
  assert.ok(both.sightings < cull.sightings);
  assert.ok(both.finalBears > now.finalBears);
});

test("同じ対策でも、凶作の翌年から始めると凶作の年の出没は減らせない", () => {
  const [now, both, late] = aggregate(params, [POLICIES.now, POLICIES.both, POLICIES.bothLate], 30);
  assert.equal(late.sightingsYear2, now.sightingsYear2);
  assert.ok(both.sightingsYear2 < now.sightingsYear2 * 0.6);
  assert.ok(both.sightings < late.sightings);
});

test("クマが増え続ける地域では、餌を断つだけだと頭数が増え、捕獲を足すと抑えられる", () => {
  const p = getScenario("growing").params;
  const [both, all] = aggregate(p, [POLICIES.both, POLICIES.all], 30);
  assert.ok(both.finalBears > p.initialBears * 1.5);
  assert.ok(all.finalBears < both.finalBears * 0.8);
  assert.ok(all.sightings < both.sightings);
});
