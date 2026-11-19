import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, createSim, getStats, runToEnd } from "./model.ts";
import { getPolicy, getScenario } from "./scenarios.ts";

const pol = (id: string) => getPolicy(id).policy;

test("同じ seed なら結果が一致する (決定的)", () => {
  const p = getScenario("poor").params;
  assert.deepEqual(getStats(runToEnd(createSim(p, pol("all")))), getStats(runToEnd(createSim(p, pol("all")))));
});

test("どの世界でも同じクマ・同じ木の配置から始まる", () => {
  const p = getScenario("poor").params;
  const a = createSim(p, pol("none"));
  const b = createSim(p, pol("attract"));
  assert.deepEqual(
    a.bears.map((x) => [x.hx, x.hy]),
    b.bears.map((x) => [x.hx, x.hy]),
  );
  assert.deepEqual(
    a.foods.map((f) => [f.x, f.y]),
    b.foods.map((f) => [f.x, f.y]),
  );
});

test("春の捕獲は割合が低い世界の分を、高い世界でも同じクマから取る", () => {
  const p = getScenario("normal").params;
  const low = createSim(p, { ...pol("none"), springCull: 0.1 });
  const high = createSim(p, { ...pol("none"), springCull: 0.3 });
  const gone = (s: typeof low) => new Set(s.bears.filter((b) => b.removedDay === -2).map((b) => b.id));
  const hi = gone(high);
  for (const id of gone(low)) assert.ok(hi.has(id));
  assert.ok(hi.size > gone(low).size);
});

test("木の実が凶作の秋は、豊作の秋よりずっと多く町に出てくる", () => {
  const poor = aggregate(getScenario("poor").params, pol("none"), 10);
  const good = aggregate(getScenario("good").params, pol("none"), 10);
  assert.ok(poor.townBearDays > good.townBearDays * 10, `${poor.townBearDays} vs ${good.townBearDays}`);
  assert.ok(poor.thinShare > good.thinShare);
});

test("凶作の秋に柿とごみを片づけると、出没はあまり減らないが里の味を覚えるクマは大きく減る", () => {
  const p = getScenario("poor").params;
  const a = aggregate(p, pol("none"), 20);
  const b = aggregate(p, pol("attract"), 20);
  assert.ok(b.farmBearDays > a.farmBearDays * 0.85, `${b.farmBearDays} vs ${a.farmBearDays}`);
  assert.ok(b.habituated < a.habituated * 0.5, `${b.habituated} vs ${a.habituated}`);
  assert.ok(b.thinShare > a.thinShare);
});

test("出てきたクマを必ず捕る体制は被害を減らすが、多くのクマを捕る", () => {
  const p = getScenario("poor").params;
  const a = aggregate(p, pol("none"), 20);
  const b = aggregate(p, pol("capture"), 20);
  assert.ok(b.injuryExp < a.injuryExp * 0.7);
  assert.ok(b.captured > a.captured * 2);
  assert.ok(b.alive < a.alive * 0.5);
});

test("やぶを刈ると、里に出てくるクマが減る", () => {
  const p = getScenario("poor").params;
  const a = aggregate(p, pol("none"), 20);
  const b = aggregate(p, pol("buffer"), 20);
  assert.ok(b.farmBearDays < a.farmBearDays * 0.85);
});

test("全部のせは、どの対策を 1 つだけ選ぶよりも人身被害が少ない", () => {
  const p = getScenario("poor").params;
  const all = aggregate(p, pol("all"), 20);
  for (const id of ["none", "cull", "capture", "attract", "buffer"]) {
    const o = aggregate(p, pol(id), 20);
    assert.ok(all.injuryExp < o.injuryExp, `${id}: ${all.injuryExp} vs ${o.injuryExp}`);
  }
});
