import "../legal.css";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata = { title: "Delete your data", description: "How to delete your data from Dall AI.", alternates: { canonical: "/data-deletion" } };
const CONTACT: string = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || BRAND.supportEmail;

export default function DataDeletion() {
  return (
    <main className="legal">
      <h1>Delete your data</h1>
      <p>You can ask us to delete your data at any time. We finish within 30 days and confirm when it&apos;s done.</p>

      <h2>If you messaged a business</h2>
      <ol>
        <li>{CONTACT ? <>Email <a href={`mailto:${CONTACT}?subject=Delete%20my%20data`}>{CONTACT}</a></> : <>Message the business you chatted with</>} with the subject &quot;Delete my data&quot;.</li>
        <li>Include the business name and the phone number, Instagram handle or Facebook name you used.</li>
        <li>We delete your messages, orders and receipts from that business&apos;s Dall AI account.</li>
      </ol>
      <p>To stop offers without deleting anything, reply <b>STOP</b> in the chat.</p>

      <h2>If you use Dall AI for your business</h2>
      <ol>
        <li>Disconnect your channels in Dashboard → Agent → Channels.</li>
        <li>{CONTACT ? <>Email <a href={`mailto:${CONTACT}?subject=Delete%20my%20business%20account`}>{CONTACT}</a></> : <>Contact us from your dashboard</>} from your account email to delete the business and all its data.</li>
      </ol>

      <h2>If you used Facebook or Instagram login</h2>
      <p>Go to Facebook Settings → Apps and websites, find Dall AI and remove it. That stops our access straight away. Then follow the steps above to delete what we stored.</p>

      <p><Link href="/privacy">Read the privacy policy</Link></p>
    </main>
  );
}
