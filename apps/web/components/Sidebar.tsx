"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
] as const satisfies ReadonlyArray<{ href: Route; label: string }>;

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="h-screen sticky top-0 w-56 border-r bg-white">
      <div className="px-4 py-4 text-lg font-semibold">PFM</div>
      <nav className="px-2 space-y-1 text-sm">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "block rounded px-3 py-2 hover:bg-gray-100 " +
                (active ? "bg-gray-100 font-medium" : "text-gray-700")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
