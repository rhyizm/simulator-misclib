/**
 * サーバーの穴と修正版のシミュレーション: 純粋な計算モデル。
 *
 * 穴の存在が漏れた時刻を 0 時間目として、400 のサイトの 1 週間を流す。
 * どのサイトがいつ気づき、いつ修正版を当てるか、攻撃にどれだけ耐えられるか
 * (攻撃の「運」) を先に決めておき、「止める」「WAF」など対応だけが違う世界で共有する。
 * 単位は「時間」。描画や React に依存しない。
 */

export type SiteKind = "ops" | "small" | "legacy";

export const SITE_KINDS: SiteKind[] = ["ops", "small", "legacy"];

export interface KindParams {
  /** サイト全体に占める割合 */
  share: number;
  /** 穴のニュースに気づく確率 */
  noticeProb: number;
  /** 気づくまでの平均時間 (漏れた時刻から) */
  noticeMean: number;
  /** 気づいたサイトが、修正版の公開 (または気づいた時刻) から当てるまでの平均時間 */
  patchMean: number;
  /** 気づかなかったサイトが、レンタルサーバーの自動更新などで直るまでの平均時間 (修正版の公開から) */
  autoPatchMean: number;
  /** CDN の WAF の後ろにいる確率 */
  cdnProb: number;
}

export interface SimParams {
  hours: number;
  sites: number;
  kinds: Record<SiteKind, KindParams>;
  /** 修正版が公開される時刻 */
  patchAt: number;
  /** CDN 各社が WAF で既定の防御を始める時刻 */
  wafAt: number;
  /** 自分で WAF を入れる場合、気づいてから効き始めるまでの時間 */
  wafSetup: number;
  /** WAF が攻撃を止める割合 (すり抜けがある) */
  wafBlock: number;
  /** 本格的な攻撃の前から続く、狙いを絞った探り (1 サイト 1 時間あたりの乗っ取られやすさ) */
  probeRate: number;
  /** 攻撃が出回りきったときの強さ (1 サイト 1 時間あたり) */
  attackMax: number;
  /** 攻撃が半分の強さに達する時刻 */
  attackMid: number;
  /** 攻撃が広がる速さ (ロジスティック曲線の幅、時間) */
  attackWidth: number;
  seed: number;
}

export interface Policy {
  id: string;
  label: string;
  desc: string;
  /** 気づいてから修正版を当てるまで、サイトを止める */
  stop: boolean;
  /** WAF で攻撃をはじく (CDN の後ろのサイトは既定の防御、それ以外は気づいたら自分で入れる) */
  waf: boolean;
}

export interface Site {
  kind: SiteKind;
  /** 気づいた時刻 (気づかなければ Infinity) */
  noticeAt: number;
  /** 修正版を当てた時刻 (1 週間で当てなければ Infinity もありうる) */
  patchedAt: number;
  cdn: boolean;
  /** 攻撃への耐性 (指数分布)。積み上がった攻撃の強さがこれを超えたら乗っ取られる */
  toughness: number;
}

export type SiteStatus = "open" | "stopped" | "waf" | "patched" | "hacked";

export interface SeriesPoint {
  t: number;
  hacked: number;
  stopped: number;
  patched: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  sites: Site[];
  t: number;
  /** 各サイトに積み上がった攻撃の強さ */
  exposure: number[];
  hackedAt: number[];
  /** 止めていた延べ時間 (サイト×時間) */
  stoppedHours: number;
  series: SeriesPoint[];
}

export interface SimStats {
  t: number;
  hacked: number;
  hackedByKind: Record<SiteKind, number>;
  stoppedNow: number;
  /** 止めていた延べ時間を「サイト×日」で */
  stoppedDays: number;
  patched: number;
  wafNow: number;
  /** 穴が開いたまま、守りもないサイト */
  open: number;
  attack: number;
}

/** 乱数 (mulberry32): seed が同じなら同じ結果になる */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expo(rng: () => number, mean: number): number {
  if (!Number.isFinite(mean)) return Infinity;
  return -Math.log(Math.max(rng(), 1e-12)) * mean;
}

/**
 * サイトの顔ぶれを作る。seed だけで決まるので、対応の違う世界どうしで
 * 同じサイト・同じ気づく時刻・同じ修正の時刻・同じ攻撃の運を共有できる。
 * 種類ごとに並べておく (描画で上から 運用 / 小規模 / 古い の順になる)。
 */
export function generateSites(p: SimParams): Site[] {
  const rng = mulberry32(p.seed ^ 0x9e37);
  const sites: Site[] = [];
  let made = 0;
  SITE_KINDS.forEach((kind, ki) => {
    const k = p.kinds[kind];
    const n = ki === SITE_KINDS.length - 1 ? p.sites - made : Math.round(p.sites * k.share);
    made += n;
    for (let i = 0; i < n; i++) {
      const noticed = rng() < k.noticeProb;
      const noticeAt = noticed ? expo(rng, k.noticeMean) : Infinity;
      const patchedAt = noticed
        ? Math.max(p.patchAt, noticeAt) + expo(rng, k.patchMean)
        : p.patchAt + expo(rng, k.autoPatchMean);
      const cdn = rng() < k.cdnProb;
      const toughness = expo(rng, 1);
      sites.push({ kind, noticeAt, patchedAt, cdn, toughness });
    }
  });
  return sites;
}

/** 時刻 t の攻撃の強さ (1 サイト 1 時間あたり) */
export function attackRate(p: SimParams, t: number): number {
  return p.probeRate + p.attackMax / (1 + Math.exp(-(t - p.attackMid) / p.attackWidth));
}

/** この世界で、サイトが WAF に守られ始める時刻 */
export function wafFrom(p: SimParams, policy: Policy, site: Site): number {
  if (!policy.waf) return Infinity;
  if (site.cdn) return p.wafAt;
  return Math.max(p.wafAt, site.noticeAt + p.wafSetup);
}

export function isStopped(policy: Policy, site: Site, t: number): boolean {
  return policy.stop && t >= site.noticeAt && t < site.patchedAt;
}

export function siteStatus(s: SimState, i: number): SiteStatus {
  const site = s.sites[i];
  if (s.hackedAt[i] <= s.t) return "hacked";
  if (s.t >= site.patchedAt) return "patched";
  if (isStopped(s.policy, site, s.t)) return "stopped";
  if (s.t >= wafFrom(s.params, s.policy, site)) return "waf";
  return "open";
}

export const DT = 0.25;

export function createSim(params: SimParams, policy: Policy, sites?: Site[]): SimState {
  const ss = sites ?? generateSites(params);
  return {
    policy,
    params,
    sites: ss,
    t: 0,
    exposure: new Array<number>(ss.length).fill(0),
    hackedAt: new Array<number>(ss.length).fill(Infinity),
    stoppedHours: 0,
    series: [{ t: 0, hacked: 0, stopped: 0, patched: 0 }],
  };
}

/** シミュレーションを dt 時間進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.hours) return;
  const t0 = s.t;
  const t1 = Math.min(p.hours, t0 + dt);
  const h = t1 - t0;
  const mid = t0 + h / 2;
  const rate = attackRate(p, mid);
  let stopped = 0;
  let patched = 0;
  let hacked = 0;
  for (let i = 0; i < s.sites.length; i++) {
    const site = s.sites[i];
    if (s.hackedAt[i] < Infinity) {
      hacked++;
      continue;
    }
    if (mid >= site.patchedAt) {
      patched++;
      continue;
    }
    if (isStopped(s.policy, site, mid)) {
      // 止めているサイトには攻撃が届かない
      s.stoppedHours += h;
      stopped++;
      continue;
    }
    const shield = mid >= wafFrom(p, s.policy, site) ? 1 - p.wafBlock : 1;
    s.exposure[i] += rate * shield * h;
    if (s.exposure[i] >= site.toughness) {
      s.hackedAt[i] = t1;
      hacked++;
    }
  }
  s.t = t1;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 1 - 1e-9 || s.t >= p.hours) {
    s.series.push({ t: Math.round(s.t * 100) / 100, hacked, stopped, patched });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.hours;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

export function getStats(s: SimState): SimStats {
  const hackedByKind: Record<SiteKind, number> = { ops: 0, small: 0, legacy: 0 };
  let hacked = 0;
  let stoppedNow = 0;
  let patched = 0;
  let wafNow = 0;
  let open = 0;
  for (let i = 0; i < s.sites.length; i++) {
    const st = siteStatus(s, i);
    if (st === "hacked") {
      hacked++;
      hackedByKind[s.sites[i].kind]++;
    } else if (st === "stopped") stoppedNow++;
    else if (st === "patched") patched++;
    else if (st === "waf") wafNow++;
    else open++;
  }
  return {
    t: s.t,
    hacked,
    hackedByKind,
    stoppedNow,
    stoppedDays: s.stoppedHours / 24,
    patched,
    wafNow,
    open,
    attack: attackRate(s.params, s.t),
  };
}

export interface AggregateStats {
  runs: number;
  hacked: number;
  hackedByKind: Record<SiteKind, number>;
  stoppedDays: number;
  /** 1 週間たっても止まったままのサイト */
  stoppedAtEnd: number;
}

/** seed を変えて何回も回した平均。各回、どの世界も同じサイトの顔ぶれを使う */
export function aggregate(params: SimParams, policies: Policy[], runs: number): AggregateStats[] {
  const acc = policies.map<AggregateStats>(() => ({
    runs,
    hacked: 0,
    hackedByKind: { ops: 0, small: 0, legacy: 0 },
    stoppedDays: 0,
    stoppedAtEnd: 0,
  }));
  for (let r = 0; r < runs; r++) {
    const p = { ...params, seed: params.seed + r * 7919 };
    const sites = generateSites(p);
    policies.forEach((pol, i) => {
      const st = getStats(runToEnd(createSim(p, pol, sites)));
      const a = acc[i];
      a.hacked += st.hacked;
      for (const k of SITE_KINDS) a.hackedByKind[k] += st.hackedByKind[k];
      a.stoppedDays += st.stoppedDays;
      a.stoppedAtEnd += st.stoppedNow;
    });
  }
  return acc.map((a) => ({
    runs,
    hacked: a.hacked / runs,
    hackedByKind: {
      ops: a.hackedByKind.ops / runs,
      small: a.hackedByKind.small / runs,
      legacy: a.hackedByKind.legacy / runs,
    },
    stoppedDays: a.stoppedDays / runs,
    stoppedAtEnd: a.stoppedAtEnd / runs,
  }));
}
