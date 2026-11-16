import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, priceIndex, runToEnd } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("sticky").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.plan)));
  const b = getStats(runToEnd(createSim(p, POLICIES.plan)));
  assert.deepEqual(a, b);
});

test("8% → 1% で値段は 6.5% 下がり、元に戻るときは 6.9% 上がる", () => {
  const down = priceIndex(0, 0, true, 1) / priceIndex(0, 0, false, 1) - 1;
  assert.ok(Math.abs(down + 0.0648) < 0.001, `${down}`);
  const s = getStats(runToEnd(createSim(getScenario("calm").params, POLICIES.cut)));
  assert.ok(Math.abs(s.cliff - 0.0693) < 0.001, `${s.cliff}`);
});

test("給付は減税と同じ予算を使い切る", () => {
  const p = getScenario("calm").params;
  const cut = getStats(runToEnd(createSim(p, POLICIES.cut)));
  for (const id of ["flat", "targeted"] as const) {
    const s = getStats(runToEnd(createSim(p, POLICIES[id])));
    assert.ok(Math.abs(s.costPerYear - cut.costPerYear) < 1, `${id}: ${s.costPerYear} vs ${cut.costPerYear}`);
  }
});

test("減税は年収の高い世帯ほど円では多く、年収に対する割合では少なく得をする", () => {
  const q = aggregate(getScenario("calm").params, POLICIES.cut, 20).stats.quintiles;
  assert.ok(q[4].perYear > q[0].perYear * 1.4);
  assert.ok(q[4].ofIncome < q[0].ofIncome / 2);
});

test("値下げが店で止まると、減税だけが目減りする (給付は目減りしない)", () => {
  const p = getScenario("sticky").params;
  const cut = getStats(runToEnd(createSim(p, POLICIES.cut)));
  const flat = getStats(runToEnd(createSim(p, POLICIES.flat)));
  assert.ok(Math.abs(cut.perYear / cut.costPerYear - p.passThrough) < 1e-6);
  assert.ok(flat.leakPerYear === 0 && Math.abs(flat.perYear - flat.costPerYear) < 1);
});

test("就業者支援金は年金世帯に届かない", () => {
  const p = getScenario("calm").params;
  const cut = getStats(runToEnd(createSim(p, POLICIES.cut)));
  const plan = getStats(runToEnd(createSim(p, POLICIES.plan)));
  assert.ok(plan.perYear > cut.perYear);
  assert.ok(Math.abs(plan.lowPension - cut.lowPension) < 1);
});

test("年収で絞った給付は、低い 20% に半分近くが届き、6 割の世帯は受け取らない", () => {
  const s = aggregate(getScenario("calm").params, POLICIES.targeted, 20).stats;
  assert.ok(s.bottomShare > 0.4, `${s.bottomShare}`);
  assert.ok(s.zeroShare > 0.5, `${s.zeroShare}`);
});
