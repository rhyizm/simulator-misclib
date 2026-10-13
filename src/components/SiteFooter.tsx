import Link from "next/link";
import { COMPANY, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

const YEAR = 2026;

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-base font-semibold">Misclib</span>
              <span className="font-mono text-sm text-soft">/ Lab</span>
            </div>
            <p className="text-sm text-soft">
              {SITE_NAME} は {COMPANY.name} の遊びプロジェクトです。本業の合間に、社会の「もしも」を
              シミュレーションにして眺めています。
            </p>
            <p className="text-xs text-muted">
              ここで示す結果は単純化したモデルによる思考実験であり、現実の予測や政策の根拠ではありません。
            </p>
          </div>
          <div>
            <p className="label mb-3">Company</p>
            <ul className="space-y-1.5 text-sm">
              <li>
                <a href={COMPANY.url} className="text-soft hover:text-accent">
                  {COMPANY.name} ↗
                </a>
              </li>
              <li>
                <a href={COMPANY.services} className="text-soft hover:text-accent">
                  サービス一覧 ↗
                </a>
              </li>
              <li>
                <a href={COMPANY.blog} className="text-soft hover:text-accent">
                  Tech Blog ↗
                </a>
              </li>
              <li>
                <a href={COMPANY.contact} className="text-soft hover:text-accent">
                  お問い合わせ ↗
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="label mb-3">Products</p>
            <ul className="space-y-1.5 text-sm">
              {COMPANY.products.map((p) => (
                <li key={p.name}>
                  <a href={p.url} className="text-soft hover:text-accent">
                    {p.name} ↗
                  </a>
                  <span className="ml-2 text-xs text-muted">{p.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            <Link href="/" className="hover:text-foreground">
              {SITE_NAME}
            </Link>
            <span className="mx-2">·</span>
            {SITE_TAGLINE}
          </p>
          <p className="font-mono">
            {COMPANY.name} / {COMPANY.nameJa} · © {YEAR} MISCLIB LLC. ALL RIGHTS RESERVED.
          </p>
        </div>
      </div>
    </footer>
  );
}
