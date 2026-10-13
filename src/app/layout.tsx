import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { COMPANY, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { SiteFooter } from "@/components/SiteFooter";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3">
              <a
                href={COMPANY.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 font-mono text-base font-semibold tracking-wide text-foreground hover:text-accent"
                title={`${COMPANY.name} のサイトへ`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/misclib-icon.svg" alt="" width={22} height={22} className="translate-y-0.5" />
                Misclib
              </a>
              <span className="text-muted" aria-hidden>
                /
              </span>
              <Link href="/" className="font-mono text-sm tracking-wide text-soft hover:text-accent">
                Lab
              </Link>
              <span className="label hidden sm:inline">{SITE_TAGLINE}</span>
            </div>
            <nav className="flex items-center gap-4 text-sm text-muted">
              <Link href="/#sims" className="hover:text-foreground">
                一覧
              </Link>
              <Link href="/#about" className="hover:text-foreground">
                この実験室について
              </Link>
              <a href={COMPANY.url} target="_blank" rel="noopener noreferrer" className="hidden hover:text-foreground sm:inline">
                misclib.com ↗
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
