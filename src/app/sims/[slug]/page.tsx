import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, getSimEntry, simEntries } from "@/lib/sims";
import { simModules } from "@/sims";

/** 一覧にない slug はビルド時に 404 にする (全ページ静的生成) */
export const dynamicParams = false;

export function generateStaticParams() {
  return simEntries.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata(props: PageProps<"/sims/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const entry = getSimEntry(slug);
  if (!entry) return {};
  return {
    title: entry.title,
    description: entry.summary,
  };
}

export default async function SimPage(props: PageProps<"/sims/[slug]">) {
  const { slug } = await props.params;
  const entry = getSimEntry(slug);
  const mod = simModules[slug];
  if (!entry || !mod) notFound();

  const { Sim, Article } = mod;

  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← 一覧へ
        </Link>
        <div className="flex items-center gap-2 font-mono text-xs text-muted">
          <span>#{String(entry.no).padStart(2, "0")}</span>
          <span>·</span>
          <time dateTime={entry.date}>{formatDate(entry.date)}</time>
          <span>·</span>
          <span>{entry.tags.join(" / ")}</span>
        </div>
        <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{entry.title}</h1>
        <p className="text-soft">{entry.question}</p>
      </header>

      <Sim />

      <div className="prose max-w-3xl">
        <Article />
      </div>
    </article>
  );
}
