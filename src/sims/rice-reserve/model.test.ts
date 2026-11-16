import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, drawWorld, getStats, govStock, runToEnd } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("normal").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.band)));
  const b = getStats(runToEnd(createSim(p, POLICIES.band)));
  assert.deepEqual(a, b);
});

test("天気と需要の揺れは方針によらず同じ", () => {
  const p = getScenario("normal").params;
  assert.deepEqual(createSim(p, POLICIES.now).yields, createSim(p, POLICIES.big).yields);
  assert.deepEqual(drawWorld(p).surges, createSim(p, POLICIES.rush).surges);
});

test("シナリオで決めた年の作況はそのまま", () => {
  const p = getScenario("disaster").params;
  assert.equal(createSim(p, POLICIES.now).yields[5], 74);
});

test("平年作が続けば、値段はいつもの値段の近くにとどまり、備蓄は目標を保つ", () => {
  const p = { ...getScenario("normal").params, badYearProb: 0, disasterProb: 0, surgeProb: 0 };
  const s = runToEnd(createSim(p, POLICIES.now));
  const st = getStats(s);
  assert.equal(st.crisisMonths, 0);
  assert.equal(st.emptyMonths, 0);
  assert.ok(Math.abs(govStock(s) - 100) < 1, `${govStock(s)}`);
});

test("令和の米騒動: 早めに放出すると、米騒動の月数がいまの備蓄の半分未満になる", () => {
  const p = getScenario("reiwa").params;
  const now = aggregate(p, POLICIES.now, 20).stats;
  const early = aggregate(p, POLICIES.early, 20).stats;
  assert.ok(early.crisisMonths < now.crisisMonths / 2, `${early.crisisMonths} vs ${now.crisisMonths}`);
});

test("出すのが遅いままなら、備蓄を 150 万 t に増やしても米騒動はほとんど減らない", () => {
  const p = getScenario("normal").params;
  const now = aggregate(p, POLICIES.now, 20).stats;
  const big = aggregate(p, POLICIES.big, 20).stats;
  assert.ok(big.crisisMonths > now.crisisMonths * 0.85, `${big.crisisMonths} vs ${now.crisisMonths}`);
  assert.ok(big.fiscalPerYear > now.fiscalPerYear * 1.4);
});

test("値段に関係なくすぐ買い戻すと、米騒動が増える", () => {
  const p = getScenario("today").params;
  const now = aggregate(p, POLICIES.now, 20).stats;
  const rush = aggregate(p, POLICIES.rush, 20).stats;
  assert.ok(rush.crisisMonths > now.crisisMonths, `${rush.crisisMonths} vs ${now.crisisMonths}`);
});

test("値段の帯で売り買いすると、高すぎる月も安すぎる月も減る", () => {
  const p = getScenario("normal").params;
  const now = aggregate(p, POLICIES.now, 20).stats;
  const band = aggregate(p, POLICIES.band, 20).stats;
  assert.ok(band.crisisMonths < now.crisisMonths / 2);
  assert.ok(band.lowMonths < now.lowMonths * 0.7);
});
