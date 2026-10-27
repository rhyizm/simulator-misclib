/**
 * デマと訂正の追いかけっこ: 純粋な計算モデル。
 *
 * 400 人がつながった小さな SNS に 1 本のデマを流し、
 * 「公式の訂正をいつ出すか」だけが違う世界で同時に広がり方を比べる。
 * 単位は「時間 (h)」。描画や React に依存しない。
 */

/** 住民の状態 */
export const UNAWARE = 0; // まだ何も知らない
export const BELIEVER = 1; // デマを信じている
export const DOUBTER = 2; // デマを見たが信じなかった
export const CORRECTED = 3; // 信じたあと、訂正を見て考えを改めた
export const INFORMED = 4; // デマより先に訂正を見た (もう信じない)
export type Status = 0 | 1 | 2 | 3 | 4;

export interface SimParams {
  /** シミュレーションする時間 (h) */
  hours: number;
  /** 格子の一辺。人数は side × side */
  side: number;
  /** となり (8 近傍) とつながっている確率 */
  localLink: number;
  /** 1 人あたりの遠くの知り合い (フォロー) の数 */
  longLinks: number;
  /**
   * 2 つの集団に分かれているか。true なら左右の半分どうしの
   * つながりが crossLink の割合まで減り、訂正の発信元は右側に偏る。
   */
  split: boolean;
  crossLink: number;
  /** デマを最初に投稿する人数 (左上の角に置く) */
  rumorSeeds: number;
  /** 拡散中の人が、つながった 1 人にデマを届ける速さ (1 時間あたり) */
  rumorRate: number;
  /** デマを見て信じる確率 */
  believe: number;
  /** 信じた人がデマを広め始める確率 */
  shareRumor: number;
  /** 拡散の勢いが 1/e に落ちるまでの時間 (h) */
  activeHours: number;
  /** 訂正が 1 人に届く速さ (1 時間あたり、拡散中の人ごと) */
  fixRate: number;
  /** 訂正を受け入れて考えを改めた人が、訂正を広める確率 */
  shareFixConvert: number;
  /** デマを信じていなかった人が、訂正を広める確率 */
  shareFixBystander: number;
  /** 信じた直後に訂正を見たとき、考えを改める確率 */
  acceptFresh: number;
  /** 信じてから長く経ったときに、考えを改める確率 (下限) */
  acceptStale: number;
  /** 考えを改める確率が下限へ近づく時定数 (h) */
  entrenchHours: number;
  /** 訂正の公式発表で、直接それを目にする人の割合 */
  officialReach: number;
  /** 発表のあと、ニュースなどで訂正を目にする割合 (1 時間あたり) */
  newsRate: number;
  /** はじめから手口を知っていてデマを信じない人の割合 (プレバンキング) */
  prebunked: number;
  seed: number;
}

export interface Policy {
  id: string;
  label: string;
  desc: string;
  /** デマが出てから公式の訂正を出すまでの時間 (h)。Infinity なら出さない */
  delay: number;
}

export interface SeriesPoint {
  t: number;
  /** 今デマを信じている人 */
  believers: number;
  /** 訂正を知っている人 (考えを改めた人 + 先に知った人) */
  informed: number;
}

export interface Network {
  side: number;
  n: number;
  /** 隣接リスト */
  adj: number[][];
  /** split のとき右側 (訂正の発信元が多い側) なら true */
  right: boolean[];
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  net: Network;
  t: number;
  status: Status[];
  /** デマを信じた時刻 (信じていなければ NaN) */
  believedAt: number[];
  /** デマを広め始めた時刻 (広めていなければ NaN) */
  rumorFrom: number[];
  /** 訂正を広め始めた時刻 (広めていなければ NaN) */
  fixFrom: number[];
  everBelieved: number;
  peakBelievers: number;
  peakAt: number;
  officialAt: number;
  series: SeriesPoint[];
  rng: () => number;
}

export interface SimStats {
  t: number;
  believers: number;
  everBelieved: number;
  peakBelievers: number;
  peakAt: number;
  corrected: number;
  informed: number;
  /** 一度でも信じた人のうち、考えを改めた人の割合 */
  correctedShare: number;
  /** 最後まで何も知らなかった人 */
  unaware: number;
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

/**
 * つながりを作る。近所 (格子の 8 近傍) と、遠くの知り合い数人。
 * seed だけで決まるので、どの世界も同じつながりを共有できる。
 */
export function buildNetwork(p: SimParams): Network {
  const rng = mulberry32(p.seed ^ 0x2f6b);
  const side = p.side;
  const n = side * side;
  const half = side / 2;
  const right = Array.from({ length: n }, (_, i) => p.split && i % side >= half);
  const sets = Array.from({ length: n }, () => new Set<number>());
  const link = (a: number, b: number) => {
    if (a === b) return;
    sets[a].add(b);
    sets[b].add(a);
  };
  const sameSide = (a: number, b: number) => right[a] === right[b];
  for (let i = 0; i < n; i++) {
    const x = i % side;
    const y = Math.floor(i / side);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= side || ny >= side) continue;
      const j = ny * side + nx;
      if (rng() >= p.localLink) continue;
      if (p.split && !sameSide(i, j) && rng() >= p.crossLink) continue;
      link(i, j);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p.longLinks / 2; k++) {
      let j = Math.floor(rng() * n);
      if (p.split && !sameSide(i, j) && rng() >= p.crossLink) {
        // 分断されていると、遠くの知り合いもほとんどが同じ側
        for (let tries = 0; tries < 20 && !sameSide(i, j); tries++) j = Math.floor(rng() * n);
      }
      link(i, j);
    }
  }
  return { side, n, adj: sets.map((s) => [...s].sort((a, b) => a - b)), right };
}

export const DT = 0.1;

export function createSim(params: SimParams, policy: Policy, net?: Network): SimState {
  const network = net ?? buildNetwork(params);
  const rng = mulberry32(params.seed);
  const n = network.n;
  const status = new Array<Status>(n).fill(UNAWARE);
  const believedAt = new Array<number>(n).fill(NaN);
  const rumorFrom = new Array<number>(n).fill(NaN);
  const fixFrom = new Array<number>(n).fill(NaN);
  // 前もって手口を知っている人
  for (let i = 0; i < n; i++) if (rng() < params.prebunked) status[i] = INFORMED;
  // デマは左上の角から始まる
  let seeded = 0;
  for (let d = 0; seeded < params.rumorSeeds && d < 2 * params.side; d++) {
    for (let x = 0; x <= d && seeded < params.rumorSeeds; x++) {
      const y = d - x;
      if (x >= params.side || y >= params.side) continue;
      const i = y * params.side + x;
      status[i] = BELIEVER;
      believedAt[i] = 0;
      rumorFrom[i] = 0;
      seeded++;
    }
  }
  return {
    policy,
    params,
    net: network,
    t: 0,
    status,
    believedAt,
    rumorFrom,
    fixFrom,
    everBelieved: seeded,
    peakBelievers: seeded,
    peakAt: 0,
    officialAt: NaN,
    series: [{ t: 0, believers: seeded, informed: count(status, INFORMED) }],
    rng,
  };
}

function count(status: Status[], a: Status, b: Status = a): number {
  let c = 0;
  for (const v of status) if (v === a || v === b) c++;
  return c;
}

/** 信じてからの時間が長いほど、訂正を受け入れにくくなる */
export function acceptProb(p: SimParams, hoursBelieved: number): number {
  return p.acceptStale + (p.acceptFresh - p.acceptStale) * Math.exp(-Math.max(0, hoursBelieved) / p.entrenchHours);
}

/** i が訂正を目にしたときの反応 */
function seeFix(s: SimState, i: number, t: number) {
  const p = s.params;
  const st = s.status[i];
  if (st === UNAWARE || st === DOUBTER) {
    s.status[i] = INFORMED;
    if (s.rng() < p.shareFixBystander) s.fixFrom[i] = t;
  } else if (st === BELIEVER) {
    if (s.rng() < acceptProb(p, t - s.believedAt[i])) {
      s.status[i] = CORRECTED;
      s.rumorFrom[i] = NaN;
      if (s.rng() < p.shareFixConvert) s.fixFrom[i] = t;
    }
  }
}

/** i がデマを目にしたときの反応 */
function seeRumor(s: SimState, i: number, t: number) {
  const p = s.params;
  if (s.status[i] !== UNAWARE) return;
  if (s.rng() < p.believe) {
    s.status[i] = BELIEVER;
    s.believedAt[i] = t;
    s.everBelieved++;
    if (s.rng() < p.shareRumor) s.rumorFrom[i] = t;
  } else {
    s.status[i] = DOUBTER;
  }
}

/** シミュレーションを dt 時間進める */
export function step(s: SimState, dt: number = DT) {
  const p = s.params;
  if (s.t >= p.hours) return;
  const t0 = s.t;
  const t1 = Math.min(p.hours, t0 + dt);
  const h = t1 - t0;
  const n = s.net.n;

  // 公式の訂正
  if (Number.isNaN(s.officialAt) && t1 > s.policy.delay) {
    s.officialAt = s.policy.delay;
    for (let i = 0; i < n; i++) {
      // 分断されているとき、公式の発表を直接見る人は右側に偏る
      const reach = p.split ? (s.net.right[i] ? p.officialReach * 1.8 : p.officialReach * 0.2) : p.officialReach;
      if (s.rng() < reach) {
        seeFix(s, i, t1);
        // 公式を直接見た人は、訂正を広めやすい
        if (s.status[i] !== BELIEVER && Number.isNaN(s.fixFrom[i]) && s.rng() < 0.3) s.fixFrom[i] = t1;
      }
    }
  }

  // この刻みで誰に何が届くかを先に決めてから、まとめて反映する
  const rumorHits: number[] = [];
  const fixHits: number[] = [];
  for (let i = 0; i < n; i++) {
    const rf = s.rumorFrom[i];
    if (!Number.isNaN(rf) && s.status[i] === BELIEVER) {
      const act = Math.exp(-(t0 - rf) / p.activeHours);
      if (act > 0.01) {
        const q = 1 - Math.exp(-p.rumorRate * act * h);
        for (const j of s.net.adj[i]) if (s.status[j] === UNAWARE && s.rng() < q) rumorHits.push(j);
      }
    }
    const ff = s.fixFrom[i];
    if (!Number.isNaN(ff)) {
      const act = Math.exp(-(t0 - ff) / p.activeHours);
      if (act > 0.01) {
        const q = 1 - Math.exp(-p.fixRate * act * h);
        for (const j of s.net.adj[i]) {
          const sj = s.status[j];
          if ((sj === UNAWARE || sj === DOUBTER || sj === BELIEVER) && s.rng() < q) fixHits.push(j);
        }
      }
    }
  }
  // ニュースやまとめで訂正を目にする
  if (!Number.isNaN(s.officialAt)) {
    const q = 1 - Math.exp(-p.newsRate * h);
    for (let i = 0; i < n; i++) {
      const sj = s.status[i];
      if (sj === UNAWARE || sj === DOUBTER || sj === BELIEVER) {
        const qi = p.split && !s.net.right[i] ? q * 0.3 : q;
        if (s.rng() < qi) fixHits.push(i);
      }
    }
  }
  for (const j of rumorHits) seeRumor(s, j, t1);
  for (const j of fixHits) seeFix(s, j, t1);

  s.t = t1;
  let believers = 0;
  let informed = 0;
  for (const v of s.status) {
    if (v === BELIEVER) believers++;
    else if (v === CORRECTED || v === INFORMED) informed++;
  }
  if (believers > s.peakBelievers) {
    s.peakBelievers = believers;
    s.peakAt = t1;
  }
  const lastT = s.series[s.series.length - 1].t;
  if (t1 - lastT >= 0.25 - 1e-9 || t1 >= p.hours) {
    s.series.push({ t: Math.round(t1 * 100) / 100, believers, informed });
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
  const corrected = count(s.status, CORRECTED);
  return {
    t: s.t,
    believers: count(s.status, BELIEVER),
    everBelieved: s.everBelieved,
    peakBelievers: s.peakBelievers,
    peakAt: s.peakAt,
    corrected,
    informed: corrected + count(s.status, INFORMED),
    correctedShare: s.everBelieved > 0 ? corrected / s.everBelieved : NaN,
    unaware: count(s.status, UNAWARE),
  };
}

export interface AggregateStats {
  runs: number;
  believers: number;
  everBelieved: number;
  peakBelievers: number;
  peakAt: number;
  corrected: number;
  correctedShare: number;
  informed: number;
}

/** seed を変えて何回も回した平均。各回、どの世界も同じつながりを使う */
export function aggregate(params: SimParams, policies: Policy[], runs: number): AggregateStats[] {
  const sum = policies.map(() => ({ believers: 0, everBelieved: 0, peakBelievers: 0, peakAt: 0, corrected: 0, informed: 0 }));
  for (let r = 0; r < runs; r++) {
    const p = { ...params, seed: params.seed + r * 7919 };
    const net = buildNetwork(p);
    policies.forEach((pol, i) => {
      const st = getStats(runToEnd(createSim(p, pol, net)));
      const a = sum[i];
      a.believers += st.believers;
      a.everBelieved += st.everBelieved;
      a.peakBelievers += st.peakBelievers;
      a.peakAt += st.peakAt;
      a.corrected += st.corrected;
      a.informed += st.informed;
    });
  }
  return sum.map((a) => ({
    runs,
    believers: a.believers / runs,
    everBelieved: a.everBelieved / runs,
    peakBelievers: a.peakBelievers / runs,
    peakAt: a.peakAt / runs,
    corrected: a.corrected / runs,
    // 回ごとの割合ではなく延べ人数で割る
    correctedShare: a.everBelieved > 0 ? a.corrected / a.everBelieved : NaN,
    informed: a.informed / runs,
  }));
}
