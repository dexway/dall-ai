"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/agent", label: "Assistant & launch kit" },
  { href: "/dashboard/catalogue", label: "Catalogue" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/payments", label: "Payments to check" },
  { href: "/dashboard/connect", label: "Channels" },
  { href: "/dashboard/ads", label: "Ads" },
  { href: "/dashboard/settings", label: "Payment settings" },
  { href: "/dashboard/billing", label: "Usage & billing" },
];

export default function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard">
      {LINKS.map((l) => {
        const active = l.href === "/dashboard" ? path === l.href : path.startsWith(l.href);
        return <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>{l.label}</Link>;
      })}
    </nav>
  );
}
