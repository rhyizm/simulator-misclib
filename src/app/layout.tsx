import type { Metadata } from "next";
import Link from "next/link";
import { Noto_Sans_JP, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE_NAME } from "@/lib/sims";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "身近な社会課題を思考実験としてシミュレーションし、その結果をアニメーションとグラフで眺めるブログ。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${notoSansJp.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="font-bold tracking-wide">
              {SITE_NAME}
            </Link>
            <nav className="text-sm text-muted">
              <Link href="/#about" className="hover:text-foreground">
                このサイトについて
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-muted">
            <p>
              ここで示す結果は単純化したモデルによる思考実験であり、現実の予測や政策の根拠ではありません。
            </p>
            <p className="mt-1">
              <a
                href="https://www.misclib.com"
                className="underline underline-offset-4 hover:text-foreground"
              >
                www.misclib.com
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
