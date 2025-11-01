"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import clsx from "clsx";

import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { SplitLayout } from "@/components/layout/SplitLayout";
import { StickyAside } from "@/components/layout/StickyAside";

import { apiPost } from "@/lib/api";
import { listRecurringRules, attachTransactionsToRule } from "@/lib/recurring/api";
import { MemberSelector } from "@/components/MemberSelector";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import * as XLSX from "xlsx";
import { parseBankSaladWorkbook, type BankSaladParseResult, type SuspectedPair } from "@/lib/importers/banksalad";
import { apiPostWithMeta } from "@/lib/api";

type SortKey = "occurred_at" | "amount" | "type" | "currency" | "memo" | "category" | "category_group";
type SortOrder = "asc" | "desc";

const SORT_DEFAULTS: Partial<Record<SortKey, SortOrder>> = {
  occurred_at: "desc",
  amount: "desc",
};

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 1000, 2000];

const GROUP_TYPE_BY_TXN: Record<Txn["type"], "I" | "E" | "T"> = {
  INCOME: "I",
  EXPENSE: "E",
  TRANSFER: "T",
  SETTLEMENT: "E",
};

type FiltersState = {
  start?: string;
  end?: string;
  types: { INCOME: boolean; EXPENSE: boolean; TRANSFER: boolean };
  categoryGroupIds: number[];
  categoryIds: number[];
  accountId?: number | "";
  minAmount?: string;
  maxAmount?: string;
  search?: string;
  statementId?: string;
  status?: "PENDING_PAYMENT" | "CLEARED" | "";
  excludeSettlements: boolean;
  page: number;
  pageSize: number;
  sortBy: SortKey;
  sortOrder: SortOrder;
};
type Txn = {
  id: number;
  user_id: number;
  occurred_at: string;
  occurred_time?: string | null;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "SETTLEMENT";
  group_id?: number | null; // transfer group id
  account_id: number;
  counter_account_id?: number | null;
  category_id?: number | null;
  amount: number;
  currency: string;
  memo?: string | null;
  payee_id?: number | null;
  external_id?: string | null;
  // credit-card specific
  card_id?: number | null;
  is_card_charge?: boolean;
  billing_cycle_id?: number | null; // aka statement_id
  status?: string | null; // PENDING_PAYMENT | CLEARED
  is_balance_neutral: boolean;
  is_auto_transfer_match: boolean;
  exclude_from_reports: boolean;
};
type Category = { id: number; name: string; full_code: string; group_id: number };
type CategoryGroup = { id: number; type: "I" | "E" | "T"; code_gg: number; name: string };
type Account = { id: number; name: string; balance?: number; currency?: string };

type TxnDraft = {
  user_id: number;
  occurred_at: string;
  occurred_time: string;
  type: Txn["type"];
  amount: number;
  currency: string;
  account_id?: number;
  counter_account_id?: number;
  category_group_id?: number;
  category_id?: number | null;
  memo?: string;
  exclude_from_reports: boolean;
};

type ToggleNotice = { id: number; type: "success" | "error"; message: string };
type UploadItem = BankSaladParseResult["items"][number];

type PotentialTransferMatch = {
  new_item_index: number;
  new_item_occurred_at?: string | null;
  new_item_occurred_time?: string | null;
  new_item_amount?: number | null;
  new_item_account_name?: string | null;
  new_item_currency?: string | null;
  existing_txn_id: number;
  existing_txn_occurred_at: string;
  existing_txn_occurred_time: string | null;
  existing_txn_amount: number;
  existing_txn_account_name: string | null;
  existing_txn_memo: string | null;
  existing_txn_type: string;
  confidence_score: number;
  confidence_level: "CERTAIN" | "SUSPECTED" | "UNLIKELY";
};

type TransactionsBulkResponse = {
  transactions: Txn[];
  db_transfer_matches: PotentialTransferMatch[];
  stats: {
    created: number;
    duplicate_transfers: number;
    settlement_duplicates: number;
    db_transfer_matches: number;
    existing_duplicates: number;
    natural_duplicates: number;
  };
};

function makeInitialFilters(): FiltersState {
  return {
    start: "",
    end: "",
    types: { INCOME: true, EXPENSE: true, TRANSFER: true },
    categoryGroupIds: [],
    categoryIds: [],
    accountId: "",
    minAmount: "",
    maxAmount: "",
    search: "",
    statementId: "",
    status: "",
    excludeSettlements: false,
    page: 1,
    pageSize: 20,
    sortBy: "occurred_at",
    sortOrder: "desc",
  };
}

// --- Small inline components to avoid bundler issues ---
function FiltersPanel({ filters, setFilters, categories, groups, accounts, onClear, className = "", afterApply }: { filters: FiltersState; setFilters: React.Dispatch<React.SetStateAction<FiltersState>>; categories: Category[]; groups: CategoryGroup[]; accounts: Account[]; onClear: () => void; className?: string; afterApply?: () => void }) {
  const [groupSearch, setGroupSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const TYPE_KEYS = ["INCOME", "EXPENSE", "TRANSFER"] as const;
  type TypeKey = typeof TYPE_KEYS[number];
  const filteredGroups = useMemo(() => {
    return groups.filter(g => {
      const typeEnabled = (g.type === 'I' && filters.types.INCOME) || (g.type === 'E' && filters.types.EXPENSE) || (g.type === 'T' && filters.types.TRANSFER);
      const text = `${g.type}${String(g.code_gg).padStart(2,'0')} ${g.name}`.toLowerCase();
      return typeEnabled && text.includes(groupSearch.toLowerCase());
    });
  }, [groups, filters.types, groupSearch]);
  const filteredCategories = useMemo(() => {
    const allowGroup = new Set(filters.categoryGroupIds);
    return categories.filter(c => (allowGroup.size === 0 || allowGroup.has(c.group_id)) && `${c.full_code} ${c.name}`.toLowerCase().includes(categorySearch.toLowerCase()));
  }, [categories, filters.categoryGroupIds, categorySearch]);

  return (
    <div className={clsx("rounded border bg-white p-4", className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 min-w-[220px] flex-col">
          <label className="text-xs text-gray-600">내용</label>
          <input type="text" value={filters.search || ""} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value, page: 1 }))} placeholder="메모 검색" className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div className="min-w-[150px]">
          <label className="block text-xs text-gray-600">시작일</label>
          <input type="date" value={filters.start || ""} onChange={(e) => setFilters((p) => ({ ...p, start: e.target.value, page: 1 }))} className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div className="min-w-[150px]">
          <label className="block text-xs text-gray-600">종료일</label>
          <input type="date" value={filters.end || ""} onChange={(e) => setFilters((p) => ({ ...p, end: e.target.value, page: 1 }))} className="mt-1 w-full rounded border px-2 py-1" />
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs text-gray-600">유형</label>
          <div className="mt-1 flex gap-3 text-sm">
            {(TYPE_KEYS as readonly TypeKey[]).map((t) => (
              <label key={t} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={filters.types[t]}
                  onChange={(e) => setFilters((p) => ({ ...p, types: { ...p.types, [t]: e.target.checked }, page: 1 }))}
                />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setFilters((p) => ({ ...p, page: 1 })); afterApply?.(); }} className="rounded border px-3 py-1 text-sm">적용</button>
          <button onClick={onClear} className="rounded border px-3 py-1 text-sm">초기화</button>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-xs text-gray-600">카테고리그룹 (대분류)</label>
          <input className="mt-1 w-full rounded border px-2 py-1" placeholder="검색" value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
          <div className="mt-2 max-h-40 overflow-auto rounded border divide-y">
            {( ["I", "E", "T"] as const).map(ty => {
              const label = ty === 'I' ? '수입 (I)' : ty === 'E' ? '지출 (E)' : '이체 (T)';
              const vis = filteredGroups.filter(g => g.type === ty);
              if (vis.length === 0) return null;
              return (
                <div key={ty}>
                  <div className="bg-gray-100 text-gray-700 font-semibold px-2 py-1 text-xs">{label}</div>
                  <div className="px-2 py-1 flex flex-wrap gap-2">
                    {vis.map(g => {
                      const selected = filters.categoryGroupIds.includes(g.id);
                      return (
                        <button key={g.id} className={`rounded border px-2 py-0.5 text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}`}
                          onClick={() => setFilters(p => {
                            const set = new Set(p.categoryGroupIds);
                            if (set.has(g.id)) set.delete(g.id); else set.add(g.id);
                            const newGroupIds = Array.from(set);
                            const catSet = new Set(p.categoryIds.filter(cid => {
                              const cat = categories.find(c => c.id === cid);
                              return !cat || newGroupIds.length === 0 || newGroupIds.includes(cat.group_id);
                            }));
                            return { ...p, categoryGroupIds: newGroupIds, categoryIds: Array.from(catSet), page: 1 };
                          })}
                        >{g.type}{String(g.code_gg).padStart(2,'0')} {g.name}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600">분류 (소분류)</label>
          <input className="mt-1 w-full rounded border px-2 py-1" placeholder="검색" value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} />
          <div className="mt-2 max-h-40 overflow-auto rounded border p-2 flex flex-wrap gap-2">
            {filteredCategories.map(c => {
              const selected = filters.categoryIds.includes(c.id);
              return (
                <button key={c.id} className={`rounded border px-2 py-0.5 text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}`}
                  onClick={() => setFilters(p => {
                    const set = new Set(p.categoryIds);
                    if (set.has(c.id)) set.delete(c.id); else set.add(c.id);
                    return { ...p, categoryIds: Array.from(set), page: 1 };
                  })}
                >{c.full_code} {c.name}</button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600">계정</label>
          <select value={filters.accountId || ""} onChange={(e) => setFilters((p) => ({ ...p, accountId: e.target.value ? Number(e.target.value) : "", page: 1 }))} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">전체</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-gray-600">최저금액</label>
            <input type="number" value={filters.minAmount || ""} onChange={(e) => setFilters((p) => ({ ...p, minAmount: e.target.value, page: 1 }))} className="mt-1 w-full rounded border px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs text-gray-600">최대금액</label>
            <input type="number" value={filters.maxAmount || ""} onChange={(e) => setFilters((p) => ({ ...p, maxAmount: e.target.value, page: 1 }))} className="mt-1 w-full rounded border px-2 py-1" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600">명세서 ID</label>
          <input className="mt-1 w-full rounded border px-2 py-1" placeholder="예: 123" value={filters.statementId || ""} onChange={(e) => setFilters((p) => ({ ...p, statementId: e.target.value, page: 1 }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-600">상태</label>
          <select className="mt-1 w-full rounded border px-2 py-1" value={filters.status || ""} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value as any, page: 1 }))}>
            <option value="">전체</option>
            <option value="PENDING_PAYMENT">PENDING_PAYMENT</option>
            <option value="CLEARED">CLEARED</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">정산 제외</label>
          <input type="checkbox" checked={filters.excludeSettlements} onChange={(e) => setFilters((p) => ({ ...p, excludeSettlements: e.target.checked, page: 1 }))} />
        </div>
      </div>
    </div>
  );
}

function TransactionsTableInline({ txns, loading, error, selectedIds, toggleSelect, selectAllOnPage, categories, groups, onRowClick, selectedId, categoriesById, groupsById, groupsByKey, accountsById, sortBy, sortOrder, onSort, onStatementClick }: {
  txns: Txn[];
  loading: boolean;
  error: string | null;
  selectedIds: Set<number>;
  toggleSelect: (id: number) => void;
  selectAllOnPage: (checked: boolean) => void;
  categories: Category[];
  groups: CategoryGroup[];
  onRowClick: (t: Txn) => void;
  selectedId?: number | null;
  categoriesById: Map<number, Category>;
  groupsById: Map<number, CategoryGroup>;
  groupsByKey: Map<string, CategoryGroup>;
  accountsById: Map<number, Account>;
  sortBy: SortKey;
  sortOrder: SortOrder;
  onSort: (key: SortKey) => void;
  onStatementClick?: (statementId: number) => void;
}) {
  const renderTxnType = (t: Txn) => {
    if (t.type === 'SETTLEMENT') return '정산';
    if (t.card_id) return '카드사용';
    return t.type;
  };
  const StatementBadge = ({ t }: { t: Txn }) => {
    if (!t.billing_cycle_id) return null;
    const pending = t.status === 'PENDING_PAYMENT' && t.type !== 'SETTLEMENT';
    return (
      <span className={clsx("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
        pending ? "bg-purple-50 text-purple-700 border border-purple-200" : "bg-gray-100 text-gray-700")}
        title={pending ? "명세서 미결제(카드사용)" : "명세서 연결됨"}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
        명세 #{t.billing_cycle_id}
      </span>
    );
  };
  const categoryText = (id?: number | null) => {
    if (!id) return "-";
    const c = categoriesById.get(id);
    if (c) return `${c.full_code} ${c.name}`;
    return "-";
  };
  const groupText = (id?: number | null) => {
    if (!id) return "-";
    const c = categoriesById.get(id);
    if (!c) return "-";
    const g = groupsById.get(c.group_id);
    if (g) return `${g.type}${String(g.code_gg).padStart(2,'0')} ${g.name}`;
    // fallback: parse from full_code and map to group name
    if (c.full_code && c.full_code.length >= 3) {
      const key = `${c.full_code[0]}${c.full_code.slice(1,3)}`;
      const gg = groupsByKey.get(key);
      if (gg) return `${key} ${gg.name}`;
      return key;
    }
    return "-";
  };
  const accountText = (id?: number | null) => {
    if (!id) return null;
    const acc = accountsById.get(id);
    return acc ? acc.name : `계정 ${id}`;
  };
  const renderHeader = (label: string, key: SortKey, align: "left" | "right" = "left") => {
    const isActive = sortBy === key;
    const indicator = isActive ? (sortOrder === "desc" ? "▼" : "▲") : "↕";
    return (
      <th
        className={clsx("px-3 py-2", align === "right" ? "text-right" : "text-left")}
        scope="col"
        aria-sort={isActive ? (sortOrder === "desc" ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          className={clsx("flex w-full items-center gap-1 text-sm font-medium text-gray-700", align === "right" ? "justify-end" : "justify-start")}
          onClick={() => onSort(key)}
        >
          <span>{label}</span>
          <span className="text-xs text-gray-500">{indicator}</span>
        </button>
      </th>
    );
  };
  return (
    <div className="overflow-x-auto rounded border bg-white">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-gray-50">
          <tr>
            <th className="px-3 py-2"><input type="checkbox" onChange={(e) => selectAllOnPage(e.target.checked)} /></th>
            {renderHeader("날짜", "occurred_at")}
            {renderHeader("유형", "type")}
            <th className="px-3 py-2 text-left">명세</th>
            {renderHeader("카테고리그룹", "category_group")}
            {renderHeader("분류", "category")}
            {renderHeader("금액", "amount", "right")}
            {renderHeader("통화", "currency")}
            {renderHeader("내용", "memo")}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">불러오는 중…</td></tr>
          ) : error ? (
            <tr><td colSpan={8} className="px-3 py-6 text-center text-red-600">{error}</td></tr>
          ) : txns.length === 0 ? (
            <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">데이터가 없습니다</td></tr>
          ) : (
            txns.map((t) => (
              <tr
                key={t.id}
                className={clsx(
                  "border-b last:border-0 cursor-pointer",
                  t.is_auto_transfer_match ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50",
                  selectedId === t.id && "bg-blue-50 hover:bg-blue-100"
                )}
                onClick={() => onRowClick(t)}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} onClick={(e) => e.stopPropagation()} />
                </td>
                <td className="px-3 py-2">{t.occurred_at}</td>
                <td className="px-3 py-2">{renderTxnType(t)}</td>
                <td className="px-3 py-2">
                  {t.billing_cycle_id ? (
                    onStatementClick ? (
                      <button
                        className="underline-offset-2 hover:underline"
                        onClick={(e) => { e.stopPropagation(); onStatementClick(t.billing_cycle_id!); }}
                      >
                        <StatementBadge t={t} />
                      </button>
                    ) : (
                      <StatementBadge t={t} />
                    )
                  ) : null}
                </td>
                <td className="px-3 py-2">{groupText(t.category_id)}</td>
                <td className="px-3 py-2">{categoryText(t.category_id)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-col items-end">
                    <span>
                      {(t.is_auto_transfer_match ? Math.abs(t.amount) : t.amount).toLocaleString()}
                    </span>
                    {t.is_auto_transfer_match && (
                      <span className="mt-0.5 flex flex-col items-end gap-1 text-[11px] font-medium text-amber-700">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                          자동 매칭
                        </span>
                        <span className="text-[10px] text-amber-600">
                          {accountText(t.amount < 0 ? t.account_id : t.counter_account_id) ?? "출금"}
                          <span className="mx-1 text-amber-500">→</span>
                          {accountText(t.amount < 0 ? t.counter_account_id : t.account_id) ?? "입금"}
                        </span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">{t.currency}</td>
                <td className="px-3 py-2">{t.memo || '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function PaginationBar({ total, page, pageSize, onChangePage }: { total: number; page: number; pageSize: number; onChangePage: (next: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-sm">
      <div>총 {total.toLocaleString()}건</div>
      <div className="space-x-1">
        <button disabled={page <= 1} onClick={() => onChangePage(1)} className="rounded border px-2 py-1 disabled:opacity-50">처음</button>
        <button disabled={page <= 1} onClick={() => onChangePage(Math.max(1, page - 1))} className="rounded border px-2 py-1 disabled:opacity-50">이전</button>
        <span className="px-2">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onChangePage(Math.min(totalPages, page + 1))} className="rounded border px-2 py-1 disabled:opacity-50">다음</button>
        <button disabled={page >= totalPages} onClick={() => onChangePage(totalPages)} className="rounded border px-2 py-1 disabled:opacity-50">끝</button>
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  const [filters, setFilters, , filtersHydrated] = usePersistentState<FiltersState>(
    "pfm:transactions:filters:v1",
    makeInitialFilters,
    { storage: "local" }
  );
  const [memberIds, setMemberIds] = usePersistentState<number[]>("pfm:members:selection:v1", [1]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [lastAppliedQuery, setLastAppliedQuery] = useState<string | null>(null);
  const [pendingFocusTxn, setPendingFocusTxn] = useState<number | null>(null);
  const focusCleared = useRef(false);

  // explicit refresh trigger independent of filters
  const [refreshTick, setRefreshTick] = useState(0);

  // Real data loading (inline)
  const [txns, setTxns] = useState<Txn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const accountNames = useMemo(() => accounts.map((a) => a.name), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const groupsById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const groupsByKey = useMemo(() => {
    const m = new Map<string, CategoryGroup>();
    groups.forEach(g => m.set(`${g.type}${String(g.code_gg).padStart(2,'0')}`, g));
    return m;
  }, [groups]);
  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

  // group_id로 묶인 TRANSFER들을 하나로 병합해서 표시
  const displayTxns = useMemo(() => {
    const seenGroupIds = new Set<number>();
    const result: Txn[] = [];
    
    for (const txn of txns) {
      // TRANSFER 타입이고 group_id가 있으면 병합 대상
      if (txn.type === 'TRANSFER' && txn.group_id && !seenGroupIds.has(txn.group_id)) {
        seenGroupIds.add(txn.group_id);
        // 같은 group_id를 가진 모든 트랜잭션 찾기
        const siblings = txns.filter(t => t.group_id === txn.group_id);
        
        // 2개 이상이면 병합 (OUT + IN)
        if (siblings.length >= 2) {
          // OUT 트랜잭션 찾기 (amount < 0)
          const outTxn = siblings.find(t => t.amount < 0) ?? siblings[0];
          // IN 트랜잭션 찾기 (amount > 0)
          const inTxn = siblings.find(t => t.amount > 0 && t.id !== outTxn.id);
          
          // 병합된 트랜잭션 생성 (OUT 기준)
          const merged: Txn = {
            ...outTxn,
            // IN 트랜잭션의 계좌를 counter_account로 설정
            counter_account_id: inTxn?.account_id ?? outTxn.counter_account_id,
            // 병합 표시용 플래그
            is_auto_transfer_match: true,
          };
          result.push(merged);
          continue;
        }
      }
      
      // TRANSFER가 아니거나 group_id 없거나 이미 처리된 group_id면 그대로 표시
      if (!txn.group_id || txn.type !== 'TRANSFER' || !seenGroupIds.has(txn.group_id)) {
        result.push(txn);
      }
    }
    
    return result;
  }, [txns]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const serialized = searchParams.toString();
    if (serialized === lastAppliedQuery) {
      return;
    }

    const startParam = searchParams.get("start") ?? searchParams.get("date");
    const endParam = searchParams.get("end") ?? (startParam ?? "");
    if (startParam || searchParams.get("end")) {
      setFilters((prev) => {
        const nextStart = startParam ?? "";
        const nextEnd = endParam ?? "";
        if (prev.start === nextStart && prev.end === nextEnd) {
          return prev;
        }
        return { ...prev, start: nextStart, end: nextEnd, page: 1 };
      });
    }

    const focusParam = searchParams.get("focusTxn");
    if (focusParam) {
      const parsed = Number.parseInt(focusParam, 10);
      if (!Number.isNaN(parsed)) {
        setPendingFocusTxn(parsed);
        focusCleared.current = false;
      }
    }

    setLastAppliedQuery(serialized);
  }, [filtersHydrated, searchParams, setFilters, lastAppliedQuery]);

  useEffect(() => {
    if (pendingFocusTxn === null) return;
    const match = txns.find((txn) => txn.id === pendingFocusTxn);
    if (match) {
      setDetail(match);
      setShowEdit(match);
      setPendingFocusTxn(null);
    } else if (!loading) {
      console.warn(`focusTxn ${pendingFocusTxn} not found in current page results`);
      setPendingFocusTxn(null);
    }
  }, [pendingFocusTxn, txns, loading]);

  useEffect(() => {
    if (pendingFocusTxn !== null) return;
    if (!lastAppliedQuery) return;
    if (focusCleared.current) return;
    if (!searchParams.get("focusTxn")) {
      focusCleared.current = true;
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("focusTxn");
    const nextQuery = params.toString();
    const target = nextQuery ? `${pathname}?${nextQuery}` : pathname;
  router.replace(target as Route, { scroll: false });
    focusCleared.current = true;
  }, [pendingFocusTxn, lastAppliedQuery, router, pathname, searchParams]);

  const buildDefaultDraft = useCallback(
    (type: Txn["type"] = "EXPENSE"): TxnDraft => {
      const today = new Date().toISOString().slice(0, 10);
      const draft: TxnDraft = {
        user_id: 1,
        occurred_at: today,
        occurred_time: "",
        type,
        amount: Number.NaN,
        currency: "KRW",
        memo: "",
        exclude_from_reports: false,
      };
      if (accounts.length > 0) {
        draft.account_id = accounts[0].id;
        const altAccount = accounts.find((a) => a.id !== draft.account_id);
        if (altAccount) {
          draft.counter_account_id = altAccount.id;
        }
      }
      if (type !== "TRANSFER") {
        const groupType = GROUP_TYPE_BY_TXN[type];
        const availableGroups = groups.filter(g => g.type === groupType);
        if (availableGroups.length > 0) {
          draft.category_group_id = availableGroups[0].id;
          const availableCategories = categories.filter(c => c.group_id === availableGroups[0].id);
          if (availableCategories.length > 0) {
            draft.category_id = availableCategories[0].id;
          }
        }
      }
      return draft;
    },
    [accounts, groups, categories]
  );

  useEffect(() => {
    if (!filtersHydrated) {
      return;
    }
    let ignore = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const enabledTypes = Object.entries(filters.types).filter(([, v]) => v).map(([k]) => k);
        const selectedType: "INCOME" | "EXPENSE" | "TRANSFER" | undefined = enabledTypes.length === 1 ? (enabledTypes[0] as any) : undefined;
        const params: Record<string, string | number | boolean | undefined> = {
          page: filters.page,
          page_size: filters.pageSize,
          sort_by: filters.sortBy,
          sort_order: filters.sortOrder,
          start: filters.start || undefined,
          end: filters.end || undefined,
          type: selectedType,
          account_id: filters.accountId === "" ? undefined : Number(filters.accountId),
          status: filters.status || undefined,
          billing_cycle_id: filters.statementId ? Number(filters.statementId) : undefined,
          exclude_settlements: filters.excludeSettlements || undefined,
          // repeatable params for multi-select
          // category_id and group_id will be appended below for each value
          min_amount: filters.minAmount === "" ? undefined : Number(filters.minAmount),
          max_amount: filters.maxAmount === "" ? undefined : Number(filters.maxAmount),
          search: filters.search || undefined,
        };
        const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
        const url = new URL("/api/transactions", base);
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, String(v)); });
        const users = (memberIds && memberIds.length > 0) ? memberIds : [1];
        users.forEach((id) => url.searchParams.append("user_id", String(id)));
        // append multi-select values
        filters.categoryIds.forEach(id => url.searchParams.append('category_id', String(id)));
        filters.categoryGroupIds.forEach(id => url.searchParams.append('group_id', String(id)));
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const totalHeader = res.headers.get("X-Total-Count");
        const json = (await res.json()) as Txn[];
        if (!ignore) { setTxns(json); setTotal(totalHeader ? Number(totalHeader) : json.length); }
      } catch (e) {
        if (!ignore) setError((e as Error).message);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [filtersHydrated, filters.page, filters.pageSize, filters.start, filters.end, filters.types, filters.accountId, filters.categoryIds, filters.categoryGroupIds, filters.minAmount, filters.maxAmount, filters.search, filters.sortBy, filters.sortOrder, filters.status, filters.statementId, filters.excludeSettlements, refreshTick, memberIds]);

  // Load all categories/groups/accounts once (for labels and filters)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
        async function fetchCatsWithFallback(): Promise<Category[]> {
          const sizes = [2000, 1500, 1000, 500, 200];
          for (const size of sizes) {
            const url = new URL("/api/categories", base);
            const users = (memberIds && memberIds.length > 0) ? memberIds : [1];
            users.forEach((id) => url.searchParams.append("user_id", String(id)));
            url.searchParams.set("page", "1");
            url.searchParams.set("page_size", String(size));
            const res = await fetch(url.toString(), { cache: 'no-store' });
            if (res.ok) return (await res.json()) as Category[];
          }
          return [];
        }
        const [cats, grps, accs] = await Promise.all([
          fetchCatsWithFallback(),
          (async () => {
            const url = new URL('/api/category-groups', base);
            const users = (memberIds && memberIds.length > 0) ? memberIds : [1];
            users.forEach((id) => url.searchParams.append('user_id', String(id)));
            const res = await fetch(url.toString(), { cache: 'no-store' });
            if (!res.ok) return [] as CategoryGroup[];
            return (await res.json()) as CategoryGroup[];
          })(),
          (async () => {
            const url = new URL('/api/accounts', base);
            const users = (memberIds && memberIds.length > 0) ? memberIds : [1];
            users.forEach((id) => url.searchParams.append('user_id', String(id)));
            const res = await fetch(url.toString(), { cache: 'no-store' });
            if (!res.ok) return [] as Account[];
            return (await res.json()) as Account[];
          })()
        ]);
        if (!ignore) { setCategories(cats); setGroups(grps as any); setAccounts(accs as any); }
      } catch {
        if (!ignore) { setCategories([]); setGroups([]); setAccounts([]); }
      }
    })();
    return () => { ignore = true; };
  }, [refreshTick, memberIds]);

  const [selectedIdStore, setSelectedIdStore, , selectionHydrated] = usePersistentState<number[]>(
    "pfm:transactions:selected-ids:v1",
    () => []
  );
  const selectedIds = useMemo(() => new Set(selectedIdStore), [selectedIdStore]);
  const [createOpen, setCreateOpen] = useState(false);
  const [statementDetail, setStatementDetail] = useState<{ id: number; loading: boolean; error: string | null; data: any | null } | null>(null);
  const openStatementDetail = useCallback(async (statementId: number) => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
    setStatementDetail({ id: statementId, loading: true, error: null, data: null });
    try {
      // Try to locate any transaction belonging to this billing cycle across all selected members
      const url = new URL(`/api/transactions`, base);
      const users = (memberIds && memberIds.length > 0) ? memberIds : [1];
      users.forEach((id) => url.searchParams.append('user_id', String(id)));
      url.searchParams.set('billing_cycle_id', String(statementId));
      url.searchParams.set('page_size', '1');
      const res1 = await fetch(url.toString(), { cache: 'no-store' });
      let accountId: number | undefined;
      let accountOwnerUserId: number | undefined;
      if (res1.ok) {
        const items = await res1.json() as Txn[];
        const first = items[0];
        accountId = first?.card_id || first?.account_id;
        accountOwnerUserId = first?.user_id;
      }
      // Fallback: try direct statement fetch if account id known from summary
      let data: any | null = null;
      if (accountId) {
        const url2 = new URL(`/api/accounts/${accountId}/credit-card-statements`, base);
        if (accountOwnerUserId) url2.searchParams.set('user_id', String(accountOwnerUserId));
        const res2 = await fetch(url2.toString(), { cache: 'no-store' });
        if (res2.ok) {
          const list = await res2.json();
          data = list.find((s: any) => s.id === statementId) || null;
        }
      }
      setStatementDetail({ id: statementId, loading: false, error: null, data });
    } catch (e) {
      setStatementDetail({ id: statementId, loading: false, error: (e as Error).message, data: null });
    }
  }, [memberIds]);
  const [createDraft, setCreateDraft] = useState<TxnDraft>(() => ({
    user_id: memberIds[0] || 1,
    occurred_at: new Date().toISOString().slice(0, 10),
    occurred_time: "",
    type: "EXPENSE",
    amount: Number.NaN,
    currency: "KRW",
    memo: "",
    exclude_from_reports: false,
  }));
  useEffect(() => {
    setCreateDraft((prev) => ({ ...prev, user_id: memberIds[0] || 1 }));
  }, [memberIds]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState<Txn | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [detail, setDetail] = useState<Txn | null>(null);
  const [deleting, setDeleting] = useState<{ id: number; busy: boolean } | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<number | null>(null);
  const [toggleNotice, setToggleNotice] = useState<ToggleNotice | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkMemoMode, setBulkMemoMode] = useState<"replace" | "append">("replace");
  const [bulkMemo, setBulkMemo] = useState("");
  const [bulkAppendDelimiter, setBulkAppendDelimiter] = useState(" ");
  const [bulkExclude, setBulkExclude] = useState<"keep" | "include" | "exclude">("keep");
  const [bulkCategoryId, setBulkCategoryId] = useState<number | "" | null>("");
  const [bulkCurrency, setBulkCurrency] = useState<string | "">("");
  const [dummyCount, setDummyCount] = useState<number>(20);
  const [dummyBusy, setDummyBusy] = useState(false);
  const [filtersDrawerVisible, setFiltersDrawerVisible] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const filtersDrawerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleSelect = (id: number) => {
    setSelectedIdStore((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  };
  const selectAllOnPage = (checked: boolean) => {
    setSelectedIdStore((prev) => {
      const next = new Set(prev);
      txns.forEach((t) => {
        if (checked) {
          next.add(t.id);
        } else {
          next.delete(t.id);
        }
      });
      return Array.from(next);
    });
  };

  const handleSort = (key: SortKey) => {
    setFilters((prev) => {
      const nextOrder: SortOrder = prev.sortBy === key ? (prev.sortOrder === "desc" ? "asc" : "desc") : (SORT_DEFAULTS[key] ?? "asc");
      return { ...prev, sortBy: key, sortOrder: nextOrder, page: 1 };
    });
  };

  const handleRowClick = useCallback((txn: Txn) => {
    setDetail((prev) => (prev && prev.id === txn.id ? null : txn));
  }, []);

  useEffect(() => {
    if (!detail) {
      setToggleNotice(null);
      setToggleBusyId(null);
      return;
    }
    setToggleNotice((prev) => (prev && prev.id === detail.id ? prev : null));
  }, [detail]);

  const handleToggleExclude = useCallback(
    async (txn: Txn, nextValue: boolean) => {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
      setToggleBusyId(txn.id);
      setToggleNotice(null);
      try {
        const res = await fetch(new URL(`/api/transactions/${txn.id}`, base).toString(), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exclude_from_reports: nextValue }),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const updated = (await res.json()) as Txn;
        setTxns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setDetail(updated);
        setToggleNotice({
          id: updated.id,
          type: "success",
          message: nextValue ? "잔액·캘린더에서 제외되었습니다." : "잔액·캘린더에 다시 포함되었습니다.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "설정 변경에 실패했습니다.";
        setToggleNotice({ id: txn.id, type: "error", message });
      } finally {
        setToggleBusyId(null);
      }
    },
    [setTxns, setDetail]
  );

  const openFiltersDrawer = () => {
    if (filtersDrawerCloseTimer.current) {
      clearTimeout(filtersDrawerCloseTimer.current);
      filtersDrawerCloseTimer.current = null;
    }
    setFiltersDrawerVisible(true);
    requestAnimationFrame(() => setFiltersDrawerOpen(true));
  };

  const closeFiltersDrawer = () => {
    setFiltersDrawerOpen(false);
    filtersDrawerCloseTimer.current = setTimeout(() => {
      setFiltersDrawerVisible(false);
      filtersDrawerCloseTimer.current = null;
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (filtersDrawerCloseTimer.current) {
        clearTimeout(filtersDrawerCloseTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectionHydrated || loading) return;
    if (txns.length === 0 && selectedIdStore.length === 0) return;
    const txnIds = new Set(txns.map((txn) => txn.id));
    setSelectedIdStore((prev) => {
      const filtered = prev.filter((id) => txnIds.has(id));
      if (filtered.length === prev.length) {
        return prev;
      }
      return filtered;
    });
  }, [loading, txns, selectionHydrated, selectedIdStore, setSelectedIdStore]);

  const headerActions = (
    <>
      <button
        className="rounded border px-3 py-1 text-sm lg:hidden"
        onClick={openFiltersDrawer}
      >
        필터 보기
      </button>
      <button
        className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
        onClick={() => {
          setCreateOpen((prev) => {
            const next = !prev;
            if (!prev) {
              setCreateError(null);
              setCreateDraft(buildDefaultDraft());
            }
            return next;
          });
        }}
      >
        {createOpen ? "입력창 닫기" : "+ 새 트랜잭션"}
      </button>
      <button className="rounded border px-3 py-1 text-sm" onClick={() => setShowBulk(true)}>
        대량 업로드
      </button>
      <button
        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        disabled={selectedIds.size === 0}
        onClick={() => {
          setBulkEditing(true);
        }}
      >
        선택 수정
      </button>
      <button
        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        disabled={selectedIds.size === 0 || bulkDeleting}
        onClick={async () => {
          if (selectedIds.size === 0) return;
          const ids = Array.from(selectedIds);
          const confirmText = `선택한 ${ids.length}건을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`;
          if (!window.confirm(confirmText)) return;
          setBulkDeleting(true);
          let success = false;
          try {
            // group by user_id to satisfy API contract
            const txById = new Map(txns.map((t) => [t.id, t]));
            const idsByUser = new Map<number, number[]>();
            for (const id of ids) {
              const t = txById.get(id);
              if (!t) continue;
              const list = idsByUser.get(t.user_id) || [];
              list.push(id);
              idsByUser.set(t.user_id, list);
            }
            const allDeleted = new Set<number>();
            let totalDeleted = 0;
            const allMissing: number[] = [];
            for (const [uid, list] of idsByUser) {
              const result = await apiPost<{ deleted: number; deleted_ids: number[]; missing: number[] }>("/api/transactions/bulk-delete", {
                user_id: uid,
                ids: list,
              });
              result.deleted_ids.forEach((x) => allDeleted.add(x));
              totalDeleted += result.deleted;
              if (result.missing?.length) allMissing.push(...result.missing);
            }
            setTxns((prev) => prev.filter((t) => !allDeleted.has(t.id)));
            setTotal((prev) => Math.max(0, prev - totalDeleted));
            setSelectedIdStore([]);
            if (detail && allDeleted.has(detail.id)) setDetail(null);
            if (allMissing.length > 0) {
              console.warn("삭제 대상 중 이미 처리된 항목", allMissing);
            }
            success = true;
          } catch (err) {
            console.error(err);
            const message = err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다.";
            alert(message);
          } finally {
            setBulkDeleting(false);
            if (success) {
              setRefreshTick((x) => x + 1);
            }
          }
        }}
      >
        선택 삭제
      </button>
      {process.env.NODE_ENV !== "production" && (
        <div className="flex items-center gap-2 sm:ml-4">
          <label className="text-xs text-gray-600">더미</label>
          <input
            type="number"
            min={1}
            max={2000}
            className="w-20 rounded border px-2 py-1"
            value={dummyCount}
            onChange={(e) => setDummyCount(Math.max(1, Math.min(2000, Number(e.target.value || 0))))}
          />
          <button
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            disabled={dummyBusy}
            onClick={async () => {
              try {
                setDummyBusy(true);
                await generateDummyTransactions(dummyCount);
                setRefreshTick((x) => x + 1);
              } finally {
                setDummyBusy(false);
              }
            }}
          >
            더미 생성
          </button>
        </div>
      )}
      {process.env.NODE_ENV === "production" && (
        <span className="text-sm text-gray-600 sm:ml-4">모듈화(파일 내부 컴포넌트)로 구조를 정리했습니다.</span>
      )}
    </>
  );

  if (!filtersHydrated || !selectionHydrated) {
    return (
      <div className="space-y-8">
        <PageHeader title="Transactions" actions={headerActions} />
        <SectionCard tone="muted">
          <p className="text-sm text-gray-600">필터 및 선택 상태를 복원하는 중…</p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Transactions" actions={headerActions} />
      <SplitLayout
        sidebar={
          <StickyAside className="hidden lg:block">
            <FiltersPanel
              filters={filters}
              setFilters={setFilters}
              categories={categories}
              groups={groups}
              accounts={accounts}
              onClear={() => {
                setFilters((p) => {
                  const next = makeInitialFilters();
                  return { ...next, pageSize: p.pageSize };
                });
              }}
              className="border-0 bg-transparent p-0 shadow-none"
            />
          </StickyAside>
        }
        main={
          <>
            {statementDetail && (
              <SectionCard
                title={`명세 상세 #${statementDetail.id}`}
                headerAction={<button className="rounded border px-3 py-1 text-sm" onClick={() => setStatementDetail(null)}>닫기</button>}
              >
                {statementDetail.loading ? (
                  <p className="text-sm text-gray-600">불러오는 중…</p>
                ) : statementDetail.error ? (
                  <p className="text-sm text-red-600">{statementDetail.error}</p>
                ) : statementDetail.data ? (
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <div><span className="text-gray-600">기간</span> <div className="mt-0.5">{statementDetail.data.period_start} ~ {statementDetail.data.period_end}</div></div>
                    <div><span className="text-gray-600">결제일</span> <div className="mt-0.5">{statementDetail.data.due_date}</div></div>
                    <div><span className="text-gray-600">상태</span> <div className="mt-0.5">{statementDetail.data.status}</div></div>
                    <div><span className="text-gray-600">미결제 합계</span> <div className="mt-0.5">{Number(statementDetail.data.total_amount).toLocaleString()}</div></div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">명세 정보를 찾을 수 없습니다.</p>
                )}
              </SectionCard>
            )}
            {bulkEditing && (
              <SectionCard
                title="선택 항목 일괄 수정"
                headerAction={<button className="rounded border px-3 py-1 text-sm" onClick={() => setBulkEditing(false)}>닫기</button>}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-gray-600">메모</label>
                    <div className="mt-1 flex items-center gap-2">
                      <select value={bulkMemoMode} onChange={(e) => setBulkMemoMode(e.target.value as any)} className="rounded border px-2 py-1 text-sm">
                        <option value="replace">대체</option>
                        <option value="append">뒤에 추가</option>
                      </select>
                      <input type="text" value={bulkMemo} onChange={(e) => setBulkMemo(e.target.value)} placeholder={bulkMemoMode === 'replace' ? '새 메모' : '추가할 내용'} className="flex-1 rounded border px-2 py-1" />
                      {bulkMemoMode === 'append' && (
                        <input type="text" value={bulkAppendDelimiter} onChange={(e) => setBulkAppendDelimiter(e.target.value)} className="w-16 rounded border px-2 py-1" title="구분자" />
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">잔액·캘린더</label>
                    <div className="mt-1 flex items-center gap-4 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={bulkExclude === 'exclude'}
                          onChange={(e) => setBulkExclude(e.target.checked ? 'exclude' : 'keep')}
                        />
                        <span>제외로 설정</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={bulkExclude === 'include'}
                          onChange={(e) => setBulkExclude(e.target.checked ? 'include' : 'keep')}
                        />
                        <span>포함으로 설정</span>
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">선택하지 않으면 변경하지 않습니다.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">카테고리</label>
                    <select value={bulkCategoryId === "" ? "" : String(bulkCategoryId ?? "")}
                      onChange={(e) => setBulkCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
                      className="mt-1 w-full rounded border px-2 py-1">
                      <option value="">변경 안 함</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.full_code} {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">통화</label>
                    <input type="text" placeholder="변경 안 함" value={bulkCurrency} onChange={(e) => setBulkCurrency(e.target.value.toUpperCase())} className="mt-1 w-full rounded border px-2 py-1" />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-gray-600">선택됨: {selectedIds.size.toLocaleString()}건</div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
                      disabled={selectedIds.size === 0}
                      onClick={async () => {
                        if (selectedIds.size === 0) return;
                        const ids = Array.from(selectedIds);
                        const updates: any = {};
                        if (bulkMemo.trim().length > 0) {
                          updates.memo = bulkMemo;
                        } else if (bulkMemoMode === 'replace') {
                          updates.memo = "";
                        }
                        if (bulkExclude !== 'keep') {
                          updates.exclude_from_reports = bulkExclude === 'exclude';
                        }
                        if (bulkCategoryId !== "") {
                          updates.category_id = bulkCategoryId === null ? null : Number(bulkCategoryId);
                        }
                        if (bulkCurrency.trim().length === 3) {
                          updates.currency = bulkCurrency.toUpperCase();
                        }
                        if (Object.keys(updates).length === 0) {
                          alert('변경할 항목을 입력하세요.');
                          return;
                        }
                        try {
                          setBulkEditing(false);
                          const txById = new Map(txns.map(t => [t.id, t]));
                          const idsByUser = new Map<number, number[]>();
                          for (const id of ids) {
                            const t = txById.get(id);
                            if (!t) continue;
                            const list = idsByUser.get(t.user_id) || [];
                            list.push(id);
                            idsByUser.set(t.user_id, list);
                          }
                          const aggregate = { updated: 0, items: [] as Txn[], skipped: [] as number[], missing: [] as number[] };
                          for (const [uid, list] of idsByUser) {
                            const res = await apiPost<{ updated: number; items: Txn[]; missing: number[]; skipped: number[] }>("/api/transactions/bulk-update", {
                              user_id: uid,
                              transaction_ids: list,
                              updates,
                              memo_mode: bulkMemoMode,
                              append_delimiter: bulkAppendDelimiter,
                            });
                            aggregate.updated += res.updated;
                            aggregate.items.push(...res.items);
                            aggregate.skipped.push(...(res.skipped || []));
                            aggregate.missing.push(...(res.missing || []));
                          }
                          const updatedMap = new Map(aggregate.items.map(t => [t.id, t]));
                          setTxns(prev => prev.map(t => updatedMap.get(t.id) || t));
                          setSelectedIdStore([]);
                          setRefreshTick(x => x + 1);
                          if (aggregate.skipped.length > 0 || aggregate.missing.length > 0) {
                            const parts = [] as string[];
                            if (aggregate.skipped.length > 0) parts.push(`건너뜀 ${aggregate.skipped.length}`);
                            if (aggregate.missing.length > 0) parts.push(`없음 ${aggregate.missing.length}`);
                            alert(`일부 항목이 건너뛰어졌습니다: ${parts.join(', ')}`);
                          }
                        } catch (err) {
                          console.error(err);
                          alert(err instanceof Error ? err.message : '일괄 수정 실패');
                        }
                      }}
                    >적용</button>
                  </div>
                </div>
              </SectionCard>
            )}
            {createOpen && (
              <SectionCard
                title="새 트랜잭션 추가"
                headerAction={
                  <div className="flex gap-2">
                    <button
                      className="rounded border px-3 py-1 text-sm"
                      onClick={() => {
                        setCreateDraft((prev) => buildDefaultDraft(prev.type));
                        setCreateError(null);
                      }}
                      disabled={createBusy}
                    >
                      초기화
                    </button>
                    <button
                      className="rounded border px-3 py-1 text-sm"
                      onClick={() => {
                        setCreateOpen(false);
                        setCreateError(null);
                      }}
                    >
                      닫기
                    </button>
                  </div>
                }
              >
                {createError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-line">
                    {createError}
                  </div>
                )}
                <TxnForm
                  draft={createDraft}
                  setDraft={setCreateDraft}
                  accounts={accounts}
                  groups={groups}
                  categories={categories}
                  disabled={createBusy}
                />
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={() => {
                      setCreateDraft(buildDefaultDraft());
                      setCreateError(null);
                    }}
                    disabled={createBusy}
                  >
                    새로 작성
                  </button>
                  <button
                    className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                    disabled={createBusy}
                    onClick={async () => {
                      const validationErrors: string[] = [];
                      if (!createDraft.occurred_at) validationErrors.push("날짜를 선택하세요.");
                      const amountValid = Number.isFinite(createDraft.amount) && createDraft.amount !== 0;
                      if (!amountValid) validationErrors.push("금액을 입력하세요 (0이 아닌 숫자).");
                      if (!createDraft.account_id) validationErrors.push("계정을 선택하세요.");
                      if (createDraft.type === "TRANSFER") {
                        if (!createDraft.counter_account_id) {
                          validationErrors.push("상대 계정을 선택하세요.");
                        } else if (createDraft.counter_account_id === createDraft.account_id) {
                          validationErrors.push("출금 계정과 상대 계정은 달라야 합니다.");
                        }
                      } else {
                        if (!createDraft.category_id) {
                          validationErrors.push("카테고리를 선택하세요.");
                        }
                      }
                      if (createDraft.currency.trim().length !== 3) {
                        validationErrors.push("통화 코드를 3자리로 입력하세요.");
                      }
                      if (validationErrors.length > 0) {
                        setCreateError(validationErrors.join("\n"));
                        return;
                      }

                      const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
                      const body: any = {
                        user_id: createDraft.user_id,
                        occurred_at: createDraft.occurred_at,
                        occurred_time: (() => {
                          const timeValue = createDraft.occurred_time?.trim();
                          if (!timeValue) return "09:00:00";
                          if (timeValue.length === 5) return `${timeValue}:00`;
                          return timeValue;
                        })(),
                        type: createDraft.type,
                        amount: Number(createDraft.amount),
                        currency: createDraft.currency,
                        memo: createDraft.memo?.trim() ? createDraft.memo : undefined,
                        account_id: createDraft.account_id,
                        exclude_from_reports: Boolean(createDraft.exclude_from_reports),
                      };
                      if (createDraft.type === "TRANSFER") {
                        body.counter_account_id = createDraft.counter_account_id;
                      } else {
                        body.category_id = createDraft.category_id;
                      }

                      try {
                        setCreateBusy(true);
                        setCreateError(null);
                        const res = await fetch(new URL('/api/transactions', base).toString(), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                        });
                        if (!res.ok) {
                          throw new Error(await res.text());
                        }
                        setCreateDraft(buildDefaultDraft(createDraft.type));
                        setCreateOpen(false);
                        setRefreshTick((x) => x + 1);
                      } catch (err) {
                        setCreateError((err as Error).message);
                      } finally {
                        setCreateBusy(false);
                      }
                    }}
                  >
                    저장
                  </button>
                </div>
              </SectionCard>
            )}
            <SectionCard
              title="거래 목록"
              headerAction={
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <span>페이지 크기</span>
                  <select
                    className="rounded border px-2 py-1 text-sm"
                    value={filters.pageSize}
                    onChange={(e) => setFilters((p) => ({ ...p, pageSize: Number(e.target.value), page: 1 }))}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}개</option>
                    ))}
                  </select>
                </label>
              }
              footer={
                <PaginationBar
                  total={total}
                  page={filters.page}
                  pageSize={filters.pageSize}
                  onChangePage={(next) => setFilters((p) => ({ ...p, page: next }))}
                />
              }
            >
              <div className={clsx(
                "space-y-4",
                detail ? "lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-4 lg:space-y-0 lg:items-start" : undefined
              )}>
                <div className="space-y-2">
                  <TransactionsTableInline
                    txns={displayTxns}
                    loading={loading}
                    error={error}
                    selectedIds={selectedIds}
                    toggleSelect={toggleSelect}
                    selectAllOnPage={selectAllOnPage}
                    categories={categories}
                    groups={groups}
                    onRowClick={handleRowClick}
                    selectedId={detail?.id}
                    categoriesById={categoriesById}
                    groupsById={groupsById}
                    groupsByKey={groupsByKey}
                    accountsById={accountsById}
                    sortBy={filters.sortBy}
                    sortOrder={filters.sortOrder}
                    onSort={handleSort}
                    onStatementClick={openStatementDetail}
                  />
                </div>
                {detail && (
                  <div className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
                    <TxnSidePane
                      txn={detail}
                      categories={categories}
                      accounts={accounts}
                      onEdit={() => setShowEdit(detail)}
                      onDelete={async () => {
                        setDeleting({ id: detail.id, busy: true });
                        try {
                          const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
                          const res = await fetch(new URL(`/api/transactions/${detail.id}`, base).toString(), { method: 'DELETE' });
                          if (!res.ok) throw new Error(await res.text());
                          setTxns((prev) => prev.filter((t) => t.id !== detail.id));
                          setTotal((prev) => Math.max(0, prev - 1));
                          setSelectedIdStore((prev) => {
                            if (!prev.includes(detail.id)) {
                              return prev;
                            }
                            return prev.filter((id) => id !== detail.id);
                          });
                          setDetail(null);
                          setRefreshTick((x) => x + 1);
                        } finally {
                          setDeleting(null);
                        }
                      }}
                      onToggleExclude={(next) => {
                        if (detail) {
                          void handleToggleExclude(detail, next);
                        }
                      }}
                      toggling={toggleBusyId === detail.id}
                      notice={toggleNotice && toggleNotice.id === detail.id ? toggleNotice : null}
                      onClose={() => setDetail(null)}
                      deleting={!!deleting}
                      onRefresh={() => setRefreshTick((x) => x + 1)}
                    />
                  </div>
                )}
              </div>
            </SectionCard>
          </>
        }
      />

      {filtersDrawerVisible && (
        <div
          className={clsx(
            "fixed inset-0 z-40 flex items-end bg-black/40 px-4 pb-6 pt-12 lg:hidden transition-opacity duration-200 ease-out",
            filtersDrawerOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={closeFiltersDrawer}
        >
          <div
            className={clsx(
              "w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-xl transition-transform duration-200 ease-out",
              filtersDrawerOpen ? "translate-y-0" : "translate-y-full"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">필터</h3>
              <button className="rounded border px-3 py-1 text-sm" onClick={closeFiltersDrawer}>닫기</button>
            </div>
            <FiltersPanel
              filters={filters}
              setFilters={setFilters}
              categories={categories}
              groups={groups}
              accounts={accounts}
              onClear={() => {
                setFilters((p) => ({
                  start: "",
                  end: "",
                  types: { INCOME: true, EXPENSE: true, TRANSFER: true },
                  categoryGroupIds: [],
                  categoryIds: [],
                  accountId: "",
                  minAmount: "",
                  maxAmount: "",
                  search: "",
                  statementId: "",
                  status: "",
                  excludeSettlements: false,
                  page: 1,
                  pageSize: p.pageSize,
                  sortBy: "occurred_at",
                  sortOrder: "desc",
                }));
                closeFiltersDrawer();
              }}
              afterApply={closeFiltersDrawer}
              className="border-0 p-0"
            />
          </div>
        </div>
      )}

      {showEdit && (
        <TxnEditModal
          initial={showEdit}
          accounts={accounts}
          groups={groups}
          categories={categories}
          onClose={() => setShowEdit(null)}
          onSaved={() => setRefreshTick((x) => x + 1)}
        />
      )}
      {showBulk && (
        <BulkUploadModal onClose={() => setShowBulk(false)} onUploaded={() => setRefreshTick((x) => x + 1)} existingAccounts={accountNames} />
      )}
    </div>
  );
}

function TxnEditModal({
  initial,
  accounts,
  groups,
  categories,
  onClose,
  onSaved,
}: {
  initial: Txn;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const computeDraft = useCallback((): TxnDraft => {
    const time = initial.occurred_time ? initial.occurred_time.slice(0, 5) : "";
    const targetCategoryId = initial.category_id ?? -1;
    const cat = categories.find((c) => c.id === targetCategoryId);
    return {
      user_id: initial.user_id,
      occurred_at: initial.occurred_at,
      occurred_time: time,
      type: initial.type,
      amount: Number(initial.amount),
      currency: initial.currency,
      account_id: initial.account_id,
      counter_account_id: initial.counter_account_id ?? undefined,
      category_group_id: cat?.group_id,
      category_id: initial.category_id ?? undefined,
      memo: initial.memo ?? "",
      exclude_from_reports: initial.exclude_from_reports,
    };
  }, [initial, categories]);

  const [draft, setDraft] = useState<TxnDraft>(computeDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(computeDraft());
    setError(null);
  }, [computeDraft]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg space-y-3 rounded bg-white p-4">
        <h3 className="text-lg font-semibold">트랜잭션 수정</h3>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-line">
            {error}
          </div>
        )}
        <TxnForm
          draft={draft}
          setDraft={setDraft}
          accounts={accounts}
          groups={groups}
          categories={categories}
          disabled={busy}
          lockType={false}
        />
        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-1" onClick={onClose} disabled={busy}>취소</button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              const validationErrors: string[] = [];
              if (!draft.occurred_at) validationErrors.push("날짜를 선택하세요.");
              const amountValid = Number.isFinite(draft.amount) && draft.amount !== 0;
              if (!amountValid) validationErrors.push("금액을 입력하세요 (0이 아닌 숫자).");
              if (!draft.account_id) validationErrors.push("계정을 선택하세요.");
              if (draft.type === "TRANSFER") {
                if (!draft.counter_account_id) {
                  validationErrors.push("상대 계정을 선택하세요.");
                } else if (draft.counter_account_id === draft.account_id) {
                  validationErrors.push("출금 계정과 상대 계정은 달라야 합니다.");
                }
              } else if (!draft.category_id) {
                validationErrors.push("카테고리를 선택하세요.");
              }
              if (draft.currency.trim().length !== 3) {
                validationErrors.push("통화 코드를 3자리로 입력하세요.");
              }
              if (validationErrors.length > 0) {
                setError(validationErrors.join("\n"));
                return;
              }

              const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
              const body: any = {
                occurred_at: draft.occurred_at,
                occurred_time: (() => {
                  const timeValue = draft.occurred_time?.trim();
                  if (!timeValue) return "09:00:00";
                  if (timeValue.length === 5) return `${timeValue}:00`;
                  return timeValue;
                })(),
                type: draft.type, // 타입 변경 지원
                account_id: draft.account_id,
                amount: Number(draft.amount),
                currency: draft.currency,
                memo: draft.memo?.trim() ? draft.memo : undefined,
                exclude_from_reports: Boolean(draft.exclude_from_reports),
              };
              if (draft.type === "TRANSFER") {
                body.counter_account_id = draft.counter_account_id;
                body.category_id = null; // TRANSFER로 변경 시 카테고리 제거
              } else {
                body.category_id = draft.category_id;
                body.counter_account_id = null; // INCOME/EXPENSE로 변경 시 상대 계좌 제거
              }

              try {
                setBusy(true);
                setError(null);
                const res = await fetch(new URL(`/api/transactions/${initial.id}`, base).toString(), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                if (!res.ok) {
                  throw new Error(await res.text());
                }
                onClose();
                onSaved();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

function TxnForm({
  draft,
  setDraft,
  accounts,
  groups,
  categories,
  disabled = false,
  lockType = false,
}: {
  draft: TxnDraft;
  setDraft: React.Dispatch<React.SetStateAction<TxnDraft>>;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  disabled?: boolean;
  lockType?: boolean;
}) {
  const transferMode = draft.type === "TRANSFER";
  const groupType = GROUP_TYPE_BY_TXN[draft.type];
  const availableGroups = useMemo(
    () => groups.filter((g) => g.type === groupType),
    [groups, groupType]
  );
  const availableCategories = useMemo(
    () => categories.filter((c) => c.group_id === draft.category_group_id),
    [categories, draft.category_group_id]
  );

  return (
    <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
      <div>
        <label className="block text-xs text-gray-600">날짜</label>
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          type="date"
          value={draft.occurred_at}
          disabled={disabled}
          onChange={(e) => setDraft((prev) => ({ ...prev, occurred_at: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600">시간</label>
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          type="time"
          step={60}
          value={draft.occurred_time}
          disabled={disabled}
          onChange={(e) => setDraft((prev) => ({ ...prev, occurred_time: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600">유형</label>
        <select
          className="mt-1 w-full rounded border px-2 py-1"
          value={draft.type}
          disabled={disabled || lockType}
          onChange={(e) => {
            if (lockType) return;
            const nextType = e.target.value as Txn["type"];
            setDraft((prev) => {
              const next: TxnDraft = { ...prev, type: nextType };
              if (nextType === "TRANSFER") {
                next.category_group_id = undefined;
                next.category_id = null;
              } else {
                const nextGroupType = GROUP_TYPE_BY_TXN[nextType];
                const nextGroups = groups.filter((g) => g.type === nextGroupType);
                if (nextGroups.length > 0) {
                  next.category_group_id = nextGroups.find((g) => g.id === prev.category_group_id)?.id ?? nextGroups[0].id;
                  const nextCategories = categories.filter((c) => c.group_id === next.category_group_id);
                  next.category_id = nextCategories.find((c) => c.id === prev.category_id)?.id ?? (nextCategories[0]?.id ?? undefined);
                } else {
                  next.category_group_id = undefined;
                  next.category_id = undefined;
                }
              }
              if (nextType !== "TRANSFER") {
                next.counter_account_id = undefined;
              } else if (prev.account_id && prev.account_id === prev.counter_account_id) {
                next.counter_account_id = accounts.find((a) => a.id !== prev.account_id)?.id ?? prev.counter_account_id;
              }
              return next;
            });
          }}
  >
          <option value="EXPENSE">EXPENSE</option>
          <option value="INCOME">INCOME</option>
          <option value="TRANSFER">TRANSFER</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-600">금액</label>
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          type="number"
          value={Number.isNaN(draft.amount) ? "" : draft.amount}
          disabled={disabled}
          onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value === "" ? NaN : Number(e.target.value) }))}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600">통화</label>
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          value={draft.currency}
          disabled={disabled}
          onChange={(e) => setDraft((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600">계정</label>
        <select
          className="mt-1 w-full rounded border px-2 py-1"
          value={draft.account_id ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const nextAccountId = e.target.value ? Number(e.target.value) : undefined;
            setDraft((prev) => {
              const next: TxnDraft = { ...prev, account_id: nextAccountId };
              if (prev.type === "TRANSFER" && nextAccountId && nextAccountId === prev.counter_account_id) {
                next.counter_account_id = accounts.find((a) => a.id !== nextAccountId)?.id ?? undefined;
              }
              return next;
            });
          }}
        >
          <option value="">선택</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      {transferMode ? (
        <div>
          <label className="block text-xs text-gray-600">상대 계정</label>
          <select
            className="mt-1 w-full rounded border px-2 py-1"
            value={draft.counter_account_id ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const nextCounterId = e.target.value ? Number(e.target.value) : undefined;
              setDraft((prev) => ({ ...prev, counter_account_id: nextCounterId }));
            }}
          >
            <option value="">선택</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === draft.account_id}>{a.name}</option>
            ))}
          </select>
          {draft.account_id && draft.counter_account_id === draft.account_id && (
            <p className="mt-1 text-xs text-red-600">출금/입금 계정은 서로 달라야 합니다.</p>
          )}
        </div>
      ) : (
        <>
          <div>
            <label className="block text-xs text-gray-600">카테고리 그룹</label>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={draft.category_group_id ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const nextGroupId = e.target.value ? Number(e.target.value) : undefined;
                setDraft((prev) => {
                  const next: TxnDraft = { ...prev, category_group_id: nextGroupId };
                  const nextCats = categories.filter((c) => c.group_id === nextGroupId);
                  next.category_id = nextCats.length > 0 ? nextCats[0].id : undefined;
                  return next;
                });
              }}
            >
              <option value="">선택</option>
              {availableGroups.map((g) => (
                <option key={g.id} value={g.id}>{`${g.type}${String(g.code_gg).padStart(2, "0")} ${g.name}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600">카테고리</label>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={draft.category_id ?? ""}
              disabled={disabled || !draft.category_group_id}
              onChange={(e) => setDraft((prev) => ({ ...prev, category_id: e.target.value ? Number(e.target.value) : undefined }))}
            >
              <option value="">선택</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>{`${c.full_code} ${c.name}`}</option>
              ))}
            </select>
          </div>
        </>
      )}
      <div className="md:col-span-2">
        <label className="block text-xs text-gray-600">메모</label>
        <input
          className="mt-1 w-full rounded border px-2 py-1"
          value={draft.memo ?? ""}
          disabled={disabled}
          onChange={(e) => setDraft((prev) => ({ ...prev, memo: e.target.value }))}
        />
      </div>
      <div className="md:col-span-2">
        <label className="flex items-start gap-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={Boolean(draft.exclude_from_reports)}
            disabled={disabled}
            onChange={(e) => setDraft((prev) => ({ ...prev, exclude_from_reports: e.target.checked }))}
          />
          <span>
            <span className="font-medium text-gray-800">잔액·캘린더에서 제외</span>
            <p className="mt-1 text-xs text-gray-500">
              {draft.type === "TRANSFER"
                ? "이체 시 계좌 잔액과 달력 요약 계산에서 제외합니다. 장부에는 계속 남습니다."
                : "해당 거래를 계좌 잔액과 달력 요약 계산에서 제외합니다. 장부에는 계속 남습니다."}
            </p>
          </span>
        </label>
      </div>
    </div>
  );
}

function BulkUploadModal({ onClose, onUploaded, existingAccounts }: { onClose: () => void; onUploaded: () => void; existingAccounts: string[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [parseResult, setParseResult] = useState<BankSaladParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploadMeta, setUploadMeta] = useState<{
    duplicateTransfers?: number;
    settlementDuplicates?: number;
    dbTransferMatches?: number;
  } | null>(null);
  // 업로드 전 파일이 '내부이체 중심'인지 확인 모달
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [transferCheckDone, setTransferCheckDone] = useState(false);
  // 의심 페어 검토 완료 여부 (모달 재오픈 방지)
  const [suspectedReviewDone, setSuspectedReviewDone] = useState(false);
  // 추정 페어 자동 연결 여부
  const [inferredAutoLink, setInferredAutoLink] = useState(false);
  // 추정 페어 보기 모달
  const [showInferredModal, setShowInferredModal] = useState(false);
  const [inferredPairDecisions, setInferredPairDecisions] = useState<Map<string, "link" | "separate">>(new Map());
  // 의심 매칭 확인 상태
  const [showSuspectedModal, setShowSuspectedModal] = useState(false);
  const [suspectedPairDecisions, setSuspectedPairDecisions] = useState<Map<string, "link" | "separate">>(new Map());
  // DB 매칭 후보 확인 상태
  const [showDbMatchModal, setShowDbMatchModal] = useState(false);
  const [dbMatches, setDbMatches] = useState<PotentialTransferMatch[]>([]);
  const [dbMatchReviewDone, setDbMatchReviewDone] = useState(false);
  const [dbMatchDecisions, setDbMatchDecisions] = useState<Map<string, "link" | "separate">>(new Map());
  const lastBulkItemsRef = useRef<UploadItem[] | null>(null);
  // 업로드 대상 멤버 선택 (기본: 나=사용자 1, 보조: 멤버 1=사용자 2)
  const [selectedMemberId, setSelectedMemberId] = useState<number>(1);
  // 단일 계좌 원장 모드: 기본 비활성화 (이체 타입 보존 우선)
  const [singleAccountMode, setSingleAccountMode] = useState(false);
  const [primaryAccountName, setPrimaryAccountName] = useState("");
  const [detectedAccounts, setDetectedAccounts] = useState<string[]>([]);
  const lastBufferRef = useRef<ArrayBuffer | null>(null);

  const previewItems = useMemo(() => parseResult?.items.slice(0, 10) ?? [], [parseResult]);
  const canUpload = !!parseResult && parseResult.items.length > 0 && !busy;

  // 파일 내 내부이체 의심 페어 수 집계 및 추정 페어 목록 생성
  const transferPairStats = useMemo(() => {
    if (!parseResult) return { suspected: 0, inferred: 0, confirmed: 0, total: 0, inferredPairs: [] as any[] };
    type Item = (typeof parseResult.items)[number];
    const suspected = parseResult.suspectedPairs?.length ?? 0;
    // items 중 TRANSFER는 확정된 1쌍으로 계산
    const confirmed = parseResult.items.reduce((acc, it) => acc + (it.type === "TRANSFER" ? 1 : 0), 0);
    // items 중 비-TRANSFER에서 날짜/시간/통화/절대금액 동일 그룹으로 OUT/IN 추정 페어 수 계산
    const groups = new Map<string, { outs: Item[]; ins: Item[] }>();
    for (const it of parseResult.items) {
      if (it.type === "TRANSFER") continue;
      const key = `${it.occurred_at}::${it.occurred_time || ""}::${(it.currency || "KRW").toUpperCase()}::${Math.abs(it.amount)}`;
      const g = groups.get(key) || { outs: [], ins: [] };
      if (it.amount < 0 || it.type === "EXPENSE") g.outs.push(it); else g.ins.push(it);
      groups.set(key, g);
    }
    const inferredPairs: Array<{ id: string; out: Item; in: Item }> = [];
    let pairId = 0;
    for (const [_, g] of groups) {
      const count = Math.min(g.outs.length, g.ins.length);
      for (let i = 0; i < count; i += 1) {
        const o = g.outs[i];
        const inn = g.ins[i];
        if (o && inn) {
          inferredPairs.push({ id: `inferred-${pairId++}`, out: o, in: inn });
        }
      }
    }
    const inferred = inferredPairs.length;
    const total = suspected + confirmed + inferred;
    return { suspected, inferred, confirmed, total, inferredPairs };
  }, [parseResult]);

  const handlePickFile = () => {
    setError(null);
    setStatus(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setStatus(null);
    try {
      const buffer = await file.arrayBuffer();
      lastBufferRef.current = buffer;
      // 워크북에서 결제수단(계좌) 후보 추출
      try {
        const wb = XLSX.read(buffer, { type: "array" });
        const sheet = wb.Sheets["가계부 내역"] ?? (wb.SheetNames[1] ? wb.Sheets[wb.SheetNames[1]] : undefined);
        const rows: unknown[][] = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]) : [];
        // 헤더 인덱스 및 컬럼 찾기
        let headerRowIndex = 0;
        while (headerRowIndex < rows.length && (!rows[headerRowIndex] || (rows[headerRowIndex] as any[]).every(c => c == null || String(c).trim() === ""))) headerRowIndex += 1;
        const headerRow = rows[headerRowIndex] ?? [];
        const norm = (v: unknown) => String(v ?? "").replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "").toLowerCase();
        const colIdx = headerRow.findIndex(c => ["결제수단","계좌","계좌명","자산","사용자산","수단"].includes(norm(c)));
        const set = new Set<string>();
        if (colIdx >= 0) {
          for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
            const row = rows[i] ?? [];
            const cell = row[colIdx];
            if (cell == null) continue;
            const name = String(cell).trim();
            if (name) set.add(name);
          }
        }
        const detected = Array.from(set).sort();
        setDetectedAccounts(detected);
        // 후보가 1개면 기본 선택
        if (detected.length === 1) setPrimaryAccountName(detected[0]);
      } catch {
        setDetectedAccounts([]);
      }

      const result = parseBankSaladWorkbook(buffer, selectedMemberId, {
        existingAccounts,
        rawSingleAccountMode: singleAccountMode,
        primaryAccountName: primaryAccountName || undefined,
      });
      console.log('[DEBUG] Parse result:', {
        totalItems: result.items.length,
        suspectedPairs: result.suspectedPairs.length,
        suspectedPairsDetail: result.suspectedPairs,
        summary: result.summary,
      });
      setParseResult(result);
      if (result.items.length === 0) {
        const message = result.issues.length > 0 ? result.issues.join("\n") : "엑셀에서 유효한 거래를 찾지 못했습니다.";
        setError(message);
      }
    } catch (err) {
      setParseResult(null);
      setError(err instanceof Error ? err.message : "엑셀 파일을 읽지 못했습니다.");
    } finally {
      // allow selecting the same file again
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  // 옵션 변경 시 재파싱
  useEffect(() => {
    const buffer = lastBufferRef.current;
    if (!buffer) return;
    try {
      const result = parseBankSaladWorkbook(buffer, selectedMemberId, {
        existingAccounts,
        rawSingleAccountMode: singleAccountMode,
        primaryAccountName: primaryAccountName || undefined,
      });
      setParseResult(result);
      setError(result.items.length === 0 ? (result.issues[0] || "엑셀에서 유효한 거래를 찾지 못했습니다.") : null);
    } catch (e) {
      // ignore for live preview
    }
  }, [singleAccountMode, primaryAccountName, existingAccounts, selectedMemberId]);

  const handleUpload = async () => {
    if (!parseResult || parseResult.items.length === 0) {
      setError("업로드할 데이터가 없습니다.");
      return;
    }
    // 1) 업로드 전 파일이 내부이체 중심인지 사용자 확인
    if (!transferCheckDone && transferPairStats.total > 0 && !showTransferConfirm) {
      setShowTransferConfirm(true);
      return;
    }
    
    // 2) 의심 매칭이 있으면 모달 표시 (한 번만)
    if (parseResult.suspectedPairs.length > 0 && !suspectedReviewDone && !showSuspectedModal) {
      setShowSuspectedModal(true);
      return;
    }
    
    // 3) 추정 페어가 있고 사용자가 아직 확인하지 않았으면 모달 표시
    if (transferPairStats.inferred > 0 && inferredPairDecisions.size === 0 && !showInferredModal) {
      setShowInferredModal(true);
      return;
    }
    
    try {
      setBusy(true);
      setError(null);
      setStatus(null);
      
      // 1) 추정 페어 자동 연결 적용 (선택 시)
  type Item = UploadItem;
      const buildInferredTransfers = (items: Item[]) => {
        const groups = new Map<string, { outs: Item[]; ins: Item[] }>();
        for (const it of items) {
          if (it.type === "TRANSFER") continue;
          const key = `${it.occurred_at}::${it.occurred_time || ""}::${(it.currency || "KRW").toUpperCase()}::${Math.abs(it.amount)}`;
          const g = groups.get(key) || { outs: [], ins: [] };
          if (it.amount < 0 || it.type === "EXPENSE") g.outs.push(it); else g.ins.push(it);
          groups.set(key, g);
        }
        const skipIds = new Set<string>();
        const transfers: Item[] = [] as any;
        for (const [_, g] of groups) {
          const count = Math.min(g.outs.length, g.ins.length);
          for (let i = 0; i < count; i += 1) {
            const o = g.outs[i];
            const inn = g.ins[i];
            if (!o || !inn) continue;
            if (o.external_id) skipIds.add(o.external_id);
            if (inn.external_id) skipIds.add(inn.external_id);
            const magnitude = Math.abs(o.amount);
            transfers.push({
              user_id: selectedMemberId,
              occurred_at: o.occurred_at,
              occurred_time: o.occurred_time,
              type: "TRANSFER",
              amount: -magnitude,
              currency: o.currency,
              account_name: o.account_name,
              counter_account_name: inn.account_name,
              memo: [o.memo, inn.memo].filter(Boolean).join(" | ") || undefined,
              external_id: `${o.external_id || "inferred"}-link-${Math.round(magnitude)}`,
              transfer_flow: "OUT",
            } as Item);
          }
        }
        return { skipIds, transfers };
      };

      let finalItems: Item[] = [];
      let skippedByInference = new Set<string>();
      
      // 1-a) 사용자가 선택한 inferred pairs 처리
      const linkedInferredIds = new Set<string>();
      for (const pair of transferPairStats.inferredPairs) {
        const decision = inferredPairDecisions.get(pair.id);
        if (decision === "link") {
          // 페어를 TRANSFER로 변환 (OUT 방향 정규화: 음수 금액)
          const magnitude = Math.abs(pair.out.amount);
          const transferItem: Item = {
            user_id: selectedMemberId,
            occurred_at: pair.out.occurred_at,
            occurred_time: pair.out.occurred_time,
            type: "TRANSFER",
            amount: -magnitude,
            currency: pair.out.currency,
            account_name: pair.out.account_name,
            counter_account_name: pair.in.account_name,
            memo: [pair.out.memo, pair.in.memo].filter(Boolean).join(" | ") || undefined,
            external_id: `${pair.out.external_id || "inferred"}-link-${Math.round(magnitude)}`,
            transfer_flow: "OUT",
          };
          finalItems.push(transferItem);
          // 원본 OUT/IN 건은 제외
          if (pair.out.external_id) linkedInferredIds.add(pair.out.external_id);
          if (pair.in.external_id) linkedInferredIds.add(pair.in.external_id);
        } else if (decision === "separate") {
          // 별도 거래로 유지 - 이 건들은 아래에서 추가됨
        }
      }
      
      // 1-b) 자동 연결 로직 (deprecated, 사용자 선택이 우선)
      const inference = inferredAutoLink && inferredPairDecisions.size === 0 
        ? buildInferredTransfers(parseResult.items) 
        : { skipIds: new Set<string>(), transfers: [] as Item[] };
      skippedByInference = inference.skipIds;

      // 원본 아이템 추가 (inferred pair로 처리된 건은 제외)
      for (const it of parseResult.items) {
        if (it.external_id && (linkedInferredIds.has(it.external_id) || skippedByInference.has(it.external_id))) continue;
        finalItems.push(it);
      }
      
      // 자동 추정 생성 TRANSFER 추가 (deprecated path)
      if (inference.transfers.length > 0) finalItems.push(...inference.transfers);

      // 2) 의심 페어 결정 반영 - 모달 통과 완료 시에만 추가
      const suspectedPairItems: Item[] = [];
      if (suspectedReviewDone) {
        for (const pair of parseResult.suspectedPairs) {
          const decision = suspectedPairDecisions.get(pair.id);
          if (decision === "link") {
            // 원본 금액 부호를 유지하여 백엔드 방향 결정 로직과 일치시킴
            const transferItem = {
              ...pair.outgoing,
              type: "TRANSFER" as const,
              amount: pair.outgoing.amount,  // 원본 부호 유지!
              counter_account_name: pair.incoming.account_name,
              category_group_name: undefined,
              category_name: undefined,
              transfer_flow: pair.outgoing.transfer_flow || "OUT" as const,
            };
            suspectedPairItems.push(transferItem);
          } else if (decision === "separate") {
            suspectedPairItems.push(pair.outgoing, pair.incoming);
          }
        }
      }
      finalItems.push(...suspectedPairItems);
      
      // DB 매칭 결정이 완료되었으면 confirm API 사용, 아니면 일반 bulk API 사용
      if (dbMatchReviewDone && dbMatches.length > 0) {
        // DB 매칭 확인 처리
        const decisions = dbMatches.reduce(
          (acc, match) => {
            const matchKey = `${match.existing_txn_id}-${match.new_item_index}`;
            const action = dbMatchDecisions.get(matchKey);
            if (!action) {
              return acc;
            }
            acc.push({
              existing_txn_id: match.existing_txn_id,
              new_item_index: match.new_item_index,
              action,
            });
            return acc;
          },
          [] as Array<{ existing_txn_id: number; new_item_index: number; action: "link" | "separate" }>
        );
        
        const confirmRes = await apiPost<{
          linked: number;
          created: number;
          updated: number;
          transactions: any[];
        }>("/api/transactions/bulk-confirm-matches", {
          user_id: selectedMemberId,
          items: finalItems,
          decisions,
        });
        
        setStatus(
          `DB 매칭 처리 완료: ${confirmRes.linked}쌍 연결, ${confirmRes.created}건 별도 등록, ${confirmRes.updated}건 업데이트`
        );
        onUploaded();
        return;
      }
      
      // 일반 bulk 업로드
      const bulkRes = await apiPost<TransactionsBulkResponse>("/api/transactions/bulk", {
        user_id: selectedMemberId,
        override,
        items: finalItems,
      });
      lastBulkItemsRef.current = finalItems;
      
      // DB 매칭 후보가 있고 아직 확인하지 않았으면 모달 표시
      if (bulkRes.db_transfer_matches.length > 0 && !dbMatchReviewDone) {
        setDbMatches(bulkRes.db_transfer_matches);
        setShowDbMatchModal(true);
        setBusy(false);
        return;
      }
      
      const stats = bulkRes.stats;
      setUploadMeta({ 
        duplicateTransfers: stats.duplicate_transfers, 
        settlementDuplicates: stats.settlement_duplicates, 
        dbTransferMatches: stats.db_transfer_matches 
      });
      setStatus(
        `${finalItems.length.toLocaleString()}건 업로드 완료 · ` +
        `동일파일 이체중복 ${stats.duplicate_transfers}건, ` +
        `정산중복 ${stats.settlement_duplicates}건, ` +
        `DB매칭 ${stats.db_transfer_matches}건, ` +
        `기존 external_id 중복 ${stats.existing_duplicates}건, ` +
        `자연키 중복 ${stats.natural_duplicates}건 건너뜀`
      );
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-3xl space-y-4 rounded bg-white p-4">
        <h3 className="text-lg font-semibold">엑셀 대량 업로드</h3>
        <p className="text-sm text-gray-700">
          BankSalad 앱에서 내보낸 엑셀 파일(.xlsx)의 2번째 시트 &quot;가계부 내역&quot;을 기반으로 트랜잭션을 생성합니다.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            onClick={handlePickFile}
            disabled={busy}
          >
            파일 선택
          </button>
          {busy && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>처리 중...</span>
            </div>
          )}
          <span className="text-sm text-gray-600">
            {fileName ? fileName : "선택된 파일이 없습니다."}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">업로드 대상</span>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="upload-member"
                value="1"
                checked={selectedMemberId === 1}
                onChange={() => setSelectedMemberId(1)}
                disabled={busy}
              />
              <span>나 (사용자 1)</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="upload-member"
                value="2"
                checked={selectedMemberId === 2}
                onChange={() => setSelectedMemberId(2)}
                disabled={busy}
              />
              <span>멤버 1 (사용자 2)</span>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            멤버별로 user_id가 달라 외부 ID(external_id)가 같아도 중복 충돌을 피할 수 있습니다.
          </p>
        </div>
        {error && (
          <div className="whitespace-pre-line rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {status && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {status}
          </div>
        )}
        {parseResult && (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              <p>총 {parseResult.summary.total.toLocaleString()}건 (수입 {parseResult.summary.byType.INCOME.toLocaleString()} / 지출 {parseResult.summary.byType.EXPENSE.toLocaleString()} / 이체 {parseResult.summary.byType.TRANSFER.toLocaleString()})</p>
              {parseResult.suspectedPairs.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  의심 내부이체 {parseResult.suspectedPairs.length}건 발견 · 업로드 시 확인 창이 열립니다.
                </p>
              )}
            </div>
            {uploadMeta && (
              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                최근 업로드 요약: 내부이체(동일파일) {uploadMeta.duplicateTransfers ?? 0}건, 정산중복 {uploadMeta.settlementDuplicates ?? 0}건, DB매칭 {uploadMeta.dbTransferMatches ?? 0}건 건너뜀
              </div>
            )}
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={singleAccountMode} onChange={(e) => setSingleAccountMode(e.target.checked)} />
                        <span>단일 계좌 원장 모드</span>
                      </label>
                      <div className="flex flex-col min-w-[260px]">
                        <label className="text-xs text-gray-600">주 계좌명 (선택)</label>
                        <input
                          list="detected-accounts"
                          value={primaryAccountName}
                          onChange={(e) => setPrimaryAccountName(e.target.value)}
                          placeholder="예: 저축예금 84607"
                          className="mt-1 rounded border px-2 py-1"
                        />
                        <datalist id="detected-accounts">
                          {Array.from(new Set([...(detectedAccounts || []), ...existingAccounts])).map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      </div>
                    </div>
            {parseResult.issues.length > 0 && (
              <div className="max-h-32 overflow-auto rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <p className="font-semibold">건너뛴 행</p>
                <ul className="list-disc pl-4">
                  {parseResult.issues.slice(0, 10).map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                  {parseResult.issues.length > 10 && <li>... (총 {parseResult.issues.length}건)</li>}
                </ul>
              </div>
            )}
            {previewItems.length > 0 && (
              <div>
                <div className="mb-2 text-xs text-gray-500">미리보기 (상위 {previewItems.length}건)</div>
                <div className="max-h-48 overflow-auto rounded border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left">날짜</th>
                        <th className="px-2 py-1 text-left">시간</th>
                        <th className="px-2 py-1 text-left">유형</th>
                        <th className="px-2 py-1 text-right">금액</th>
                        <th className="px-2 py-1 text-left">계정</th>
                        <th className="px-2 py-1 text-left">대분류</th>
                        <th className="px-2 py-1 text-left">소분류</th>
                        <th className="px-2 py-1 text-left">메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewItems.map((item, idx) => (
                        <tr key={`${item.external_id}-${idx}`} className="border-t">
                          <td className="px-2 py-1 whitespace-nowrap">{item.occurred_at}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{item.occurred_time?.slice(0, 5)}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{item.type}</td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">{item.amount.toLocaleString()}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{item.account_name}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{item.category_group_name ?? "-"}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{item.category_name ?? "-"}</td>
                          <td className="px-2 py-1">{item.memo ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* 내부이체 파일 여부 확인 모달 */}
        {showTransferConfirm && parseResult && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-xl rounded bg-white p-6 space-y-4">
              <h3 className="text-lg font-semibold">이 파일은 내부이체 중심일 수 있어요</h3>
              <p className="text-sm text-gray-700">
                날짜/시간/금액 절대값이 같은 OUT/IN 조합을 기반으로 내부이체 의심 페어를 찾았습니다.
              </p>
              <ul className="text-sm text-gray-700 list-disc pl-5">
                <li>의심 페어: {transferPairStats.suspected}쌍</li>
                <li>확정 페어(TRANSFER): {transferPairStats.confirmed}쌍</li>
                <li>추정 페어(비-TRANSFER 그룹): {transferPairStats.inferred}쌍</li>
                <li className="font-medium">총합: {transferPairStats.total}쌍</li>
              </ul>
              {transferPairStats.inferred > 0 && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={inferredAutoLink} onChange={(e) => setInferredAutoLink(e.target.checked)} />
                  <span>추정 페어를 자동으로 내부이체로 연결</span>
                </label>
              )}
              <p className="text-xs text-gray-500">계속 진행하면 다음 단계에서 의심 페어를 내부이체로 연결할지 선택할 수 있습니다.</p>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded border px-3 py-1"
                  onClick={() => {
                    setShowTransferConfirm(false);
                  }}
                >취소</button>
                {parseResult.suspectedPairs.length > 0 && (
                  <button
                    className="rounded border px-3 py-1"
                    onClick={() => {
                      setShowTransferConfirm(false);
                      setTransferCheckDone(true);
                      setShowSuspectedModal(true);
                    }}
                  >의심페어 보기</button>
                )}
                {transferPairStats.inferred > 0 && (
                  <button
                    className="rounded border px-3 py-1"
                    onClick={() => {
                      setShowTransferConfirm(false);
                      setTransferCheckDone(true);
                      setShowInferredModal(true);
                    }}
                  >추정페어 보기</button>
                )}
                <button
                  className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    setShowTransferConfirm(false);
                    setTransferCheckDone(true);
                    // 확인 후 업로드 흐름 재개
                    handleUpload();
                  }}
                >{busy ? "처리 중..." : "계속"}</button>
              </div>
            </div>
          </div>
        )}

        {/* 추정 페어 선택 모달 */}
        {showInferredModal && transferPairStats.inferredPairs.length > 0 && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded bg-white p-6 space-y-4">
              <h3 className="text-lg font-semibold">추정된 내부 이체 페어</h3>
              <p className="text-sm text-gray-700">
                날짜/시간/금액이 정확히 일치하는 OUT/IN 조합 {transferPairStats.inferredPairs.length}쌍을 발견했습니다. 
                각 페어를 확인하고 내부 이체로 연결할지 별도 거래로 유지할지 선택하세요.
              </p>
              
              <div className="space-y-3">
                {transferPairStats.inferredPairs.map((pair) => {
                  const decision = inferredPairDecisions.get(pair.id);
                  
                  return (
                    <div key={pair.id} className="border rounded p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          추정 페어 (날짜·시간·금액 일치)
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="border-r pr-4">
                          <p className="font-semibold text-gray-700 mb-2">출금</p>
                          <p className="text-xs text-gray-500">{pair.out.occurred_at} {pair.out.occurred_time}</p>
                          <p className="text-lg font-medium text-red-600">{Math.abs(pair.out.amount).toLocaleString()} {pair.out.currency}</p>
                          <p className="text-sm">{pair.out.account_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{pair.out.memo || "(메모 없음)"}</p>
                        </div>
                        
                        <div className="pl-4">
                          <p className="font-semibold text-gray-700 mb-2">입금</p>
                          <p className="text-xs text-gray-500">{pair.in.occurred_at} {pair.in.occurred_time}</p>
                          <p className="text-lg font-medium text-green-600">{Math.abs(pair.in.amount).toLocaleString()} {pair.in.currency}</p>
                          <p className="text-sm">{pair.in.account_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{pair.in.memo || "(메모 없음)"}</p>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          className={`flex-1 px-4 py-2 rounded text-sm font-medium ${
                            decision === "link"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                          onClick={() => {
                            const newDecisions = new Map(inferredPairDecisions);
                            newDecisions.set(pair.id, "link");
                            setInferredPairDecisions(newDecisions);
                          }}
                        >
                          ✅ 내부 이체로 연결
                        </button>
                        <button
                          className={`flex-1 px-4 py-2 rounded text-sm font-medium ${
                            decision === "separate"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                          onClick={() => {
                            const newDecisions = new Map(inferredPairDecisions);
                            newDecisions.set(pair.id, "separate");
                            setInferredPairDecisions(newDecisions);
                          }}
                        >
                          ❌ 별도 거래로 등록
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex gap-2 text-sm">
                  <button
                    className="px-3 py-1 rounded border hover:bg-gray-50"
                    onClick={() => {
                      const newDecisions = new Map<string, "link" | "separate">();
                      transferPairStats.inferredPairs.forEach(pair => {
                        newDecisions.set(pair.id, "link");
                      });
                      setInferredPairDecisions(newDecisions);
                    }}
                  >
                    전체 연결
                  </button>
                  <button
                    className="px-3 py-1 rounded border hover:bg-gray-50"
                    onClick={() => {
                      const newDecisions = new Map<string, "link" | "separate">();
                      transferPairStats.inferredPairs.forEach(pair => {
                        newDecisions.set(pair.id, "separate");
                      });
                      setInferredPairDecisions(newDecisions);
                    }}
                  >
                    전체 별도 등록
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 rounded border hover:bg-gray-50"
                    onClick={() => {
                      setShowInferredModal(false);
                      setInferredPairDecisions(new Map());
                    }}
                  >
                    취소
                  </button>
                  <button
                    className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={inferredPairDecisions.size < transferPairStats.inferredPairs.length || busy}
                    onClick={() => {
                      setShowInferredModal(false);
                      handleUpload();
                    }}
                  >
                    {busy ? "처리 중..." : `확인 (${inferredPairDecisions.size}/${transferPairStats.inferredPairs.length})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 의심 매칭 확인 모달 */}
        {showSuspectedModal && parseResult && parseResult.suspectedPairs.length > 0 && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded bg-white p-6 space-y-4">
              <h3 className="text-lg font-semibold">내부 이체로 연결할까요?</h3>
              <p className="text-sm text-gray-700">
                {parseResult.suspectedPairs.length}건의 의심 내부 이체를 발견했습니다. 
                각 항목을 확인하고 내부 이체로 연결할지 별도 거래로 등록할지 선택하세요.
              </p>
              
              <div className="space-y-3">
                {parseResult.suspectedPairs.map((pair) => {
                  const decision = suspectedPairDecisions.get(pair.id);
                  const { confidence } = pair;
                  
                  return (
                    <div key={pair.id} className="border rounded p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          confidence.level === "CERTAIN" ? "bg-green-100 text-green-800" :
                          confidence.level === "SUSPECTED" ? "bg-yellow-100 text-yellow-800" :
                          "bg-red-100 text-red-800"
                        }`}>
                          신뢰도 {confidence.score}%
                        </span>
                        <span className="text-xs text-gray-500">
                          {confidence.reasons.join(", ")}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="border-r pr-4">
                          <p className="font-semibold text-gray-700 mb-2">출금</p>
                          <p className="text-xs text-gray-500">{pair.outgoing.occurred_at} {pair.outgoing.occurred_time}</p>
                          <p className="text-lg font-medium text-red-600">{pair.outgoing.amount.toLocaleString()} {pair.outgoing.currency}</p>
                          <p className="text-sm">{pair.outgoing.account_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{pair.outgoing.memo}</p>
                        </div>
                        
                        <div className="pl-4">
                          <p className="font-semibold text-gray-700 mb-2">입금</p>
                          <p className="text-xs text-gray-500">{pair.incoming.occurred_at} {pair.incoming.occurred_time}</p>
                          <p className="text-lg font-medium text-green-600">{pair.incoming.amount.toLocaleString()} {pair.incoming.currency}</p>
                          <p className="text-sm">{pair.incoming.account_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{pair.incoming.memo}</p>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          className={`flex-1 px-4 py-2 rounded text-sm font-medium ${
                            decision === "link"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                          onClick={() => {
                            const newDecisions = new Map(suspectedPairDecisions);
                            newDecisions.set(pair.id, "link");
                            setSuspectedPairDecisions(newDecisions);
                          }}
                        >
                          ✅ 내부 이체로 연결
                        </button>
                        <button
                          className={`flex-1 px-4 py-2 rounded text-sm font-medium ${
                            decision === "separate"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                          onClick={() => {
                            const newDecisions = new Map(suspectedPairDecisions);
                            newDecisions.set(pair.id, "separate");
                            setSuspectedPairDecisions(newDecisions);
                          }}
                        >
                          ❌ 별도 거래로 등록
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex gap-2 text-sm">
                  <button
                    className="px-3 py-1 rounded border hover:bg-gray-50"
                    onClick={() => {
                      const newDecisions = new Map<string, "link" | "separate">();
                      parseResult.suspectedPairs.forEach(pair => {
                        newDecisions.set(pair.id, "link");
                      });
                      setSuspectedPairDecisions(newDecisions);
                    }}
                  >
                    전체 연결
                  </button>
                  <button
                    className="px-3 py-1 rounded border hover:bg-gray-50"
                    onClick={() => {
                      const newDecisions = new Map<string, "link" | "separate">();
                      parseResult.suspectedPairs.forEach(pair => {
                        newDecisions.set(pair.id, "separate");
                      });
                      setSuspectedPairDecisions(newDecisions);
                    }}
                  >
                    전체 별도 등록
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 rounded border hover:bg-gray-50"
                    onClick={() => {
                      setShowSuspectedModal(false);
                      setSuspectedPairDecisions(new Map());
                    }}
                  >
                    취소
                  </button>
                  <button
                    className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={suspectedPairDecisions.size < parseResult.suspectedPairs.length || busy}
                    onClick={() => {
                      setSuspectedReviewDone(true);
                      setShowSuspectedModal(false);
                      // 결정만 저장하고 업로드는 하지 않음 (최종 업로드 버튼에서 처리)
                    }}
                  >
                    {busy ? "처리 중..." : `확인 (${suspectedPairDecisions.size}/${parseResult.suspectedPairs.length})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* DB 매칭 후보 확인 모달 */}
        {showDbMatchModal && dbMatches.length > 0 && parseResult && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded bg-white p-6 space-y-4">
              <h3 className="text-lg font-semibold">분산 업로드 매칭 발견</h3>
              <p className="text-sm text-gray-700">
                {dbMatches.length}건의 기존 거래와 내부 이체로 연결 가능한 항목을 발견했습니다. 
                각 항목을 확인하고 내부 이체로 연결할지 별도 거래로 등록할지 선택하세요.
              </p>
              
              <div className="space-y-3">
                {dbMatches.map((match) => {
                  const matchKey = `${match.existing_txn_id}-${match.new_item_index}`;
                  const decision = dbMatchDecisions.get(matchKey);
                  const newAt = match.new_item_occurred_at ?? (parseResult.items[match.new_item_index]?.occurred_at || "");
                  const newTm = match.new_item_occurred_time ?? (parseResult.items[match.new_item_index]?.occurred_time || "");
                  const newAmt = match.new_item_amount ?? (parseResult.items[match.new_item_index]?.amount || 0);
                  const newAcct = match.new_item_account_name ?? (parseResult.items[match.new_item_index]?.account_name || "");
                  const newCcy = match.new_item_currency ?? (parseResult.items[match.new_item_index]?.currency || "KRW");
                  return (
                    <div key={`${match.existing_txn_id}-${match.new_item_index}`} className="border rounded p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          match.confidence_level === "CERTAIN" ? "bg-green-100 text-green-800" :
                          match.confidence_level === "SUSPECTED" ? "bg-yellow-100 text-yellow-800" :
                          "bg-red-100 text-red-800"
                        }`}>
                          신뢰도 {match.confidence_score}점
                        </span>
                        <span className="text-xs text-gray-500">
                          DB 거래 #{match.existing_txn_id}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="border-r pr-4">
                          <p className="font-semibold text-gray-700 mb-2">새 항목 (업로드)</p>
                          <p className="text-xs text-gray-500">{newAt} {newTm}</p>
                          <p className={`text-lg font-medium ${newAmt < 0 ? "text-red-600" : "text-green-600"}`}>
                            {newAmt.toLocaleString()} {newCcy}
                          </p>
                          <p className="text-sm">{newAcct}</p>
                        </div>
                        
                        <div className="pl-4">
                          <p className="font-semibold text-gray-700 mb-2">기존 거래 (DB)</p>
                          <p className="text-xs text-gray-500">
                            {match.existing_txn_occurred_at} {match.existing_txn_occurred_time}
                          </p>
                          <p className={`text-lg font-medium ${match.existing_txn_amount < 0 ? "text-red-600" : "text-green-600"}`}>
                            {match.existing_txn_amount.toLocaleString()} KRW
                          </p>
                          <p className="text-sm">{match.existing_txn_account_name}</p>
                          <p className="text-xs text-gray-500 mt-1">{match.existing_txn_memo}</p>
                          <p className="text-xs text-blue-500 mt-1">유형: {match.existing_txn_type}</p>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          className={`flex-1 px-4 py-2 rounded text-sm font-medium ${
                            decision === "link"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                          onClick={() => {
                            const newDecisions = new Map(dbMatchDecisions);
                            newDecisions.set(matchKey, "link");
                            setDbMatchDecisions(newDecisions);
                          }}
                        >
                          ✅ 내부 이체로 연결
                        </button>
                        <button
                          className={`flex-1 px-4 py-2 rounded text-sm font-medium ${
                            decision === "separate"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                          onClick={() => {
                            const newDecisions = new Map(dbMatchDecisions);
                            newDecisions.set(matchKey, "separate");
                            setDbMatchDecisions(newDecisions);
                          }}
                        >
                          ❌ 별도 거래로 등록
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex gap-2 text-sm">
                  <button
                    className="px-3 py-1 rounded border hover:bg-gray-50"
                    onClick={() => {
                      const newDecisions = new Map<string, "link" | "separate">();
                      dbMatches.forEach(match => {
                        newDecisions.set(`${match.existing_txn_id}-${match.new_item_index}`, "link");
                      });
                      setDbMatchDecisions(newDecisions);
                    }}
                  >
                    전체 연결
                  </button>
                  <button
                    className="px-3 py-1 rounded border hover:bg-gray-50"
                    onClick={() => {
                      const newDecisions = new Map<string, "link" | "separate">();
                      dbMatches.forEach(match => {
                        newDecisions.set(`${match.existing_txn_id}-${match.new_item_index}`, "separate");
                      });
                      setDbMatchDecisions(newDecisions);
                    }}
                  >
                    전체 별도 등록
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 rounded border hover:bg-gray-50"
                    onClick={() => {
                      setShowDbMatchModal(false);
                      setDbMatchDecisions(new Map());
                    }}
                  >
                    취소
                  </button>
                  <button
                    className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={dbMatchDecisions.size < dbMatches.length || busy}
                    onClick={() => {
                      setDbMatchReviewDone(true);
                      setShowDbMatchModal(false);
                      // 결정만 저장하고 업로드는 하지 않음 (최종 업로드 버튼에서 처리)
                    }}
                  >
                    {busy ? "처리 중..." : `확인 (${dbMatchDecisions.size}/${dbMatches.length})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            disabled={busy}
          />
          <span>external_id가 같으면 기존 트랜잭션을 대체합니다.</span>
        </label>
        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-1" onClick={onClose} disabled={busy}>닫기</button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
            disabled={!canUpload}
            onClick={handleUpload}
          >
            {busy ? "업로드 중…" : "업로드"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Dev helper: generate N dummy transactions and POST to bulk API ---
async function generateDummyTransactions(n: number) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
  const now = Date.now();
  const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = <T,>(arr: T[]) => arr[rnd(0, arr.length - 1)];

  const accounts = ["현금", "은행", "체크카드", "저축계좌", "신용카드"];
  const groups = [
    { name: "식비", cats: ["아침", "점심", "저녁", "간식", "카페"] },
    { name: "교통", cats: ["지하철", "버스", "택시", "정기권"] },
    { name: "생활", cats: ["문구", "세제", "생활용품"] },
    { name: "주거", cats: ["관리비", "전기", "가스", "수도"] },
    { name: "여가", cats: ["영화", "도서", "게임"] },
    { name: "쇼핑", cats: ["의류", "잡화", "전자"] },
    { name: "의료", cats: ["약", "병원"] },
    { name: "급여", cats: ["월급", "상여"] },
    { name: "기타수입", cats: ["중고판매", "선물"] },
  ];
  const memos = ["테스트", "더미", "임시", "랜덤", "자동생성"];

  const items = Array.from({ length: n }).map((_, i) => {
    const typeRoll = Math.random();
    let type: "EXPENSE" | "INCOME" | "TRANSFER";
    if (typeRoll < 0.6) type = "EXPENSE"; else if (typeRoll < 0.9) type = "INCOME"; else type = "TRANSFER";
    const dayOffset = rnd(0, 29);
    const d = new Date(now - dayOffset * 24 * 3600 * 1000);
    const occurred_at = d.toISOString().slice(0, 10);
    const amount = type === "TRANSFER" ? rnd(50000, 500000) : rnd(3000, 120000);
    const account_name = pick(accounts);
    const memo = `${pick(memos)} ${i+1}`;
    const external_id = `dummy-${now}-${i}`;

    if (type === "TRANSFER") {
      let counter = pick(accounts);
      if (counter === account_name) counter = pick(accounts);
      return { user_id: 1, occurred_at, type, amount, currency: "KRW", account_name, counter_account_name: counter, memo, external_id };
    } else {
      const g = pick(groups);
      const c = pick(g.cats);
      return { user_id: 1, occurred_at, type, amount, currency: "KRW", account_name, category_group_name: g.name, category_name: c, memo, external_id };
    }
  });

  const res = await fetch(new URL('/api/transactions/bulk', base).toString(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 1, override: false, items })
  });
  if (!res.ok) throw new Error(await res.text());
}

function TxnSidePane({
  txn,
  categories,
  accounts,
  onEdit,
  onDelete,
  onToggleExclude,
  toggling,
  notice,
  onClose,
  deleting,
  onRefresh,
}: {
  txn: Txn;
  categories: Category[];
  accounts: Account[];
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onToggleExclude: (nextValue: boolean) => void;
  toggling: boolean;
  notice: ToggleNotice | null;
  onClose: () => void;
  deleting: boolean;
  onRefresh: () => void;
}) {
  // Recurring rule attach state
  const [rules, setRules] = useState<Array<{ id: number; name: string; type: Txn["type"]; account_id: number; currency: string; is_active: boolean }>>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<number | "">("");
  const [attachBusy, setAttachBusy] = useState(false);
  useEffect(() => {
    let ignore = false;
    setRulesLoading(true);
    setRulesError(null);
    (async () => {
      try {
        const list = await listRecurringRules(txn.user_id);
        if (ignore) return;
        // minimal fields used in this panel; listRecurringRules returns more but we only access subset
        setRules(list as any);
      } catch (e: any) {
        if (!ignore) setRulesError(e?.message || String(e));
      } finally {
        if (!ignore) setRulesLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [txn.user_id]);

  const eligibleRules = useMemo(() => {
    const kind: "INCOME" | "EXPENSE" = txn.amount >= 0 ? "INCOME" : "EXPENSE";
    return rules.filter((r) => {
      // Only active rules, same type and currency, and same account for primary direction
      return (
        (r as any).is_active !== false &&
        (r as any).type === kind &&
        (r as any).currency?.toUpperCase() === txn.currency.toUpperCase() &&
        (r as any).account_id === txn.account_id
      );
    });
  }, [rules, txn]);

  const handleAttachToRule = async () => {
    if (!selectedRuleId || attachBusy) return;
    setAttachBusy(true);
    try {
      const res = await attachTransactionsToRule(Number(selectedRuleId), txn.user_id, [txn.id]);
      const attached = Array.isArray(res.attached) ? res.attached.length : 0;
      const errors = Array.isArray(res.errors) ? res.errors.length : 0;
      if (attached > 0 || errors > 0) {
        window.alert(`규칙에 편입 ${attached}건${errors ? `, 실패 ${errors}건` : ""}`);
      }
      if (attached > 0) {
        onRefresh();
      }
    } catch (e: any) {
      window.alert(e?.message || String(e));
    } finally {
      setAttachBusy(false);
    }
  };
  const categoryText = (id?: number | null) => {
    if (!id) return "-";
    const c = categories.find(c => c.id === id);
    return c ? `${c.full_code} ${c.name}` : String(id);
  };
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const resolveAccount = (id?: number | null) => {
    if (!id) return null;
    const acc = accountMap.get(id);
    return acc ? acc.name : `계정 ${id}`;
  };
  const amountAbs = Math.abs(txn.amount);
  const isTransfer = txn.type === "TRANSFER";
  const isAuto = txn.is_auto_transfer_match;
  const primaryAccountName = resolveAccount(txn.account_id);
  const counterAccountName = resolveAccount(txn.counter_account_id ?? undefined);
  const excludeHelpText = isTransfer
    ? "이체 시 계좌 잔액과 달력 요약 계산에서 제외합니다. 장부에는 계속 남습니다."
    : "해당 거래를 계좌 잔액과 달력 요약 계산에서 제외합니다. 장부에는 계속 남습니다.";
  return (
    <div className="min-h-[240px] rounded border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-lg font-semibold">상세 정보</h3>
        <button className="rounded border px-3 py-1 text-sm" onClick={onClose}>닫기</button>
      </div>
      <div className="space-y-2 text-sm">
        {isAuto && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
              자동 매칭된 이체
            </div>
            {isTransfer && (
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>{primaryAccountName ?? "출금 계정"}</span>
                  <span className="font-medium text-red-700">-{amountAbs.toLocaleString()} {txn.currency}</span>
                </div>
                {counterAccountName && (
                  <div className="flex justify-between">
                    <span>{counterAccountName}</span>
                    <span className="font-medium text-green-700">+{amountAbs.toLocaleString()} {txn.currency}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-between"><span className="text-gray-600">ID</span><span>{txn.id}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">사용자 ID</span><span>{txn.user_id}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">날짜</span><span>{txn.occurred_at}</span></div>
        {txn.occurred_time && (
          <div className="flex justify-between"><span className="text-gray-600">시간</span><span>{txn.occurred_time.slice(0,5)}</span></div>
        )}
        <div className="flex justify-between"><span className="text-gray-600">유형</span><span>{txn.type}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">금액</span><span>{txn.amount.toLocaleString()} {txn.currency}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">계정</span><span>{primaryAccountName ?? txn.account_id}</span></div>
        {txn.counter_account_id != null && (
          <div className="flex justify-between"><span className="text-gray-600">상대 계정</span><span>{counterAccountName ?? txn.counter_account_id}</span></div>
        )}
        {isTransfer && (
          <div className="flex justify-between"><span className="text-gray-600">이체 방향</span><span>{txn.amount < 0 ? `${primaryAccountName ?? "출금"} → ${counterAccountName ?? "입금"}` : `${counterAccountName ?? "출금"} → ${primaryAccountName ?? "입금"}`}</span></div>
        )}
        <div className="flex justify-between"><span className="text-gray-600">카테고리</span><span>{categoryText(txn.category_id)}</span></div>
        {txn.group_id != null && <div className="flex justify-between"><span className="text-gray-600">이체 그룹 ID</span><span>{txn.group_id}</span></div>}
        {txn.payee_id != null && <div className="flex justify-between"><span className="text-gray-600">거래처 ID</span><span>{txn.payee_id}</span></div>}
        {txn.external_id && <div className="flex justify-between"><span className="text-gray-600">외부 ID</span><span className="font-mono">{txn.external_id}</span></div>}
        {isAuto && (
          <div className="flex justify-between"><span className="text-gray-600">자동 매칭 여부</span><span>예</span></div>
        )}
        <div className="flex justify-between"><span className="text-gray-600">잔액·달력 제외</span><span>{txn.exclude_from_reports ? "예" : "아니요"}</span></div>
        {txn.memo && <div><div className="text-gray-600">메모</div><div className="whitespace-pre-wrap">{txn.memo}</div></div>}
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={txn.exclude_from_reports}
              onChange={(e) => onToggleExclude(e.target.checked)}
              disabled={toggling}
            />
            <span>
              <span className="font-medium text-gray-800">잔액·캘린더에서 제외</span>
              <p className="mt-1 text-xs text-gray-500">{excludeHelpText}</p>
            </span>
          </label>
          {notice && (
            <p className={`mt-2 text-xs ${notice.type === "error" ? "text-red-600" : "text-green-600"}`}>
              {notice.message}
            </p>
          )}
          {toggling && <p className="mt-1 text-xs text-gray-500">저장 중…</p>}
        </div>
        <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-blue-800">정기규칙에 포함하기</h4>
            {rulesLoading && <span className="text-xs text-blue-700">불러오는 중…</span>}
          </div>
          <p className="mb-2 text-xs text-blue-800/80">현재 거래를 선택한 정기 규칙의 발생 내역으로 연결합니다.</p>
          {rulesError ? (
            <p className="text-xs text-red-600">{rulesError}</p>
          ) : eligibleRules.length === 0 ? (
            <p className="text-xs text-blue-800/80">조건에 맞는 활성 규칙이 없습니다. 규칙의 유형/계정/통화를 확인하세요.</p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                className="flex-1 rounded border px-2 py-1 text-sm"
                value={selectedRuleId}
                onChange={(e) => setSelectedRuleId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">규칙 선택</option>
                {eligibleRules.map((r) => (
                  <option key={r.id} value={r.id}>{(r as any).name}</option>
                ))}
              </select>
              <button className="rounded border px-3 py-1 text-sm disabled:opacity-50" disabled={!selectedRuleId || attachBusy} onClick={handleAttachToRule}>포함</button>
            </div>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onEdit} disabled={deleting}>수정</button>
          <button className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50" disabled={deleting} onClick={onDelete}>삭제</button>
        </div>
      </div>
    </div>
  );
}
