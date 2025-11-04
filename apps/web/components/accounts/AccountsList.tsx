"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelectedAccount } from "./useSelectedAccount";

type AccountRecord = {
  id: number;
  user_id: number;
  name: string;
  type: string;
  currency?: string | null;
  balance: number | string;
  is_archived: boolean;
  linked_account_id?: number | null;
};

export function AccountsList({ memberIds }: { memberIds: number[] }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const { selectedId, setSelectedId } = useSelectedAccount();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setStatus("loading");
        setError(null);
        const users = memberIds && memberIds.length > 0 ? memberIds : [1];
        const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
        const url = new URL("/api/accounts", base);
        for (const id of users) url.searchParams.append("user_id", String(id));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as AccountRecord[];
        if (!cancelled) setAccounts(data);
        setStatus("success");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [memberIds]);

  const { totalActive, totalAll } = useMemo(() => {
    let active = 0;
    let all = 0;
    for (const a of accounts) {
      const val = typeof a.balance === "number" ? a.balance : Number(a.balance);
      const num = Number.isFinite(val) ? Number(val) : 0;
      const isLinkedCheckCard = a.type === "CHECK_CARD" && a.linked_account_id != null;
      if (isLinkedCheckCard) continue;
      all += num;
      if (!a.is_archived) active += num;
    }
    return { totalActive: active, totalAll: all };
  }, [accounts]);

  return (
    <div className="space-y-4">
      <div className="rounded border border-dashed border-gray-200 bg-white p-3">
        <div className="text-xs uppercase text-gray-500">요약</div>
        {status === "loading" && <p className="text-sm text-gray-500">불러오는 중…</p>}
        {status === "error" && <p className="text-sm text-red-600">로드 실패: {error}</p>}
        {status === "success" && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3">
              <div className="text-xs uppercase text-gray-500">활성 계좌 합계</div>
              <div className="mt-1 text-sm font-semibold text-gray-900 tabular-nums">{totalActive.toLocaleString()}</div>
            </div>
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3">
              <div className="text-xs uppercase text-gray-500">전체 계좌 합계</div>
              <div className="mt-1 text-sm font-semibold text-gray-900 tabular-nums">{totalAll.toLocaleString()}</div>
            </div>
            <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3">
              <div className="text-xs uppercase text-gray-500">계좌 수</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{accounts.length.toLocaleString()}개</div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="mb-2 text-xs uppercase text-gray-500">계좌 목록</div>
        {status === "loading" && <p className="text-sm text-gray-500">불러오는 중…</p>}
        {status === "error" && <p className="text-sm text-red-600">로드 실패: {error}</p>}
        {status === "success" && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="px-2 py-1">이름</th>
                  <th className="px-2 py-1">유형</th>
                  <th className="px-2 py-1">통화</th>
                  <th className="px-2 py-1 text-right">잔액</th>
                  <th className="px-2 py-1">상태</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => {
                  const balance = typeof acc.balance === "number" ? acc.balance : Number(acc.balance);
                  const isSelected = selectedId === acc.id;
                  return (
                    <tr 
                      key={acc.id} 
                      className={`border-t border-gray-100 cursor-pointer ${
                        isSelected ? "bg-indigo-50 hover:bg-indigo-100" : "hover:bg-gray-50"
                      }`}
                      onClick={() => setSelectedId(acc.id)}
                    >
                      <td className="px-2 py-1 font-medium text-gray-900">{acc.name}</td>
                      <td className="px-2 py-1 text-gray-600">{acc.type}</td>
                      <td className="px-2 py-1 text-gray-600">{acc.currency || ""}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold">{Number.isFinite(balance) ? balance.toLocaleString() : "-"}</td>
                      <td className="px-2 py-1 text-gray-600">{acc.is_archived ? "보관됨" : "활성"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
