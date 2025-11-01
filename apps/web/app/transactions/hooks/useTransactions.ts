"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

export type Txn = {
  id: number;
  occurred_at: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  account_id: number;
  counter_account_id?: number | null;
  category_id?: number | null;
  memo?: string | null;
};

export type Account = { id: number; name: string };
export type Category = { id: number; name: string; full_code: string; group_id: number };

export type Filters = {
  start?: string;
  end?: string;
  types: { INCOME: boolean; EXPENSE: boolean; TRANSFER: boolean };
  categoryId?: number | "";
  accountId?: number | "";
  minAmount?: string;
  maxAmount?: string;
  search?: string;
  page: number;
  pageSize: number;
};

export function useTransactions(initial?: Partial<Filters>) {
  const [filters, setFilters] = useState<Filters>({
    start: "",
    end: "",
    types: { INCOME: true, EXPENSE: true, TRANSFER: true },
    categoryId: "",
    accountId: "",
    minAmount: "",
    maxAmount: "",
    search: "",
    page: 1,
    pageSize: 20,
    ...initial,
  });

  const [txns, setTxns] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load accounts/categories once
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const [accs, cats] = await Promise.all([
          apiGet<Account[]>("/api/accounts", { user_id: 1 }),
          apiGet<Category[]>("/api/categories", { user_id: 1 }),
        ]);
        if (!ignore) {
          setAccounts(accs);
          setCategories(cats);
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { ignore = true; };
  }, []);

  // Load transactions when filters change
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const enabledTypes = Object.entries(filters.types).filter(([, v]) => v).map(([k]) => k);
        const selectedType: "INCOME" | "EXPENSE" | "TRANSFER" | undefined = enabledTypes.length === 1 ? (enabledTypes[0] as any) : undefined;
        const params: Record<string, string | number | boolean | undefined> = {
          user_id: 1,
          page: filters.page,
          page_size: Math.min(filters.pageSize, 2000),
          start: filters.start || undefined,
          end: filters.end || undefined,
          type: selectedType,
          account_id: filters.accountId === "" ? undefined : Number(filters.accountId),
          category_id: filters.categoryId === "" ? undefined : Number(filters.categoryId),
          min_amount: filters.minAmount === "" ? undefined : Number(filters.minAmount),
          max_amount: filters.maxAmount === "" ? undefined : Number(filters.maxAmount),
          search: filters.search || undefined,
        };
        const { data, total: parsedTotal } = await (async () => {
          // Use apiGet to fetch JSON; but we still need X-Total-Count header.
          // Workaround: Do a manual fetch to read header, falling back to length.
          const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
          const url = new URL("/api/transactions", base);
          Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, String(v)); });
          const res = await fetch(url.toString(), { cache: 'no-store' });
          if (!res.ok) throw new Error(await res.text());
          const totalHeader = res.headers.get("X-Total-Count");
          const json = (await res.json()) as Txn[];
          return { data: json, total: totalHeader ? Number(totalHeader) : json.length };
        })();
        if (!ignore) { setTxns(data); setTotal(parsedTotal); }
      } catch (e: any) {
        if (!ignore) setError(e.message || String(e));
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [filters.page, filters.pageSize, filters.start, filters.end, filters.types, filters.accountId, filters.categoryId, filters.minAmount, filters.maxAmount, filters.search]);

  return {
    filters,
    setFilters,
    txns,
    total,
    accounts,
    categories,
    loading,
    error,
  };
}
