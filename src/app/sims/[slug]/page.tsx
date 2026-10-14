import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, getSimEntry, simEntries } from "@/lib/sims";
import { simModules } from "@/sims";
import { JsonLd } from "@/components/JsonLd";
import { COMPANY, SITE_NAME, SITE_URL } from "@/lib/site";

/** 一覧にない slug はビルド時に 404 にする (全ページ静的生成) */
export const dynamicParams = false;

export function generateStaticParams() {
  return simEntries.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata(props: PageProps<"/sims/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const entry = getSimEntry(slug);
  if (!entry) return {};
  const path = `/sims/${entry.slug}`;
  const description = `${entry.question} ${entry.summary}`;
  const image = { url: `/og/${entry.slug}.png`, width: 1200, height: 630, alt: entry.title };
  return {
    title: entry.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      url: path,
      title: entry.title,
      description,
      publishedTime: `${entry.date}T00:00:00+09:00`,
      authors: [COMPANY.name],
      tags: entry.tags,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: entry.title,
      description,
      images: [image.url],
    },
  };
}

export default async function SimPage(props: PageProps<"/sims/[slug]">) {
  const { slug } = await props.params;
  const entry = getSimEntry(slug);
  const mod = simModules[slug];
  if (!entry || !mod) notFound();

  const { Sim, Article } = mod;
  const url = `${SITE_URL}/sims/${entry.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: entry.title,
    description: `${entry.question} ${entry.summary}`,
    url,
    mainEntityOfPage: url,
    image: [`${SITE_URL}/og/${entry.slug}.png`],
    datePublished: `${entry.date}T00:00:00+09:00`,
    dateModified: `${entry.date}T00:00:00+09:00`,
    inLanguage: "ja",
    keywords: entry.tags.join(", "),
    author: { "@type": "Organization", name: COMPANY.name, url: "https://www.misclib.com/" },
    publisher: { "@type": "Organization", name: COMPANY.name, url: "https://www.misclib.com/", logo: { "@type": "ImageObject", url: `${SITE_URL}/misclib-icon.svg` } },
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}/` },
  };

  return (
    <article className="space-y-10">
      <JsonLd data={jsonLd} />
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
