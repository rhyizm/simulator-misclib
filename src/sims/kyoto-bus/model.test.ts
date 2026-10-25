import { test } from "node:test";
import assert from "node:assert/strict";
import { FARE_VISITOR, aggregate, createSim, demandFactor, getStats, runToEnd } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("autumn").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.all)));
  const b = getStats(runToEnd(createSim(p, POLICIES.all)));
  assert.deepEqual(a, b);
});

test("弾力性 −0.3 なら 230 円 → 400 円で観光客の利用は約 15% 減る", () => {
  const f = demandFactor(FARE_VISITOR, -0.3);
  assert.ok(Math.abs(1 - f - 0.153) < 0.005, `${1 - f}`);
  assert.equal(demandFactor(FARE_VISITOR, 0), 1);
});

test("平日の昼は席に余裕があり、市民はほとんど乗り残されない", () => {
  const p = getScenario("weekday").params;
  const now = aggregate(p, POLICIES.now, 10).stats;
  assert.ok(now.resident.leftBehindRate < 0.02, `${now.resident.leftBehindRate}`);
});

test("紅葉の週末: 二重運賃の効き目は弾力性しだい。反応しなければ何も変わらない", () => {
  const base = getScenario("autumn").params;
  const p0 = { ...base, elasticity: 0 };
  const now0 = aggregate(p0, POLICIES.now, 10).stats;
  const dual0 = aggregate(p0, POLICIES.dual, 10).stats;
  assert.ok(Math.abs(now0.resident.leftBehindRate - dual0.resident.leftBehindRate) < 0.01);
  // 収入だけは増える
  assert.ok(dual0.revenuePerHour > now0.revenuePerHour * 1.3);
  const p5 = { ...base, elasticity: -0.5 };
  const now5 = aggregate(p5, POLICIES.now, 10).stats;
  const dual5 = aggregate(p5, POLICIES.dual, 10).stats;
  assert.ok(dual5.resident.leftBehindRate < now5.resident.leftBehindRate / 2);
});

test("運転士不足の日: 始発で空けると市民は助かり、そのぶん観光客が長く待つ", () => {
  const p = getScenario("driver").params;
  const now = aggregate(p, POLICIES.now, 10).stats;
  const reserve = aggregate(p, POLICIES.reserve, 10).stats;
  assert.ok(reserve.resident.leftBehindRate < now.resident.leftBehindRate / 2);
  assert.ok(reserve.tourist.avgWait > now.tourist.avgWait);
});

test("観光特急に回しても運転士の数は同じ (普通のバスが減る)", () => {
  const p = getScenario("autumn").params;
  const s = runToEnd(createSim(p, POLICIES.express));
  const regular = s.buses.filter((b) => !b.express).length;
  const express = s.buses.filter((b) => b.express).length;
  assert.equal(regular, 2 * (p.busesPerHour - 3));
  assert.equal(express, 2 * 4);
});
