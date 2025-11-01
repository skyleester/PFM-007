"use client";

type Txn = {
  id: number;
  occurred_at: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  memo?: string | null;
};

type Props = {
  txns: Txn[];
  loading: boolean;
  error: string | null;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onSelectAllPage: (checked: boolean) => void;
};

export default function TransactionsTableLite({ txns, loading, error, selectedIds, onToggleSelect, onSelectAllPage }: Props) {
  return (
    <div className="overflow-x-auto rounded border bg-white">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-gray-50">
          <tr>
            <th className="px-3 py-2"><input type="checkbox" onChange={(e) => onSelectAllPage(e.target.checked)} /></th>
            <th className="px-3 py-2 text-left">날짜</th>
            <th className="px-3 py-2 text-left">유형</th>
            <th className="px-3 py-2 text-left">내용</th>
            <th className="px-3 py-2 text-right">금액</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">불러오는 중…</td></tr>
          ) : error ? (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-red-600">{error}</td></tr>
          ) : txns.length === 0 ? (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">데이터가 없습니다</td></tr>
          ) : (
            txns.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => onToggleSelect(t.id)} />
                </td>
                <td className="px-3 py-2">{t.occurred_at}</td>
                <td className="px-3 py-2">{t.type}</td>
                <td className="px-3 py-2">{t.memo || '-'}</td>
                <td className="px-3 py-2 text-right">{t.amount.toLocaleString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
