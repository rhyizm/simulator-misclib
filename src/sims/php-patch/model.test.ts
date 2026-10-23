import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, runToEnd, wafFrom } from "./model.ts";
import { getScenario, policies } from "./scenarios.ts";

const [wait, stop, waf] = policies;

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("actual").params;
  const a = getStats(runToEnd(createSim(p, wait)));
  const b = getStats(runToEnd(createSim(p, wait)));
  assert.deepEqual(a, b);
});

test("WAF がすべて止めるなら、乗っ取られるのは WAF が効く前だけ", () => {
  const p = { ...getScenario("actual").params, wafBlock: 1 };
  const s = runToEnd(createSim(p, waf));
  s.sites.forEach((site, i) => {
    if (s.hackedAt[i] < Infinity) assert.ok(s.hackedAt[i] <= wafFrom(p, waf, site) + 0.25);
  });
});

test("止めても WAF でも、待つだけより乗っ取られるサイトは減る", () => {
  const r = aggregate(getScenario("actual").params, [wait, stop, waf], 20);
  assert.ok(r[1].hacked < r[0].hacked * 0.6);
  assert.ok(r[2].hacked < r[0].hacked * 0.6);
  assert.equal(r[0].stoppedDays, 0);
  assert.ok(r[1].stoppedDays > 300);
});

test("修正版の公開が遅れると、待つだけの世界で運用チームのあるサイトまで乗っ取られる", () => {
  const a = aggregate(getScenario("actual").params, [wait], 20)[0];
  const b = aggregate(getScenario("planned").params, [wait], 20)[0];
  assert.ok(b.hackedByKind.ops > a.hackedByKind.ops * 4);
  assert.ok(b.hacked > a.hacked + 60);
});

test("古い PHP のサイトは、どの対応でも半分以上が乗っ取られる", () => {
  const p = getScenario("actual").params;
  const legacy = Math.round(p.sites * 0.2);
  const r = aggregate(p, policies, 20);
  for (const a of r) assert.ok(a.hackedByKind.legacy > legacy * 0.5, `${a.hackedByKind.legacy}`);
});

test("レンタルサーバーが一斉に更新すると、小さなサイトの被害が大きく減る", () => {
  const a = aggregate(getScenario("actual").params, [wait], 20)[0];
  const b = aggregate(getScenario("hosting").params, [wait], 20)[0];
  assert.ok(b.hackedByKind.small < a.hackedByKind.small / 2);
});
