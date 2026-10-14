import Link from "next/link";
import { formatDate, simEntries } from "@/lib/sims";
import { COMPANY, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.misclib.com/#organization",
      name: COMPANY.name,
      alternateName: COMPANY.nameJa,
      url: "https://www.misclib.com/",
      logo: `${SITE_URL}/misclib-icon.svg`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      alternateName: SITE_TAGLINE,
      description: SITE_DESCRIPTION,
      inLanguage: "ja",
      publisher: { "@id": "https://www.misclib.com/#organization" },
    },
  ],
};

export default function Home() {
  return (
    <div className="space-y-14">
      <JsonLd data={jsonLd} />
      <section className="space-y-4 pt-4">
        <p className="label">A side project by {COMPANY.name}</p>
        <h1 className="text-3xl font-bold leading-snug sm:text-5xl">
          社会の「もしも」を、
          <br className="sm:hidden" />
          動かして眺める。
        </h1>
        <p className="max-w-2xl text-soft">
          身近な社会課題をうんと単純化したモデルに落とし込み、ブラウザの中で動かしてみる連載です。
          答えを出すためではなく、「何が効いているのか」を目で確かめるために。
        </p>
        <div className="flex flex-wrap gap-4 pt-1 font-mono text-xs text-muted">
          <span>
            Experiments <span className="text-foreground">{String(simEntries.length).padStart(2, "0")}</span>
          </span>
          <span>
            Since <span className="text-foreground">2026</span>
          </span>
          <span>
            By{" "}
            <a href={COMPANY.url} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4 hover:text-accent">
              {COMPANY.name}
            </a>
          </span>
        </div>
      </section>

      <section id="sims" className="scroll-mt-24 space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="label">01</span>
          <h2 className="text-lg font-bold">シミュレーション一覧</h2>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {simEntries.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/sims/${e.slug}`}
                className="group block h-full rounded-xl border border-border bg-card p-5 transition hover:border-accent"
              >
                <div className="flex items-center gap-2 font-mono text-xs text-muted">
                  <span>#{String(e.no).padStart(2, "0")}</span>
                  <span>·</span>
                  <time dateTime={e.date}>{formatDate(e.date)}</time>
                </div>
                <h3 className="mt-2 text-lg font-bold leading-snug group-hover:text-accent">{e.title}</h3>
                <p className="mt-2 text-sm text-soft">{e.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {e.tags.map((t) => (
                    <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-soft">
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="about" className="scroll-mt-24 space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="label">02</span>
          <h2 className="text-lg font-bold">この実験室について</h2>
        </div>
        <div className="prose max-w-2xl">
          <p>
            「エスカレーターは片側を空けるべき？」「信号のない横断歩道で車は止まるべき？」といった、
            誰もが一度は考える小さな社会課題を、エージェントベースの簡単なシミュレーションにして眺めます。
          </p>
          <p>
            それぞれの記事では、ルールを変えた複数の世界を並べて同時に動かし、
            何が起きるかをアニメーションと数字で比べます。モデルの前提と限界も必ず書くので、
            「この前提を変えたらどうなる？」と考える材料にしてください。
          </p>
          <p>結果はあくまで思考実験です。現実の制度設計や安全対策の根拠として使えるものではありません。</p>
          <p>
            作っているのは東京の小さな会社、
            <a href={COMPANY.url} target="_blank" rel="noopener noreferrer">{COMPANY.name}</a>
            です。本業の合間の遊びとして、気が向いたときに更新します。
          </p>
        </div>
      </section>
    </div>
  );
}
