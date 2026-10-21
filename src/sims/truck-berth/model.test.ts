import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, runToEnd, getStats, aggregate } from "./model.ts";
import { getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("normal").params;
  const a = getStats(runToEnd(createSim(p, "reservation")));
  const b = getStats(runToEnd(createSim(p, "reservation")));
  assert.deepEqual(a, b);
});

test("2 つの世界には同じトラック (同じ荷物・同じ遅れ) が来る", () => {
  const p = getScenario("traffic").params;
  const a = createSim(p, "firstCome").trucks;
  const b = createSim(p, "reservation").trucks;
  assert.deepEqual(
    a.map((t) => [t.am, t.service, t.delay]),
    b.map((t) => [t.am, t.service, t.delay]),
  );
});

test("バースは同時に本数以上使われず、全員が荷降ろしを終える", () => {
  for (const policy of ["firstCome", "reservation"] as const) {
    const s = runToEnd(createSim(getScenario("overload").params, policy));
    assert.ok(s.trucks.every((t) => t.state === "done"));
    for (const t of s.trucks) assert.ok(t.tDock >= s.params.openAt && t.tDock >= Math.floor(t.tArrive));
    const events = s.trucks.flatMap((t) => [
      { t: t.tDock, d: 1 },
      { t: t.tDone, d: -1 },
    ]);
    events.sort((x, y) => x.t - y.t || x.d - y.d);
    let busy = 0;
    for (const e of events) {
      busy += e.d;
      assert.ok(busy <= s.params.berths);
    }
  }
});

test("いつもの平日: 予約制で平均の荷待ちと 2 時間超えが大きく減る", () => {
  const p = getScenario("normal").params;
  const fc = aggregate(p, "firstCome", 20);
  const rs = aggregate(p, "reservation", 20);
  assert.ok(rs.avgWait < fc.avgWait / 2, `${rs.avgWait} < ${fc.avgWait} / 2`);
  assert.ok(rs.over2h < fc.over2h / 2);
  assert.ok(rs.maxWaiting < fc.maxWaiting);
});

test("予約制では予約しないトラックが割を食う", () => {
  const p = getScenario("walkin").params;
  const fc = aggregate(p, "firstCome", 20);
  const rs = aggregate(p, "reservation", 20);
  assert.ok(rs.avgWaitWalkIn > fc.avgWait, `${rs.avgWaitWalkIn} > ${fc.avgWait}`);
});

test("荷物が多すぎる日は、どちらでも時間帯に間に合わないトラックが出る", () => {
  const p = getScenario("overload").params;
  const fc = aggregate(p, "firstCome", 20);
  const rs = aggregate(p, "reservation", 20);
  assert.ok(fc.missWindow > 0.15 && rs.missWindow > 0.15);
  assert.ok(Math.abs(fc.missWindow - rs.missWindow) < 0.1);
  // ただし予約制では待つ場所が路上から予定表に移る
  assert.ok(rs.avgWait < fc.avgWait / 2);
});
