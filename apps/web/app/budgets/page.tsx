"use client";

import { useEffect, useState } from "react";
import { MemberSelector } from "@/components/MemberSelector";
import { usePersistentState } from "@/lib/hooks/usePersistentState";

type Budget = { id: number; user_id: number; period_start: string; period_end: string; amount: number; currency: string; account_id: number | null; category_id: number | null; name?: string | null };
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
const USER_ID = 1;

const sections = [
  {
    heading: "예산 개요",
    body: "카테고리/계좌별 예산과 실적을 나란히 보여줄 표를 구성합니다.",
    api: "GET /api/budgets",
  },
  {
    heading: "상세 요약",
    body: "선택한 예산의 기간별 실행률과 잔여 금액을 요약합니다.",
    api: "GET /api/budgets/:id/summary",
  },
  {
    heading: "예산 편집",
    body: "새 예산 추가 및 기존 예산 수정을 위한 폼을 배치합니다.",
    api: "POST /api/budgets",
  },
];

export default function BudgetsPage() {
  const [memberIds, setMemberIds] = usePersistentState<number[]>("pfm:members:selection:v1", [USER_ID]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const url = new URL("/api/budgets", API_BASE);
        const users = (memberIds && memberIds.length > 0) ? memberIds : [USER_ID];
        users.forEach((id) => url.searchParams.append("user_id", String(id)));
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Budget[];
        if (!cancel) setBudgets(data);
      } catch (e: any) {
        if (!cancel) setError(e?.message || "로드 실패");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [memberIds]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Budgets</h2>
          <p className="text-xs text-gray-500">예산을 설정하고 실적을 추적하는 화면을 준비합니다.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <MemberSelector value={memberIds} onChange={setMemberIds} />
          주요 스키마: <code className="font-mono text-[11px]">BudgetOut</code>, <code className="font-mono text-[11px]">BudgetSummaryOut</code>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((item) => (
          <div key={item.heading} className="rounded border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800">{item.heading}</h3>
            <p className="mt-1 text-sm text-gray-600">{item.body}</p>
            <p className="mt-3 text-xs text-gray-400">API: <code className="font-mono text-[11px]">{item.api}</code></p>
            <p className="mt-2 text-xs text-gray-400">※ UI 및 데이터 연동은 후속 작업에서 구현됩니다.</p>
          </div>
        ))}
      </div>

      <div className="rounded border bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800">예산 목록 (읽기전용)</h3>
        {loading && <p className="text-xs text-gray-500 mt-2">불러오는 중…</p>}
        {error && <p className="text-xs text-red-600 mt-2">로드 실패: {error}</p>}
        {!loading && !error && (
          budgets.length === 0 ? (
            <p className="text-xs text-gray-500 mt-2">선택된 멤버의 예산이 없습니다.</p>
          ) : (
            <div className="mt-2 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">기간</th>
                    <th className="px-3 py-2 text-left">금액</th>
                    <th className="px-3 py-2 text-left">계정/카테고리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {budgets.map((b) => (
                    <tr key={b.id}>
                      <td className="px-3 py-2">{b.period_start} ~ {b.period_end}</td>
                      <td className="px-3 py-2">{b.amount.toLocaleString()} {b.currency}</td>
                      <td className="px-3 py-2">{b.account_id ? `계좌 #${b.account_id}` : (b.category_id ? `카테고리 #${b.category_id}` : "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
