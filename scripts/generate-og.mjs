/**
 * OG 画像 (1200×630) を生成して public/og/ に置く。
 *   npm run og
 * ブランドカラーの HTML を Playwright の Chromium で描画するだけなので、
 * Workers 上で画像生成ライブラリを動かす必要がない。
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "og");

// シミュレーション一覧 (TypeScript を直接読めないので、--experimental-strip-types 経由で import する)
const { simEntries } = await import(path.join(root, "src/lib/sims.ts"));
const { SITE_NAME, SITE_TAGLINE, COMPANY } = await import(path.join(root, "src/lib/site.ts"));

const icon = await readFile(path.join(root, "public", "misclib-icon.svg"), "utf8");
const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`;

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function html({ kicker, title, sub }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
  html,body{margin:0;width:1200px;height:630px;background:#0a0a0a;color:#f2f2f0;font-family:"Noto Sans JP",sans-serif;}
  .wrap{box-sizing:border-box;width:1200px;height:630px;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between;
        background:
          radial-gradient(900px 500px at 85% -10%, #8db8ff26, transparent 60%),
          linear-gradient(#ffffff0a 1px, transparent 1px) 0 0/100% 48px,
          #0a0a0a;}
  .top{display:flex;align-items:center;gap:18px;font-family:"IBM Plex Mono",monospace;font-size:28px;letter-spacing:.04em;}
  .top img{width:44px;height:44px}
  .top .sep{color:#ffffff66}
  .top .lab{color:#ffffffc7}
  .kicker{font-family:"IBM Plex Mono",monospace;font-size:22px;letter-spacing:.14em;color:#8db8ff;text-transform:uppercase;margin-bottom:22px}
  h1{margin:0;font-size:64px;line-height:1.28;font-weight:700;letter-spacing:.01em;font-feature-settings:"palt"}
  .sub{margin-top:26px;font-size:28px;line-height:1.6;color:#ffffffc7;max-width:1000px}
  .bottom{display:flex;justify-content:space-between;align-items:flex-end;font-family:"IBM Plex Mono",monospace;font-size:22px;color:#ffffff99;letter-spacing:.06em}
</style></head>
<body><div class="wrap">
  <div class="top"><img src="${iconDataUri}" alt=""><span>Misclib</span><span class="sep">/</span><span class="lab">Lab</span></div>
  <div>
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(title)}</h1>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
  </div>
  <div class="bottom"><span>simu.misclib.com</span><span>${esc(COMPANY.name)}</span></div>
</div></body></html>`;
}

const pages = [
  { file: "default.png", kicker: SITE_TAGLINE, title: "社会の「もしも」を、動かして眺める。", sub: `${SITE_NAME} は身近な社会課題をシミュレーションにして、何が効いているのかを目で確かめる実験室です。` },
  ...simEntries.map((e) => ({
    file: `${e.slug}.png`,
    kicker: `#${String(e.no).padStart(2, "0")} · ${e.tags.join(" / ")}`,
    title: e.title,
    sub: e.question,
  })),
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const p of pages) {
  await page.setContent(html(p), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await writeFile(path.join(outDir, p.file), png);
  console.log("wrote", path.join("public/og", p.file), `${Math.round(png.length / 1024)} KB`);
}
await browser.close();
