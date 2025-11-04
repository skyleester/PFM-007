"use client";

import { useEffect, useState } from "react";

type TransactionItem = {
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

type SimpleTransactionsListProps = {
  filterType?: "ALL" | "INCOME" | "EXPENSE" | "TRANSFER";
};

export function SimpleTransactionsList({ filterType = "ALL" }: SimpleTransactionsListProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);

  const loadTransactions = async () => {
    try {
      setStatus("loading");
      setError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL("/api/transactions", base);
      url.searchParams.set("user_id", "1"); // Default user
      url.searchParams.set("page_size", "50");
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
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  // Filter transactions based on filterType
  const filteredTransactions = filterType === "ALL" 
    ? transactions 
    : transactions.filter(tx => tx.type === filterType);

  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-900">
          거래 목록 
          {filterType !== "ALL" && (
            <span className="ml-2 text-xs text-gray-500">
              ({filterType} 필터 적용: {filteredTransactions.length}건)
            </span>
          )}
        </h2>
        <button
          onClick={loadTransactions}
          disabled={status === "loading"}
          className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
        >
          {status === "loading" ? "불러오는 중..." : "새로고침"}
        </button>
      </div>
      
      {status === "error" && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
          오류: {error}
        </div>
      )}
      
      {status === "success" && filteredTransactions.length === 0 && (
        <p className="text-sm text-gray-500">
          {filterType === "ALL" 
            ? "거래 내역이 없습니다." 
            : `${filterType} 유형의 거래 내역이 없습니다.`
          }
        </p>
      )}
      
      {status === "success" && filteredTransactions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="px-2 py-2">날짜</th>
                <th className="px-2 py-2">유형</th>
                <th className="px-2 py-2 text-right">금액</th>
                <th className="px-2 py-2">메모</th>
                <th className="px-2 py-2">카테고리</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const amountColor = tx.amount > 0 ? "text-emerald-600" : tx.amount < 0 ? "text-rose-600" : "text-gray-700";
                const formattedAmount = tx.amount > 0 
                  ? `+${tx.amount.toLocaleString()}`
                  : tx.amount < 0
                  ? `-${Math.abs(tx.amount).toLocaleString()}`
                  : "0";
                return (
                  <tr key={tx.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 text-gray-700">
                      {tx.occurred_at}
                      {tx.occurred_time && <span className="text-gray-500 ml-1">{tx.occurred_time.slice(0,5)}</span>}
                    </td>
                    <td className="px-2 py-2 text-gray-600">{tx.type}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${amountColor}`}>
                      {formattedAmount}
                    </td>
                    <td className="px-2 py-2 text-gray-600">{tx.memo || "-"}</td>
                    <td className="px-2 py-2 text-gray-600">{tx.category || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SimpleTransactionsList;