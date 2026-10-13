import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="label">404</p>
      <h1 className="mt-2 text-2xl font-bold">ページが見つかりません</h1>
      <p className="mt-4">
        <Link href="/" className="text-accent underline underline-offset-4">
          トップへ戻る
        </Link>
      </p>
    </div>
  );
}
