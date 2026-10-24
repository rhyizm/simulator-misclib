import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKS, CURRENT_PR, adams, aggregate, buildRows, dhondtOrder, generateElection, worldResult } from "./model.ts";
import { PR_TOTALS, getScenario } from "./scenarios.ts";

test("アダムズ方式で現行のブロック定数 (計 176) が再現できる", () => {
  assert.equal(CURRENT_PR, 176);
  assert.deepEqual(
    adams(BLOCKS.map((b) => b.pop), 176),
    BLOCKS.map((b) => b.seats),
  );
});

test("定数を減らしてもどのブロックも増えない (アダムズ方式の単調性)", () => {
  const pops = BLOCKS.map((b) => b.pop);
  for (let t = 60; t < 176; t++) {
    const a = adams(pops, t);
    const b = adams(pops, t + 1);
    assert.equal(a.reduce((x, y) => x + y, 0), t);
    a.forEach((v, i) => assert.ok(v <= b[i]));
  }
});

test("ドント方式: 先頭 m 席がそのまま定数 m の配分になる", () => {
  const votes = [100, 80, 30, 20];
  const all = dhondtOrder(votes, 8, [true, true, true, true]);
  // 商: 100, 80, 50, 40, 33.3, 30 (C), 26.7 (B), 25 (A)
  assert.deepEqual(all, [0, 1, 0, 1, 0, 2, 1, 0]);
  const count = (o: number[]) => votes.map((_, i) => o.filter((x) => x === i).length);
  assert.deepEqual(count(all.slice(0, 5)), [3, 2, 0, 0]);
  assert.deepEqual(count(dhondtOrder(votes, 5, [true, true, true, true])), [3, 2, 0, 0]);
});

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("like2024").params;
  assert.deepEqual(generateElection(p), generateElection(p));
});

test("どの世界でも議席の合計が定数と一致する", () => {
  const p = getScenario("like2024").params;
  const e = generateElection(p);
  const rows = buildRows(e, p.parties, "block", [...PR_TOTALS]);
  PR_TOTALS.forEach((t, w) => {
    const r = worldResult(e, rows, w, "block");
    assert.equal(r.prTotal, t);
    assert.equal(r.pr.reduce((a, v) => a + v, 0), t);
    assert.equal(r.total.reduce((a, v) => a + v, 0), r.house);
  });
});

test("ブロック制で比例を減らすと、小さな党ほど議席を失いやすく、単独過半数が出やすくなる", () => {
  const p = getScenario("like2024").params;
  const agg = aggregate(p, "block", [...PR_TOTALS], 60);
  const h = p.parties.findIndex((x) => x.name === "H 党");
  assert.ok(agg[2].zeroRate[h] > agg[0].zeroRate[h] + 0.4);
  assert.ok(agg[2].wasted > agg[0].wasted);
  assert.ok(agg[2].majorityRate > agg[0].majorityRate);
});

test("全国 1 区なら、削減の割合はどの党もほぼ同じ", () => {
  const p = getScenario("like2024").params;
  const agg = aggregate(p, "national", [...PR_TOTALS], 40);
  p.parties.forEach((x, i) => {
    if (x.minor) return;
    const ratio = agg[2].pr[i] / agg[0].pr[i];
    assert.ok(Math.abs(ratio - 131 / 176) < 0.06, `${x.name}: ${ratio}`);
  });
});
