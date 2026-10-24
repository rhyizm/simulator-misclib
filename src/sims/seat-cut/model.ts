/**
 * 衆院の比例代表の定数を減らすと、どの党の議席が消えるのかのモデル。
 *
 * - 11 の比例ブロックに、国勢調査人口 (概数) からアダムズ方式で定数を割り振る
 * - ブロックの中ではドント方式で党に議席を配る
 * - 小選挙区 (289) は定数を変えないので、どの世界でも同じ結果を使う
 *
 * 同じ 1 回の選挙 (同じ票) を、比例定数だけが違う世界に流して比べる。
 * ドント方式もアダムズ方式も「定数を減らすと、最後に配られた席から消える」性質があるので、
 * 削られる席は現行の配分の「後ろの方」にある席とちょうど一致する。
 */

export interface Block {
  name: string;
  /** 2020 年国勢調査の人口 (万人, 概数) */
  pop: number;
  /** 現行の比例定数 */
  seats: number;
  /** 小選挙区の数 */
  districts: number;
}

export const BLOCKS: Block[] = [
  { name: "北海道", pop: 522, seats: 8, districts: 12 },
  { name: "東北", pop: 861, seats: 12, districts: 21 },
  { name: "北関東", pop: 1390, seats: 19, districts: 33 },
  { name: "南関東", pop: 1633, seats: 23, districts: 36 },
  { name: "東京", pop: 1375, seats: 19, districts: 30 },
  { name: "北陸信越", pop: 718, seats: 10, districts: 18 },
  { name: "東海", pop: 1492, seats: 21, districts: 33 },
  { name: "近畿", pop: 2054, seats: 28, districts: 45 },
  { name: "中国", pop: 725, seats: 10, districts: 17 },
  { name: "四国", pop: 369, seats: 6, districts: 10 },
  { name: "九州", pop: 1425, seats: 20, districts: 34 },
];

export const CURRENT_PR = BLOCKS.reduce((a, b) => a + b.seats, 0); // 176
export const SMD_TOTAL = BLOCKS.reduce((a, b) => a + b.districts, 0); // 289

export interface Party {
  name: string;
  /** 全国の比例得票率 (%)。合計が 100 でなくてもよい (正規化する) */
  share: number;
  /** 小選挙区での強さ。1 なら比例と同じ得票、0 なら候補を立てない */
  smd: number;
  /** ブロックごとの強さの偏り (倍率)。ブロック名 → 倍率 */
  bias?: Record<string, number>;
  /** 「その他」のような、議席の割り振りに加わらない票 */
  minor?: boolean;
}

export interface ElectionParams {
  parties: Party[];
  /** 選挙ごとの全国的な風 (対数正規の標準偏差) */
  swingSigma: number;
  /** ブロックごとのばらつき */
  regionSigma: number;
  /** 小選挙区ごとのばらつき (候補者の顔ぶれなど) */
  districtSigma: number;
  seed: number;
}

export type Mode = "block" | "national";

export interface Election {
  /** [ブロック][党] の比例得票 (万票) */
  blockVotes: number[][];
  /** 全国の比例得票率 (0〜1) */
  national: number[];
  /** 小選挙区の党ごとの議席 */
  smd: number[];
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

function gauss(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TURNOUT = 0.54;

/** 1 回の選挙の票を作る */
export function generateElection(p: ElectionParams): Election {
  const rng = mulberry32(p.seed);
  const n = p.parties.length;
  const swing = p.parties.map(() => Math.exp(gauss(rng) * p.swingSigma));
  const blockVotes: number[][] = [];
  const smd = new Array<number>(n).fill(0);
  for (const b of BLOCKS) {
    const raw = p.parties.map((pt, i) => pt.share * swing[i] * (pt.bias?.[b.name] ?? 1) * Math.exp(gauss(rng) * p.regionSigma));
    const sum = raw.reduce((a, v) => a + v, 0);
    const shares = raw.map((v) => v / sum);
    blockVotes.push(shares.map((s) => s * b.pop * TURNOUT));
    // 小選挙区: 比例の得票に「小選挙区での強さ」を掛け、いちばん多い党が勝つ
    for (let d = 0; d < b.districts; d++) {
      let best = -1;
      let bestScore = -1;
      for (let i = 0; i < n; i++) {
        const pt = p.parties[i];
        if (pt.smd <= 0) continue;
        const score = shares[i] * pt.smd * Math.exp(gauss(rng) * p.districtSigma);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best >= 0) smd[best]++;
    }
  }
  const totals = new Array<number>(n).fill(0);
  for (const row of blockVotes) row.forEach((v, i) => (totals[i] += v));
  const all = totals.reduce((a, v) => a + v, 0);
  return { blockVotes, national: totals.map((v) => v / all), smd };
}

/**
 * アダムズ方式: 人口 ÷ 除数 を切り上げる。どのブロックにも最低 1 席。
 * 「k 席持っているブロックの次の 1 席の強さ = 人口 / k」で 1 席ずつ配るのと同じ。
 */
export function adams(pops: number[], total: number): number[] {
  const seats = pops.map(() => 1);
  for (let k = pops.length; k < total; k++) {
    let best = 0;
    for (let i = 1; i < pops.length; i++) if (pops[i] / seats[i] > pops[best] / seats[best]) best = i;
    seats[best]++;
  }
  return seats;
}

/**
 * ドント方式で、議席が配られる順に党の番号を並べる。
 * 先頭から m 個を取れば定数 m のときの配分になる。
 */
export function dhondtOrder(votes: number[], seats: number, eligible: boolean[]): number[] {
  const won = votes.map(() => 0);
  const order: number[] = [];
  for (let k = 0; k < seats; k++) {
    let best = -1;
    for (let i = 0; i < votes.length; i++) {
      if (!eligible[i]) continue;
      if (best < 0 || votes[i] / (won[i] + 1) > votes[best] / (won[best] + 1)) best = i;
    }
    if (best < 0) break;
    won[best]++;
    order.push(best);
  }
  return order;
}

export interface Row {
  label: string;
  /** 現行の定数のときの、議席が配られる順の党の番号 */
  order: number[];
  /** 世界ごとの、この行の定数 */
  cuts: number[];
}

/** 定数ごとに、各行 (ブロック) で何席まで配るかを並べたもの */
export function buildRows(e: Election, parties: Party[], mode: Mode, prTotals: number[]): Row[] {
  const eligible = parties.map((p) => !p.minor);
  const maxTotal = Math.max(...prTotals);
  if (mode === "national") {
    const totals = parties.map((_, i) => e.blockVotes.reduce((a, row) => a + row[i], 0));
    return [{ label: "全国", order: dhondtOrder(totals, maxTotal, eligible), cuts: prTotals.slice() }];
  }
  const pops = BLOCKS.map((b) => b.pop);
  const perWorld = prTotals.map((t) => adams(pops, t));
  const maxSeats = adams(pops, maxTotal);
  return BLOCKS.map((b, bi) => ({
    label: b.name,
    order: dhondtOrder(e.blockVotes[bi], maxSeats[bi], eligible),
    cuts: perWorld.map((w) => w[bi]),
  }));
}

export interface WorldResult {
  prTotal: number;
  house: number;
  majority: number;
  pr: number[];
  total: number[];
  /** 比例で、そのブロックで 1 席も取れなかった党に入った票の割合 */
  wasted: number;
  /** 議席率と得票率のずれ (ギャラガー指数, %) */
  gallagher: number;
  /** 比例 1 議席あたりの得票 (万票)。議席 0 なら Infinity */
  votesPerSeat: number[];
}

export function worldResult(e: Election, rows: Row[], w: number, mode: Mode): WorldResult {
  const n = e.national.length;
  const pr = new Array<number>(n).fill(0);
  let wastedVotes = 0;
  let allVotes = 0;
  rows.forEach((row, ri) => {
    const got = new Array<number>(n).fill(0);
    for (let k = 0; k < row.cuts[w]; k++) got[row.order[k]]++;
    got.forEach((g, i) => (pr[i] += g));
    if (mode === "block") {
      e.blockVotes[ri].forEach((v, i) => {
        allVotes += v;
        if (got[i] === 0) wastedVotes += v;
      });
    } else {
      const totals = e.national;
      totals.forEach((s, i) => {
        allVotes += s;
        if (got[i] === 0) wastedVotes += s;
      });
    }
  });
  const prTotal = rows.reduce((a, r) => a + r.cuts[w], 0);
  const total = pr.map((v, i) => v + e.smd[i]);
  const house = SMD_TOTAL + prTotal;
  const g = Math.sqrt(0.5 * e.national.reduce((a, v, i) => a + (v * 100 - (total[i] / house) * 100) ** 2, 0));
  const nationalVotes = e.blockVotes.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
  return {
    prTotal,
    house,
    majority: Math.floor(house / 2) + 1,
    pr,
    total,
    wasted: allVotes > 0 ? wastedVotes / allVotes : 0,
    gallagher: g,
    votesPerSeat: e.national.map((s, i) => (pr[i] > 0 ? (s * nationalVotes) / pr[i] : Infinity)),
  };
}

export interface AggregateWorld {
  pr: number[];
  total: number[];
  wasted: number;
  gallagher: number;
  /** 第 1 党が単独で過半数を取った割合 */
  majorityRate: number;
  /** 党ごとに、比例で 1 席も取れなかった割合 */
  zeroRate: number[];
}

/** 乱数を変えて runs 回の選挙を流し、世界ごとに平均する */
export function aggregate(p: ElectionParams, mode: Mode, prTotals: number[], runs: number): AggregateWorld[] {
  const n = p.parties.length;
  const acc: AggregateWorld[] = prTotals.map(() => ({
    pr: new Array<number>(n).fill(0),
    total: new Array<number>(n).fill(0),
    wasted: 0,
    gallagher: 0,
    majorityRate: 0,
    zeroRate: new Array<number>(n).fill(0),
  }));
  for (let r = 0; r < runs; r++) {
    const e = generateElection({ ...p, seed: p.seed + r * 7919 });
    const rows = buildRows(e, p.parties, mode, prTotals);
    prTotals.forEach((_, w) => {
      const res = worldResult(e, rows, w, mode);
      const a = acc[w];
      res.pr.forEach((v, i) => {
        a.pr[i] += v / runs;
        if (v === 0) a.zeroRate[i] += 1 / runs;
      });
      res.total.forEach((v, i) => (a.total[i] += v / runs));
      a.wasted += res.wasted / runs;
      a.gallagher += res.gallagher / runs;
      const top = Math.max(...res.total);
      if (top >= res.majority) a.majorityRate += 1 / runs;
    });
  }
  return acc;
}
