"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
  category_main?: string | null;
  category_sub?: string | null;
  account_name?: string | null;
};

type FilterType = "ALL" | "INCOME" | "EXPENSE" | "TRANSFER";

export function TransactionsPanel() {
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [showUploadedBanner, setShowUploadedBanner] = useState(false);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [failedRows, setFailedRows] = useState<Array<Record<string, any>>>([]);
  const [showFailedDetails, setShowFailedDetails] = useState<boolean>(true);
  const [bannerAnimated, setBannerAnimated] = useState<boolean>(false);
  const [failedListAnimated, setFailedListAnimated] = useState<boolean>(false);
  const searchParams = useSearchParams();

  const loadTransactions = useCallback(async () => {
    try {
      setStatus("loading");
      setError(null);
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      const url = new URL("/api/transactions", base);
      url.searchParams.set("user_id", "1");
      url.searchParams.set("page_size", "200");
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

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (searchParams?.get("uploaded") === "1") {
      setShowUploadedBanner(true);
      const failed = Number(searchParams.get("failed") || 0);
      setFailedCount(Number.isFinite(failed) ? failed : 0);
      if (failed > 0) {
        // Retrieve pre-enriched failed rows from sessionStorage
        try {
          const raw = sessionStorage.getItem("failed_rows");
          const rows = raw ? (JSON.parse(raw) as Array<any>) : [];
          // Rows are already enriched (date/type/amount/error)
          setFailedRows(Array.isArray(rows) ? rows : []);
        } catch {
          setFailedRows([]);
        } finally {
          // Clear after consuming to avoid persistence across refresh
          try {
            sessionStorage.removeItem("failed_rows");
            sessionStorage.removeItem("last_uploaded_payload");
          } catch {}
        }
      } else {
        setFailedRows([]);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!showUploadedBanner) return;
    const t = setTimeout(() => setShowUploadedBanner(false), 5000);
    return () => clearTimeout(t);
  }, [showUploadedBanner]);

  // Trigger simple CSS transitions on mount
  useEffect(() => {
    if (showUploadedBanner) {
      setBannerAnimated(false);
      requestAnimationFrame(() => setBannerAnimated(true));
    } else {
      setBannerAnimated(false);
    }
  }, [showUploadedBanner]);

  // Filter and search transactions
  const filteredTransactions = transactions.filter(tx => {
    // Apply type filter
    if (filterType !== "ALL" && tx.type !== filterType) {
      return false;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return (
        tx.memo?.toLowerCase().includes(query) ||
        tx.category?.toLowerCase().includes(query) ||
        tx.account_name?.toLowerCase().includes(query) ||
        tx.type.toLowerCase().includes(query) ||
        tx.amount.toString().includes(query) ||
        tx.occurred_at.includes(query)
      );
    }

    return true;
  });

  // Calculate summary stats
  const stats = {
    total: filteredTransactions.length,
    income: filteredTransactions
      .filter(tx => tx.amount > 0)
      .reduce((sum, tx) => sum + tx.amount, 0),
    expense: filteredTransactions
      .filter(tx => tx.amount < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0),
  };
  const net = stats.income - stats.expense;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">거래 관리</h1>
          <p className="mt-1 text-sm text-gray-600">거래 내역을 조회하고 관리합니다.</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded border border-gray-200 p-4">
        <div className="flex flex-col space-y-4 lg:flex-row lg:items-center lg:justify-between lg:space-y-0">
          {/* Filter Buttons */}
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "ALL" as const, label: "전체" },
              { key: "INCOME" as const, label: "수입" },
              { key: "EXPENSE" as const, label: "지출" },
              { key: "TRANSFER" as const, label: "이체" },
            ].map(({ key, label }) => {
              const active = filterType === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilterType(key)}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Search and Actions */}
          <div className="flex items-center space-x-3">
            <input
              type="text"
              placeholder="예: 식대, 교통비, 국민은행"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1 text-sm w-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <Link
              href="/transactions/upload"
              className="px-4 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 transition-colors"
              title="엑셀 파일 업로드로 거래 추가"
            >
              Excel 업로드
            </Link>
          </div>
        </div>
      </div>

      {showUploadedBanner && (
        <div
          className={`bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-4 py-3 transition-all duration-200 ease-out ${
            bannerAnimated ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              ✅ 거래 업로드가 완료되었습니다.
              {failedCount > 0 && (
                <span className="ml-2 text-amber-800">일부 항목이 실패했습니다. 실패 내역을 확인하세요.</span>
              )}
            </div>
            <button
              onClick={() => setShowUploadedBanner(false)}
              className="text-emerald-700 hover:text-emerald-900 text-sm"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Failed details */}
      {failedCount > 0 && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-2 text-sm transition-opacity duration-200" style={{ opacity: 1 }}>
          <div className="flex items-center justify-between">
            <div className="font-medium text-rose-800">
              업로드 실패 내역 ({failedRows.length || failedCount}건)
            </div>
            {failedRows.length > 0 && (
              <button
                onClick={() => setShowFailedDetails((v) => !v)}
                className="text-rose-700 hover:text-rose-900"
              >
                {showFailedDetails ? "상세 숨기기" : "상세 보기"}
              </button>
            )}
          </div>
          {failedRows.length === 0 ? (
            <div className="mt-2 text-rose-800">
              실패 건수 정보만 제공되었습니다. 상세 행 데이터가 응답에 없었습니다.
            </div>
          ) : (
            showFailedDetails && (
              <div className="mt-2 overflow-x-auto transition-opacity duration-150">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-rose-800">
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                      <th className="px-2 py-1 text-left">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedRows.map((r, i) => (
                      <tr key={i} className="border-t border-rose-100">
                        <td className="px-2 py-1">{r.date || "-"}</td>
                        <td className="px-2 py-1">{r.type || "-"}</td>
                        <td className="px-2 py-1 text-right">{typeof r.amount === "number" ? r.amount.toLocaleString() : (r.amount || "-")}</td>
                        <td className="px-2 py-1 text-rose-800">{r.error || r.message || r.reason || `Row ${r.row ?? "?"} error`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {/* Monthly Summary */}
      <div className="space-y-2">
        <div className="text-sm text-gray-600">{new Date().getFullYear()}년 {new Date().getMonth() + 1}월 요약</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-xs text-gray-500">총 거래 수</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{stats.total.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-green-200 p-4 bg-gradient-to-r from-green-50 to-white">
            <div className="text-xs text-green-700">총 수입</div>
            <div className="mt-1 text-2xl font-semibold text-green-700">₩{stats.income.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-rose-200 p-4 bg-gradient-to-r from-rose-50 to-white">
            <div className="text-xs text-rose-700">총 지출</div>
            <div className="mt-1 text-2xl font-semibold text-rose-700">₩{stats.expense.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-blue-200 p-4 bg-gradient-to-r from-blue-50 to-white">
            <div className="text-xs text-blue-700">순이익</div>
            <div className={`mt-1 text-2xl font-semibold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {net >= 0 ? "+" : "-"}₩{Math.abs(net).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

  {/* Transactions List */}
      <div className="bg-white rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">
            거래 목록
            {filterType !== "ALL" && (
              <span className="ml-2 text-xs text-gray-500">
                ({filterType} 필터 적용)
              </span>
            )}
            {searchQuery && (
              <span className="ml-2 text-xs text-gray-500">
                              {searchQuery && (
                <span className="ml-2 text-xs text-gray-500">
                  (검색: {searchQuery})
                </span>
              )}
              </span>
            )}
          </h3>
          <button
            onClick={loadTransactions}
            disabled={status === "loading"}
            className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
          >
            {status === "loading" ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {status === "error" && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <p className="text-red-800">오류: {error}</p>
          </div>
        )}

        {status === "loading" && (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mb-2"></div>
            <p className="text-gray-600">거래 데이터를 불러오는 중...</p>
          </div>
        )}

        {status === "success" && filteredTransactions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            {searchQuery 
              ? `${searchQuery}에 대한 검색 결과가 없습니다.`
              : filterType === "ALL"
              ? "거래 내역이 없습니다."
              : `${filterType} 유형의 거래 내역이 없습니다.`
            }
          </div>
        )}

        {status === "success" && filteredTransactions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">날짜</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">유형</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">금액</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">메모</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">카테고리(대/소) </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">계좌</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTransactions.map((tx) => {
                  const amountColor = tx.amount > 0 
                    ? "text-emerald-600" 
                    : tx.amount < 0 
                    ? "text-rose-600" 
                    : "text-gray-700";
                  
                  const formattedAmount = tx.amount > 0 
                    ? `+${tx.amount.toLocaleString()}`
                    : tx.amount < 0
                    ? `-${Math.abs(tx.amount).toLocaleString()}`
                    : "0";

                  const typeColor = {
                    INCOME: "text-emerald-700 bg-emerald-50",
                    EXPENSE: "text-rose-700 bg-rose-50",
                    TRANSFER: "text-blue-700 bg-blue-50",
                  }[tx.type];

                  const typeLabel = {
                    INCOME: "수입",
                    EXPENSE: "지출", 
                    TRANSFER: "이체",
                  }[tx.type];

                  return (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div>{tx.occurred_at}</div>
                        {tx.occurred_time && (
                          <div className="text-xs text-gray-500">
                            {tx.occurred_time.slice(0, 5)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${typeColor}`}>
                          {typeLabel}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm font-medium text-right tabular-nums ${amountColor}`}>
                        {formattedAmount}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.memo || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.category_main || tx.category || tx.category_sub
                          ? [tx.category_main || tx.category, tx.category_sub].filter(Boolean).join(" / ")
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.account_name || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload handled on dedicated page */}
    </div>
  );
}

export default TransactionsPanel;