"use client";

import clsx from "clsx";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek, subMonths, subWeeks } from "date-fns";
import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { StickyAside } from "@/components/layout/StickyAside";

import { fetchAccounts, type AccountRecord } from "@/lib/accounts";
import { composeCalendarSnapshot, extractRecurringRuleId, useCalendarData } from "@/lib/calendar/data";
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "@/lib/calendar/events";
import { fetchCategories, type Category } from "@/lib/categories";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { MemberSelector } from "@/components/MemberSelector";
const MEMBER_COLORS = ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#dc2626", "#0ea5e9"]; // blue, green, amber, pink, violet, red, sky
import type {
  CalendarDayBucket,
  CalendarEvent,
  CalendarEventType,
  CalendarSnapshot,
  CalendarTransaction,
} from "@/lib/calendar/types";

type CalendarView = "month" | "week" | "day";
type CalendarFilters = { accounts: number[]; categories: number[] };
type FilterOption = { id: number; label: string };
type EventFormState = {
  id?: number;
  date: string;
  type: CalendarEventType;
  title: string;
  description: string;
  color: string;
};

const USER_ID = 1;
const EVENT_TYPE_OPTIONS: { value: CalendarEventType; label: string }[] = [
  { value: "memo", label: "메모" },
  { value: "anniversary", label: "기념일" },
  { value: "reminder", label: "리마인더" },
];

const EVENT_COLOR_SWATCHES = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#2dd4bf",
  "#60a5fa",
  "#a855f7",
  "#f472b6",
  "#94a3b8",
];

const serializeDate = (value: Date) => value.toISOString();
const deserializeDate = (value: string): Date => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

function getRange(view: CalendarView, cursor: Date) {
  if (view === "month") {
    const monthStart = startOfMonth(cursor);
    return {
      start: format(startOfWeek(monthStart, { weekStartsOn: 0 }), "yyyy-MM-dd"),
      end: format(startOfDay(addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }), 1)), "yyyy-MM-dd"),
    };
  }
  if (view === "week") {
    const weekStart = startOfWeek(cursor, { weekStartsOn: 0 });
    return {
      start: format(weekStart, "yyyy-MM-dd"),
      end: format(addDays(endOfWeek(cursor, { weekStartsOn: 0 }), 1), "yyyy-MM-dd"),
    };
  }
  // day view
  return {
    start: format(cursor, "yyyy-MM-dd"),
    end: format(addDays(cursor, 1), "yyyy-MM-dd"),
  };
}

function ensureBucket(snapshot: CalendarSnapshot, dateKey: string): CalendarDayBucket {
  return (
    snapshot.byDate[dateKey] ?? {
      date: dateKey,
      transactions: [],
      recurring: [],
      events: [],
      holidays: [],
      totals: { income: 0, expense: 0, net: 0, transferIn: 0, transferOut: 0 },
    }
  );
}

function buildMonthGrid(snapshot: CalendarSnapshot, cursor: Date) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const rows: CalendarDayBucket[][] = [];
  let currentRow: CalendarDayBucket[] = [];
  for (const day of days) {
    const dateKey = format(day, "yyyy-MM-dd");
    const bucket = ensureBucket(snapshot, dateKey);
    currentRow.push(bucket);
    if (currentRow.length === 7) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    while (currentRow.length < 7) {
      currentRow.push({
        date: "",
        transactions: [],
        recurring: [],
        events: [],
        holidays: [],
        totals: { income: 0, expense: 0, net: 0, transferIn: 0, transferOut: 0 },
      });
    }
    rows.push(currentRow);
  }
  return rows;
}

function filterSnapshot(snapshot: CalendarSnapshot, filters: CalendarFilters): CalendarSnapshot {
  const { accounts, categories } = filters;
  const accountSet = new Set(accounts);
  const categorySet = new Set(categories);
  const hasAccountFilter = accountSet.size > 0;
  const hasCategoryFilter = categorySet.size > 0;
  if (!hasAccountFilter && !hasCategoryFilter) {
    return snapshot;
  }

  const transactions = snapshot.transactions.filter((txn) => {
    if (hasAccountFilter) {
      const matchesAccount = accountSet.has(txn.account_id) || (txn.counter_account_id ? accountSet.has(txn.counter_account_id) : false);
      if (!matchesAccount) return false;
    }
    if (hasCategoryFilter) {
      if (!txn.category_id || !categorySet.has(txn.category_id)) return false;
    }
    return true;
  });

  const recurringOccurrences = snapshot.recurringOccurrences.filter((occurrence) => {
    if (hasAccountFilter) {
      const matchesAccount = accountSet.has(occurrence.accountId) || (occurrence.counterAccountId ? accountSet.has(occurrence.counterAccountId) : false);
      if (!matchesAccount) return false;
    }
    if (hasCategoryFilter) {
      if (!occurrence.categoryId || !categorySet.has(occurrence.categoryId)) return false;
    }
    return true;
  });

  return composeCalendarSnapshot(
    { userId: USER_ID, start: snapshot.range.start, end: snapshot.range.end },
    transactions,
    recurringOccurrences,
    snapshot.events,
    snapshot.holidays
  );
}

export default function CalendarPage() {
  const router = useRouter();
  const [view, setView] = usePersistentState<CalendarView>("pfm:calendar:view:v1", "month");
  const [cursor, setCursor] = usePersistentState<Date>(
    "pfm:calendar:cursor:v1",
    () => new Date(),
    { serialize: serializeDate, deserialize: deserializeDate }
  );
  const [selectedDate, setSelectedDate] = usePersistentState<Date>(
    "pfm:calendar:selected-date:v1",
    () => new Date(),
    { serialize: serializeDate, deserialize: deserializeDate }
  );
  const [filters, setFilters] = usePersistentState<CalendarFilters>(
    "pfm:calendar:filters:v1",
    () => ({ accounts: [], categories: [] })
  );
  const [accountOptions, setAccountOptions] = useState<AccountRecord[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<Category[]>([]);
  const [metaStatus, setMetaStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [eventMode, setEventMode] = useState<"create" | "edit">("create");
  const [eventDraft, setEventDraft] = useState<EventFormState>(() => ({
    date: format(new Date(), "yyyy-MM-dd"),
    type: "memo",
    title: "",
    description: "",
    color: "",
  }));
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [eventDeletingId, setEventDeletingId] = useState<number | null>(null);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);

  const [memberIds, setMemberIds] = usePersistentState<number[]>("pfm:members:selection:v1", [USER_ID]);

  useEffect(() => {
    let ignore = false;
    setMetaStatus("loading");
    setMetaError(null);
    Promise.all([
      // 다중 멤버 지원: accounts/categories에 반복 user_id 사용
      (async () => {
        const users = (memberIds && memberIds.length > 0) ? memberIds : [USER_ID];
        // fetchAccounts는 현재 단일 user_id 시그니처이므로 반복 호출 후 합치기
        const lists = await Promise.all(users.map((id) => fetchAccounts({ user_id: id, include_archived: true })));
        // 중복 계정(id 기준) 제거
        const map = new Map<number, AccountRecord>();
        for (const list of lists) for (const acc of list) map.set(acc.id, acc);
        return Array.from(map.values());
      })(),
      (async () => {
        const users = (memberIds && memberIds.length > 0) ? memberIds : [USER_ID];
        const lists = await Promise.all(users.map((id) => fetchCategories({ user_id: id, page: 1, page_size: 500 })));
        const seen = new Set<number>();
        const merged: Category[] = [];
        for (const list of lists) {
          for (const c of list) {
            if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
          }
        }
        return merged;
      })(),
    ])
      .then(([accounts, categories]) => {
        if (ignore) return;
        setAccountOptions(accounts);
        setCategoryOptions(categories);
        setMetaStatus("success");
      })
      .catch((err) => {
        if (ignore) return;
        setMetaError(err instanceof Error ? err.message : String(err));
        setMetaStatus("error");
      });
    return () => {
      ignore = true;
    };
  }, [memberIds]);

  const range = useMemo(() => getRange(view, cursor), [view, cursor]);
  // 다중 멤버 트랜잭션/반복/이벤트 스냅샷: 현재 훅은 단일 user 지원이므로 멤버별로 호출 후 합산
  const usersForData = useMemo(() => (memberIds && memberIds.length > 0 ? memberIds : [USER_ID]), [memberIds]);
  const singleUserData = useCalendarData({ userId: usersForData[0], start: range.start, end: range.end });
  const [combined, setCombined] = useState<{ status: typeof singleUserData.status; data?: typeof singleUserData.data; error?: typeof singleUserData.error }>(() => ({ status: "loading" }));
  useEffect(() => {
    let cancel = false;
    (async () => {
      // 1) 첫 사용자 데이터는 훅 상태로부터 취득
      if (usersForData.length === 1) {
        setCombined({ status: singleUserData.status, data: singleUserData.data, error: singleUserData.error });
        return;
      }
      // 2) 나머지 사용자 스냅샷은 직접 호출해 합치기
      if (singleUserData.status !== "success") {
        setCombined({ status: singleUserData.status, data: singleUserData.data, error: singleUserData.error });
        return;
      }
      try {
        const base = singleUserData.data!;
        const snapshots = await Promise.all(
          usersForData.slice(1).map((uid) => import("@/lib/calendar/data").then(m => m.fetchCalendarSnapshot({ userId: uid, start: range.start, end: range.end })))
        );
        if (cancel) return;
        const merged = snapshots.reduce((acc, snap) => {
          return composeCalendarSnapshot(
            { userId: USER_ID, start: range.start, end: range.end },
            [...acc.transactions, ...snap.transactions],
            [...acc.recurringOccurrences, ...snap.recurringOccurrences],
            [...acc.events, ...snap.events],
            [...acc.holidays, ...snap.holidays]
          );
        }, base);
        setCombined({ status: "success", data: merged });
      } catch (e) {
        if (cancel) return;
        setCombined({ status: "error", error: e instanceof Error ? e : new Error(String(e)) });
      }
    })();
    return () => { cancel = true; };
  }, [usersForData, range.start, range.end, singleUserData.status, singleUserData.data, singleUserData.error]);

  const status = combined.status;
  const data = combined.data;
  const error = combined.error;
  const refresh = singleUserData.refresh;
  const baseSnapshot = status === "success" ? data : undefined;

  const accountChoices = useMemo<FilterOption[]>(() => {
    if (accountOptions.length > 0) {
      return [...accountOptions]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((account) => ({ id: account.id, label: `${account.name}${account.is_archived ? " (보관)" : ""}` }));
    }
    if (!baseSnapshot) return [];
    const map = new Map<number, string>();
    for (const tx of baseSnapshot.transactions) {
      if (!map.has(tx.account_id)) {
        map.set(tx.account_id, `계좌 #${tx.account_id}`);
      }
      if (tx.counter_account_id && !map.has(tx.counter_account_id)) {
        map.set(tx.counter_account_id, `계좌 #${tx.counter_account_id}`);
      }
    }
    for (const occurrence of baseSnapshot.recurringOccurrences) {
      if (!map.has(occurrence.accountId)) {
        map.set(occurrence.accountId, `계좌 #${occurrence.accountId}`);
      }
      if (occurrence.counterAccountId && !map.has(occurrence.counterAccountId)) {
        map.set(occurrence.counterAccountId, `계좌 #${occurrence.counterAccountId}`);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [accountOptions, baseSnapshot]);

  const categoryChoices = useMemo<FilterOption[]>(() => {
    if (categoryOptions.length > 0) {
      return [...categoryOptions]
        .sort((a, b) => a.full_code.localeCompare(b.full_code))
        .map((category) => ({ id: category.id, label: `${category.full_code} ${category.name}` }));
    }
    if (!baseSnapshot) return [];
    const map = new Map<number, string>();
    for (const tx of baseSnapshot.transactions) {
      if (tx.category_id && !map.has(tx.category_id)) {
        map.set(tx.category_id, `카테고리 #${tx.category_id}`);
      }
    }
    for (const occurrence of baseSnapshot.recurringOccurrences) {
      if (occurrence.categoryId && !map.has(occurrence.categoryId)) {
        map.set(occurrence.categoryId, `카테고리 #${occurrence.categoryId}`);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [categoryOptions, baseSnapshot]);

  // 멤버 라벨/색상 매핑 준비
  const memberIdList = useMemo(() => (memberIds && memberIds.length > 0 ? memberIds : [USER_ID]), [memberIds]);
  const memberColorMap = useMemo(() => {
    const map = new Map<number, string>();
    memberIdList.forEach((id, idx) => map.set(id, MEMBER_COLORS[idx % MEMBER_COLORS.length]));
    return map;
  }, [memberIdList]);
  const memberInitial = (id: number) => `M${id}`;

  const activeSnapshot = useMemo(() => {
    if (!baseSnapshot) return undefined;
    if (filters.accounts.length === 0 && filters.categories.length === 0) {
      return baseSnapshot;
    }
    return filterSnapshot(baseSnapshot, filters);
  }, [baseSnapshot, filters]);

  const monthGrid = useMemo(() => (activeSnapshot ? buildMonthGrid(activeSnapshot, cursor) : []), [activeSnapshot, cursor]);
  const weekBuckets = useMemo(() => {
    if (!activeSnapshot) return [];
    const weekStart = startOfWeek(cursor, { weekStartsOn: 0 });
    const weekEnd = addDays(weekStart, 6);
    return eachDayOfInterval({ start: weekStart, end: weekEnd }).map((day) => ensureBucket(activeSnapshot, format(day, "yyyy-MM-dd")));
  }, [activeSnapshot, cursor]);
  const selectedKey = useMemo(() => format(selectedDate, "yyyy-MM-dd"), [selectedDate]);
  const resetEventForm = useCallback(() => {
    setEventMode("create");
    setEventDraft({
      id: undefined,
      date: selectedKey,
      type: "memo",
      title: "",
      description: "",
      color: "",
    });
    setEventError(null);
  }, [selectedKey]);
  const selectedBucket = useMemo(() => {
    if (!activeSnapshot) return undefined;
    return ensureBucket(activeSnapshot, selectedKey);
  }, [activeSnapshot, selectedKey]);

  const navigateToTransactions = useCallback(
    (targetDate: Date, focusTxnId?: number) => {
      const dateKey = format(targetDate, "yyyy-MM-dd");
      const params = new URLSearchParams();
      params.set("start", dateKey);
      params.set("end", dateKey);
      if (typeof focusTxnId === "number") {
        params.set("focusTxn", String(focusTxnId));
      }
      router.push(`/transactions?${params.toString()}`);
    },
    [router]
  );

  const handleViewTransactions = useCallback(
    (date: Date) => {
      navigateToTransactions(date);
    },
    [navigateToTransactions]
  );

  const handleInspectTransaction = useCallback(
    (txn: CalendarTransaction, date: Date) => {
      if (typeof window !== "undefined") {
        const confirmed = window.confirm("해당 거래 편집 화면으로 이동할까요? 기존 작업은 저장되지 않을 수 있습니다.");
        if (!confirmed) {
          return;
        }
      }
      navigateToTransactions(date, txn.id);
    },
    [navigateToTransactions]
  );

  useEffect(() => {
    resetEventForm();
    setEventMessage(null);
  }, [resetEventForm]);

  const updateEventDraft = useCallback((patch: Partial<EventFormState>) => {
    setEventDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const editingEventId = eventMode === "edit" ? eventDraft.id ?? null : null;

  const handleEditEvent = useCallback((event: CalendarEvent) => {
    setEventMode("edit");
    setEventDraft({
      id: event.id,
      date: event.date,
      type: event.type,
      title: event.title,
      description: event.description ?? "",
      color: event.color ?? "",
    });
    setEventError(null);
    setEventMessage(null);
  }, []);

  const handleDeleteEvent = useCallback(
    async (event: CalendarEvent) => {
      if (typeof window !== "undefined") {
        const confirmed = window.confirm(`'${event.title}' 일정을 삭제할까요?`);
        if (!confirmed) return;
      }
      try {
        setEventDeletingId(event.id);
        setEventError(null);
        setEventMessage(null);
        const activeUserId = (memberIds && memberIds.length > 0) ? memberIds[0] : USER_ID;
        await deleteCalendarEvent(activeUserId, event.id);
        if (editingEventId === event.id) {
          resetEventForm();
        }
        setEventMessage("메모를 삭제했습니다.");
        refresh();
      } catch (err) {
        setEventError(err instanceof Error ? err.message : String(err));
      } finally {
        setEventDeletingId(null);
      }
    },
    [editingEventId, refresh, resetEventForm, memberIds]
  );

  const handleEventSubmit = useCallback(async () => {
    if (!eventDraft.title.trim()) {
      setEventError("제목을 입력해주세요.");
      return;
    }
    const trimmedDescription = eventDraft.description.trim();
    const trimmedColor = eventDraft.color.trim();
    const sanitizedColor = trimmedColor ? trimmedColor.toLowerCase() : null;
    setEventSubmitting(true);
    setEventError(null);
    setEventMessage(null);
    try {
      const activeUserId = (memberIds && memberIds.length > 0) ? memberIds[0] : USER_ID;
      if (eventMode === "edit" && eventDraft.id) {
        await updateCalendarEvent({
          id: eventDraft.id,
          userId: activeUserId,
          date: eventDraft.date,
          type: eventDraft.type,
          title: eventDraft.title.trim(),
          description: trimmedDescription ? trimmedDescription : null,
          color: sanitizedColor,
        });
        setEventMessage("메모를 수정했습니다.");
      } else {
        await createCalendarEvent({
          userId: activeUserId,
          date: eventDraft.date,
          type: eventDraft.type,
          title: eventDraft.title.trim(),
          description: trimmedDescription ? trimmedDescription : null,
          color: sanitizedColor,
        });
        setEventMessage("메모를 추가했습니다.");
      }
      refresh();
      resetEventForm();
    } catch (err) {
      setEventError(err instanceof Error ? err.message : String(err));
    } finally {
      setEventSubmitting(false);
    }
  }, [eventDraft, eventMode, refresh, resetEventForm, memberIds]);

  useEffect(() => {
    setSelectedDate(cursor);
  }, [cursor, setSelectedDate]);

  const filtersActive = filters.accounts.length > 0 || filters.categories.length > 0;

  const toggleAccountFilter = (id: number) => {
    setFilters((prev) => {
      const exists = prev.accounts.includes(id);
      const accounts = exists ? prev.accounts.filter((value) => value !== id) : [...prev.accounts, id];
      return { ...prev, accounts };
    });
  };

  const toggleCategoryFilter = (id: number) => {
    setFilters((prev) => {
      const exists = prev.categories.includes(id);
      const categories = exists ? prev.categories.filter((value) => value !== id) : [...prev.categories, id];
      return { ...prev, categories };
    });
  };

  const resetFilters = () => {
    setFilters({ accounts: [], categories: [] });
  };

  const changeView = (next: CalendarView) => {
    setView(next);
    if (next === "week" || next === "day") {
      setCursor(new Date(selectedDate));
    }
  };

  const handleSelectDate = (value: Date) => {
    setSelectedDate(value);
    setCursor(new Date(value));
  };

  const title = useMemo(() => {
    if (view === "month") return format(cursor, "yyyy년 MM월");
    if (view === "week") {
      const weekStart = startOfWeek(cursor, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(cursor, { weekStartsOn: 0 });
      return `${format(weekStart, "yyyy.MM.dd")} ~ ${format(weekEnd, "MM.dd")}`;
    }
    return format(cursor, "yyyy년 MM월 dd일");
  }, [view, cursor]);

  const goToday = () => setCursor(new Date());
  const goPrev = () => {
    setCursor((prev) => {
      if (view === "month") return subMonths(prev, 1);
      if (view === "week") return subWeeks(prev, 1);
      return addDays(prev, -1);
    });
  };
  const goNext = () => {
    setCursor((prev) => {
      if (view === "month") return addMonths(prev, 1);
      if (view === "week") return addWeeks(prev, 1);
      return addDays(prev, 1);
    });
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <MemberSelector value={memberIds} onChange={setMemberIds} />
      {/* 멤버 색상 범례 */}
      <div className="hidden items-center gap-1 sm:flex">
        {memberIdList.map((id) => {
          const tone = memberColorMap.get(id) || "#4b5563";
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tone}1A`, color: tone }}>
              {`M${id}`}
            </span>
          );
        })}
      </div>
      <div className="inline-flex rounded border bg-white text-sm shadow-sm">
        {(["month", "week", "day"] as CalendarView[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => changeView(item)}
            className={`px-3 py-1 capitalize ${view === item ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="inline-flex items-center gap-2 rounded border bg-white px-2 py-1 text-sm shadow-sm">
        <button type="button" onClick={goPrev} className="px-2 py-1 text-gray-600 hover:text-gray-900">이전</button>
        <span className="text-gray-900 font-medium">{title}</span>
        <button type="button" onClick={goNext} className="px-2 py-1 text-gray-600 hover:text-gray-900">다음</button>
        <button type="button" onClick={goToday} className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50">
          오늘
        </button>
      </div>
      <button type="button" onClick={refresh} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-100">
        새로고침
      </button>
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Calendar"
        subtitle="거래와 정기 규칙을 달력 형태로 탐색합니다."
        actions={headerActions}
      />

      {status === "loading" && (
        <SectionCard tone="muted">
          <p className="text-sm text-gray-500">불러오는 중…</p>
        </SectionCard>
      )}
      {status === "error" && (
        <SectionCard tone="muted">
          <p className="text-sm text-red-600">데이터를 불러오지 못했습니다: {error?.message}</p>
        </SectionCard>
      )}
      {status === "success" && activeSnapshot && (
        <>
          <SectionCard title="기간 요약" description="선택된 기간의 데이터 통계를 확인하세요.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="text-xs text-gray-500">기간</div>
                <div className="mt-1 font-medium text-gray-800">
                  {activeSnapshot.range.start} ~ {activeSnapshot.range.end}
                </div>
              </div>
              <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="text-xs text-gray-500">트랜잭션</div>
                <div className="mt-1 font-medium text-gray-800">{activeSnapshot.transactions.length.toLocaleString()}건</div>
              </div>
              <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="text-xs text-gray-500">정기 규칙 일정</div>
                <div className="mt-1 font-medium text-gray-800">{activeSnapshot.recurringOccurrences.length.toLocaleString()}건</div>
              </div>
            </div>
          </SectionCard>

          <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,2.5fr)_minmax(360px,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
            <div className="space-y-6">
              {filtersActive && (
                <SectionCard tone="brand">
                  <p className="text-sm text-indigo-700">
                    필터 적용 중 — {activeSnapshot.transactions.length.toLocaleString()}건의 거래가 표시됩니다.
                  </p>
                </SectionCard>
              )}

              <SectionCard>
                {view === "month" && (
                  <MonthGrid grid={monthGrid} referenceDate={cursor} selectedKey={selectedKey} onSelectDate={handleSelectDate} />
                )}
                {view === "week" && (
                  <WeekView
                    days={weekBuckets}
                    selectedKey={selectedKey}
                    onSelectDate={handleSelectDate}
                  />
                )}
                {view === "day" && selectedBucket && (
                  <DayOverview bucket={selectedBucket} date={selectedDate} />
                )}
              </SectionCard>
            </div>

            <StickyAside
              className="static lg:sticky overflow-visible border-transparent bg-transparent p-0 shadow-none"
              offset={104}
            >
              <div className="space-y-4">
                <FilterControls
                  accounts={accountChoices}
                  categories={categoryChoices}
                  filters={filters}
                  onToggleAccount={toggleAccountFilter}
                  onToggleCategory={toggleCategoryFilter}
                  onClear={resetFilters}
                  status={metaStatus}
                  error={metaError}
                />
                {selectedBucket ? (
                  <DayDetail
                    bucket={selectedBucket}
                    date={selectedDate}
                    variant="full"
                    onEditEvent={handleEditEvent}
                    onDeleteEvent={handleDeleteEvent}
                    editingEventId={editingEventId}
                    deletingEventId={eventDeletingId}
                    onViewTransactions={handleViewTransactions}
                    onInspectTransaction={(txn) => handleInspectTransaction(txn, selectedDate)}
                    memberColorMap={memberColorMap}
                    memberInitial={memberInitial}
                    baseSnapshot={baseSnapshot}
                  />
                ) : (
                  <SectionCard tone="muted">
                    <p className="text-sm text-gray-500 text-center">날짜를 선택하면 상세 정보를 확인할 수 있습니다.</p>
                  </SectionCard>
                )}
                <EventEditor
                  mode={eventMode}
                  draft={eventDraft}
                  onDraftChange={updateEventDraft}
                  onSubmit={handleEventSubmit}
                  submitting={eventSubmitting}
                  onCancel={resetEventForm}
                  error={eventError}
                  message={eventMessage}
                />
              </div>
            </StickyAside>
          </div>
        </>
      )}
    </div>
  );
}

function FilterControls({
  accounts,
  categories,
  filters,
  onToggleAccount,
  onToggleCategory,
  onClear,
  status,
  error,
}: {
  accounts: FilterOption[];
  categories: FilterOption[];
  filters: CalendarFilters;
  onToggleAccount: (id: number) => void;
  onToggleCategory: (id: number) => void;
  onClear: () => void;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
}) {
  const hasFilters = filters.accounts.length > 0 || filters.categories.length > 0;
  return (
    <SectionCard
      title="필터"
      description="계좌와 카테고리로 표시할 거래를 선택하세요."
      headerAction={
        <button
          type="button"
          onClick={onClear}
          disabled={!hasFilters}
          className={`rounded border px-2 py-1 text-xs ${hasFilters ? "border-indigo-300 text-indigo-600 hover:bg-indigo-100" : "border-gray-200 text-gray-400"}`}
        >
          초기화
        </button>
      }
    >
      {status === "loading" && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {error && <p className="text-xs text-red-600">로드 실패: {error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <FilterList label="계좌" items={accounts} selected={filters.accounts} onToggle={onToggleAccount} disabled={status === "loading" && accounts.length === 0} />
        <FilterList label="카테고리" items={categories} selected={filters.categories} onToggle={onToggleCategory} disabled={status === "loading" && categories.length === 0} />
      </div>
    </SectionCard>
  );
}

function FilterList({ label, items, selected, onToggle, disabled }: { label: string; items: FilterOption[]; selected: number[]; onToggle: (id: number) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded border border-gray-200 bg-white p-2">
        {items.length === 0 ? (
          <p className="text-[11px] text-gray-400">{disabled ? "불러오는 중" : "사용 가능한 항목이 없습니다."}</p>
        ) : (
          items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <label key={item.id} className="flex cursor-pointer items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-gray-300"
                  checked={checked}
                  onChange={() => onToggle(item.id)}
                  disabled={disabled}
                />
                <span className={checked ? "font-semibold text-gray-900" : undefined}>{item.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

function MonthGrid({ grid, referenceDate, selectedKey, onSelectDate }: { grid: CalendarDayBucket[][]; referenceDate: Date; selectedKey: string; onSelectDate: (date: Date) => void }) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-px text-center text-xs uppercase text-gray-500">
        {weekdays.map((weekday) => (
          <div key={weekday} className="py-2 font-semibold tracking-wide">{weekday}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px rounded border border-gray-200 bg-gray-200">
        {grid.map((row, rowIndex) => (
          <Fragment key={rowIndex}>
            {row.map((bucket) => (
              <MonthCell key={`${bucket.date}-${rowIndex}`} bucket={bucket} referenceDate={referenceDate} selectedKey={selectedKey} onSelectDate={onSelectDate} />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function MonthCell({ bucket, referenceDate, selectedKey, onSelectDate }: { bucket: CalendarDayBucket; referenceDate: Date; selectedKey: string; onSelectDate: (date: Date) => void }) {
  if (!bucket.date) {
    return <div className="h-32 bg-white" />;
  }
  const cellDate = new Date(bucket.date);
  const outsideCurrentMonth = !isSameMonth(cellDate, referenceDate);
  const today = isToday(cellDate);
  const hasHolidays = bucket.holidays.length > 0;
  const dayClass = outsideCurrentMonth
    ? "text-gray-300"
    : hasHolidays
      ? "text-rose-600"
      : today
        ? "text-indigo-600"
        : "text-gray-900";
  const totals = bucket.totals;
  const hasRecurring = bucket.recurring.length > 0;
  const hasEvents = bucket.events.length > 0;
  const hasTransactions = bucket.transactions.length > 0;
  const isSelected = bucket.date === selectedKey;
  return (
    <button
      type="button"
      onClick={() => onSelectDate(cellDate)}
      className={`flex h-32 flex-col justify-between bg-white p-2 text-left transition ${outsideCurrentMonth ? "opacity-70" : ""} ${isSelected ? "ring-2 ring-indigo-500" : "hover:bg-indigo-50"}`}
    >
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${dayClass}`}>{format(cellDate, "d")}</span>
        {today && <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">Today</span>}
      </div>
      {hasHolidays && (
        <div className="mt-1 space-y-0.5 text-[10px] font-semibold text-rose-500">
          {bucket.holidays.slice(0, 2).map((holiday) => (
            <div key={holiday.name}>{holiday.name}</div>
          ))}
          {bucket.holidays.length > 2 && <div className="text-[9px] font-normal text-rose-400">외 {bucket.holidays.length - 2}건</div>}
        </div>
      )}
      <div className="space-y-1 text-[11px] leading-tight text-gray-600">
        {hasTransactions && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">지출</span>
            <span className="tabular-nums text-rose-600">{totals.expense.toLocaleString()}</span>
          </div>
        )}
        {hasTransactions && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">수입</span>
            <span className="tabular-nums text-emerald-600">{totals.income.toLocaleString()}</span>
          </div>
        )}
        {totals.transferIn !== 0 || totals.transferOut !== 0 ? (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400">Transfer</span>
            <span className="tabular-nums text-gray-500">+{totals.transferIn.toLocaleString()} / -{totals.transferOut.toLocaleString()}</span>
          </div>
        ) : null}
        {!hasTransactions && !hasRecurring && !hasEvents && (
          <p className="text-[10px] text-gray-300">기록 없음</p>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {hasHolidays && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
            공휴일 {bucket.holidays.length}
          </span>
        )}
        {hasRecurring && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
            정기 {bucket.recurring.length}
          </span>
        )}
        {hasEvents && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
            메모 {bucket.events.length}
          </span>
        )}
      </div>
    </button>
  );
}

function WeekView({ days, selectedKey, onSelectDate }: { days: CalendarDayBucket[]; selectedKey: string; onSelectDate: (date: Date) => void }) {
  const totals = days.reduce(
    (acc, bucket) => {
      acc.income += bucket.totals.income;
      acc.expense += bucket.totals.expense;
      acc.net += bucket.totals.net;
      acc.transferIn += bucket.totals.transferIn;
      acc.transferOut += bucket.totals.transferOut;
      return acc;
    },
    { income: 0, expense: 0, net: 0, transferIn: 0, transferOut: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="rounded border border-dashed border-gray-200 p-4 text-sm text-gray-600">
        <div className="text-xs uppercase text-gray-500">주간 합산</div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1 text-gray-600"><strong className="text-gray-900">순수익</strong> {totals.net.toLocaleString()}</span>
          <span className="flex items-center gap-1 text-emerald-600"><strong>수입</strong> {totals.income.toLocaleString()}</span>
          <span className="flex items-center gap-1 text-rose-600"><strong>지출</strong> {totals.expense.toLocaleString()}</span>
          <span className="flex items-center gap-1 text-gray-500"><strong>이체</strong> +{totals.transferIn.toLocaleString()} / -{totals.transferOut.toLocaleString()}</span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((bucket) => {
          const dateObj = new Date(bucket.date);
          const label = format(dateObj, "MM/dd (EEE)");
          const isSelected = bucket.date === selectedKey;
          const hasRecurring = bucket.recurring.length > 0;
          const hasEvents = bucket.events.length > 0;
          const hasHolidays = bucket.holidays.length > 0;
          return (
            <button
              key={bucket.date}
              type="button"
              onClick={() => onSelectDate(dateObj)}
              className={`rounded border p-3 text-left text-sm transition ${isSelected ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50"}`}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                <span>{label}</span>
                {isToday(dateObj) && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-600">오늘</span>}
              </div>
              <div className="mt-2 space-y-1 text-[12px] text-gray-600">
                <div className="flex justify-between"><span>지출</span><span className="tabular-nums text-rose-600">{bucket.totals.expense.toLocaleString()}</span></div>
                <div className="flex justify-between"><span>수입</span><span className="tabular-nums text-emerald-600">{bucket.totals.income.toLocaleString()}</span></div>
                {(hasHolidays || hasRecurring || hasEvents) && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {hasHolidays && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">공휴일 {bucket.holidays.length}</span>}
                    {hasRecurring && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">정기 {bucket.recurring.length}</span>}
                    {hasEvents && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">메모 {bucket.events.length}</span>}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type DayDetailVariant = "full" | "condensed";

function DayOverview({ bucket, date }: { bucket: CalendarDayBucket; date: Date }) {
  const dateLabel = format(date, "yyyy년 MM월 dd일 (EEE)");
  const { totals } = bucket;
  const stats = [
    { label: "수입", value: totals.income, tone: "text-emerald-600" },
    { label: "지출", value: totals.expense, tone: "text-rose-600" },
    { label: "순수익", value: totals.net, tone: "text-gray-900" },
    { label: "이체 유입", value: totals.transferIn, tone: "text-gray-600" },
    { label: "이체 유출", value: totals.transferOut, tone: "text-gray-600" },
  ];
  return (
    <div className="rounded border border-dashed border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-dashed border-gray-200 pb-2">
        <div>
          <div className="text-xs uppercase text-gray-500">선택된 날짜</div>
          <div className="text-base font-semibold text-gray-900">{dateLabel}</div>
        </div>
        <div className="text-xs text-gray-500">
          거래 {bucket.transactions.length.toLocaleString()}건 · 정기 {bucket.recurring.length.toLocaleString()}건 · 메모 {bucket.events.length.toLocaleString()}건
          {bucket.holidays.length > 0 && <> · 공휴일 {bucket.holidays.length.toLocaleString()}건</>}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((item) => (
          <div key={item.label} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="text-[11px] uppercase text-gray-400">{item.label}</div>
            <div className={`mt-1 text-sm font-semibold ${item.tone}`}>{item.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayDetail({
  bucket,
  date,
  variant,
  onEditEvent,
  onDeleteEvent,
  editingEventId,
  deletingEventId,
  onViewTransactions,
  onInspectTransaction,
  memberColorMap,
  memberInitial,
  baseSnapshot,
}: {
  bucket: CalendarDayBucket;
  date: Date;
  variant: DayDetailVariant;
  onEditEvent?: (event: CalendarEvent) => void;
  onDeleteEvent?: (event: CalendarEvent) => void;
  editingEventId?: number | null;
  deletingEventId?: number | null;
  onViewTransactions?: (date: Date) => void;
  onInspectTransaction?: (txn: CalendarTransaction) => void;
  memberColorMap: Map<number, string>;
  memberInitial: (id: number) => string;
  baseSnapshot?: CalendarSnapshot;
}) {
  const dateLabel = format(date, "yyyy년 MM월 dd일 (EEE)");
  const transactions = [...bucket.transactions].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  const recurring = bucket.recurring;
  const events = bucket.events;
  const holidays = bucket.holidays;
  const hasContent = transactions.length > 0 || recurring.length > 0 || events.length > 0 || holidays.length > 0;

  return (
    <SectionCard
      title={dateLabel}
      description="선택된 날짜의 거래, 정기 일정, 메모를 확인하세요."
      headerAction={
        onViewTransactions ? (
          <button
            type="button"
            onClick={() => onViewTransactions(date)}
            className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-600 transition hover:bg-indigo-50"
          >
            자세히보기
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        <span>수입 <strong className="text-emerald-600">{bucket.totals.income.toLocaleString()}</strong></span>
        <span>지출 <strong className="text-rose-600">{bucket.totals.expense.toLocaleString()}</strong></span>
        <span>순수익 <strong className="text-gray-900">{bucket.totals.net.toLocaleString()}</strong></span>
      </div>
      {hasContent ? (
        <div className="space-y-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500">공휴일</h4>
            {holidays.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">등록된 공휴일이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {holidays.map((holiday) => (
                  <li key={`holiday-${holiday.date}-${holiday.name}`} className="flex items-center justify-between rounded border border-rose-100 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    <span className="font-semibold">{holiday.name}</span>
                    <span className="text-[11px] uppercase text-rose-400">공휴일</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500">거래</h4>
            {transactions.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">기록된 거래가 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {transactions.map((txn) => {
                  const recurring = isRecurringTransaction(txn);
                  const tone = memberColorMap.get(txn.user_id) || "#4b5563";
                  const content = (
                    <div
                      className={clsx(
                        "flex w-full items-center justify-between rounded border px-2 py-1 text-xs transition",
                        recurring ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white",
                        onInspectTransaction ? "cursor-pointer hover:border-indigo-300 hover:bg-indigo-50" : null
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tone}1A`, color: tone }}>
                          {memberInitial(txn.user_id)}
                        </span>
                        <span className={clsx("rounded px-1.5 py-0.5 font-medium", recurring ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600")}>{formatTransactionTime(txn)}</span>
                        <span className={clsx("font-semibold", recurring ? "text-indigo-700" : "text-gray-700")}>{renderTxnTypeLabel(txn.type)}</span>
                        {recurring && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                            정기
                          </span>
                        )}
                        {recurring && txn.recurring_rule_name && (
                          <span className="rounded bg-indigo-200/60 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">{txn.recurring_rule_name}</span>
                        )}
                        {txn.memo && <span className={recurring ? "text-indigo-600" : "text-gray-500"}>{txn.memo}</span>}
                      </div>
                      <span className={clsx("tabular-nums font-semibold", amountTone(txn))}>{formatTxnAmount(txn)}</span>
                    </div>
                  );
                  return (
                    <li key={`txn-${txn.id}`} className="group">
                      {onInspectTransaction ? (
                        <button
                          type="button"
                          onClick={() => onInspectTransaction(txn)}
                          className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500">정기 일정</h4>
            {recurring.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">예정된 정기 일정이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {recurring.map((item) => {
                  const matchedUserId = baseSnapshot?.transactions.find((t: CalendarTransaction) => t.recurring_rule_id === item.ruleId)?.user_id ?? USER_ID;
                  const tone = memberColorMap.get(matchedUserId) || "#4b5563";
                  const amountValue = typeof item.amount === "number" ? item.amount : null;
                  const prefix = item.ruleType === "EXPENSE" ? "-" : item.ruleType === "INCOME" ? "+" : "±";
                  return (
                    <li
                      key={`recurring-${item.ruleId}`}
                      className="flex items-center justify-between rounded border px-2 py-1 text-xs"
                      style={{ borderColor: `${tone}40`, backgroundColor: `${tone}14`, color: tone }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tone}1A`, color: tone }}>{memberInitial(matchedUserId)}</span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium uppercase text-[10px]">{renderTxnTypeLabel(item.ruleType)}</span>
                        <span className="font-semibold">{item.ruleName}</span>
                        {item.memo && <span className="text-indigo-600">{item.memo}</span>}
                      </div>
                      <span className="tabular-nums font-semibold">
                        {amountValue === null ? "금액 미정" : `${prefix}${amountValue.toLocaleString()}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase text-gray-500">메모 & 이벤트</h4>
            {events.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">등록된 일정이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {events.map((event) => {
                  const tone = memberColorMap.get(event.user_id) || "#92400e";
                  const isEditing = editingEventId === event.id;
                  const isDeleting = deletingEventId === event.id;
                  return (
                    <li
                      key={event.id}
                      className={`rounded border px-3 py-2 text-xs shadow-sm transition ${
                        isEditing ? "ring-1" : ""
                      }`}
                      style={{
                        borderColor: `${tone}40`,
                        backgroundColor: `${tone}12`,
                        color: tone,
                        boxShadow: isEditing ? `0 0 0 1px ${tone}` : undefined,
                      }}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${tone}1A`, color: tone }}>
                            {memberInitial(event.user_id)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium uppercase text-[10px]">
                            {event.color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: event.color }} />}
                            {renderEventTypeLabel(event.type)}
                          </span>
                          <span className="font-semibold text-amber-900">{event.title}</span>
                          {event.description && <span className="text-amber-700">{event.description}</span>}
                        </div>
                        {(onEditEvent || onDeleteEvent) && (
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            {onEditEvent && (
                              <button
                                type="button"
                                onClick={() => onEditEvent(event)}
                                disabled={isDeleting}
                                className="rounded border border-amber-300 px-2 py-0.5 text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isEditing ? "편집 중" : "수정"}
                              </button>
                            )}
                            {onDeleteEvent && (
                              <button
                                type="button"
                                onClick={() => onDeleteEvent(event)}
                                disabled={isDeleting}
                                className="rounded border border-amber-300 px-2 py-0.5 text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isDeleting ? "삭제 중…" : "삭제"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <p className="text-xs text-gray-400">선택된 날짜에는 기록된 내용이 없습니다.</p>
      )}
    </SectionCard>
  );
}

type EventEditorProps = {
  mode: "create" | "edit";
  draft: EventFormState;
  onDraftChange: (patch: Partial<EventFormState>) => void;
  onSubmit: () => Promise<void> | void;
  submitting: boolean;
  onCancel: () => void;
  error: string | null;
  message: string | null;
};

function EventEditor({ mode, draft, onDraftChange, onSubmit, submitting, onCancel, error, message }: EventEditorProps) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit();
  };

  const disableSubmit = submitting || draft.title.trim().length === 0 || draft.date.trim().length === 0;

  return (
    <SectionCard
      title={mode === "edit" ? "선택한 일정 수정" : "새 일정 등록"}
      description="메모, 기념일, 리마인더를 추가하세요."
      tone="muted"
      headerAction={
        mode === "edit" ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            새 메모
          </button>
        ) : undefined
      }
    >
      {error && <p className="rounded bg-white px-3 py-2 text-xs text-red-600">{error}</p>}
      {message && !error && <p className="rounded bg-white px-3 py-2 text-xs text-emerald-700">{message}</p>}
      <form className="space-y-3" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase text-amber-600">날짜</span>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => onDraftChange({ date: e.target.value })}
            className="rounded border border-amber-200 bg-white px-2 py-1 text-sm text-amber-900 focus:border-amber-400 focus:outline-none"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase text-amber-600">유형</span>
          <select
            value={draft.type}
            onChange={(e) => onDraftChange({ type: e.target.value as CalendarEventType })}
            className="rounded border border-amber-200 bg-white px-2 py-1 text-sm text-amber-900 focus:border-amber-400 focus:outline-none"
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase text-amber-600">제목</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onDraftChange({ title: e.target.value })}
            className="rounded border border-amber-200 bg-white px-2 py-1 text-sm text-amber-900 focus:border-amber-400 focus:outline-none"
            placeholder="메모 제목"
            maxLength={200}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase text-amber-600">설명</span>
          <textarea
            value={draft.description}
            onChange={(e) => onDraftChange({ description: e.target.value })}
            className="min-h-[60px] rounded border border-amber-200 bg-white px-2 py-1 text-sm text-amber-900 focus:border-amber-400 focus:outline-none"
            placeholder="세부 메모 (선택)"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase text-amber-600">색상</span>
          <div className="flex flex-wrap gap-2">
            {EVENT_COLOR_SWATCHES.map((hex) => {
              const isSelected = draft.color?.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onDraftChange({ color: hex })}
                  className={`h-8 w-8 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    isSelected ? "border-amber-700 ring-2 ring-amber-500" : "border-white shadow"
                  }`}
                  style={{ backgroundColor: hex }}
                  aria-label={`${hex} 색상 선택`}
                />
              );
            })}
            <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-amber-300 bg-white text-[10px] font-semibold text-amber-600 shadow">
              <span className="sr-only">사용자 지정 색상</span>
              🎨
              <input
                type="color"
                value={draft.color ? draft.color : "#facc15"}
                onChange={(e) => onDraftChange({ color: e.target.value })}
                className="hidden"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft.color}
              onChange={(e) => onDraftChange({ color: e.target.value })}
              placeholder="#facc15"
              pattern="^$|^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$"
              className="flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-sm text-amber-900 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onDraftChange({ color: "" })}
              className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
            >
              초기화
            </button>
            {draft.color && (
              <span
                className="inline-flex h-6 w-6 rounded-full border border-amber-300"
                style={{ backgroundColor: draft.color }}
                aria-label="색상 미리보기"
              />
            )}
          </div>
          <p className="text-[11px] text-amber-600">기본 팔레트를 선택하거나 🎨 버튼으로 사용자 색을 고르세요. 직접 입력 시 #RRGGBB 혹은 #RRGGBBAA 형태를 사용하세요.</p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          {mode === "edit" && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              취소
            </button>
          )}
          <button
            type="submit"
            disabled={disableSubmit}
            className="rounded bg-amber-500 px-4 py-1 text-xs font-semibold text-white shadow hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "저장 중…" : mode === "edit" ? "일정 업데이트" : "일정 추가"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function formatTransactionTime(txn: CalendarTransaction) {
  if (txn.occurred_time) return txn.occurred_time.slice(0, 5);
  const date = new Date(txn.occurred_at);
  if (!Number.isNaN(date.getTime())) return format(date, "HH:mm");
  return "종일";
}

export function isRecurringTransaction(txn: CalendarTransaction): boolean {
  return extractRecurringRuleId(txn.external_id ?? null) !== null;
}

function renderTxnTypeLabel(type: CalendarTransaction["type"]) {
  switch (type) {
    case "INCOME":
      return "수입";
    case "EXPENSE":
      return "지출";
    default:
      return "이체";
  }
}

function amountTone(txn: CalendarTransaction) {
  if (txn.amount > 0) return "text-emerald-600";
  if (txn.amount < 0) return "text-rose-600";
  return "text-gray-700";
}

function formatTxnAmount(txn: CalendarTransaction) {
  if (txn.amount > 0) {
    return `+${txn.amount.toLocaleString()}`;
  }
  if (txn.amount < 0) {
    return `-${Math.abs(txn.amount).toLocaleString()}`;
  }
  return "0";
}

function renderEventTypeLabel(type: CalendarEventType) {
  switch (type) {
    case "memo":
      return "메모";
    case "anniversary":
      return "기념일";
    case "reminder":
      return "리마인더";
    default:
      return "이벤트";
  }
}
