import { WEEKS_PER_YEAR, activePolicy, type Mast, type SimState } from "./model";

export interface RenderTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  grid: string;
  forest: string;
  wild: string;
  learned: string;
  fruit: string;
}

export const CANVAS_W = 360;
export const CANVAS_H = 426;

/** 集落に下りたクマを、この年数だけ集落に描いておく (約 1.5 週) */
const VISIT_YEARS = 1.5 / WEEKS_PER_YEAR;

const PAD = 14;
const FOREST_TOP = 44;
const FOREST_BOTTOM = 196;
const BUFFER_BOTTOM = 226;
const VILLAGE_BOTTOM = 318;
const TL_TOP = 334;
const TL_BOTTOM = 392;

export const MAST_LABEL: Record<Mast, string> = { good: "豊作", fair: "並作", poor: "凶作" };

/** id から決まる 0〜1 の擬似乱数 (描画専用。モデルの乱数には触らない) */
function hash(n: number): number {
  let x = (n + 1) * 0x9e3779b1;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function monthOf(week: number): number {
  return 4 + Math.floor((week / WEEKS_PER_YEAR) * 8);
}

/** 柿の木の位置 (集落の中に 14 本) */
const FRUIT_TREES = Array.from({ length: 14 }, (_, i) => ({
  x: PAD + 14 + hash(i * 31 + 7) * (CANVAS_W - PAD * 2 - 28),
  y: BUFFER_BOTTOM + 14 + hash(i * 17 + 3) * (VILLAGE_BOTTOM - BUFFER_BOTTOM - 28),
  keep: hash(i * 53 + 11),
}));

/** 家の位置 */
const HOUSES = Array.from({ length: 9 }, (_, i) => ({
  x: PAD + 20 + (i % 5) * 64 + hash(i * 13) * 20,
  y: BUFFER_BOTTOM + 22 + Math.floor(i / 5) * 40 + hash(i * 29) * 10,
}));

/**
 * 1 つの世界 (方針) を 1 枚のキャンバスに描く。
 * 上: 山 (点 1 つがクマ 1 頭)、真ん中: やぶ (緩衝帯)、下: 集落、最下段: 年ごとの出没件数。
 */
export function renderSim(ctx: CanvasRenderingContext2D, s: SimState, theme: RenderTheme) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const p = s.params;
  const yearIdx = Math.min(s.year, p.years - 1);
  const pol = activePolicy(s.policy, yearIdx);
  const mast = s.masts[yearIdx];
  const done = s.year >= p.years;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // 見出し
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillStyle = theme.muted;
  const label = done ? `${p.firstYear + p.years - 1} 年 (終了)` : `${p.firstYear + yearIdx} 年 ${monthOf(s.week)} 月`;
  ctx.fillText(label, PAD, 22);
  ctx.textAlign = "right";
  ctx.font = "700 12px sans-serif";
  ctx.fillStyle = mast === "poor" ? theme.learned : mast === "good" ? theme.forest : theme.muted;
  const autumn = !done && s.week >= 20;
  ctx.fillText(`秋の実り: ${MAST_LABEL[mast]}${autumn ? " (いま秋)" : ""}`, W - PAD, 22);
  if (yearIdx < s.policy.from) {
    ctx.font = "11px sans-serif";
    ctx.fillStyle = theme.muted;
    ctx.fillText(`対策は ${p.firstYear + s.policy.from} 年から`, W - PAD, 38);
  }

  // 山: 秋は実りに応じて色づく
  const forestAlpha = autumn ? (mast === "good" ? 0.22 : mast === "fair" ? 0.13 : 0.05) : 0.12;
  ctx.globalAlpha = forestAlpha;
  ctx.fillStyle = theme.forest;
  ctx.fillRect(PAD, FOREST_TOP, W - PAD * 2, FOREST_BOTTOM - FOREST_TOP);
  ctx.globalAlpha = 1;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.muted;
  ctx.fillText("山", PAD + 4, FOREST_TOP + 12);

  // やぶ / 緩衝帯
  const bufferOn = pol.buffer < 1;
  if (bufferOn) {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    for (let x = PAD; x < W - PAD; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, BUFFER_BOTTOM - 4);
      ctx.lineTo(x + 3, BUFFER_BOTTOM - 8);
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = theme.forest;
    for (let i = 0; i < 70; i++) {
      const x = PAD + hash(i * 7 + 1) * (W - PAD * 2);
      const y = FOREST_BOTTOM + 4 + hash(i * 11 + 5) * (BUFFER_BOTTOM - FOREST_BOTTOM - 8);
      ctx.beginPath();
      ctx.arc(x, y, 3 + hash(i) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = theme.muted;
  ctx.font = "10px sans-serif";
  ctx.fillText(bufferOn ? "緩衝帯 (刈り払い済み)" : "やぶ・耕作放棄地", PAD + 4, FOREST_BOTTOM + 14);

  // 集落
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD + 0.5, BUFFER_BOTTOM + 0.5, W - PAD * 2 - 1, VILLAGE_BOTTOM - BUFFER_BOTTOM - 1);
  ctx.fillText("集落", PAD + 4, BUFFER_BOTTOM + 13);
  for (const h of HOUSES) {
    ctx.fillStyle = theme.grid;
    ctx.fillRect(h.x - 7, h.y - 5, 14, 11);
    ctx.strokeStyle = theme.border;
    ctx.strokeRect(h.x - 7, h.y - 5, 14, 11);
  }
  // 柿の木: 残っている割合だけ実をつけて描き、伐った木は切り株に
  const keepShare = Math.min(1, pol.attractant / 0.6);
  for (const tr of FRUIT_TREES) {
    if (tr.keep < keepShare) {
      ctx.fillStyle = theme.fruit;
      ctx.globalAlpha = autumn ? 0.95 : 0.4;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tr.x - 3, tr.y);
      ctx.lineTo(tr.x + 3, tr.y);
      ctx.stroke();
    }
  }

  // 集落に下りてきたクマの id
  const visiting = new Map<number, (typeof s.events)[number]>();
  for (const e of s.events) {
    if (s.t - e.t < VISIT_YEARS) visiting.set(e.bearId, e);
  }

  // 山のクマ
  for (const b of s.bears) {
    if (visiting.has(b.id)) continue;
    const wob = Math.sin(s.t * 40 + b.id) * 2;
    const x = PAD + 6 + hash(b.id * 3 + 1) * (W - PAD * 2 - 12) + wob;
    const y = FOREST_TOP + 18 + hash(b.id * 5 + 2) * (FOREST_BOTTOM - FOREST_TOP - 26);
    ctx.fillStyle = b.learned ? theme.learned : theme.wild;
    ctx.beginPath();
    ctx.arc(x, y, b.learned ? 3.6 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 集落のクマ (下りてきた、餌を食べた、捕獲された)
  for (const e of visiting.values()) {
    const x = PAD + 10 + hash(e.bearId * 7 + Math.floor(e.t * 1000)) * (W - PAD * 2 - 20);
    const y = BUFFER_BOTTOM + 10 + hash(e.bearId * 13 + 5) * (VILLAGE_BOTTOM - BUFFER_BOTTOM - 20);
    const color = e.learned ? theme.learned : theme.wild;
    if (e.kind === "culled") {
      ctx.strokeStyle = theme.fg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4);
      ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4);
      ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      if (e.kind === "ate") {
        // 餌にありつけた: 実の色の輪
        ctx.strokeStyle = theme.fruit;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // 年ごとの出没件数
  const n = p.years;
  const slot = (W - PAD * 2) / n;
  let maxS = 120;
  for (const y of s.years) maxS = Math.max(maxS, y.sightings);
  const barH = TL_BOTTOM - TL_TOP - 12;
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let i = 0; i < n; i++) {
    const x = PAD + i * slot;
    const rec = s.years[i];
    if (rec) {
      const h = (rec.sightings / maxS) * barH;
      const learnedH = (rec.learnedSightings / maxS) * barH;
      ctx.fillStyle = theme.wild;
      ctx.globalAlpha = i === yearIdx && !done ? 1 : 0.7;
      ctx.fillRect(x + 3, TL_BOTTOM - h, slot - 6, h - learnedH);
      ctx.fillStyle = theme.learned;
      ctx.fillRect(x + 3, TL_BOTTOM - learnedH, slot - 6, learnedH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.muted;
      ctx.fillText(String(rec.sightings), x + slot / 2, TL_BOTTOM - h - 3);
    }
    const m = s.masts[i];
    ctx.fillStyle = m === "poor" ? theme.learned : m === "good" ? theme.forest : theme.muted;
    ctx.fillText(MAST_LABEL[m][0], x + slot / 2, TL_BOTTOM + 13);
    if (i === 0 || i === n - 1) {
      ctx.fillStyle = theme.muted;
      ctx.fillText(String(p.firstYear + i), x + slot / 2, TL_BOTTOM + 26);
    }
  }
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(PAD, TL_BOTTOM + 0.5);
  ctx.lineTo(W - PAD, TL_BOTTOM + 0.5);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = theme.muted;
  ctx.fillText("出没件数 / 年", PAD, TL_TOP - 2);
}
