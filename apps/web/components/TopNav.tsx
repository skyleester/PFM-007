"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";

const navItems = [
  { href: "/" as Route, label: "Home" },
  { href: "/accounts" as Route, label: "Accounts" },
  { href: "/transactions" as Route, label: "Transactions" },
  { href: "/budgets" as Route, label: "Budgets" },
  { href: "/recurring" as Route, label: "Recurring" },
  { href: "/statistics" as Route, label: "Statistics" },
  { href: "/calendar" as Route, label: "Calendar" },
  { href: "/categories" as Route, label: "Categories" },
  { href: "/preferences" as Route, label: "Preferences" },
] as const;

export default function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((prev) => !prev);
  const close = () => setOpen(false);
  return (
    <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="flex h-14 items-center gap-3">
          <Link href="/" className="text-lg font-semibold tracking-tight text-gray-900" onClick={close}>
            PFM
          </Link>
          <button
            type="button"
            onClick={toggle}
            className="ml-auto inline-flex items-center justify-center rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:hidden"
            aria-expanded={open}
            aria-label="메뉴 열기"
          >
            {open ? "닫기" : "메뉴"}
          </button>
          <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
            {navItems.map((item) => {
              const active =
                pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className={
                    "rounded px-3 py-2 transition-colors " +
                    (active
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-100")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {open && (
          <div className="mt-2 space-y-1 rounded-md border border-gray-200 bg-white p-2 shadow-md md:hidden">
            {navItems.map((item) => {
              const active =
                pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className={
                    "block rounded px-3 py-2 text-sm font-medium transition-colors " +
                    (active
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-100")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
}
