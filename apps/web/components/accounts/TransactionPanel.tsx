"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useSelectedAccount } from "./useSelectedAccount";

type TransactionRecord = {
  id: number;
  user_id: number;
  account_id: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency?: string | null;
  occurred_at: string; // yyyy-mm-dd
  occurred_time?: string | null; // HH:mm:ss or null
  memo?: string | null;
  external_id?: string | null;
};

export function TransactionPanel({ memberIds }: { memberIds: number[] }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const { selectedId } = useSelectedAccount();

  const canLoad = selectedId != null && Number.isFinite(selectedId);

  const load = useCallback(async () => {
    if (!canLoad || selectedId == null) return;
    try {
      setStatus("loading");
      setError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL("/api/transactions", base);
      const users = memberIds && memberIds.length > 0 ? memberIds : [1];
      for (const id of users) url.searchParams.append("user_id", String(id));
      url.searchParams.set("account_id", String(selectedId));
      url.searchParams.set("page_size", "500");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TransactionRecord[];
      // sort: by date desc, then time desc, then id desc
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
      setError(err instanceof Error ? err.message : String(err));
      setTransactions([]);
      setStatus("error");
    }
  }, [selectedId, canLoad, memberIds]);

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    for (const tx of transactions) {
      if (tx.type === "INCOME") income += tx.amount;
      if (tx.type === "EXPENSE") expense += Math.abs(tx.amount);
    }
    return { income, expense, net: income - expense };
  }, [transactions]);

  // Auto-load when selectedId changes
  useEffect(() => {
    if (selectedId != null) {
      load();
    } else {
      setTransactions([]);
      setStatus("idle");
      setError(null);
    }
  }, [selectedId, load]);

  return (
    <div className="space-y-3">
      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="text-xs uppercase text-gray-500">거래 조회</div>
        <div className="mt-2 text-sm">
          {selectedId == null ? (
            <span className="text-gray-500">계좌를 선택하세요</span>
          ) : (
            <span className="text-gray-700">Account ID: <strong>{selectedId}</strong></span>
          )}
          {status === "loading" && <span className="ml-2 text-xs text-blue-600">불러오는 중…</span>}
          {status === "error" && <span className="ml-2 text-xs text-red-600">{error}</span>}
        </div>
      </div>

      {status === "success" && (
        <div className="space-y-2">
          <div className="rounded border border-dashed border-gray-200 bg-white p-3 text-sm">
            <div className="text-xs uppercase text-gray-500">요약</div>
            <div className="mt-1 flex flex-wrap gap-3">
              <span className="text-emerald-700">수입 <strong className="tabular-nums">{totals.income.toLocaleString()}</strong></span>
              <span className="text-rose-700">지출 <strong className="tabular-nums">{totals.expense.toLocaleString()}</strong></span>
              <span className="text-gray-900">순수익 <strong className="tabular-nums">{totals.net.toLocaleString()}</strong></span>
              <span className="text-gray-500">거래 <strong>{transactions.length.toLocaleString()}건</strong></span>
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-3 py-2 text-xs uppercase text-gray-500">거래 목록</div>
            <div className="max-h-[420px] overflow-y-auto p-2 text-sm">
              {transactions.length === 0 ? (
                <p className="px-1 text-gray-500">표시할 거래가 없습니다.</p>
              ) : (
                <table className="min-w-full">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="px-2 py-1">날짜</th>
                      <th className="px-2 py-1">유형</th>
                      <th className="px-2 py-1 text-right">금액</th>
                      <th className="px-2 py-1">메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="border-t border-gray-100">
                        <td className="px-2 py-1 text-gray-700">{tx.occurred_at}{tx.occurred_time ? ` ${tx.occurred_time.slice(0,5)}` : ""}</td>
                        <td className="px-2 py-1 text-gray-600">{tx.type}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">
                          {tx.amount > 0 ? `+${tx.amount.toLocaleString()}` : tx.amount < 0 ? `-${Math.abs(tx.amount).toLocaleString()}` : "0"}
                        </td>
                        <td className="px-2 py-1 text-gray-600">{tx.memo ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TransactionPanel;
