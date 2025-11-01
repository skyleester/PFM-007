"use client";

import { useMemo } from "react";

type Txn = {
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

type Account = { id: number; name: string };
type Category = { id: number; name: string; full_code: string; group_id: number };

type Props = {
  txns: Txn[];
  accounts: Account[];
  categories: Category[];
  loading: boolean;
  error: string | null;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onSelectAllPage: (checked: boolean) => void;
  onClickRow: (t: Txn) => void;
};

export default function TransactionsTable({ txns, accounts, categories, loading, error, selectedIds, onToggleSelect, onSelectAllPage, onClickRow }: Props) {
  const accountName = useMemo(() => (id?: number | null) => accounts.find(a => a.id === id)?.name || "-", [accounts]);
  const categoryText = useMemo(() => (id?: number | null) => {
    if (!id) return "-";
    const cat = categories.find(c => c.id === id);
    return cat ? `${cat.full_code} ${cat.name}` : String(id);
  }, [categories]);

  return (
    <div className="overflow-x-auto rounded border bg-white">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-gray-50">
          <tr>
            <th className="px-3 py-2"><input type="checkbox" onChange={(e) => onSelectAllPage(e.target.checked)} /></th>
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
              <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => onClickRow(t)}>
                <td className="px-3 py-2" onClick={(e) => { e.stopPropagation(); }}>
                  <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => onToggleSelect(t.id)} />
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
  );
}
