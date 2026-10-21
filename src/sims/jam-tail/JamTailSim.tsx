"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type SimParams,
  type SimState,
  type SimStats,
  type World,
} from "./model";
import { getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { BlindChart, type BlindSeries } from "./BlindChart";

type Speed = 1 | 3 | 10;

const WORLDS: World[] = ["eyes", "phone"];

const WORLD_LABEL: Record<World, string> = {
  eyes: "前を見ている世界",
  phone: "ながらスマホがいる世界",
};

const WORLD_COLOR: Record<World, string> = {
  eyes: "var(--series-1)",
  phone: "var(--series-2)",
};

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    tunnel: v("--line"),
    phone: v("--amber"),
    glance: v("--soft"),
    hit: v("--status-critical"),
    safe: v("--series-3"),
  };
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function JamTailSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(3);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [phoneSec, setPhoneSec] = useState<number | null>(null);
  const [phoneShare, setPhoneShare] = useState<number | null>(null);
  const [aebShare, setAebShare] = useState<number | null>(null);
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<BlindSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const base = scenario.params;
    return {
      ...base,
      seed: base.seed + seedOffset,
      phoneSec: phoneSec ?? base.phoneSec,
      phoneShare: phoneShare ?? base.phoneShare,
      aebShare: aebShare ?? base.aebShare,
    };
  }, [scenario, seedOffset, phoneSec, phoneShare, aebShare]);

  const simsRef = useRef<Record<World, SimState> | null>(null);
  const canvasRefs = useRef<Record<World, HTMLCanvasElement | null>>({ eyes: null, phone: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    for (const world of WORLDS) {
      const canvas = canvasRefs.current[world];
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      if (!themeRef.current) themeRef.current = readTheme(canvas);
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth) || CANVAS_W;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(CANVAS_H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const color = getComputedStyle(canvas).getPropertyValue(world === "eyes" ? "--series-1" : "--series-2").trim();
      renderSim(ctx, sims[world], themeRef.current, color, width);
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({ eyes: getStats(sims.eyes), phone: getStats(sims.phone) });
    setChartSeries(WORLDS.map((w) => ({ name: WORLD_LABEL[w], color: WORLD_COLOR[w], encounters: sims[w].encounters.slice() })));
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    simsRef.current = {
      eyes: createSim(params, "eyes"),
      phone: createSim(params, "phone"),
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

  // 画面幅が変わったら描き直す
  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

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
      while (accRef.current >= DT && n < 400) {
        step(sims.eyes, DT);
        step(sims.phone, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 150) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.eyes) && isFinished(sims.phone)) {
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

  const finished = stats ? stats.eyes.t >= params.durationSec : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({
        eyes: aggregate(params, "eyes", runs),
        phone: aggregate(params, "phone", runs),
      });
      setAggBusy(false);
    }, 20);
  };

  const worldDesc: Record<World, string> = {
    eyes: `メーターやミラーに 0.4〜1.2 秒、目をやるだけ。スマホは見ない`,
    phone: `同じ車のうち ${Math.round(params.phoneShare * 100)}% の人が、ときどき ${params.phoneSec} 秒ほど (±30%) スマホを見る`,
  };

  return (
    <section className="space-y-4" aria-label="渋滞の最後尾とながらスマホのシミュレーション">
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
                setAebShare(null);
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

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-sm">
            1 回にスマホを見る長さ <span className="font-mono font-semibold">{params.phoneSec} 秒</span>
            <span className="ml-2 text-xs text-muted">
              (時速 85 km なら {Math.round((params.phoneSec * 85) / 3.6)} m 走るあいだ前を見ていない)
            </span>
          </span>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={params.phoneSec}
            onChange={(e) => {
              setPhoneSec(Number(e.target.value));
              setPlaying(true);
            }}
            aria-label="1 回にスマホを見る長さ (秒)"
          />
        </label>

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
            title="乱数の種を変えて、別の 1 回を試す"
          >
            別の乱数で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([1, 3, 10] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                ×{sp}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            経過 {stats ? fmtClock(stats.eyes.t) : "0:00"} / {fmtClock(params.durationSec)}
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                スマホを見る人の割合 {Math.round(params.phoneShare * 100)}%（「ながらスマホがいる世界」だけ）
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.phoneShare}
                onChange={(e) => setPhoneShare(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                自動ブレーキ (AEB) が付いている割合 {Math.round(params.aebShare * 100)}%（両方の世界に同じだけ）
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.aebShare}
                onChange={(e) => setAebShare(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4">
        {WORLDS.map((world) => {
          const st = stats?.[world];
          return (
            <div key={world} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[world] }} aria-hidden />
                <h3 className="text-base font-bold">{WORLD_LABEL[world]}</h3>
              </div>
              <p className="text-xs text-muted">{worldDesc[world]}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[world] = el;
                }}
                className="mt-2 block w-full"
                style={{ height: CANVAS_H }}
                role="img"
                aria-label={`${WORLD_LABEL[world]}の高速道路の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <Stat label="最後尾に着いた" value={st ? `${st.reached} 台` : "–"} />
                <Stat
                  label="追突"
                  value={st ? `${st.crashes} 回` : "–"}
                  hint={st && world === "phone" && st.crashes > 0 ? `うちスマホ中 ${st.phoneCrashes}` : undefined}
                />
                <Stat label="平均の追突速度" value={st && st.crashes > 0 ? `${st.avgImpactKmh.toFixed(0)} km/h` : "–"} />
                <Stat label="亡くなる人 (期待値)" value={st ? `${st.expectedDeaths.toFixed(2)} 人` : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <BlindChart
          series={chartSeries}
          sightM={params.sightM}
          truckKmh={Math.round((params.truckKmhMin + params.truckKmhMax) / 2)}
          carKmh={Math.round((params.carKmhMin + params.carKmhMax) / 2)}
          reaction={(params.reactionMin + params.reactionMax) / 2}
          truckDecel={params.truckDecel}
          carDecel={params.carDecel}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">乱数を変えて 100 回ずつ回した合計</h3>
            <p className="text-xs text-muted">
              追突は「目を離した瞬間に最後尾が現れるか」という偶然に大きく左右されるので、同じ条件で 100 回 (5 分 × 100 = 8 時間あまり) 試行して合計します。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 回試行する"}
          </button>
        </div>
        {agg && <AggTable a={agg.eyes} b={agg.phone} />}
      </div>
    </section>
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

function AggTable({ a, b }: { a: AggregateStats; b: AggregateStats }) {
  const per1000 = (n: number, x: AggregateStats) => (x.reached > 0 ? (n / x.reached) * 1000 : 0);
  const rows: { label: string; a: string; b: string }[] = [
    { label: "最後尾に着いた車", a: `${a.reached} 台`, b: `${b.reached} 台` },
    {
      label: "1000 台あたりの追突",
      a: `${per1000(a.crashes, a).toFixed(1)} 回`,
      b: `${per1000(b.crashes, b).toFixed(1)} 回`,
    },
    {
      label: "うち、最後尾が見えた瞬間にスマホを見ていた",
      a: "–",
      b: b.crashes > 0 ? `${Math.round((b.phoneCrashes / b.crashes) * 100)}%` : "–",
    },
    {
      label: "追突したときの平均速度",
      a: a.crashes > 0 ? `${a.avgImpactKmh.toFixed(1)} km/h` : "–",
      b: b.crashes > 0 ? `${b.avgImpactKmh.toFixed(1)} km/h` : "–",
    },
    {
      label: "1000 台あたり、50 km/h 以上での追突",
      a: `${per1000(a.severe, a).toFixed(1)} 回`,
      b: `${per1000(b.severe, b).toFixed(1)} 回`,
    },
    {
      label: "1000 台あたり、亡くなる人 (期待値)",
      a: `${per1000(a.expectedDeaths, a).toFixed(2)} 人`,
      b: `${per1000(b.expectedDeaths, b).toFixed(2)} 人`,
    },
  ];
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-3 font-semibold">指標</th>
            <th className="py-1 pr-3 font-semibold">{WORLD_LABEL.eyes}</th>
            <th className="py-1 font-semibold">{WORLD_LABEL.phone}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-1 pr-3">{r.label}</td>
              <td className="py-1 pr-3 font-mono">{r.a}</td>
              <td className="py-1 font-mono">{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        「止まった列の最後尾に、ほぼ全員が 1 回ずつ出会う」という、現実よりずっと厳しい条件での数字です。比べるのは 2 つの世界の差と、条件を変えたときの増え方です。
      </p>
    </div>
  );
}

function Legend() {
  const items: { color: string; label: string; shape?: "bar" | "line" }[] = [
    { color: "var(--series-1)", label: "前を見ている世界の車 (高いのがトラック)" },
    { color: "var(--series-2)", label: "ながらスマホがいる世界の車" },
    { color: "var(--muted)", label: "最初から止まっている渋滞の列" },
    { color: "var(--amber)", label: "スマホを見ている車と、見ながら走った区間", shape: "line" },
    { color: "var(--status-critical)", label: "追突した場所" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block ${it.shape === "line" ? "h-1 w-4" : "h-3 w-3 rounded-sm"}`}
            style={{ background: it.color }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
      <li>白い点はメーターやミラーを見ている一瞬</li>
    </ul>
  );
}
