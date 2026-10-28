import "./legal.css";
import Link from "next/link";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="legal">
      <h1>This page isn&apos;t here</h1>
      <p>If you followed a payment link, it may have expired or been replaced. Ask the business to send you a fresh one.</p>
      <p><Link href="/">Go to the Dall AI home page</Link></p>
    </main>
  );
}
