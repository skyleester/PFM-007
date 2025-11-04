import { useEffect, useState, useCallback } from "react";
import { TransactionFilterType } from "./useTransactionsFilter";

export type TransactionItem = {
  id: number;
  user_id: number;
  account_id: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency?: string | null;
  occurred_at: string;
  occurred_time?: string | null;
  memo?: string | null;
  category?: string | null;
  account_name?: string | null;
};

export type TransactionsDataState = {
  transactions: TransactionItem[];
  filteredTransactions: TransactionItem[];
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  searchQuery: string;
  loadTransactions: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  refresh: () => Promise<void>;
};

export function useTransactionsData(filterType: TransactionFilterType): TransactionsDataState {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const loadTransactions = useCallback(async () => {
    try {
      setStatus("loading");
      setError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL("/api/transactions", base);
      url.searchParams.set("user_id", "1"); // Default user
      url.searchParams.set("page_size", "200"); // Increased page size for better functionality
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TransactionItem[];
      const sorted = [...data].sort((a, b) => {
        if (a.occurred_at === b.occurred_at) {
          const ta = a.occurred_time ?? "";
          const tb = b.occurred_time ?? "";
          if (ta === tb) return b.id - a.id;
          return ta < tb ? 1 : -1;
        }
        return a.occurred_at < b.occurred_at ? 1 : -1;
      });
      setTransactions(sorted);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTransactions([]);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Refresh function (alias for loadTransactions)
  const refresh = useCallback(() => {
    return loadTransactions();
  }, [loadTransactions]);

  // Filter transactions based on filterType and searchQuery
  const filteredTransactions = useCallback(() => {
    let filtered = transactions;

    // Apply type filter
    if (filterType !== "ALL") {
      filtered = filtered.filter(tx => tx.type === filterType);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(tx =>
        tx.memo?.toLowerCase().includes(query) ||
        tx.category?.toLowerCase().includes(query) ||
        tx.account_name?.toLowerCase().includes(query) ||
        tx.type.toLowerCase().includes(query) ||
        tx.amount.toString().includes(query) ||
        tx.occurred_at.includes(query)
      );
    }

    return filtered;
  }, [transactions, filterType, searchQuery])();

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return {
    transactions,
    filteredTransactions,
    status,
    error,
    searchQuery,
    loadTransactions,
    setSearchQuery: handleSearchQueryChange,
    refresh,
  };
}