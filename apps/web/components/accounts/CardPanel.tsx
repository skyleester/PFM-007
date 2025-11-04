"use client";

import { useCallback, useState, useEffect } from "react";
import { useSelectedAccount } from "./useSelectedAccount";

type CardSummary = {
  account_id: number;
  total_spend: number;
  due_amount: number;
  due_date?: string | null;
  current_balance: number;
  available_credit: number;
};

type CardStatement = {
  id: number;
  account_id: number;
  billing_date: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
  status: "PENDING" | "PAID" | "OVERDUE";
  created_at: string;
};

type CardSettlement = {
  id: number;
  account_id: number;
  statement_id?: number | null;
  payment_date: string;
  amount: number;
  method: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  created_at: string;
};

export function CardPanel({ memberIds }: { memberIds: number[] }) {
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [statementsStatus, setStatementsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [settlementsStatus, setSettlementsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [statementsError, setStatementsError] = useState<string | null>(null);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [statements, setStatements] = useState<CardStatement[]>([]);
  const [settlements, setSettlements] = useState<CardSettlement[]>([]);
  
  const { selectedId } = useSelectedAccount();

  const loadSummary = useCallback(async (accountId: number) => {
    try {
      setSummaryStatus("loading");
      setSummaryError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL(`/api/cards/${accountId}/summary`, base);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as CardSummary;
      setSummary(data);
      setSummaryStatus("success");
    } catch (err) {
      setSummaryStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setSummaryError(msg);
      setSummary(null);
      console.error("CardPanel summary error:", msg);
    }
  }, []);

  const loadStatements = useCallback(async (accountId: number) => {
    try {
      setStatementsStatus("loading");
      setStatementsError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL(`/api/cards/${accountId}/statements`, base);
      url.searchParams.set("page_size", "50");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as CardStatement[];
      // Sort by billing_date desc
      const sorted = [...data].sort((a, b) => b.billing_date.localeCompare(a.billing_date));
      setStatements(sorted);
      setStatementsStatus("success");
    } catch (err) {
      setStatementsStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setStatementsError(msg);
      setStatements([]);
      console.error("CardPanel statements error:", msg);
    }
  }, []);

  const loadSettlements = useCallback(async (accountId: number) => {
    try {
      setSettlementsStatus("loading");
      setSettlementsError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL(`/api/cards/${accountId}/settlements`, base);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as CardSettlement[];
      // Sort by payment_date desc
      const sorted = [...data].sort((a, b) => b.payment_date.localeCompare(a.payment_date));
      setSettlements(sorted);
      setSettlementsStatus("success");
    } catch (err) {
      setSettlementsStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setSettlementsError(msg);
      setSettlements([]);
      console.error("CardPanel settlements error:", msg);
    }
  }, []);

  // Auto-load when selectedId changes
  useEffect(() => {
    if (selectedId != null) {
      loadSummary(selectedId);
      loadStatements(selectedId);
      loadSettlements(selectedId);
    } else {
      // Reset all data when no account selected
      setSummary(null);
      setStatements([]);
      setSettlements([]);
      setSummaryStatus("idle");
      setStatementsStatus("idle");
      setSettlementsStatus("idle");
      setSummaryError(null);
      setStatementsError(null);
      setSettlementsError(null);
    }
  }, [selectedId, loadSummary, loadStatements, loadSettlements]);

  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="text-xs uppercase text-gray-500">카드 패널</div>
        <div className="mt-2 text-sm">
          {selectedId == null ? (
            <span className="text-gray-500">카드 계좌를 선택하세요</span>
          ) : (
            <span className="text-gray-700">Card Account ID: <strong>{selectedId}</strong></span>
          )}
        </div>
      </div>

      {selectedId != null && (
        <div className="space-y-4">
          {/* Summary Section */}
          <div className="rounded border border-gray-200 bg-white p-3">
            <h3 className="text-sm font-semibold text-gray-900">Summary</h3>
            {summaryStatus === "loading" && <p className="mt-2 text-xs text-blue-600">불러오는 중…</p>}
            {summaryStatus === "error" && <p className="mt-2 text-xs text-red-600">오류: {summaryError}</p>}
            {summaryStatus === "success" && summary && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-2">
                  <div className="text-xs text-gray-500">총 사용금액</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 tabular-nums">{summary.total_spend.toLocaleString()}</div>
                </div>
                <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-2">
                  <div className="text-xs text-gray-500">결제 예정금액</div>
                  <div className="mt-1 text-sm font-semibold text-rose-600 tabular-nums">{summary.due_amount.toLocaleString()}</div>
                </div>
                <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-2">
                  <div className="text-xs text-gray-500">현재 잔액</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 tabular-nums">{summary.current_balance.toLocaleString()}</div>
                </div>
                <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-2">
                  <div className="text-xs text-gray-500">사용 가능 한도</div>
                  <div className="mt-1 text-sm font-semibold text-emerald-600 tabular-nums">{summary.available_credit.toLocaleString()}</div>
                </div>
                {summary.due_date && (
                  <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-2 sm:col-span-2">
                    <div className="text-xs text-gray-500">결제 예정일</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{summary.due_date}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Statements Section */}
          <div className="rounded border border-gray-200 bg-white p-3">
            <h3 className="text-sm font-semibold text-gray-900">Statements</h3>
            {statementsStatus === "loading" && <p className="mt-2 text-xs text-blue-600">불러오는 중…</p>}
            {statementsStatus === "error" && <p className="mt-2 text-xs text-red-600">오류: {statementsError}</p>}
            {statementsStatus === "success" && (
              <div className="mt-3">
                {statements.length === 0 ? (
                  <p className="text-xs text-gray-500">명세서가 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="px-2 py-1">청구일</th>
                          <th className="px-2 py-1">결제일</th>
                          <th className="px-2 py-1 text-right">총 금액</th>
                          <th className="px-2 py-1 text-right">결제 금액</th>
                          <th className="px-2 py-1">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statements.map((stmt) => (
                          <tr key={stmt.id} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-gray-700">{stmt.billing_date}</td>
                            <td className="px-2 py-1 text-gray-700">{stmt.due_date}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-semibold">{stmt.total_amount.toLocaleString()}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-semibold">{stmt.paid_amount.toLocaleString()}</td>
                            <td className="px-2 py-1">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                stmt.status === "PAID" ? "bg-emerald-100 text-emerald-700" :
                                stmt.status === "OVERDUE" ? "bg-red-100 text-red-700" :
                                "bg-yellow-100 text-yellow-700"
                              }`}>
                                {stmt.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Settlements Section */}
          <div className="rounded border border-gray-200 bg-white p-3">
            <h3 className="text-sm font-semibold text-gray-900">Settlements</h3>
            {settlementsStatus === "loading" && <p className="mt-2 text-xs text-blue-600">불러오는 중…</p>}
            {settlementsStatus === "error" && <p className="mt-2 text-xs text-red-600">오류: {settlementsError}</p>}
            {settlementsStatus === "success" && (
              <div className="mt-3">
                {settlements.length === 0 ? (
                  <p className="text-xs text-gray-500">정산 내역이 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="px-2 py-1">결제일</th>
                          <th className="px-2 py-1 text-right">금액</th>
                          <th className="px-2 py-1">결제 방법</th>
                          <th className="px-2 py-1">상태</th>
                          <th className="px-2 py-1">생성일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settlements.map((settlement) => (
                          <tr key={settlement.id} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-gray-700">{settlement.payment_date}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-semibold">{settlement.amount.toLocaleString()}</td>
                            <td className="px-2 py-1 text-gray-700">{settlement.method}</td>
                            <td className="px-2 py-1">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                settlement.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" :
                                settlement.status === "FAILED" ? "bg-red-100 text-red-700" :
                                "bg-yellow-100 text-yellow-700"
                              }`}>
                                {settlement.status}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-gray-500">{settlement.created_at.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CardPanel;