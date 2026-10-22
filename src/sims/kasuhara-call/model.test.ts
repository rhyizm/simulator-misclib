import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, runToEnd, getStats, aggregate } from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("normal").params;
  const a = getStats(runToEnd(createSim(p, "cap")));
  const b = getStats(runToEnd(createSim(p, "cap")));
  assert.deepEqual(a, b);
});

test("2 つの世界には同じ時刻に同じ電話がかかる", () => {
  const p = getScenario("normal").params;
  const a = createSim(p, "noLimit").calls;
  const b = createSim(p, "cap").calls;
  assert.deepEqual(
    a.map((c) => [c.tArrive, c.harass, c.need]),
    b.map((c) => [c.tArrive, c.harass, c.need]),
  );
});

test("電話の id は並び順と一致し、同時に話せるのはオペレーターの人数まで", () => {
  for (const policy of ["noLimit", "cap"] as const) {
    const s = runToEnd(createSim(getScenario("callback").params, policy));
    s.calls.forEach((c, i) => assert.equal(c.id, i));
    assert.ok(s.calls.every((c) => c.state === "done" || c.state === "abandoned"));
    const talked = s.calls.filter((c) => c.state === "done");
    const events = talked.flatMap((c) => [
      { t: c.tStart, d: 1 },
      { t: c.tEnd, d: -1 },
    ]);
    events.sort((x, y) => x.t - y.t || x.d - y.d);
    let busy = 0;
    for (const e of events) {
      busy += e.d;
      assert.ok(busy <= s.params.operators);
    }
  }
});

test("打ち切りの世界では、カスハラの電話は 1 回あたり上限を超えない", () => {
  const p = getScenario("normal").params;
  const s = runToEnd(createSim(p, "cap"));
  for (const c of s.calls) {
    if (c.harass && c.state === "done") assert.ok(c.tEnd - c.tStart <= p.capMin + 1e-9);
  }
});

test("いつもの平日: 打ち切りで待ちきれない客と早退が減る", () => {
  const p = getScenario("normal").params;
  const nl = aggregate(p, "noLimit", 30);
  const cap = aggregate(p, "cap", 30);
  assert.ok(cap.abandonRate < nl.abandonRate, `${cap.abandonRate} < ${nl.abandonRate}`);
  assert.ok(cap.harassMin < nl.harassMin);
  assert.ok(cap.leftDays < nl.leftDays / 4, `${cap.leftDays} < ${nl.leftDays} / 4`);
});

test("ほとんど掛け直してくると、カスハラに取られる時間は減らないが早退は減る", () => {
  const p = getScenario("callback").params;
  const nl = aggregate(p, "noLimit", 30);
  const cap = aggregate(p, "cap", 30);
  assert.ok(cap.harassMin > nl.harassMin * 0.95, `${cap.harassMin} > ${nl.harassMin} * 0.95`);
  assert.ok(cap.harassCalls > nl.harassCalls * 1.5);
  assert.ok(cap.leftDays < nl.leftDays / 2);
});
