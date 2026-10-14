import type { MetadataRoute } from "next";
import { simEntries } from "@/lib/sims";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const latest = simEntries.map((e) => e.date).sort().at(-1) ?? "2026-10-13";
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(latest),
      changeFrequency: "monthly",
      priority: 1,
    },
    ...simEntries.map((e) => ({
      url: `${SITE_URL}/sims/${e.slug}`,
      lastModified: new Date(e.date),
      changeFrequency: "yearly" as const,
      priority: 0.8,
    })),
  ];
}
