import { test } from "node:test";
import assert from "node:assert/strict";
import { TARGET_YEN, aggregate, createSim, expectedRedShare, getStats, runToEnd, shareAbove } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("wave").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.target)));
  const b = getStats(runToEnd(createSim(p, POLICIES.target)));
  assert.deepEqual(a, b);
});

test("購入額 10 万円以上は約 9%、重点検査で赤になるのは約 11%", () => {
  assert.ok(Math.abs(shareAbove(TARGET_YEN) - 0.09) < 0.01, `${shareAbove(TARGET_YEN)}`);
  assert.ok(Math.abs(expectedRedShare(POLICIES.target) - 0.109) < 0.01);
  const st = aggregate(getScenario("normal").params, POLICIES.target, 5).stats;
  assert.ok(Math.abs(st.redShare - 0.109) < 0.01, `${st.redShare}`);
});

test("ふだんの昼: 1 割検査なら誰もあきらめず、2 割にすると列が崩れる", () => {
  const p = getScenario("normal").params;
  const now = aggregate(p, POLICIES.now, 10).stats;
  const strict = aggregate(p, POLICIES.strict, 10).stats;
  assert.ok(now.gaveUp < 1, `${now.gaveUp}`);
  assert.ok(now.avgInspectWait < 180);
  assert.ok(strict.avgInspectWait > 15 * 60);
  assert.ok(strict.gaveUp > 50);
  // 検査を倍にしても、確かめた購入額は 1.5 倍にも届かない
  assert.ok(strict.inspectedValueShare < now.inspectedValueShare * 1.5);
});

test("重点検査は件数が同じでも列が伸びるが、確かめる購入額は大きい", () => {
  const p = getScenario("normal").params;
  const now = aggregate(p, POLICIES.now, 10).stats;
  const target = aggregate(p, POLICIES.target, 10).stats;
  const both = aggregate(p, POLICIES.targetStaff, 10).stats;
  assert.ok(target.avgInspectWait > now.avgInspectWait * 5);
  assert.ok(target.inspectedValueShare > now.inspectedValueShare * 1.8);
  assert.ok(both.gaveUp < 3);
  assert.ok(both.inspectedValueShare > now.inspectedValueShare * 3);
});

test("始まったばかり: 端末が詰まり、事前申告で解ける。検査員を増やしても変わらない", () => {
  const p = getScenario("first").params;
  const now = aggregate(p, POLICIES.now, 10).stats;
  const online = aggregate(p, POLICIES.online, 10).stats;
  const staff = aggregate(p, POLICIES.staff, 10).stats;
  assert.ok(now.avgKioskWait > 4 * 60);
  assert.ok(online.avgKioskWait < 30);
  assert.ok(staff.avgKioskWait > 4 * 60);
});

test("検査員を足す方針は、検査台の数に反映される", () => {
  const p = getScenario("normal").params;
  assert.equal(createSim(p, POLICIES.staff).inspectors.length, p.inspectors + 3);
  assert.equal(createSim(p, POLICIES.now).kiosks.length, p.kiosks);
});
