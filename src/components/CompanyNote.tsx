import { COMPANY } from "@/lib/site";

/** 記事の末尾やトップに置く、運営会社の紹介ボックス (ささやかな宣伝) */
export function CompanyNote() {
  return (
    <aside className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-label="運営会社について">
      <p className="label">Made by</p>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <p className="text-base font-bold">
            {COMPANY.name}{" "}
            <span className="font-normal text-muted">({COMPANY.nameJa})</span>
          </p>
          <p className="mt-1 text-sm text-soft">{COMPANY.summary}</p>
          <p className="mt-2 text-sm text-soft">
            このサイトは本業とは関係のない遊びですが、「動かして確かめる」という姿勢は同じです。
            データの可視化やシミュレーションの相談も歓迎します。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
          <a
            href={COMPANY.url}
            className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-semibold text-accent-fg hover:opacity-90"
          >
            Misclib の仕事を見る ↗
          </a>
          <a
            href={COMPANY.contact}
            className="rounded-lg border border-border px-4 py-2 text-center text-sm text-soft hover:border-accent hover:text-foreground"
          >
            お問い合わせ ↗
          </a>
        </div>
      </div>
    </aside>
  );
}
