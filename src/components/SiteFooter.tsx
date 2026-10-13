import Link from "next/link";
import { COMPANY, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

const YEAR = 2026;

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl space-y-2">
            <div className="flex items-baseline gap-2">
              <Link href="/" className="font-mono text-base font-semibold hover:text-accent">
                Misclib
              </Link>
              <span className="font-mono text-sm text-soft">/ Lab</span>
              <span className="label ml-1">{SITE_TAGLINE}</span>
            </div>
            <p className="text-sm text-soft">
              {SITE_NAME} は{" "}
              <a href={COMPANY.url} className="underline underline-offset-4 hover:text-accent">
                {COMPANY.name}
              </a>{" "}
              の遊びプロジェクトです。
            </p>
            <p className="text-xs text-muted">
              ここで示す結果は単純化したモデルによる思考実験であり、現実の予測や政策の根拠ではありません。
            </p>
          </div>
          <p className="font-mono text-xs text-muted sm:text-right">
            {COMPANY.name} / {COMPANY.nameJa}
            <br />© {YEAR} MISCLIB LLC. ALL RIGHTS RESERVED.
          </p>
        </div>
      </div>
    </footer>
  );
}
