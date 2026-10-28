/**
 * 京都の市バスの混雑シミュレーション: 純粋な計算モデル。
 *
 * 単位は「秒」。京都駅を出て東山の観光地へ向かう 1 本の路線を、市民と観光客が一緒に使う。
 * 運賃の分け方 (二重運賃)、観光特急バス、始発で車内を空けて出す、の 3 つの手を
 * 同じ乗客・同じ渋滞のまま入れ替えて比べる。描画や React に依存しない。
 */

export type Kind = "r" | "t";

/** 現行の均一運賃 (円) */
export const FARE_FLAT = 230;
/** 二重運賃の案: 市民 */
export const FARE_RESIDENT = 200;
/** 二重運賃の案: 市民以外 (350〜400 円の案の上限) */
export const FARE_VISITOR = 400;
/** 観光特急バスの運賃 */
export const FARE_EXPRESS = 500;

export interface Stop {
  name: string;
  /** 観光特急が止まるか */
  express: boolean;
  /** 観光客の行き先としての重み (0 なら観光客は降りない) */
  touristWeight: number;
}

export interface Policy {
  name: string;
  /** 市民 200 円・市民以外 400 円にする */
  dualFare: boolean;
  /** 1 時間あたりのバスのうち、観光特急に回す台数 (普通のバスに換算。運転士の数は変えない) */
  expressDrivers: number;
  /** 始発 (京都駅) で乗せるのを定員の何割までにするか。1 なら満員まで乗せる */
  originFill: number;
}

export interface SimParams {
  /** 京都駅から乗る観光客 (人/時)。均一運賃 230 円のときの人数 */
  touristPerHour: number;
  /** 沿線の市民 (人/時、全停留所の合計)。均一運賃 230 円のときの人数 */
  residentPerHour: number;
  /** 1 時間に京都駅を出るバスの台数 (観光特急を含む) */
  busesPerHour: number;
  /** 1 台の定員 (人。大きな荷物は 2 人分) */
  capacity: number;
  /** 停留所の間を走る平均時間 (秒) */
  segmentSec: number;
  /** 運賃に対する利用の弾力性 (−0.3 なら運賃 1% 上げで利用 0.3% 減) */
  elasticity: number;
  /** 観光客のうち、500 円払っても観光特急を待つ人の割合 */
  expressPreference: number;
  /** 観光特急を待つ人が、あきらめて普通のバスに乗るまでの時間 (秒) */
  expressPatienceSec: number;
  /** 市民がバスをあきらめて歩くかタクシーにするまでの時間 (秒) */
  residentGiveUpSec: number;
  /** 観光客のうち、スーツケースなど大きな荷物を持つ人の割合 */
  luggageShare: number;
  durationSec: number;
  seed: number;
}

export interface Passenger {
  id: number;
  kind: Kind;
  origin: number;
  dest: number;
  luggage: boolean;
  wantsExpress: boolean;
  tArrive: number;
  tBoard: number;
  /** 満員で目の前のバスに乗れなかったことがある */
  leftBehind: boolean;
  /** 待ちきれずにバスをあきらめた時刻 (あきらめていなければ -1) */
  tGiveUp: number;
}

export type BusState = "dwell" | "move" | "done";

export interface Bus {
  id: number;
  express: boolean;
  /** dwell のときは止まっている停留所、move のときは出発した停留所 */
  at: number;
  state: BusState;
  /** 今の状態が終わる時刻 */
  until: number;
  /** 今の状態が始まった時刻 (描画の補間に使う) */
  since: number;
  onboard: number[];
  load: number;
  tDepart: number;
}

export interface SeriesPoint {
  t: number;
  /** 停留所で待っている市民 */
  resident: number;
  /** 停留所で待っている観光客 */
  tourist: number;
}

export interface SimState {
  policy: Policy;
  params: SimParams;
  stops: Stop[];
  t: number;
  people: Passenger[];
  queues: number[][];
  buses: Bus[];
  /** 次に京都駅を出る普通 / 特急バスの時刻 */
  nextRegular: number;
  nextExpress: number;
  revenue: number;
  tripSum: number;
  tripCount: number;
  series: SeriesPoint[];
  nextId: number;
  rng: () => number;
}

export interface KindStats {
  arrived: number;
  boarded: number;
  waiting: number;
  /** 平均待ち時間。まだ待っている人はここまで待った分を数える */
  avgWait: number;
  maxWait: number;
  /** 満員で乗れなかったことがある人の割合 */
  leftBehindRate: number;
  /** 待ちきれずにバスをあきらめた人 */
  gaveUp: number;
}

export interface SimStats {
  t: number;
  resident: KindStats;
  tourist: KindStats;
  /** 運賃が上がってバスをやめた観光客 (期待値、人) */
  touristShifted: number;
  /** 1 時間あたりの運賃収入 (円) */
  revenuePerHour: number;
  /** 普通のバスが京都駅から終点まで走った平均時間 (秒) */
  avgTripSec: number;
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

export const DT = 1;

/** 扉の開け閉めなど、止まるたびにかかる時間 (秒) */
export const DOOR_SEC = 8;
/** 降りるのにかかる時間 (秒/人)。京都の市バスは後ろから乗って前で運賃を払って降りる */
export const ALIGHT_SEC: Record<Kind, number> = { r: 2, t: 4 };
/** 乗るのにかかる時間 (秒/人) */
export const BOARD_SEC: Record<Kind, number> = { r: 1.5, t: 2.5 };
/** 大きな荷物を持つ人の上乗せ (秒) */
export const LUGGAGE_SEC = 2;

/** 京都駅 → 東山方面の単純化した路線 */
export const STOPS: Stop[] = [
  { name: "京都駅前", express: true, touristWeight: 0 },
  { name: "七条京阪前", express: false, touristWeight: 0 },
  { name: "博物館前", express: false, touristWeight: 0.1 },
  { name: "東山七条", express: false, touristWeight: 0 },
  { name: "五条坂", express: true, touristWeight: 0.45 },
  { name: "清水道", express: false, touristWeight: 0.15 },
  { name: "東山安井", express: false, touristWeight: 0 },
  { name: "祇園", express: true, touristWeight: 0.3 },
];

export function fareFor(kind: Kind, policy: Policy, express: boolean): number {
  if (express) return FARE_EXPRESS;
  if (!policy.dualFare) return FARE_FLAT;
  return kind === "r" ? FARE_RESIDENT : FARE_VISITOR;
}

/** 運賃が 230 円から変わったときの利用の倍率 (定弾力性) */
export function demandFactor(fare: number, elasticity: number): number {
  return Math.pow(fare / FARE_FLAT, elasticity);
}

/** この方針のもとでの 1 時間あたりの到着人数 */
export function effectiveRates(params: SimParams, policy: Policy): { tourist: number; resident: number } {
  return {
    tourist: params.touristPerHour * demandFactor(fareFor("t", policy, false), params.elasticity),
    resident: params.residentPerHour * demandFactor(fareFor("r", policy, false), params.elasticity),
  };
}

/**
 * 観光特急は途中に止まらないぶん早く京都駅に戻れるので、
 * 普通のバス 3 台分の運転士で 4 台走らせられるとみなす。
 */
export const EXPRESS_TURN_GAIN = 4 / 3;

export function regularPerHour(params: SimParams, policy: Policy): number {
  return Math.max(0, params.busesPerHour - policy.expressDrivers);
}

export function expressPerHour(policy: Policy): number {
  return Math.round(policy.expressDrivers * EXPRESS_TURN_GAIN * 10) / 10;
}

export function createSim(params: SimParams, policy: Policy): SimState {
  const reg = regularPerHour(params, policy);
  return {
    policy,
    params,
    stops: STOPS,
    t: 0,
    people: [],
    queues: STOPS.map(() => []),
    buses: [],
    // 最初のバスは間隔の半分で出す (それまでに少し人がたまる)。特急も同じ
    nextRegular: reg > 0 ? 1800 / reg : Infinity,
    nextExpress: policy.expressDrivers > 0 ? 1800 / expressPerHour(policy) : Infinity,
    revenue: 0,
    tripSum: 0,
    tripCount: 0,
    series: [{ t: 0, resident: 0, tourist: 0 }],
    nextId: 1,
    rng: mulberry32(params.seed),
  };
}

function poisson(rng: () => number, expected: number): number {
  let n = 0;
  let rest = expected;
  while (rest > 0) {
    if (rng() < Math.min(1, rest)) n++;
    rest -= 1;
  }
  return n;
}

function pickTouristDest(s: SimState): number {
  const total = s.stops.reduce((a, st) => a + st.touristWeight, 0);
  let r = s.rng() * total;
  for (let i = 0; i < s.stops.length; i++) {
    r -= s.stops[i].touristWeight;
    if (r <= 0 && s.stops[i].touristWeight > 0) return i;
  }
  return s.stops.length - 1;
}

function addPassenger(s: SimState, kind: Kind, origin: number, dest: number) {
  const p = s.params;
  const tourist = kind === "t";
  const luggage = tourist && s.rng() < p.luggageShare;
  // 観光特急は行き先が特急の停留所の人しか使えない
  const wantsExpress =
    tourist && s.policy.expressDrivers > 0 && s.stops[dest].express && s.rng() < p.expressPreference;
  s.people.push({
    id: s.nextId,
    kind,
    origin,
    dest,
    luggage,
    wantsExpress,
    tArrive: s.t,
    tBoard: -1,
    leftBehind: false,
    tGiveUp: -1,
  });
  s.queues[origin].push(s.nextId);
  s.nextId++;
}

function arrive(s: SimState, dt: number) {
  const rates = effectiveRates(s.params, s.policy);
  const n = s.stops.length;
  // 観光客は京都駅から乗る
  const nt = poisson(s.rng, (rates.tourist / 3600) * dt);
  for (let i = 0; i < nt; i++) addPassenger(s, "t", 0, pickTouristDest(s));
  // 市民は終点以外の停留所から、それより先の停留所へ。京都駅からも乗る
  const nr = poisson(s.rng, (rates.resident / 3600) * dt);
  for (let i = 0; i < nr; i++) {
    const origin = Math.floor(s.rng() * (n - 1));
    const dest = origin + 1 + Math.floor(s.rng() * (n - 1 - origin));
    addPassenger(s, "r", origin, dest);
  }
}

function dispatch(s: SimState) {
  const reg = regularPerHour(s.params, s.policy);
  while (s.t >= s.nextRegular) {
    launchBus(s, false);
    s.nextRegular += 3600 / reg;
  }
  while (s.t >= s.nextExpress) {
    launchBus(s, true);
    s.nextExpress += 3600 / expressPerHour(s.policy);
  }
}

function launchBus(s: SimState, express: boolean) {
  const bus: Bus = {
    id: s.buses.length + 1,
    express,
    at: 0,
    state: "dwell",
    until: s.t,
    since: s.t,
    onboard: [],
    load: 0,
    tDepart: s.t,
  };
  s.buses.push(bus);
  serveStop(s, bus);
}

function space(p: Passenger): number {
  return p.luggage ? 2 : 1;
}

/** この人がこのバスに乗りたいか */
function wantsBus(s: SimState, p: Passenger, bus: Bus): boolean {
  if (bus.express) return p.wantsExpress;
  if (p.wantsExpress) return s.t - p.tArrive >= s.params.expressPatienceSec;
  return true;
}

/** 停留所に着いたバス: 降ろして、乗せて、止まっている時間を決める */
function serveStop(s: SimState, bus: Bus) {
  const stop = bus.at;
  let work = 0;
  const stay: number[] = [];
  let alighted = 0;
  for (const id of bus.onboard) {
    const p = s.people[id - 1];
    if (p.dest === stop) {
      work += ALIGHT_SEC[p.kind] + (p.luggage ? LUGGAGE_SEC : 0);
      bus.load -= space(p);
      alighted++;
    } else {
      stay.push(id);
    }
  }
  bus.onboard = stay;

  const cap = s.params.capacity * (stop === 0 ? s.policy.originFill : 1);
  const q = s.queues[stop];
  const rest: number[] = [];
  let boarded = 0;
  for (const id of q) {
    const p = s.people[id - 1];
    if (!wantsBus(s, p, bus)) {
      rest.push(id);
      continue;
    }
    if (bus.load + space(p) > cap) {
      p.leftBehind = true;
      rest.push(id);
      continue;
    }
    bus.onboard.push(id);
    bus.load += space(p);
    p.tBoard = s.t;
    s.revenue += fareFor(p.kind, s.policy, bus.express);
    work += BOARD_SEC[p.kind] + (p.luggage ? LUGGAGE_SEC : 0);
    boarded++;
  }
  s.queues[stop] = rest;

  bus.state = "dwell";
  bus.since = s.t;
  // 誰も乗り降りしない途中の停留所は通過する
  const pass = stop !== 0 && alighted === 0 && boarded === 0;
  bus.until = s.t + (pass ? 0 : DOOR_SEC + work);
}

function segmentTime(s: SimState): number {
  return s.params.segmentSec * (0.8 + 0.4 * s.rng());
}

function moveBuses(s: SimState) {
  const last = s.stops.length - 1;
  for (const bus of s.buses) {
    if (bus.state === "done" || s.t < bus.until) continue;
    if (bus.state === "dwell") {
      if (bus.at === last) {
        bus.state = "done";
        if (!bus.express) {
          s.tripSum += s.t - bus.tDepart;
          s.tripCount++;
        }
        continue;
      }
      // 観光特急は次の特急停留所までまとめて走る
      let to = bus.at + 1;
      let travel = segmentTime(s);
      if (bus.express) {
        while (!s.stops[to].express) {
          to++;
          travel += segmentTime(s);
        }
      }
      bus.state = "move";
      bus.since = s.t;
      bus.until = s.t + travel;
      // move のあいだは at = 出発した停留所。着く停留所は nextStop() で求める
    } else {
      bus.at = nextStop(s, bus);
      serveStop(s, bus);
    }
  }
}

export function nextStop(s: SimState, bus: Bus): number {
  let to = bus.at + 1;
  if (bus.express) while (to < s.stops.length - 1 && !s.stops[to].express) to++;
  return Math.min(to, s.stops.length - 1);
}

/** 長く待った市民は、歩くかタクシーに切り替えて列を離れる */
function giveUp(s: SimState) {
  const limit = s.params.residentGiveUpSec;
  for (let i = 0; i < s.queues.length; i++) {
    const q = s.queues[i];
    if (!q.some((id) => s.people[id - 1].kind === "r" && s.t - s.people[id - 1].tArrive >= limit)) continue;
    s.queues[i] = q.filter((id) => {
      const p = s.people[id - 1];
      if (p.kind === "r" && s.t - p.tArrive >= limit) {
        p.tGiveUp = s.t;
        return false;
      }
      return true;
    });
  }
}

/** シミュレーションを dt 秒進める */
export function step(s: SimState, dt: number = DT) {
  if (s.t >= s.params.durationSec) return;
  arrive(s, dt);
  dispatch(s);
  moveBuses(s);
  giveUp(s);
  s.t = Math.round((s.t + dt) * 1000) / 1000;
  const lastT = s.series[s.series.length - 1].t;
  if (s.t - lastT >= 30 - 1e-9) {
    let resident = 0;
    let tourist = 0;
    for (const q of s.queues) {
      for (const id of q) {
        if (s.people[id - 1].kind === "r") resident++;
        else tourist++;
      }
    }
    s.series.push({ t: Math.round(s.t), resident, tourist });
  }
}

export function isFinished(s: SimState): boolean {
  return s.t >= s.params.durationSec;
}

export function runToEnd(s: SimState) {
  while (!isFinished(s)) step(s, DT);
  return s;
}

function kindStats(s: SimState, kind: Kind): KindStats {
  let arrived = 0;
  let boarded = 0;
  let waitSum = 0;
  let maxWait = 0;
  let left = 0;
  let gaveUp = 0;
  for (const p of s.people) {
    if (p.kind !== kind) continue;
    arrived++;
    const end = p.tBoard >= 0 ? p.tBoard : p.tGiveUp >= 0 ? p.tGiveUp : s.t;
    const w = end - p.tArrive;
    if (p.tBoard >= 0) boarded++;
    if (p.tGiveUp >= 0) gaveUp++;
    waitSum += w;
    if (w > maxWait) maxWait = w;
    if (p.leftBehind) left++;
  }
  return {
    arrived,
    boarded,
    waiting: arrived - boarded - gaveUp,
    avgWait: arrived > 0 ? waitSum / arrived : 0,
    maxWait,
    leftBehindRate: arrived > 0 ? left / arrived : 0,
    gaveUp,
  };
}

export function getStats(s: SimState): SimStats {
  const rates = effectiveRates(s.params, s.policy);
  const hours = Math.max(1e-9, s.t / 3600);
  return {
    t: s.t,
    resident: kindStats(s, "r"),
    tourist: kindStats(s, "t"),
    touristShifted: (s.params.touristPerHour - rates.tourist) * (s.t / 3600),
    revenuePerHour: s.t > 0 ? s.revenue / hours : 0,
    avgTripSec: s.tripCount > 0 ? s.tripSum / s.tripCount : 0,
  };
}

/** 同じシナリオを seed を変えて何回も回した平均 */
export interface AggregateStats {
  runs: number;
  stats: SimStats;
}

export function aggregate(params: SimParams, policy: Policy, runs: number): AggregateStats {
  const zeroKind = (): KindStats => ({
    arrived: 0,
    boarded: 0,
    waiting: 0,
    avgWait: 0,
    maxWait: 0,
    leftBehindRate: 0,
    gaveUp: 0,
  });
  const acc: SimStats = {
    t: 0,
    resident: zeroKind(),
    tourist: zeroKind(),
    touristShifted: 0,
    revenuePerHour: 0,
    avgTripSec: 0,
  };
  for (let i = 0; i < runs; i++) {
    const st = getStats(runToEnd(createSim({ ...params, seed: params.seed + i * 7919 }, policy)));
    acc.t = st.t;
    for (const k of ["resident", "tourist"] as const) {
      for (const f of Object.keys(acc[k]) as (keyof KindStats)[]) acc[k][f] += st[k][f] / runs;
    }
    acc.touristShifted += st.touristShifted / runs;
    acc.revenuePerHour += st.revenuePerHour / runs;
    acc.avgTripSec += st.avgTripSec / runs;
  }
  return { runs, stats: acc };
}
