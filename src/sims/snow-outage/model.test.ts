import { test } from "node:test";
import assert from "node:assert/strict";
import { NETWORK, aggregate, createSim, getStats, pathBetween, runToEnd } from "./model.ts";
import { getPolicy, getScenario } from "./scenarios.ts";

const wet = getScenario("wet").params;
const now = getPolicy("now");

test("網: 変電所から全部の集落へ 1 本の道でつながっている", () => {
  assert.equal(NETWORK.parent[0], -1);
  for (let v = 1; v < NETWORK.n; v++) {
    assert.ok(NETWORK.parent[v] >= 0 && NETWORK.parent[v] < v);
    const path = pathBetween(NETWORK, 0, v);
    assert.equal(path[path.length - 1], v);
    assert.equal(path.length, NETWORK.depth[v]);
  }
  assert.equal(NETWORK.totalHomes, NETWORK.homes.reduce((a, b) => a + b, 0));
});

test("同じ seed なら結果が一致する (決定的)", () => {
  assert.deepEqual(getStats(runToEnd(createSim(wet, now))), getStats(runToEnd(createSim(wet, now))));
});

test("どの対策の世界でも、同じ雪なら倒木は同じか、伐った世界のほうが少ない", () => {
  const a = createSim(wet, now);
  const b = createSim(wet, getPolicy("crews"));
  const c = createSim(wet, getPolicy("trim"));
  assert.deepEqual(a.events, b.events);
  assert.ok(c.events.length < a.events.length);
  // 伐った世界で起きる倒木は、伐っていない世界でも起きる
  const key = (e: (typeof a.events)[number]) => `${e.kind}:${e.seg}:${e.t}`;
  const all = new Set(a.events.map(key));
  for (const e of c.events) assert.ok(all.has(key(e)));
});

test("雪がやめば、いずれ全部の家に電気が戻る (乾いた雪)", () => {
  const st = getStats(runToEnd(createSim(getScenario("dry").params, now)));
  assert.equal(st.out, 0);
  assert.ok(st.peakOut > 0);
  assert.ok(st.lastRestoreH > 0);
});

test("作業班を倍にすると停電は短くなるが、班を増やす効き目はだんだん薄れる", () => {
  const h = (crews: number) => aggregate(wet, { ...now, crews }, 20).homeHours;
  const h6 = h(6);
  const h12 = h(12);
  const h24 = h(24);
  assert.ok(h12 < h6);
  assert.ok(h24 < h12);
  assert.ok(h6 - h12 > h12 - h24, `${h6} ${h12} ${h24}`);
});

test("電線沿いの木を伐っておくと、作業班を倍にするより停電が短い", () => {
  const crews = aggregate(wet, getPolicy("crews"), 20);
  const trim = aggregate(wet, getPolicy("trim"), 20);
  assert.ok(trim.homeHours < crews.homeHours);
  assert.ok(trim.over72 < crews.over72);
});

test("電源車を出すと、1 日を超える停電が減る", () => {
  const a = aggregate(wet, now, 20);
  const b = aggregate(wet, getPolicy("gen"), 20);
  assert.ok(b.over24 < a.over24);
});

test("夜も作業できれば、最後まで残る停電はずっと短くなる", () => {
  const a = aggregate(wet, now, 20);
  const b = aggregate({ ...wet, workFromHour: 0, workToHour: 24 }, now, 20);
  assert.ok(b.longestH < a.longestH * 0.6, `${b.longestH} vs ${a.longestH}`);
});

test("真冬の乾いた雪は、11 月の湿った雪より停電が短い", () => {
  const a = aggregate(wet, now, 10);
  const b = aggregate(getScenario("dry").params, now, 10);
  assert.ok(b.homeHours < a.homeHours * 0.5);
});
