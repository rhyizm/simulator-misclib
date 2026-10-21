"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  LIMIT_MIN,
  aggregate,
  clock,
  createSim,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries } from "./TimeChart";

/** 実時間 1 秒あたりに進むシミュレーション上の分数 */
type Speed = 10 | 30 | 90;

const POLICIES = ["firstCome", "reservation"] as const;

const POLICY_LABEL: Record<Policy, string> = {
  firstCome: "先着順",
  reservation: "バース予約制",
};

const POLICY_DESC: Record<Policy, string> = {
  firstCome: "着いた順に荷降ろし。早く並んだ人から終わるので、早めに来て待つドライバーが出る",
  reservation: "予約した枠の時刻に来て荷降ろし。予約のない車や遅刻した車は空いたバースで後回し",
};

const POLICY_COLOR: Record<Policy, string> = {
  firstCome: "var(--series-2)",
  reservation: "var(--series-7)",
};

type Override = Partial<Pick<SimParams, "trucks" | "berths" | "rushRatio" | "lateProb" | "walkInRatio">>;

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    ok: v("--series-1"),
    warn: v("--amber"),
    crit: v("--status-critical"),
    work: v("--series-3"),
  };
}

function fmtMin(m: number): string {
  if (!Number.isFinite(m)) return "–";
  return `${Math.round(m)} 分`;
}

function fmtPct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

export function TruckBerthSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(30);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [override, setOverride] = useState<Override>({});
  const [metric, setMetric] = useState<"waiting" | "done">("waiting");
  const [stats, setStats] = useState<Record<Policy, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<Policy, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(
    () => ({ ...scenario.params, ...override, seed: scenario.params.seed + seedOffset }),
    [scenario, override, seedOffset],
  );

  const simsRef = useRef<Record<Policy, SimState> | null>(null);
  const canvasRefs = useRef<Record<Policy, HTMLCanvasElement | null>>({ firstCome: null, reservation: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    for (const policy of POLICIES) {
      const canvas = canvasRefs.current[policy];
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      if (!themeRef.current) themeRef.current = readTheme(canvas);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== CANVAS_W * dpr) {
        canvas.width = CANVAS_W * dpr;
        canvas.height = CANVAS_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderSim(ctx, sims[policy], themeRef.current);
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({ firstCome: getStats(sims.firstCome), reservation: getStats(sims.reservation) });
    setChartSeries(
      POLICIES.map((policy) => ({
        name: POLICY_LABEL[policy],
        color: POLICY_COLOR[policy],
        points: sims[policy].series.slice(),
      })),
    );
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    simsRef.current = {
      firstCome: createSim(params, "firstCome"),
      reservation: createSim(params, "reservation"),
    };
    accRef.current = 0;
    lastTsRef.current = null;
    draw();
  }, [params, draw]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // パラメータが変わったら最初から
  useEffect(() => {
    reset();
    const id = requestAnimationFrame(() => {
      setAgg(null);
      publish();
    });
    return () => cancelAnimationFrame(id);
  }, [reset, publish]);

  // ページを開いたら自動で再生する (動きを減らす設定の人は除く)
  useEffect(() => {
    if (autoStarted) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = requestAnimationFrame(() => {
      setAutoStarted(true);
      if (!reduced) setPlaying(true);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStarted]);

  // ダークモード切替に追従
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      themeRef.current = null;
      draw();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [draw]);

  // アニメーションループ
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }
    let lastPublish = 0;
    const loop = (ts: number) => {
      const sims = simsRef.current;
      if (!sims) return;
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const real = Math.min(0.1, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      accRef.current += real * speedRef.current;
      let n = 0;
      while (accRef.current >= DT && n < 200) {
        step(sims.firstCome, DT);
        step(sims.reservation, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 120) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.firstCome) && isFinished(sims.reservation)) {
        publish();
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, draw, publish]);

  const finished = stats
    ? POLICIES.every((p) => stats[p].t >= params.durationMin || stats[p].done === params.trucks)
    : false;
  const nowT = stats ? Math.max(stats.firstCome.t, stats.reservation.t) : 0;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({
        firstCome: aggregate(params, "firstCome", runs),
        reservation: aggregate(params, "reservation", runs),
      });
      setAggBusy(false);
    }, 20);
  };

  const setParam = (key: keyof Override, value: number) => setOverride((o) => ({ ...o, [key]: value }));

  return (
    <section className="space-y-4" aria-label="物流センターの荷待ちシミュレーション">
      {/* シナリオ選択 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="シナリオ">
          {scenarios.map((sc) => (
            <button
              key={sc.id}
              type="button"
              role="tab"
              aria-selected={sc.id === scenarioId}
              onClick={() => {
                setScenarioId(sc.id);
                setOverride({});
                setPlaying(true);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                sc.id === scenarioId
                  ? "border-accent bg-accent-soft font-semibold"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {sc.name}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">{scenario.description}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (finished) {
                reset();
                setAgg(null);
                publish();
              }
              setPlaying((p) => !p);
            }}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90"
          >
            {playing ? "一時停止" : finished ? "もう一度" : "再生"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              setAgg(null);
              publish();
              setPlaying(true);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
          >
            最初から
          </button>
          <button
            type="button"
            onClick={() => {
              setSeedOffset((s) => s + 1);
              setPlaying(true);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
            title="乱数の種を変えて、別の 1 日を試す"
          >
            別の日で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">1 秒 =</span>
            {([10, 30, 90] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {sp} 分
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 font-mono text-xs text-muted">
          時刻 {clock(nowT)} / {clock(params.durationMin)} まで
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Slider
              label={`トラックの台数 ${params.trucks} 台`}
              min={20}
              max={64}
              step={1}
              value={params.trucks}
              onChange={(v) => setParam("trucks", v)}
            />
            <Slider
              label={`バースの数 ${params.berths} 本`}
              min={2}
              max={8}
              step={1}
              value={params.berths}
              onChange={(v) => setParam("berths", v)}
            />
            <Slider
              label={`先着順で早めに並ぶドライバー ${fmtPct(params.rushRatio)}`}
              min={0}
              max={1}
              step={0.05}
              value={params.rushRatio}
              onChange={(v) => setParam("rushRatio", v)}
            />
            <Slider
              label={`渋滞などで大きく遅れるトラック ${fmtPct(params.lateProb)}`}
              min={0}
              max={0.6}
              step={0.05}
              value={params.lateProb}
              onChange={(v) => setParam("lateProb", v)}
            />
            <Slider
              label={`予約を取らないトラック ${fmtPct(params.walkInRatio)}`}
              min={0}
              max={1}
              step={0.05}
              value={params.walkInRatio}
              onChange={(v) => setParam("walkInRatio", v)}
            />
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {POLICIES.map((policy) => {
          const st = stats?.[policy];
          return (
            <div key={policy} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: POLICY_COLOR[policy] }} aria-hidden />
                <h3 className="text-base font-bold">{POLICY_LABEL[policy]}</h3>
              </div>
              <p className="text-xs text-muted">{POLICY_DESC[policy]}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[policy] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[360px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${POLICY_LABEL[policy]}の物流センターの様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Stat label="平均の荷待ち" value={st ? fmtMin(st.avgWait) : "–"} />
                <Stat label="2 時間超え" value={st ? fmtPct(st.over2h) : "–"} hint="荷待ち+荷役" />
                <Stat label="最長の荷待ち" value={st ? fmtMin(st.maxWait) : "–"} />
                <Stat label="今の待機" value={st ? `${st.waiting} 台` : "–"} />
                <Stat label="最大の待機" value={st ? `${st.maxWaiting} 台` : "–"} />
                <Stat label="時間帯に遅れ" value={st ? fmtPct(st.missWindow) : "–"} />
                <Stat label="最後の完了" value={st ? (st.lastDone >= 0 ? clock(st.lastDone) : "作業中") : "–"} />
                {policy === "reservation" && (
                  <Stat label="予約なし車の荷待ち" value={st && params.walkInRatio > 0 ? fmtMin(st.avgWaitWalkIn) : "–"} />
                )}
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart series={chartSeries} durationMin={params.durationMin} metric={metric} onMetricChange={setMetric} />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別の日を 100 日ずつ回した平均</h3>
            <p className="text-xs text-muted">
              1 日だけでは偶然に左右されるので、同じ条件でトラックの顔ぶれと遅れ方を変えた 100 日の平均を取ります。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 日試行する"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">指標</th>
                  <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.firstCome}</th>
                  <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.reservation}</th>
                  <th className="py-1 font-semibold">差</th>
                </tr>
              </thead>
              <tbody>
                <AggRow label="平均の荷待ち" a={agg.firstCome.avgWait} b={agg.reservation.avgWait} unit="分" />
                <AggRow
                  label={`荷待ち+荷役が ${LIMIT_MIN / 60} 時間超え`}
                  a={agg.firstCome.over2h * 100}
                  b={agg.reservation.over2h * 100}
                  unit="%"
                />
                <AggRow label="最長の荷待ち" a={agg.firstCome.maxWait} b={agg.reservation.maxWait} unit="分" />
                <AggRow label="最大の待機台数" a={agg.firstCome.maxWaiting} b={agg.reservation.maxWaiting} unit="台" />
                <AggRow
                  label="時間帯に遅れた割合"
                  a={agg.firstCome.missWindow * 100}
                  b={agg.reservation.missWindow * 100}
                  unit="%"
                />
                <AggRow label="全車の荷降ろし完了" a={agg.firstCome.lastDone} b={agg.reservation.lastDone} unit="分" fmt={clock} />
                {params.walkInRatio > 0 && (
                  <AggRow
                    label="予約なし車の荷待ち"
                    a={agg.firstCome.avgWaitWalkIn}
                    b={agg.reservation.avgWaitWalkIn}
                    unit="分"
                  />
                )}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              先着順の世界には予約がないので、「予約なし車」の行の先着順の値は全トラックの平均です。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono font-semibold">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

/** どの指標も小さいほうが良い */
function AggRow({
  label,
  a,
  b,
  unit,
  fmt,
}: {
  label: string;
  a: number;
  b: number;
  unit: string;
  /** 値の表示 (省略時は「数値 単位」) */
  fmt?: (v: number) => string;
}) {
  const show = (v: number) => (fmt ? fmt(v) : `${v.toFixed(1)} ${unit}`);
  const diff = b - a;
  const same = Math.abs(diff) < 0.5;
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 pr-3 font-mono">{show(a)}</td>
      <td className="py-1 pr-3 font-mono">{show(b)}</td>
      <td className="py-1 font-mono text-muted">
        {same ? "ほぼ同じ" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${unit}（${diff < 0 ? "予約制" : "先着順"}が有利）`}
      </td>
    </tr>
  );
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: "var(--series-1)", label: "荷待ち+荷役 1 時間以内" },
    { color: "var(--amber)", label: "1〜2 時間" },
    { color: "var(--status-critical)", label: "2 時間超え" },
    { color: "var(--series-3)", label: "荷降ろしの進み具合" },
  ];
  return (
    <div className="space-y-1 text-xs text-muted">
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="凡例">
        {items.map((it) => (
          <li key={it.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} aria-hidden />
            {it.label}
          </li>
        ))}
      </ul>
      <p>荷台に白い帯があるトラックは予約車 (予約制の世界のみ)。帯がないのは予約なし、または遅刻して優先権を失ったトラック。</p>
    </div>
  );
}
