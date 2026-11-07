import { test } from "node:test";
import assert from "node:assert/strict";
import { CELLS, REAL_SERVERS, aggregate, createSim, getStats, runToEnd } from "./model.ts";
import { POLICIES, getScenario } from "./scenarios.ts";

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("quiet").params;
  const a = getStats(runToEnd(createSim(p, POLICIES.all)));
  const b = getStats(runToEnd(createSim(p, POLICIES.all)));
  assert.deepEqual(a, b);
});

test("区画は 400 マスを等分し、入り込む場所は方針によらず同じ", () => {
  const p = getScenario("quiet").params;
  const one = createSim(p, POLICIES.now);
  const ten = createSim(p, POLICIES.split);
  assert.equal(one.k, 1);
  assert.equal(ten.k, 10);
  for (let seg = 0; seg < 10; seg++) assert.equal(ten.segmentOf.filter((x) => x === seg).length, CELLS / 10);
  assert.equal(one.foothold, ten.foothold);
});

test("1 本の鍵で全部: 鍵を盗まれた時点で全サーバーに届く", () => {
  const p = getScenario("quiet").params;
  const s = runToEnd(createSim(p, POLICIES.now));
  const st = getStats(s);
  assert.ok(st.firstKeyDay >= 0);
  assert.ok(Math.abs(st.reachableServers - REAL_SERVERS) < 1e-6);
});

test("静かに潜む攻撃者: 1 本の鍵だと気づくのは 2 か月以上あと、被害は大半に及ぶ", () => {
  const p = getScenario("quiet").params;
  const now = aggregate(p, POLICIES.now, 60);
  assert.ok(now.mean.dwellDays > 60 && now.mean.dwellDays < 90, `${now.mean.dwellDays}`);
  assert.ok(now.mean.infectedServers > REAL_SERVERS * 0.6, `${now.mean.infectedServers}`);
});

test("鍵を分けると被害は減るが、気づくのは遅くなる", () => {
  const p = getScenario("quiet").params;
  const now = aggregate(p, POLICIES.now, 60);
  const split = aggregate(p, POLICIES.split, 60);
  assert.ok(split.mean.infectedServers < now.mean.infectedServers * 0.6);
  assert.ok(split.mean.dwellDays > now.mean.dwellDays);
  assert.ok(split.detectedRate < now.detectedRate);
});

test("見張りは静かな攻撃者には効くが、急ぐ攻撃者には間に合わないことがある", () => {
  const quiet = aggregate(getScenario("quiet").params, POLICIES.monitor, 60);
  const fast = aggregate(getScenario("fast").params, POLICIES.monitor, 60);
  assert.ok(quiet.mean.infectedServers < 1000, `${quiet.mean.infectedServers}`);
  assert.ok(fast.mean.infectedServers > 5000, `${fast.mean.infectedServers}`);
});

test("全部のせは、どのシナリオでも 1 本の鍵より 1 桁以上被害が小さい", () => {
  for (const id of ["quiet", "fast", "noisy"]) {
    const p = getScenario(id).params;
    const now = aggregate(p, POLICIES.now, 60);
    const all = aggregate(p, POLICIES.all, 60);
    assert.ok(all.mean.infectedServers < now.mean.infectedServers / 10, `${id}: ${all.mean.infectedServers}`);
  }
});
