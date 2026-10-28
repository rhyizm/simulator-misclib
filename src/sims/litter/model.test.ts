import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, runToEnd } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("weekday").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.bins)));
  const b = getStats(runToEnd(createSim(p, POLICIES.bins)));
  assert.deepEqual(a, b);
});

test("対策が違っても、ごみを出す人の顔ぶれは同じ", () => {
  const p = getScenario("weekday").params;
  const counts = Object.values(POLICIES).map((pol) => getStats(runToEnd(createSim(p, pol))).produced);
  assert.ok(counts.every((c) => c === counts[0]), counts.join(", "));
});

test("ごみがごみを呼ばなければ、きれいな道で捨てる人は 1 割ほど", () => {
  const p = { ...getScenario("weekday").params, litterMultiplier: 1 };
  const r = aggregate(p, POLICIES.none, 5).litterRate;
  assert.ok(r > 0.08 && r < 0.16, `${r}`);
});

test("何もしないと散らかりが散らかりを呼び、捨てる人の割合が 2 倍以上になる", () => {
  const p = getScenario("weekday").params;
  const dirty = aggregate(p, POLICIES.none, 5).litterRate;
  const clean = aggregate({ ...p, litterMultiplier: 1 }, POLICIES.none, 5).litterRate;
  assert.ok(dirty > clean * 2, `${dirty} > ${clean} * 2`);
});

test("見回りは捨てる人を半分以下にするが、手間はいちばんかかる", () => {
  const p = getScenario("weekday").params;
  const none = aggregate(p, POLICIES.none, 5);
  const patrol = aggregate(p, POLICIES.patrol, 5);
  const smart = aggregate(p, POLICIES.smart, 5);
  assert.ok(patrol.litterRate < none.litterRate / 2);
  assert.ok(patrol.laborHours > smart.laborHours * 10);
});

test("回収が追いつかないごみ箱は、何もしないより道を汚す", () => {
  const p = getScenario("weekend").params;
  const none = aggregate(p, POLICIES.none, 5);
  const bins = aggregate(p, POLICIES.bins, 5);
  const smart = aggregate(p, POLICIES.smart, 5);
  assert.ok(bins.littered > none.littered, `${bins.littered} > ${none.littered}`);
  assert.ok(smart.littered < none.littered / 2, `${smart.littered} < ${none.littered} / 2`);
});

test("こまめな清掃は道をきれいに保ち、捨てる人も減らす", () => {
  const p = getScenario("broken").params;
  const none = aggregate(p, POLICIES.none, 5);
  const clean = aggregate(p, POLICIES.clean, 5);
  assert.ok(clean.maxStreet < none.maxStreet / 3);
  assert.ok(clean.litterRate < none.litterRate);
});

test("家庭ごみの持ち込みがあると、ごみ箱からあふれる量が増える", () => {
  const p = getScenario("weekday").params;
  const without = aggregate(p, POLICIES.bins, 3).overflowed;
  const withDump = aggregate({ ...p, dumpPerBinHour: 20 }, POLICIES.bins, 3).overflowed;
  assert.ok(withDump > without, `${withDump} > ${without}`);
});
