import "../legal.css";
import Link from "next/link";
import { BRAND } from "@/lib/config";

export const metadata = { title: "Privacy policy", description: "How Dall AI collects, uses and protects data for businesses and their customers.", alternates: { canonical: "/privacy" } };
const CONTACT: string = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || BRAND.supportEmail;

export default function Privacy() {
  return (
    <main className="legal">
      <h1>Privacy policy</h1>
      <small>Last updated 28 October 2026</small>
      <p>Dall AI lets businesses run AI sales assistants on WhatsApp, Instagram, Messenger and web chat. This policy explains what we collect, why, and the choices you have. It covers business owners who use Dall AI and the customers who message those businesses.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Business accounts:</b> name, email, business details, catalogue, bank details for receiving transfers, and team members.</li>
        <li><b>Connected channels:</b> when a business connects WhatsApp, Instagram, Facebook or ads through Meta, we store the access tokens and page or account IDs Meta gives us.</li>
        <li><b>Customer conversations:</b> messages sent to a business, the customer&apos;s name or handle and phone number as provided by the channel, orders, and payment receipts they upload.</li>
        <li><b>Marketing consent:</b> whether a customer agreed to receive offers, and opt-outs (for example replying STOP).</li>
        <li><b>Technical data:</b> IP address and device information for security and rate limiting.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To reply to customers, answer questions from the business&apos;s catalogue, create orders and check payment receipts.</li>
        <li>To hand conversations to the business&apos;s team when needed.</li>
        <li>To send follow-ups and offers only to customers who agreed, and never after they opt out.</li>
        <li>To run and report on ads the business creates, if it connects an ad account.</li>
        <li>To keep the service secure and prevent abuse.</li>
      </ul>
      <p>We do not sell personal data. We do not use customer conversations to train AI models.</p>

      <h2>Who we share it with</h2>
      <p>Only the service providers needed to run Dall AI: Meta (messaging and ads), Anthropic (AI replies), Supabase (database and storage), Vercel (hosting), and Higgsfield (image and video generation, only when a business requests it). Each processes data for us under its own terms. We share data with authorities only when the law requires it.</p>

      <h2>How long we keep it</h2>
      <p>Conversations, orders and receipts are kept while the business has an account, so it can serve its customers. When a business deletes its account, or a customer asks for deletion, we delete the data within 30 days, except records we must keep by law.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Customers can reply STOP to stop marketing messages at any time.</li>
        <li>Anyone can ask to see, correct or delete their data. See <Link href="/data-deletion">how to delete your data</Link>.</li>
        <li>Businesses can disconnect Meta channels at any time from their dashboard or from Facebook settings.</li>
      </ul>

      <h2>Security</h2>
      <p>Data is encrypted in transit, access is limited by role, bank-detail changes need email confirmation, and payments are always confirmed by the business owner.</p>

      <h2>Contact</h2>
      <p>{CONTACT ? <>Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with any privacy question.</> : <>Business owners can reach us from their dashboard. Customers can ask the business they messaged to contact us on their behalf.</>} This policy follows the Nigeria Data Protection Act 2023.</p>
    </main>
  );
}
