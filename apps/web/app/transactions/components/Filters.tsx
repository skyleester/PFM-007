"use client";

type Filters = {
  start?: string;
  end?: string;
  types: { INCOME: boolean; EXPENSE: boolean; TRANSFER: boolean };
  categoryId?: number | "";
  accountId?: number | "";
  minAmount?: string;
  maxAmount?: string;
  search?: string;
  page: number;
  pageSize: number;
};

type Account = { id: number; name: string };
type Category = { id: number; name: string; full_code: string; group_id: number };

type Props = {
  filters: Filters;
  setFilters: (updater: (prev: Filters) => Filters) => void;
  accounts: Account[];
  categories: Category[];
};

export default function Filters({ filters, setFilters, accounts, categories }: Props) {
  return (
    <div className="rounded border bg-white p-3">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-600">시작일</label>
          <input type="date" value={filters.start || ""} onChange={(e) => setFilters((p) => ({ ...p, start: e.target.value }))} className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">종료일</label>
          <input type="date" value={filters.end || ""} onChange={(e) => setFilters((p) => ({ ...p, end: e.target.value }))} className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">유형</label>
          <div className="mt-1 flex gap-3 text-sm">
            {(["INCOME", "EXPENSE", "TRANSFER"] as const).map((t) => (
              <label key={t} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={filters.types[t]}
                  onChange={(e) => setFilters((p) => ({ ...p, types: { ...p.types, [t]: e.target.checked } }))}
                />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600">분류</label>
          <select value={filters.categoryId || ""} onChange={(e) => setFilters((p) => ({ ...p, categoryId: e.target.value ? Number(e.target.value) : "" }))} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">전체</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.full_code} {c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">계정</label>
          <select value={filters.accountId || ""} onChange={(e) => setFilters((p) => ({ ...p, accountId: e.target.value ? Number(e.target.value) : "" }))} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">전체</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">최저금액</label>
          <input type="number" value={filters.minAmount || ""} onChange={(e) => setFilters((p) => ({ ...p, minAmount: e.target.value }))} className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">최대금액</label>
          <input type="number" value={filters.maxAmount || ""} onChange={(e) => setFilters((p) => ({ ...p, maxAmount: e.target.value }))} className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div className="md:col-span-2 lg:col-span-1">
          <label className="block text-xs text-gray-600">내용</label>
          <input type="text" value={filters.search || ""} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} placeholder="메모 검색" className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div className="flex items-center gap-2 md:col-span-2 lg:col-span-1">
          <label className="text-xs text-gray-600">페이지 크기</label>
          <select value={filters.pageSize} onChange={(e) => { const n = Number(e.target.value); setFilters((p) => ({ ...p, pageSize: n, page: 1 })); }} className="rounded border px-2 py-1">
            {[20, 50, 100, 200, 500, 1000, 2000].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button onClick={() => setFilters((p) => ({ ...p, page: 1 }))} className="ml-auto rounded border px-3 py-1 text-sm">적용</button>
        </div>
      </div>
    </div>
  );
}
