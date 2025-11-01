"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch } from "@/lib/api";

// Types
interface Txn {
  id: number;
  occurred_at: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  account_id: number;
  counter_account_id?: number | null;
  category_id?: number | null;
  memo?: string | null;
  exclude_from_reports: boolean;
  occurred_time?: string | null;
  is_balance_neutral?: boolean;
  is_auto_transfer_match?: boolean;
}

interface Account { id: number; name: string }
interface Category { id: number; name: string; full_code: string; group_id: number }

const pageSizeOptions = [20, 50, 100, 200, 500, 1000, 2000] as const;

export default function TransactionsClient() {
  // Filters
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [types, setTypes] = useState<{ INCOME: boolean; EXPENSE: boolean; TRANSFER: boolean }>({ INCOME: true, EXPENSE: true, TRANSFER: true });
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Data
  const [txns, setTxns] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [updatingExclude, setUpdatingExclude] = useState(false);

  const selectedType: "INCOME" | "EXPENSE" | "TRANSFER" | undefined = useMemo(() => {
    const t = Object.entries(types).filter(([, v]) => v).map(([k]) => k as keyof typeof types);
    return t.length === 1 ? (t[0] as any) : undefined;
  }, [types]);

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
        const params: Record<string, string | number | boolean | undefined> = {
          user_id: 1,
          page,
          // Backend currently caps page_size at 2000
          page_size: Math.min(pageSize, 2000),
          start: start || undefined,
          end: end || undefined,
          type: selectedType,
          account_id: accountId === "" ? undefined : Number(accountId),
          category_id: categoryId === "" ? undefined : Number(categoryId),
          min_amount: minAmount === "" ? undefined : Number(minAmount),
          max_amount: maxAmount === "" ? undefined : Number(maxAmount),
          search: search || undefined,
        };
        const url = new URL("/api/transactions", process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000");
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, String(v)); });
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const totalHeader = res.headers.get("X-Total-Count");
        const data = (await res.json()) as Txn[];
        if (!ignore) {
          setTxns(data);
          setTotal(totalHeader ? Number(totalHeader) : data.length);
        }
      } catch (e: any) {
        if (!ignore) setError(e.message || String(e));
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [page, pageSize, start, end, selectedType, accountId, categoryId, minAmount, maxAmount, search]);

  // Selection and detail panel
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeTxn, setActiveTxn] = useState<Txn | null>(null);
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      txns.forEach((t) => { if (checked) next.add(t.id); else next.delete(t.id); });
      return next;
    });
  };

  const openTransaction = (txn: Txn | null) => {
    setActiveTxn(txn);
    setPanelNotice(null);
    setUpdatingExclude(false);
  };

  const handleToggleExclude = async () => {
    if (!activeTxn) return;
    const nextValue = !activeTxn.exclude_from_reports;
    setUpdatingExclude(true);
    setPanelNotice(null);
    try {
      const updated = await apiPatch<Txn>(`/api/transactions/${activeTxn.id}`, {
        exclude_from_reports: nextValue,
      }, { user_id: 1 });
  setTxns((prev) => prev.map((txn) => (txn.id === updated.id ? { ...txn, ...updated } : txn)));
  setActiveTxn(updated);
      setPanelNotice({
        type: "success",
        message: nextValue ? "잔액·캘린더에서 제외되었습니다." : "잔액·캘린더에 다시 포함되었습니다.",
      });
    } catch (e: any) {
      console.error(e);
      setPanelNotice({ type: "error", message: e?.message || "설정 변경에 실패했습니다." });
    } finally {
      setUpdatingExclude(false);
    }
  };

  const accountName = (id?: number | null) => accounts.find(a => a.id === id)?.name || "-";
  const categoryText = (id?: number | null) => {
    if (!id) return "-";
    const cat = categories.find(c => c.id === id);
    return cat ? `${cat.full_code} ${cat.name}` : String(id);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-3">
        <div className="rounded border bg-white p-3">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-600">시작일</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-gray-600">종료일</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-gray-600">유형</label>
              <div className="mt-1 flex gap-3 text-sm">
                {(["INCOME", "EXPENSE", "TRANSFER"] as const).map((t) => (
                  <label key={t} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={types[t]} onChange={(e) => setTypes({ ...types, [t]: e.target.checked })} />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600">분류</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")} className="mt-1 w-full rounded border px-2 py-1">
                <option value="">전체</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_code} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">계정</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")} className="mt-1 w-full rounded border px-2 py-1">
                <option value="">전체</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">최저금액</label>
              <input type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-gray-600">최대금액</label>
              <input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-1">
              <label className="block text-xs text-gray-600">내용</label>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="메모 검색" className="mt-1 w-full rounded border px-2 py-1" />
            </div>
            <div className="flex items-center gap-2 md:col-span-2 lg:col-span-1">
              <label className="text-xs text-gray-600">페이지 크기</label>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded border px-2 py-1">
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button onClick={() => setPage(1)} className="ml-auto rounded border px-3 py-1 text-sm">적용</button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-3 py-2"><input type="checkbox" onChange={(e) => selectAllOnPage(e.target.checked)} /></th>
                <th className="px-3 py-2 text-left">날짜</th>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-left">분류</th>
                <th className="px-3 py-2 text-left">내용</th>
                <th className="px-3 py-2 text-right">금액</th>
                <th className="px-3 py-2 text-left">계정</th>
                <th className="px-3 py-2 text-left">화폐</th>
                <th className="px-3 py-2 text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">불러오는 중…</td></tr>
              ) : error ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-red-600">{error}</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">데이터가 없습니다</td></tr>
              ) : (
                txns.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => openTransaction(t)}>
                    <td className="px-3 py-2" onClick={(e) => { e.stopPropagation(); }}>
                      <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} />
                    </td>
                    <td className="px-3 py-2">{t.occurred_at}</td>
                    <td className="px-3 py-2">{t.type}</td>
                    <td className="px-3 py-2">{categoryText(t.category_id)}</td>
                    <td className="px-3 py-2">{t.memo || "-"}</td>
                    <td className="px-3 py-2 text-right">{t.amount.toLocaleString()}</td>
                    <td className="px-3 py-2">{accountName(t.account_id)}</td>
                    <td className="px-3 py-2">{t.currency}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <button className="rounded border px-2 py-1 mr-2">수정</button>
                      <button className="rounded border px-2 py-1 text-red-700">삭제</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div>총 {total.toLocaleString()}건</div>
          <div className="space-x-1">
            <button disabled={page <= 1} onClick={() => setPage(1)} className="rounded border px-2 py-1 disabled:opacity-50">처음</button>
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border px-2 py-1 disabled:opacity-50">이전</button>
            <span className="px-2">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded border px-2 py-1 disabled:opacity-50">다음</button>
            <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="rounded border px-2 py-1 disabled:opacity-50">끝</button>
          </div>
        </div>
      </div>

      <div className="w-96 sticky top-6 self-start">
        <div className="rounded border bg-white p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">상세정보</h3>
            {activeTxn && (
              <button className="text-sm text-gray-600" onClick={() => openTransaction(null)}>닫기</button>
            )}
          </div>
          {!activeTxn ? (
            <div className="text-sm text-gray-500 mt-4">행을 클릭하면 상세정보가 표시됩니다.</div>
          ) : (
            <div className="mt-3 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-gray-600">날짜</span><span>{activeTxn.occurred_at}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">유형</span><span>{activeTxn.type}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">분류</span><span>{categoryText(activeTxn.category_id)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">내용</span><span>{activeTxn.memo || '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">금액</span><span>{activeTxn.amount.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">계정</span><span>{accountName(activeTxn.account_id)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">화폐</span><span>{activeTxn.currency}</span></div>
              {activeTxn.counter_account_id ? (
                <div className="flex justify-between"><span className="text-gray-600">상대계정</span><span>{accountName(activeTxn.counter_account_id)}</span></div>
              ) : null}
              <div className="mt-4 space-y-2 rounded border border-gray-200 p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={activeTxn.exclude_from_reports}
                    onChange={handleToggleExclude}
                    disabled={updatingExclude}
                  />
                  <div>
                    <div className="font-medium">잔액·캘린더에서 제외</div>
                    <p className="text-xs text-gray-500">
                      {activeTxn.type === "TRANSFER"
                        ? "이체 시 계좌 잔액과 달력 요약 계산에서 제외합니다. 장부에는 계속 남습니다."
                        : "해당 거래를 계좌 잔액과 달력 요약 계산에서 제외합니다. 장부에는 계속 남습니다."}
                    </p>
                  </div>
                </label>
                {panelNotice ? (
                  <p className={`text-xs ${panelNotice.type === "error" ? "text-red-600" : "text-green-600"}`}>
                    {panelNotice.message}
                  </p>
                ) : null}
                {updatingExclude ? (
                  <p className="text-xs text-gray-500">저장 중…</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
