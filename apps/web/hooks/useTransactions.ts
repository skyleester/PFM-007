"use client";

import { useCallback, useState, useMemo } from "react";

type TransactionItem = {
  id: number;
  date: string;
  description: string;
  category?: string | null;
  account_name?: string | null;
  amount: number;
  payment_method?: string | null;
  balance_after?: number | null;
  memo?: string | null;
};

type TransactionsResponse = {
  items: TransactionItem[];
  total: number;
  page: number;
  page_size: number;
};

type TransactionFilters = {
  startDate: string;
  endDate: string;
  category: string;
  account: string;
  payment_method: string;
  minAmount: string;
  maxAmount: string;
};

const initialFilters: TransactionFilters = {
  startDate: "",
  endDate: "",
  category: "",
  account: "",
  payment_method: "",
  minAmount: "",
  maxAmount: "",
};

export function useTransactions() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [filters, setFilters] = useState<TransactionFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const loadTransactions = useCallback(async (currentFilters: TransactionFilters, currentPage: number) => {
    try {
      setStatus("loading");
      setError(null);
      
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL("/api/transactions", base);
      
      // Apply filters as query parameters
      if (currentFilters.startDate) url.searchParams.set("start_date", currentFilters.startDate);
      if (currentFilters.endDate) url.searchParams.set("end_date", currentFilters.endDate);
      if (currentFilters.category) url.searchParams.set("category", currentFilters.category);
      if (currentFilters.account) url.searchParams.set("account", currentFilters.account);
      if (currentFilters.payment_method) url.searchParams.set("payment_method", currentFilters.payment_method);
      if (currentFilters.minAmount) url.searchParams.set("min_amount", currentFilters.minAmount);
      if (currentFilters.maxAmount) url.searchParams.set("max_amount", currentFilters.maxAmount);
      
      url.searchParams.set("page", String(currentPage));
      url.searchParams.set("page_size", String(pageSize));
      
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      
      const responseData = (await res.json()) as TransactionsResponse;
      setData(responseData);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setData(null);
      console.error("useTransactions error:", msg);
    }
  }, [pageSize]);

  const applyFilters = useCallback((newFilters: Partial<TransactionFilters>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    setPage(1); // Reset to first page when filters change
    loadTransactions(updatedFilters, 1);
  }, [filters, loadTransactions]);

  const changePage = useCallback((newPage: number) => {
    setPage(newPage);
    loadTransactions(filters, newPage);
  }, [filters, loadTransactions]);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
    setPage(1);
    loadTransactions(initialFilters, 1);
  }, [loadTransactions]);

  // Initial load
  const initialLoad = useCallback(() => {
    loadTransactions(filters, page);
  }, [loadTransactions, filters, page]);

  const totalPages = useMemo(() => {
    return data ? Math.ceil(data.total / pageSize) : 0;
  }, [data, pageSize]);

  return {
    // Data
    transactions: data?.items || [],
    total: data?.total || 0,
    page,
    totalPages,
    
    // Filters
    filters,
    applyFilters,
    resetFilters,
    
    // Pagination
    changePage,
    
    // Actions
    initialLoad,
    reload: () => loadTransactions(filters, page),
    
    // Status
    status,
    error,
    isLoading: status === "loading",
    isEmpty: status === "success" && (!data?.items || data.items.length === 0),
  };
}