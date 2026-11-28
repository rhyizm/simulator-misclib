import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, runToEnd } from "./model.ts";
import { getPolicy, getScenario } from "./scenarios.ts";

const free = getPolicy("free");
const fee = getPolicy("fee");

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("weekday").params;
  assert.deepEqual(getStats(runToEnd(createSim(p, fee))), getStats(runToEnd(createSim(p, fee))));
});

test("どちらの世界でも、具合が悪くなる人は同じ", () => {
  const p = getScenario("weekday").params;
  const a = createSim(p, free);
  const b = createSim(p, fee);
  assert.equal(a.patients.length, b.patients.length);
  for (let i = 0; i < a.patients.length; i++) {
    assert.equal(a.patients[i].tOnset, b.patients[i].tOnset);
    assert.equal(a.patients[i].severity, b.patients[i].severity);
  }
});

test("無料なら全員が 119 番をし、1 日の終わりには (ほぼ) 全員が運ばれている", () => {
  const p = { ...getScenario("weekday").params, durationSec: 86400 };
  const st = getStats(runToEnd(createSim(p, free)));
  assert.equal(st.calls, st.onset);
  assert.equal(st.selfMild, 0);
  assert.equal(st.delayedSevere, 0);
  assert.ok(st.transported >= st.calls - 4);
});

test("選定療養費: 軽症の 119 番は 2〜3 割減るが、払うのは大きな病院へ運ばれた人の数 % だけ", () => {
  const p = getScenario("weekday").params;
  const a = aggregate(p, free, 40);
  const b = aggregate(p, fee, 40);
  const cut = 1 - b.callsMild / a.callsMild;
  assert.ok(cut > 0.18 && cut < 0.32, `cut ${cut}`);
  const rate = b.charged / b.toLarge;
  assert.ok(rate > 0.01 && rate < 0.06, `rate ${rate}`);
  // 中等症以上の 119 番の数は変わらない (遅れるだけ)
  assert.equal(Math.round(a.callsSevere * 10), Math.round(b.callsSevere * 10));
});

test("選定療養費では中等症以上にも呼び控えが出るが、#7119 を案内すると減る", () => {
  const p = getScenario("weekday").params;
  const b = aggregate(p, fee, 30);
  const c = aggregate(p, getPolicy("fee7119"), 30);
  assert.ok(b.delayedSevere > 0.5);
  assert.ok(c.delayedSevere < b.delayedSevere * 0.5);
});

test("全員から取ると、呼び控える重い人は選定療養費より多い", () => {
  const p = getScenario("weekday").params;
  const b = aggregate(p, fee, 30);
  const d = aggregate(p, getPolicy("all"), 30);
  assert.ok(d.delayedSevere > b.delayedSevere * 2);
});

test("混む日ほど、軽症が減ったぶん重い人の到着が早くなる", () => {
  const normal = getScenario("weekday").params;
  const heat = getScenario("heat").params;
  const gainNormal = aggregate(normal, free, 30).severeResponseMin - aggregate(normal, fee, 30).severeResponseMin;
  const gainHeat = aggregate(heat, free, 30).severeResponseMin - aggregate(heat, fee, 30).severeResponseMin;
  assert.ok(gainHeat > gainNormal + 0.5, `${gainHeat} vs ${gainNormal}`);
});

test("救急車を増やすと到着は早くなるが、救急外来の混雑 (搬送困難) は減らない", () => {
  const p = getScenario("flu").params;
  const a = aggregate(p, free, 30);
  const u = aggregate(p, getPolicy("units"), 30);
  const f = aggregate(p, fee, 30);
  assert.ok(u.severeResponseMin < a.severeResponseMin);
  assert.ok(u.difficult >= a.difficult * 0.9);
  assert.ok(f.difficult < a.difficult);
});
