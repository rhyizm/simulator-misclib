import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, generateTown, getStats, runToEnd } from "./model.ts";
import { getScenario, policies } from "./scenarios.ts";

const [now, food7, all7] = policies;

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("city").params;
  const a = getStats(runToEnd(createSim(p, now)));
  const b = getStats(runToEnd(createSim(p, now)));
  assert.deepEqual(a, b);
});

test("どの世界も同じ町・同じ被害を共有する", () => {
  const p = getScenario("city").params;
  const town = generateTown(p);
  const st = policies.map((pol) => getStats(runToEnd(createSim(p, pol, town))));
  assert.equal(new Set(st.map((s) => s.population)).size, 1);
  assert.equal(new Set(st.map((s) => s.reasons.damage)).size, 1);
});

test("人数は増えも減りもしない", () => {
  const p = getScenario("peninsula").params;
  const s = createSim(p, now);
  runToEnd(s);
  for (const pt of s.series) assert.equal(pt.home + pt.shelter + pt.overflow, s.population);
});

test("水と食料だけ増やしても、トイレで家を出る人に置き換わるだけ", () => {
  const r = aggregate(getScenario("city").params, [now, food7, all7], 30);
  assert.ok(r[1].reasons.water + r[1].reasons.food < (r[0].reasons.water + r[0].reasons.food) / 5);
  assert.ok(r[1].reasons.toilet > r[0].reasons.toilet);
  // 家を出る人の減り方は 2 割未満
  assert.ok(r[1].everLeft > r[0].everLeft * 0.8, `${r[1].everLeft} > ${r[0].everLeft} * 0.8`);
});

test("トイレまでそろえると、都市では避難所がほぼ定員に収まる", () => {
  const r = aggregate(getScenario("city").params, [now, all7], 30);
  assert.ok(r[0].peakEvacuees > r[0].capacity * 3);
  assert.ok(r[1].peakEvacuees < r[1].capacity * 1.4);
  assert.ok(r[1].overflowPersonDays < r[0].overflowPersonDays / 5);
});

test("断水が 7 日を超えて続く半島では、7 日分の備えでも避難所はあふれる", () => {
  const r = aggregate(getScenario("peninsula").params, [all7], 30)[0];
  assert.ok(r.overCapacityShare > 0.9);
  assert.ok(r.reasons.water > 0);
});

test("給水所に通える世帯が増えると、家に残れる人が増える", () => {
  const p = getScenario("peninsula").params;
  const lo = aggregate({ ...p, fetchRate: 0.4 }, [all7], 20)[0];
  const hi = aggregate({ ...p, fetchRate: 0.85 }, [all7], 20)[0];
  assert.ok(hi.everLeft < lo.everLeft);
});
