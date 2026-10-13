import Link from "next/link";
import { formatDate, simEntries } from "@/lib/sims";

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <p className="text-sm font-medium text-accent">思考実験のための小さな実験室</p>
        <h1 className="text-3xl font-bold leading-snug sm:text-4xl">
          社会の「もしも」を、
          <br className="sm:hidden" />
          動かして眺める。
        </h1>
        <p className="max-w-2xl text-muted">
          身近な社会課題をうんと単純化したモデルに落とし込み、ブラウザの中で動かしてみる連載です。
          答えを出すためではなく、「何が効いているのか」を目で確かめるために。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">シミュレーション一覧</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {simEntries.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/sims/${e.slug}`}
                className="group block h-full rounded-xl border border-border bg-card p-5 transition hover:border-accent"
              >
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="font-mono">#{String(e.no).padStart(2, "0")}</span>
                  <span>·</span>
                  <time dateTime={e.date}>{formatDate(e.date)}</time>
                </div>
                <h3 className="mt-2 text-lg font-bold leading-snug group-hover:text-accent">
                  {e.title}
                </h3>
                <p className="mt-2 text-sm text-muted">{e.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="about" className="prose max-w-2xl scroll-mt-24">
        <h2>このサイトについて</h2>
        <p>
          「エスカレーターは片側を空けるべき？」「信号のない横断歩道で車は止まるべき？」といった、
          誰もが一度は考える小さな社会課題を、エージェントベースの簡単なシミュレーションにして眺めます。
        </p>
        <p>
          それぞれの記事では、ルールを変えた複数の世界を並べて同時に動かし、
          何が起きるかをアニメーションと数字で比べます。モデルの前提と限界も必ず書くので、
          「この前提を変えたらどうなる？」と考える材料にしてください。
        </p>
        <p>
          結果はあくまで思考実験です。現実の制度設計や安全対策の根拠として使えるものではありません。
        </p>
      </section>
    </div>
  );
}
