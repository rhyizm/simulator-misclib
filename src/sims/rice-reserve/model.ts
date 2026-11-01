/**
 * 政府備蓄米のシミュレーション: 純粋な計算モデル。
 *
 * 単位は「月」と「万トン (玄米)」と「円 / 5 kg (店頭)」。
 * 1 年は 7 月に始まり 6 月に終わる (米の「年度」)。新米は 9 月と 10 月に市場へ入る。
 * 天気 (作況) と需要の揺れは最初に 30 年分を決めてしまうので、
 * 同じ seed なら方針が違っても同じ天気・同じ需要の世界になる。描画や React に依存しない。
 */

/** 1 年の月の並び (7 月始まり) */
export const MONTHS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6] as const;
/** 新米が入る月 (MONTHS の添字) と、その割合。早場米が 8 月から出回る */
const HARVEST_IN: Record<number, number> = { 1: 0.1, 2: 0.4, 3: 0.5 };
/** 作況がわかる月 (8 月) */
const YIELD_KNOWN_AT = 1;
/** 政府が買い入れ・入れ替えをする月 (10 月) */
const BUY_AT = 3;
/** 農家が翌年の作付けを決める月 (2 月) */
const PLAN_AT = 7;

/** 6 月末の民間在庫がこれくらいなら「いつもの値段」になる (万トン) */
export const NORMAL_CARRY = 200;
/** 民間在庫の見込みに対する値段の効き方 (在庫が 1% 減ると値段が約 1.5% 上がる) */
const PRICE_K = 1.5;
/** 値段が見込みに追いつく速さ (1 か月あたり) */
const PRICE_SPEED = 0.25;
/** 値段に対する食べる量の反応 (米はほとんど反応しない) */
const DEMAND_ELASTICITY = -0.1;
/** 値段に対する作付けの反応 */
const SUPPLY_ELASTICITY = 0.12;

/** 「米騒動」とみなす値段 (いつもの値段の何倍か)。2025 年 5 月の最高値 4,285 円がほぼこの水準 */
export const CRISIS_RATIO = 1.4;
/** 「農家が苦しい」とみなす値段 */
export const LOW_RATIO = 0.8;
/** 「品薄」とみなす民間在庫 (何か月分) */
export const EMPTY_MONTHS = 1;

/** 民間在庫がこれ (何か月分) を切ると、買いだめで需要が膨らみ始める */
const PANIC_MONTHS = 1;

/** 政府が買う・売る値段 (万円 / トン) を店頭の値段 (円 / 5 kg) から出す係数 */
const GOV_PRICE_PER_TON = (p5kg: number) => (p5kg * 200 * 0.6) / 10000;
/** 保管料 (万円 / トン・年) */
const STORAGE_PER_TON_YEAR = 1.2;
/** 入れ替えで飼料用に売るときの値段 (万円 / トン) */
const FEED_PRICE = 3;

export interface Policy {
  name: string;
  /** 備蓄の目標 (万トン) */
  target: number;
  /** 毎年 10 月に新米で買い入れる量 (万トン) */
  annualBuy: number;
  /** 何年保管したら飼料用に売って入れ替えるか */
  rotationYears: number;
  /** 値段が「いつもの何倍」になったら放出を考えるか */
  releaseTrigger: number;
  /** その値段が何か月続いたら放出を決めるか */
  decisionLag: number;
  /** 放出を決めてから店に届くまで (か月) */
  deliveryLag: number;
  /** 1 か月に放出する量 (万トン) */
  releasePerMonth: number;
  /** 値段が「いつもの何倍」より安いときだけ、目標に戻すための追加の買い入れ (買い戻し) をする */
  buyBackBelow: number;
  /** 1 年に追加で買い入れる上限 (万トン) */
  buyBackMax: number;
  /** 追加で買い入れるときに積んでよい上限 (万トン)。ふつうは目標と同じ */
  holdCap: number;
}

export interface SimParams {
  /** シミュレーションする年数 */
  years: number;
  /** いつもの値段 (円 / 5 kg) */
  refPrice: number;
  /** 1 年目の主食用の需要 (万トン / 年、いつもの値段のとき) */
  demand: number;
  /** 需要の毎年の変化 (−0.008 なら毎年 0.8% 減る) */
  demandTrend: number;
  /** 不作の年の確率 (作況 92〜96) */
  badYearProb: number;
  /** 大凶作の年の確率 (作況 74〜85、1993 年級) */
  disasterProb: number;
  /** 需要が急に増える年の確率 (訪日客、買いだめなど。+3%) */
  surgeProb: number;
  /** 最初の民間在庫 (7 月 1 日、万トン) */
  startPrivate: number;
  /** 最初の政府備蓄 (万トン)。目標より少なければ、足りない分は最近買ったものとして積む */
  startGov: number;
  /** 最初の値段 (いつもの何倍) */
  startPriceRatio: number;
  /** 決まった年に決まった天気・需要を起こす (シナリオ用)。添字は年 (0 始まり) */
  forced?: Record<number, { yieldIdx?: number; surge?: number }>;
  seed: number;
}

export interface Lot {
  /** 買った年 (0 始まり。最初からあった分は負) */
  year: number;
  tons: number;
}

export interface SimEvent {
  month: number;
  kind: "harvest" | "release" | "buy" | "rotate" | "empty" | "plan";
  text: string;
}

export interface SeriesPoint {
  /** 経過月 */
  m: number;
  price: number;
  gov: number;
  priv: number;
}

export interface Shipment {
  arrive: number;
  tons: number;
}

export interface SimState {
  params: SimParams;
  policy: Policy;
  /** 経過月 (0 = 1 年目の 7 月 1 日) */
  month: number;
  /** 年ごとの作況指数 (100 = 平年) */
  yields: number[];
  /** 年ごとの需要の上乗せ (1.03 なら 3% 増) */
  surges: number[];
  /** その年の作付け (平年作のときの収穫量、万トン) */
  planted: number;
  /** 翌年の作付け */
  nextPlanted: number;
  priv: number;
  lots: Lot[];
  /** 店に向かっている放出米 */
  pipeline: Shipment[];
  /** 店頭の値段 (円 / 5 kg) */
  price: number;
  /** 放出を考える値段が続いている月数 */
  highCount: number;
  /** 直近 12 か月の値段 (作付けの判断用) */
  recentPrices: number[];
  /** 今年度の追加買い入れ (買い戻し) の量 */
  buyBackThisYear: number;
  // 集計
  crisisMonths: number;
  lowMonths: number;
  emptyMonths: number;
  peakPrice: number;
  minPrice: number;
  minGov: number;
  /** 食べたかったのに買えなかった量 (万トン) */
  unmet: number;
  /** 財政負担の累計 (億円) */
  fiscal: number;
  released: number;
  boughtBack: number;
  rotated: number;
  series: SeriesPoint[];
  events: SimEvent[];
}

export interface SimStats {
  month: number;
  price: number;
  gov: number;
  priv: number;
  crisisMonths: number;
  lowMonths: number;
  emptyMonths: number;
  peakPrice: number;
  minPrice: number;
  minGov: number;
  unmet: number;
  /** 財政負担 (億円 / 年) */
  fiscalPerYear: number;
  released: number;
  boughtBack: number;
}

/** 再現できる乱数 (mulberry32) */
function makeRng(seed: number): () => number {
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
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 30 年分の天気と需要の揺れを決める。方針には依存しない */
export function drawWorld(params: SimParams): { yields: number[]; surges: number[] } {
  const rng = makeRng(params.seed);
  const yields: number[] = [];
  const surges: number[] = [];
  for (let y = 0; y < params.years; y++) {
    const r = rng();
    let idx: number;
    if (r < params.disasterProb) idx = 74 + rng() * 11;
    else if (r < params.disasterProb + params.badYearProb) idx = 92 + rng() * 4;
    else idx = 100 + gauss(rng) * 2;
    const surge = rng() < params.surgeProb ? 1.03 : 1;
    const f = params.forced?.[y];
    yields.push(Math.round(f?.yieldIdx ?? idx));
    surges.push(f?.surge ?? surge);
  }
  return { yields, surges };
}

export function yearOf(month: number): number {
  return Math.floor(month / 12);
}

export function monthOfYear(month: number): number {
  return month % 12;
}

/** その年度の需要 (いつもの値段のとき、万トン / 年) */
function baseDemand(s: SimState, year: number): number {
  const p = s.params;
  return p.demand * Math.pow(1 + p.demandTrend, year) * (s.surges[year] ?? 1);
}

export function govStock(s: SimState): number {
  let t = 0;
  for (const l of s.lots) t += l.tons;
  return t;
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const { yields, surges } = drawWorld(params);
  // 最初の備蓄: 新しい年から順に毎年の買い入れ量ずつ積んだことにする
  const lots: Lot[] = [];
  let left = Math.min(params.startGov, policy.holdCap);
  for (let age = 1; left > 0.01 && age <= 10; age++) {
    const t = Math.min(left, policy.annualBuy > 0 ? policy.annualBuy : left);
    lots.push({ year: -age, tons: t });
    left -= t;
  }
  if (left > 0.01) lots.push({ year: -1, tons: left });
  // いつもの年の作付け: 需要 + 政府が毎年買う量
  const planted = params.demand + policy.annualBuy;
  const price = params.refPrice * params.startPriceRatio;
  const s: SimState = {
    params,
    policy,
    month: 0,
    yields,
    surges,
    planted,
    nextPlanted: planted,
    priv: params.startPrivate,
    lots,
    pipeline: [],
    price,
    highCount: 0,
    recentPrices: [],
    buyBackThisYear: 0,
    crisisMonths: 0,
    lowMonths: 0,
    emptyMonths: 0,
    peakPrice: price,
    minPrice: price,
    minGov: Math.min(params.startGov, policy.holdCap),
    unmet: 0,
    fiscal: 0,
    released: 0,
    boughtBack: 0,
    rotated: 0,
    series: [],
    events: [],
  };
  s.series.push({ m: 0, price, gov: govStock(s), priv: s.priv });
  return s;
}

/** その年の収穫 (万トン) */
export function harvestOf(s: SimState, year: number): number {
  return s.planted * ((s.yields[year] ?? 100) / 100);
}

/**
 * 6 月末の民間在庫の見込み。市場はこれを見て値段を決める。
 * 作況がわかる前は平年作とみなす。届く途中の放出米も見込みに入る (発表だけで値段が動く)。
 */
export function projectedCarry(s: SimState): number {
  const y = yearOf(s.month);
  const mo = monthOfYear(s.month);
  const harvest = mo >= YIELD_KNOWN_AT ? harvestOf(s, y) : s.planted;
  let remainingHarvest = 0;
  // その月の分は step() で値段を決める前に在庫に入っているので、来月以降の分だけ数える
  for (const [k, share] of Object.entries(HARVEST_IN)) if (Number(k) > mo) remainingHarvest += harvest * share;
  const remainingMonths = 12 - mo;
  const cons = (baseDemand(s, y) / 12) * remainingMonths;
  let incoming = 0;
  for (const sh of s.pipeline) incoming += sh.tons;
  const govBuy = mo < BUY_AT ? s.policy.annualBuy : 0;
  return s.priv + remainingHarvest + incoming - cons - govBuy;
}

function priceTarget(s: SimState): number {
  const carry = Math.max(20, projectedCarry(s));
  const ratio = Math.pow(carry / NORMAL_CARRY, -PRICE_K);
  return s.params.refPrice * Math.max(0.6, Math.min(3, ratio));
}

function pushEvent(s: SimState, kind: SimEvent["kind"], text: string) {
  s.events.push({ month: s.month, kind, text });
  if (s.events.length > 40) s.events.shift();
}

/** 古いものから順に取り出す */
function takeOldest(s: SimState, tons: number): { tons: number; avgAge: number } {
  s.lots.sort((a, b) => a.year - b.year);
  let got = 0;
  let ageSum = 0;
  const y = yearOf(s.month);
  while (got < tons - 1e-9 && s.lots.length > 0) {
    const lot = s.lots[0];
    const take = Math.min(lot.tons, tons - got);
    lot.tons -= take;
    got += take;
    ageSum += take * (y - lot.year);
    if (lot.tons <= 1e-9) s.lots.shift();
  }
  return { tons: got, avgAge: got > 0 ? ageSum / got : 0 };
}

export function isFinished(s: SimState): boolean {
  return s.month >= s.params.years * 12;
}

/** 1 か月進める */
export function step(s: SimState): void {
  if (isFinished(s)) return;
  const p = s.params;
  const pol = s.policy;
  const y = yearOf(s.month);
  const mo = monthOfYear(s.month);
  const ref = p.refPrice;

  if (mo === 0) {
    s.planted = s.nextPlanted;
    s.buyBackThisYear = 0;
  }
  if (mo === YIELD_KNOWN_AT) {
    const idx = s.yields[y];
    const label = idx < 86 ? "大凶作" : idx < 97 ? "不作" : idx > 102 ? "豊作" : "平年並み";
    pushEvent(s, "harvest", `作況 ${idx} (${label})`);
  }

  // 1. 新米が入る
  const share = HARVEST_IN[mo];
  if (share) s.priv += harvestOf(s, y) * share;

  // 2. 放出米が店に届く
  s.pipeline = s.pipeline.filter((sh) => {
    if (sh.arrive <= s.month) {
      s.priv += sh.tons;
      return false;
    }
    return true;
  });

  // 3. 10 月: 入れ替え (古い米を飼料用に) と買い入れ
  if (mo === BUY_AT) {
    let rotated = 0;
    s.lots = s.lots.filter((l) => {
      if (y - l.year >= pol.rotationYears) {
        rotated += l.tons;
        return false;
      }
      return true;
    });
    if (rotated > 0) {
      s.rotated += rotated;
      s.fiscal -= rotated * FEED_PRICE; // 万トン × 万円/トン = 億円
      pushEvent(s, "rotate", `${Math.round(rotated)} 万 t を飼料用に`);
    }
    const stock = govStock(s);
    let buy = Math.max(0, Math.min(pol.annualBuy, pol.target - stock));
    // 追加の買い入れ (買い戻し): 安いときだけ
    if (s.price < pol.buyBackBelow * ref) {
      const room = Math.max(0, pol.holdCap - stock - buy);
      const extra = Math.min(pol.buyBackMax - s.buyBackThisYear, room);
      if (extra > 0.5) {
        buy += extra;
        s.buyBackThisYear += extra;
        s.boughtBack += extra;
      }
    }
    buy = Math.min(buy, Math.max(0, s.priv - 30));
    if (buy > 0.5) {
      s.priv -= buy;
      s.lots.push({ year: y, tons: buy });
      s.fiscal += buy * GOV_PRICE_PER_TON(s.price);
      pushEvent(s, "buy", `${Math.round(buy)} 万 t を買い入れ`);
    }
  }

  // 4. 値段が見込みに近づく
  const target = priceTarget(s);
  s.price += (target - s.price) * PRICE_SPEED;

  // 5. 放出の判断
  if (s.price >= pol.releaseTrigger * ref) s.highCount++;
  else s.highCount = 0;
  if (s.highCount >= pol.decisionLag && govStock(s) > 0.5) {
    const got = takeOldest(s, pol.releasePerMonth);
    if (got.tons > 0) {
      s.pipeline.push({ arrive: s.month + pol.deliveryLag, tons: got.tons });
      s.released += got.tons;
      // 古い米ほど安くしか売れない
      const discount = Math.max(0.5, 1 - 0.08 * got.avgAge);
      s.fiscal -= got.tons * GOV_PRICE_PER_TON(s.price) * discount;
      pushEvent(s, "release", `${Math.round(got.tons)} 万 t を放出 (${Math.round(got.avgAge)} 年前の米)`);
    }
  }

  // 6. 食べる: 在庫が細ると買いだめで需要が膨らむ
  const monthly = baseDemand(s, y) / 12;
  const privMonths = s.priv / monthly;
  const panic = 1 + 0.1 * Math.max(0, Math.min(1, (PANIC_MONTHS - privMonths) / PANIC_MONTHS));
  const want = monthly * Math.pow(s.price / ref, DEMAND_ELASTICITY) * panic;
  const eat = Math.min(want, Math.max(0, s.priv));
  s.priv -= eat;
  s.unmet += want - eat;

  // 7. 保管料
  const stock = govStock(s);
  s.fiscal += (stock * STORAGE_PER_TON_YEAR) / 12;

  // 8. 2 月: 農家が翌年の作付けを決める
  s.recentPrices.push(s.price);
  if (s.recentPrices.length > 12) s.recentPrices.shift();
  if (mo === PLAN_AT) {
    const avg = s.recentPrices.reduce((a, b) => a + b, 0) / s.recentPrices.length;
    const nextDemand = p.demand * Math.pow(1 + p.demandTrend, y + 1);
    // 値段に反応しつつ、ゆっくり需要 + 政府の買い入れに寄っていく
    const anchor = nextDemand + pol.annualBuy;
    const resp = Math.pow(avg / ref, SUPPLY_ELASTICITY);
    let next = s.planted * resp;
    next += (anchor - next) * 0.15;
    next = Math.max(s.planted * 0.92, Math.min(s.planted * 1.08, next));
    s.nextPlanted = next;
    const diff = next / s.planted - 1;
    if (Math.abs(diff) >= 0.02) pushEvent(s, "plan", `来年の作付け ${diff > 0 ? "+" : ""}${(diff * 100).toFixed(0)}%`);
  }

  // 集計
  s.month++;
  const endMonthly = baseDemand(s, y) / 12;
  if (s.price >= CRISIS_RATIO * ref) s.crisisMonths++;
  if (s.price <= LOW_RATIO * ref) s.lowMonths++;
  if (s.priv < EMPTY_MONTHS * endMonthly) {
    s.emptyMonths++;
    if (s.emptyMonths === 1 || s.events[s.events.length - 1]?.kind !== "empty") pushEvent(s, "empty", "品薄 (在庫が 1 か月分を切った)");
  }
  s.peakPrice = Math.max(s.peakPrice, s.price);
  s.minPrice = Math.min(s.minPrice, s.price);
  s.minGov = Math.min(s.minGov, stock);
  s.series.push({ m: s.month, price: s.price, gov: stock, priv: s.priv });
}

export function runToEnd(s: SimState): SimState {
  while (!isFinished(s)) step(s);
  return s;
}

export function getStats(s: SimState): SimStats {
  const years = Math.max(1 / 12, s.month / 12);
  return {
    month: s.month,
    price: s.price,
    gov: govStock(s),
    priv: s.priv,
    crisisMonths: s.crisisMonths,
    lowMonths: s.lowMonths,
    emptyMonths: s.emptyMonths,
    peakPrice: s.peakPrice,
    minPrice: s.minPrice,
    minGov: s.minGov,
    unmet: s.unmet,
    fiscalPerYear: s.fiscal / years,
    released: s.released,
    boughtBack: s.boughtBack,
  };
}

export interface AggregateStats {
  runs: number;
  stats: SimStats;
  /** 一度でも米騒動 (1.4 倍超) が起きた試行の割合 */
  anyCrisis: number;
  /** 一度でも品薄になった試行の割合 */
  anyEmpty: number;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const acc: SimStats = {
    month: 0,
    price: 0,
    gov: 0,
    priv: 0,
    crisisMonths: 0,
    lowMonths: 0,
    emptyMonths: 0,
    peakPrice: 0,
    minPrice: 0,
    minGov: 0,
    unmet: 0,
    fiscalPerYear: 0,
    released: 0,
    boughtBack: 0,
  };
  let anyCrisis = 0;
  let anyEmpty = 0;
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    for (const k of Object.keys(acc) as (keyof SimStats)[]) acc[k] += st[k] / runs;
    if (st.crisisMonths > 0) anyCrisis++;
    if (st.emptyMonths > 0) anyEmpty++;
  }
  return { runs, stats: acc, anyCrisis: anyCrisis / runs, anyEmpty: anyEmpty / runs };
}
