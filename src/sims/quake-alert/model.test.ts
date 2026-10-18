import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, generateQuakes, getStats, runToEnd } from "./model.ts";
import { getScenario, policies } from "./scenarios.ts";

const [early, standard, strict] = policies;

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("standard").params;
  const a = getStats(runToEnd(createSim(p, standard)));
  const b = getStats(runToEnd(createSim(p, standard)));
  assert.deepEqual(a, b);
});

test("どの世界も同じ地震を経験する", () => {
  const p = getScenario("standard").params;
  const quakes = generateQuakes(p);
  const strongs = policies.map((pol) => getStats(runToEnd(createSim(p, pol, quakes))).strong);
  assert.equal(new Set(strongs).size, 1);
});

test("しきい値を下げると見逃しは減るが空振りは増える", () => {
  const r = aggregate(getScenario("standard").params, policies, 20);
  assert.ok(r[0].misses < r[1].misses && r[1].misses < r[2].misses);
  assert.ok(r[0].falseAlarms > r[1].falseAlarms && r[1].falseAlarms > r[2].falseAlarms);
});

test("早く鳴らしすぎると信頼が落ち、強い揺れで身を守れる人はかえって減る", () => {
  const r = aggregate(getScenario("standard").params, [early, standard, strict], 20);
  assert.ok(r[0].trust < r[1].trust);
  assert.ok(r[1].protectedShare > r[0].protectedShare);
  assert.ok(r[1].protectedShare > r[2].protectedShare);
});

test("誤作動はしきい値の高い世界の空振りも増やす", () => {
  const normal = aggregate(getScenario("standard").params, [strict], 20)[0];
  const glitchy = aggregate(getScenario("glitch").params, [strict], 20)[0];
  assert.ok(glitchy.falseAlarms > normal.falseAlarms * 3);
  assert.ok(glitchy.trust < normal.trust);
});

test("空振りで信頼が減りにくいと、早めに鳴らす世界の不利が縮む", () => {
  const a = aggregate(getScenario("standard").params, [early, standard], 20);
  const b = aggregate(getScenario("forgiving").params, [early, standard], 20);
  const gapA = a[1].protectedShare - a[0].protectedShare;
  const gapB = b[1].protectedShare - b[0].protectedShare;
  assert.ok(gapB < gapA / 2, `${gapB} < ${gapA} / 2`);
});
