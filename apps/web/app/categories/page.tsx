"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { MemberSelector } from "@/components/MemberSelector";
import { usePersistentState } from "@/lib/hooks/usePersistentState";

type Category = { id: number; user_id?: number; group_id: number; code_cc: number; name: string; full_code: string };
type CategoryGroup = { id: number; user_id?: number; type: "I" | "E" | "T"; code_gg: number; name: string };

type Member = { id: number; name: string };

type AggregatedGroup = {
  key: string;
  type: "I" | "E" | "T";
  code_gg: number;
  displayName: string;
  nameMismatch: boolean;
  memberIds: number[];
  items: CategoryGroup[];
};

type AggregatedCategory = {
  key: string;
  type: "I" | "E" | "T";
  code_gg: number;
  code_cc: number;
  displayName: string;
  nameMismatch: boolean;
  groupDisplayName: string;
  groupMismatch: boolean;
  memberIds: number[];
  items: Category[];
};

type Filters = {
  type: "ALL" | "I" | "E" | "T";
  groupKey: string | null;
  search: string;
  page: number;
  pageSize: number;
};

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
const USER_ID = 1; // TODO: wire with auth/session later

function makeGroupKey(type: "I" | "E" | "T", codeGg: number) {
  return `${type}-${codeGg.toString().padStart(2, "0")}`;
}

function parseGroupKey(key: string | null): { type: "I" | "E" | "T"; code_gg: number } | null {
  if (!key) return null;
  const [type, gg] = key.split("-");
  if (!type || !gg) return null;
  const code = Number(gg);
  if (!Number.isFinite(code)) return null;
  if (type !== "I" && type !== "E" && type !== "T") return null;
  return { type, code_gg: code };
}

export default function CategoriesPage() {
  const [memberIds, setMemberIds] = usePersistentState<number[]>("pfm:members:selection:v1", [USER_ID]);
  const [filters, setFilters] = useState<Filters>({ type: "ALL", groupKey: null, search: "", page: 1, pageSize: 50 });
  const [members, setMembers] = useState<Member[]>([]);
  const [memberLoadError, setMemberLoadError] = useState<string | null>(null);
  const [rawGroups, setRawGroups] = useState<CategoryGroup[]>([]);
  const [rawCategories, setRawCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create/Edit/Delete modals state
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<{ id: number; name: string } | null>(null);
  const [showDelete, setShowDelete] = useState<{ id: number } | null>(null);
  // Groups modals
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState<{ id: number; name: string } | null>(null);
  const [showGroupDelete, setShowGroupDelete] = useState<{ id: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [expandedCategoryKeys, setExpandedCategoryKeys] = useState<string[]>([]);

  useEffect(() => {
    let ignore = false;
    async function loadMembers() {
      try {
        const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
        const res = await fetch(new URL("/api/members", base).toString(), { cache: "no-store" });
        if (!res.ok) throw new Error(`members load failed: ${res.status}`);
        const data = (await res.json()) as Member[];
        if (!ignore) {
          setMembers(data);
          setMemberLoadError(null);
        }
      } catch (e) {
        if (!ignore) {
          setMemberLoadError(e instanceof Error ? e.message : String(e));
          const fallback: Member[] = [
            { id: 1, name: "me" },
            { id: 2, name: "member1" },
          ];
          setMembers(fallback);
        }
      }
    }
    loadMembers();
    return () => {
      ignore = true;
    };
  }, []);

  const targetMemberId = memberIds && memberIds.length > 0 ? memberIds[0] : USER_ID;

  const groupsForTargetMember = useMemo(() => {
    // 전역 그룹( user_id 없음 )이면 모든 그룹 사용, 그렇지 않으면 선택 멤버 필터링
    const hasUserScope = rawGroups.some((g) => typeof g.user_id === "number");
    return hasUserScope ? rawGroups.filter((g) => g.user_id === targetMemberId) : rawGroups;
  }, [rawGroups, targetMemberId]);

  // Derived
  const memberNameMap = useMemo(() => {
    const map = new Map<number, string>();
    members.forEach((m) => map.set(m.id, m.name));
    return map;
  }, [members]);

  const groupsById = useMemo(() => new Map(rawGroups.map((g) => [g.id, g])), [rawGroups]);

  const aggregatedGroups = useMemo<AggregatedGroup[]>(() => {
    const bucket = new Map<string, { type: "I" | "E" | "T"; code_gg: number; names: Set<string>; memberIds: Set<number>; items: CategoryGroup[] }>();
    rawGroups.forEach((group) => {
      const key = makeGroupKey(group.type, group.code_gg);
      let entry = bucket.get(key);
      if (!entry) {
        entry = {
          type: group.type,
          code_gg: group.code_gg,
          names: new Set(),
          memberIds: new Set<number>(),
          items: [],
        };
        bucket.set(key, entry);
      }
      entry.names.add(group.name);
  if (typeof group.user_id === "number") entry.memberIds.add(group.user_id);
  entry.items.push(group);
    });
    return Array.from(bucket.entries())
      .map(([key, value]) => {
        const names = Array.from(value.names);
        const displayName = names.length === 0 ? key : names[0];
        return {
          key,
          type: value.type,
          code_gg: value.code_gg,
          displayName,
          nameMismatch: names.length > 1,
          memberIds: Array.from(value.memberIds).sort((a, b) => a - b),
      items: value.items.sort((a, b) => (a.user_id ?? 0) - (b.user_id ?? 0)),
        } satisfies AggregatedGroup;
      })
      .sort((a, b) => {
        if (a.type === b.type) return a.code_gg - b.code_gg;
        return a.type.localeCompare(b.type);
      });
  }, [rawGroups]);

  const aggregatedGroupMap = useMemo(() => new Map(aggregatedGroups.map((g) => [g.key, g])), [aggregatedGroups]);

  const aggregatedCategories = useMemo<AggregatedCategory[]>(() => {
    const bucket = new Map<string, {
      type: "I" | "E" | "T";
      code_gg: number;
      code_cc: number;
      groupNames: Set<string>;
      names: Set<string>;
      memberIds: Set<number>;
      items: Category[];
    }>();

    rawCategories.forEach((cat) => {
      const group = groupsById.get(cat.group_id);
      const type = group?.type ?? (cat.full_code?.[0] as "I" | "E" | "T" | undefined) ?? "E";
      const codeGg = group?.code_gg ?? Number(cat.full_code.slice(1, 3) || 0);
      const key = `${makeGroupKey(type, codeGg)}-${cat.code_cc.toString().padStart(2, "0")}`;
      let entry = bucket.get(key);
      if (!entry) {
        entry = {
          type,
          code_gg: codeGg,
          code_cc: cat.code_cc,
          groupNames: new Set<string>(),
          names: new Set<string>(),
          memberIds: new Set<number>(),
          items: [],
        };
        bucket.set(key, entry);
      }
      if (group?.name) entry.groupNames.add(group.name);
  entry.names.add(cat.name);
  if (typeof cat.user_id === "number") entry.memberIds.add(cat.user_id);
  entry.items.push(cat);
    });

    return Array.from(bucket.entries())
      .map(([key, value]) => {
        const groupNames = Array.from(value.groupNames).sort();
        const categoryNames = Array.from(value.names).sort();
        const groupDisplayName = groupNames.length === 0 ? key.slice(0, 4) : groupNames[0];
        const displayName = categoryNames.length === 0 ? key : categoryNames[0];
        return {
          key,
          type: value.type,
          code_gg: value.code_gg,
          code_cc: value.code_cc,
          displayName,
          nameMismatch: categoryNames.length > 1,
          groupDisplayName,
          groupMismatch: groupNames.length > 1,
          memberIds: Array.from(value.memberIds).sort((a, b) => a - b),
      items: value.items.sort((a, b) => (a.user_id ?? 0) - (b.user_id ?? 0)),
        } satisfies AggregatedCategory;
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        if (a.code_gg !== b.code_gg) return a.code_gg - b.code_gg;
        return a.code_cc - b.code_cc;
      });
  }, [rawCategories, groupsById]);

  const defaultGroupForTarget = useMemo(() => {
    if (!filters.groupKey) return undefined;
    return groupsForTargetMember.find((g) => makeGroupKey(g.type, g.code_gg) === filters.groupKey);
  }, [filters.groupKey, groupsForTargetMember]);

  const displayTotal = aggregatedCategories.length;
  const selectedGroup = filters.groupKey ? aggregatedGroupMap.get(filters.groupKey) : null;

  const toggleGroupExpand = (key: string) => {
    setExpandedGroupKeys((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]));
  };

  const toggleCategoryExpand = (key: string) => {
    setExpandedCategoryKeys((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]));
  };

  const sameTypeCategories = useMemo(() => {
    if (filters.type === "ALL") return rawCategories;
    const t = filters.type;
    return rawCategories.filter((r) => {
      const group = groupsById.get(r.group_id);
      return group ? group.type === t : false;
    });
  }, [rawCategories, groupsById, filters.type]);

  // Load groups whenever type changes (skip when ALL)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
  const url = new URL("/api/category-groups", BACKEND_URL);
  // 전역 카테고리/그룹: user_id 파라미터 제거
        if (filters.type !== "ALL") url.searchParams.set("type", filters.type);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as CategoryGroup[];
        if (!ignore) setRawGroups(data);
      } catch (e) {
        if (!ignore) setRawGroups([]);
      }
    })();
    return () => { ignore = true; };
  }, [filters.type, memberIds]);

  // Load categories whenever filters change
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
  const url = new URL("/api/categories", BACKEND_URL);
  // 전역 카테고리/그룹: user_id 파라미터 제거
        if (filters.type !== "ALL") url.searchParams.set("type", filters.type);
        const parsedGroup = parseGroupKey(filters.groupKey);
        if (parsedGroup) {
          url.searchParams.set("group_code", String(parsedGroup.code_gg));
        }
        if (filters.search) url.searchParams.set("search", filters.search);
        url.searchParams.set("page", String(filters.page));
        url.searchParams.set("page_size", String(filters.pageSize));
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Category[];
        if (!ignore) {
          setRawCategories(data);
        }
      } catch (e: any) {
        if (!ignore) setError(e?.message || "로드 실패");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [filters.page, filters.pageSize, filters.type, filters.groupKey, filters.search, groupsById, memberIds]);

  // Actions
  async function createCategory(input: { type: "I" | "E" | "T"; groupId: number; code_cc: number; name: string }) {
    const url = new URL("/api/categories", BACKEND_URL);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: input.groupId, code_cc: input.code_cc, name: input.name })
    });
    if (!res.ok) throw new Error(await res.text());
    // refresh
    setFilters(f => ({ ...f }));
  }

  async function updateCategoryName(id: number, name: string) {
    const url = new URL(`/api/categories/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(await res.text());
    setFilters(f => ({ ...f }));
  }

  async function updateCategoryCode(id: number, code_cc: number) {
    const url = new URL(`/api/categories/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code_cc })
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function deleteCategory(id: number, reassignTo?: number) {
    const url = new URL(`/api/categories/${id}`, BACKEND_URL);
    if (reassignTo) url.searchParams.set("reassign_to", String(reassignTo));
    const res = await fetch(url.toString(), { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    setFilters(f => ({ ...f }));
  }

  // Group actions
  async function createGroup(payload: { type: "I" | "E" | "T"; code_gg: number; name: string }) {
    const url = new URL("/api/category-groups", BACKEND_URL);
    const res = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    setFilters(f => ({ ...f }));
  }
  async function updateGroupName(id: number, name: string) {
    const url = new URL(`/api/category-groups/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) throw new Error(await res.text());
    setFilters(f => ({ ...f }));
  }
  async function updateGroupCode(id: number, code_gg: number) {
    const url = new URL(`/api/category-groups/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_gg }) });
    if (!res.ok) throw new Error(await res.text());
  }
  async function deleteGroup(id: number) {
    const url = new URL(`/api/category-groups/${id}`, BACKEND_URL);
    const res = await fetch(url.toString(), { method: "DELETE" });
    if (!res.ok) {
      const msg = await res.text();
      if (res.status === 409) setToast("그룹에 소분류가 있어 삭제할 수 없습니다.");
      else setToast(`삭제 실패: ${msg}`);
      return;
    }
    setFilters(f => ({ ...f }));
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">{toast}<button className="float-right" onClick={() => setToast(null)}>닫기</button></div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">카테고리/그룹 관리</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <MemberSelector value={memberIds} onChange={setMemberIds} />
          <button className="rounded border px-3 py-1" onClick={() => setShowGroupCreate(true)}>+ 새 그룹</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white" onClick={() => setShowCreate(true)}>+ 새 카테고리</button>
        </div>
      </div>
        {memberLoadError && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            멤버 목록을 불러오지 못해 기본 이름을 사용 중입니다. ({memberLoadError})
          </div>
        )}
      {/* 상단 필터바: 유형/검색/페이지 크기만 유지, 그룹 드롭다운 제거 */}
      <FiltersBarCompact filters={filters} setFilters={setFilters} />

      {/* 좌우 2열 레이아웃 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 좌측: 그룹 목록 */}
        <div className="rounded border bg-white md:col-span-1">
          <div className="px-3 py-2 text-sm text-gray-600 flex items-center justify-between">
            <span>카테고리 그룹</span>
            <span className="text-xs text-gray-500">선택하면 오른쪽 목록이 필터링됩니다</span>
          </div>
          <table className="min-w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-left">코드</th>
                <th className="px-3 py-2 text-left">이름</th>
                <th className="px-3 py-2 text-left">멤버</th>
                <th className="px-3 py-2 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {aggregatedGroups.length === 0 ? (
                <tr><td className="px-3 py-4 text-center" colSpan={5}>그룹 없음</td></tr>
              ) : (
                aggregatedGroups.map((agg) => {
                  const selected = filters.groupKey === agg.key;
                  const single = agg.items.length === 1 ? agg.items[0] : null;
                  const expanded = expandedGroupKeys.includes(agg.key);
                  const groupCodeLabel = `${agg.type}${agg.code_gg.toString().padStart(2, "0")}`;
                  return (
                    <Fragment key={agg.key}>
                      <tr
                        className={`border-b last:border-0 hover:bg-gray-50 cursor-pointer ${selected ? "bg-blue-50" : ""}`}
                        onClick={() => setFilters((f) => ({ ...f, type: agg.type, groupKey: agg.key, page: 1 }))}
                      >
                        <td className="px-3 py-2">{agg.type}</td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {single ? (
                            <InlineGgEditor
                              type={single.type}
                              gg={single.code_gg}
                              disabled={single.code_gg === 0}
                              onSubmit={async (newGg) => {
                                await updateGroupCode(single.id, newGg);
                                setFilters((f) => ({ ...f }));
                              }}
                            />
                          ) : (
                            <span className="font-mono">{groupCodeLabel}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span>{agg.displayName}</span>
                            {agg.nameMismatch && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">이름 불일치</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {agg.memberIds.map((mid) => (
                              <span key={`m-${mid}`} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                {memberNameMap.get(mid) ?? `ID ${mid}`}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                          {single ? (
                            <>
                              <button className="rounded border px-2 py-1" onClick={() => setShowGroupEdit({ id: single.id, name: single.name })}>이름수정</button>
                              <button className="rounded border px-2 py-1 text-red-600" onClick={() => setShowGroupDelete({ id: single.id })}>삭제</button>
                            </>
                          ) : (
                            <button className="rounded border px-2 py-1" onClick={() => toggleGroupExpand(agg.key)}>
                              {expanded ? "접기" : "자세히"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {agg.items.length > 1 && expanded && (
                        <tr className="border-b last:border-0 bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-600" colSpan={5}>
                            <div className="space-y-3">
                              {agg.items.map((item) => (
                                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                                  <div>
                                    <div className="text-sm font-medium text-gray-800">{(typeof item.user_id === 'number' ? memberNameMap.get(item.user_id) : undefined) ?? (typeof item.user_id === 'number' ? `ID ${item.user_id}` : '전역')}</div>
                                    <div className="text-xs text-gray-500">코드 {item.type}{String(item.code_gg).padStart(2, "0")}&nbsp;·&nbsp;{item.name}</div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <InlineGgEditor
                                      type={item.type}
                                      gg={item.code_gg}
                                      disabled={item.code_gg === 0}
                                      onSubmit={async (newGg) => {
                                        await updateGroupCode(item.id, newGg);
                                        setFilters((f) => ({ ...f }));
                                      }}
                                    />
                                    <button className="rounded border px-2 py-1" onClick={() => setShowGroupEdit({ id: item.id, name: item.name })}>이름수정</button>
                                    <button className="rounded border px-2 py-1 text-red-600" onClick={() => setShowGroupDelete({ id: item.id })}>삭제</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 우측: 카테고리 목록 */}
        <div className="rounded border bg-white md:col-span-2">
          <div className="px-3 py-2 text-sm text-gray-600 flex items-center justify-between">
            <span>카테고리 목록</span>
            {selectedGroup && (
              <span className="text-xs text-gray-500">
                선택된 그룹: {selectedGroup.type}-{selectedGroup.code_gg.toString().padStart(2, "0")} {selectedGroup.displayName}
              </span>
            )}
          </div>
          <table className="min-w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">유형</th>
                <th className="px-3 py-2 text-left">코드</th>
                <th className="px-3 py-2 text-left">그룹</th>
                <th className="px-3 py-2 text-left">이름</th>
                <th className="px-3 py-2 text-left">멤버</th>
                <th className="px-3 py-2 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-3 py-6 text-center" colSpan={6}>불러오는 중…</td></tr>
              ) : error ? (
                <tr><td className="px-3 py-6 text-red-600" colSpan={6}>에러: {error}</td></tr>
              ) : aggregatedCategories.length === 0 ? (
                <tr><td className="px-3 py-6 text-center" colSpan={6}>데이터가 없습니다</td></tr>
              ) : (
                aggregatedCategories.map((agg) => {
                  const single = agg.items.length === 1 ? agg.items[0] : null;
                  const sampleGroup = single ? groupsById.get(single.group_id) : undefined;
                  const expanded = expandedCategoryKeys.includes(agg.key);
                  const groupLabel = `${agg.code_gg.toString().padStart(2, "0")} ${agg.groupDisplayName}`;
                  const fullCode = `${agg.type}${agg.code_gg.toString().padStart(2, "0")}${agg.code_cc.toString().padStart(2, "0")}`;
                  return (
                    <Fragment key={agg.key}>
                      <tr className={`border-b last:border-0 ${expanded ? "bg-blue-50/40" : ""}`}>
                        <td className="px-3 py-2">{agg.type}</td>
                        <td className="px-3 py-2">
                          {single ? (
                            <InlineCodeEditor
                              type={sampleGroup?.type ?? agg.type}
                              groupCode={sampleGroup?.code_gg ?? agg.code_gg}
                              cc={single.code_cc}
                              disabled={single.code_cc === 0}
                              onSubmit={async (newCc) => {
                                await updateCategoryCode(single.id, newCc);
                                setFilters((f) => ({ ...f }));
                              }}
                            />
                          ) : (
                            <span className="font-mono">{fullCode}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span>{groupLabel}</span>
                            {agg.groupMismatch && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">이름 불일치</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span>{agg.displayName}</span>
                            {agg.nameMismatch && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">이름 불일치</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {agg.memberIds.map((mid) => (
                              <span key={`m-${mid}`} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                {memberNameMap.get(mid) ?? `ID ${mid}`}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right space-x-2">
                          {single ? (
                            <>
                              <button className="rounded border px-2 py-1" onClick={() => setShowEdit({ id: single.id, name: single.name })}>이름수정</button>
                              <button className="rounded border px-2 py-1 text-red-600" onClick={() => setShowDelete({ id: single.id })}>삭제</button>
                            </>
                          ) : (
                            <button className="rounded border px-2 py-1" onClick={() => toggleCategoryExpand(agg.key)}>
                              {expanded ? "접기" : "자세히"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {agg.items.length > 1 && expanded && (
                        <tr className="border-b last:border-0 bg-gray-50">
                          <td className="px-3 py-3" colSpan={6}>
                            <div className="space-y-3">
                              {agg.items.map((item) => {
                                const group = groupsById.get(item.group_id);
                                const codeLabel = item.full_code || `${group?.type ?? agg.type}${String(group?.code_gg ?? agg.code_gg).padStart(2, "0")}${String(item.code_cc).padStart(2, "0")}`;
                                return (
                                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                                    <div>
                                      <div className="text-sm font-medium text-gray-800">{(typeof item.user_id === 'number' ? memberNameMap.get(item.user_id) : undefined) ?? (typeof item.user_id === 'number' ? `ID ${item.user_id}` : '전역')}</div>
                                      <div className="text-xs text-gray-500">{codeLabel} · {group ? `${group.code_gg.toString().padStart(2, "0")} ${group.name}` : "그룹 미지정"}</div>
                                      <div className="text-xs text-gray-500">이름: {item.name}</div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                      <InlineCodeEditor
                                        type={group?.type ?? agg.type}
                                        groupCode={group?.code_gg ?? agg.code_gg}
                                        cc={item.code_cc}
                                        disabled={item.code_cc === 0}
                                        onSubmit={async (newCc) => {
                                          await updateCategoryCode(item.id, newCc);
                                          setFilters((f) => ({ ...f }));
                                        }}
                                      />
                                      <button className="rounded border px-2 py-1" onClick={() => setShowEdit({ id: item.id, name: item.name })}>이름수정</button>
                                      <button className="rounded border px-2 py-1 text-red-600" onClick={() => setShowDelete({ id: item.id })}>삭제</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>

          <div className="p-2">
            <PaginationBar
              page={filters.page}
              pageSize={filters.pageSize}
              total={displayTotal}
              onChange={(p, s) => setFilters((f) => ({ ...f, page: p, pageSize: s }))}
            />
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          groups={groupsForTargetMember}
          defaultType={filters.type !== "ALL" ? filters.type : "E"}
          defaultGroupId={defaultGroupForTarget?.id}
          onCreate={async (payload) => {
            await createCategory(payload);
            setShowCreate(false);
          }}
        />
      )}

      {showEdit && (
        <EditModal
          initial={showEdit}
          onClose={() => setShowEdit(null)}
          onSave={async (id, name) => { await updateCategoryName(id, name); setShowEdit(null); }}
        />
      )}

      {showDelete && (
        <DeleteModal
          id={showDelete.id}
          categories={sameTypeCategories}
          onClose={() => setShowDelete(null)}
          onDelete={async (id, reassignTo) => { await deleteCategory(id, reassignTo); setShowDelete(null); }}
        />
      )}

      {showGroupCreate && (
        <GroupCreateModal onClose={() => setShowGroupCreate(false)} onCreate={async (p) => { try { await createGroup(p); setShowGroupCreate(false); } catch (e: any) { setToast(e?.message || "생성 실패"); } }} />
      )}
      {showGroupEdit && (
        <GroupEditModal initial={showGroupEdit} onClose={() => setShowGroupEdit(null)} onSave={async (id, name) => { try { await updateGroupName(id, name); setShowGroupEdit(null); } catch (e: any) { setToast(e?.message || "수정 실패"); } }} />
      )}
      {showGroupDelete && (
        <GroupDeleteModal id={showGroupDelete.id} onClose={() => setShowGroupDelete(null)} onDelete={async (id) => { await deleteGroup(id); setShowGroupDelete(null); }} />
      )}
    </div>
  );
}

function InlineCodeEditor({ type, groupCode, cc, disabled, onSubmit }: { type: string; groupCode: number; cc: number; disabled: boolean; onSubmit: (newCc: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(cc).padStart(2,'0'));
  useEffect(() => { setVal(String(cc).padStart(2,'0')); }, [cc]);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono">{type}{String(groupCode).padStart(2,'0')}{val}</span>
      <button className="text-xs underline disabled:opacity-50" disabled={disabled} onClick={() => setEditing(true)}>코드변경</button>
      {editing && (
        <span className="flex items-center gap-1">
          <input className="w-14 rounded border px-1 py-0.5 font-mono" maxLength={2} value={val} onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '').slice(0,2);
            setVal(raw.padStart(2,'0'));
          }} />
          <button className="rounded border px-2 py-0.5 text-xs" onClick={async () => { await onSubmit(Number(val)); setEditing(false); }}>저장</button>
          <button className="rounded border px-2 py-0.5 text-xs" onClick={() => { setVal(String(cc).padStart(2,'0')); setEditing(false); }}>취소</button>
        </span>
      )}
    </div>
  );
}

function InlineGgEditor({ type, gg, disabled, onSubmit }: { type: "I" | "E" | "T"; gg: number; disabled: boolean; onSubmit: (newGg: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(gg).padStart(2,'0'));
  useEffect(() => { setVal(String(gg).padStart(2,'0')); }, [gg]);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono">{type}{val}</span>
      <button className="text-xs underline disabled:opacity-50" disabled={disabled} onClick={() => setEditing(true)}>코드변경</button>
      {editing && (
        <span className="flex items-center gap-1">
          <input className="w-14 rounded border px-1 py-0.5 font-mono" maxLength={2} value={val} onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '').slice(0,2);
            setVal(raw.padStart(2,'0'));
          }} />
          <button className="rounded border px-2 py-0.5 text-xs" onClick={async () => { await onSubmit(Number(val)); setEditing(false); }}>저장</button>
          <button className="rounded border px-2 py-0.5 text-xs" onClick={() => { setVal(String(gg).padStart(2,'0')); setEditing(false); }}>취소</button>
        </span>
      )}
    </div>
  );
}

function GroupCreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: { type: "I" | "E" | "T"; code_gg: number; name: string }) => Promise<void> }) {
  const [type, setType] = useState<"I" | "E" | "T">("E");
  const [codeGg, setCodeGg] = useState<number | "">("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = type && codeGg !== "" && name.trim().length > 0;
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">새 그룹</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600">유형</label>
            <select className="mt-1 w-full rounded border px-2 py-1" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="E">지출(E)</option>
              <option value="I">수입(I)</option>
              <option value="T">이체(T)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600">그룹 코드(GG)</label>
            <input className="mt-1 w-full rounded border px-2 py-1" type="number" min={0} max={99} value={codeGg === "" ? "" : codeGg} onChange={(e) => {
              const v = e.target.value === "" ? "" : Math.max(0, Math.min(99, Number(e.target.value)));
              setCodeGg(v as any);
            }} placeholder="00-99" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-600">이름</label>
            <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50" disabled={!valid || busy} onClick={async () => { if (!valid) return; try { setBusy(true); await onCreate({ type, code_gg: codeGg as number, name: name.trim() }); } finally { setBusy(false); } }}>생성</button>
        </div>
      </div>
    </div>
  );
}

function GroupEditModal({ initial, onClose, onSave }: { initial: { id: number; name: string }; onClose: () => void; onSave: (id: number, name: string) => Promise<void> }) {
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-sm rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">그룹 수정</h2>
        <div>
          <label className="block text-xs text-gray-600">이름</label>
          <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50" disabled={busy || !name.trim()} onClick={async () => { try { setBusy(true); await onSave(initial.id, name.trim()); } finally { setBusy(false); } }}>저장</button>
        </div>
      </div>
    </div>
  );
}

function GroupDeleteModal({ id, onClose, onDelete }: { id: number; onClose: () => void; onDelete: (id: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-sm rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">그룹 삭제</h2>
        <p className="text-sm text-gray-700">해당 그룹을 삭제합니다. 그룹에 소분류가 존재하면 삭제가 거부됩니다.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50" disabled={busy} onClick={async () => { try { setBusy(true); await onDelete(id); } finally { setBusy(false); } }}>삭제</button>
        </div>
      </div>
    </div>
  );
}

function FiltersBarCompact({ filters, setFilters }: { filters: Filters; setFilters: React.Dispatch<React.SetStateAction<Filters>> }) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs text-gray-600">유형</label>
        <select className="mt-1 rounded border px-2 py-1" value={filters.type} onChange={(e) => setFilters(f => ({ ...f, type: e.target.value as Filters["type"], groupKey: null, page: 1 }))}>
          <option value="ALL">전체</option>
          <option value="E">지출(E)</option>
          <option value="I">수입(I)</option>
          <option value="T">이체(T)</option>
        </select>
      </div>
      <div className="grow max-w-[420px]">
        <label className="block text-xs text-gray-600">검색</label>
        <input className="mt-1 w-full rounded border px-2 py-1" placeholder="이름/코드 검색" value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value, page: 1 }))} />
      </div>
      <div>
        <label className="block text-xs text-gray-600">페이지 크기</label>
        <select className="mt-1 rounded border px-2 py-1" value={filters.pageSize} onChange={(e) => setFilters(f => ({ ...f, pageSize: Number(e.target.value), page: 1 }))}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
      </div>
    </div>
  );
}

function PaginationBar({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number, s: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-sm">
      <div>총 {total.toLocaleString()}건</div>
      <div className="space-x-2">
        <button className="rounded border px-2 py-1" disabled={page <= 1} onClick={() => onChange(page - 1, pageSize)}>이전</button>
        <span>페이지 {page} / {totalPages}</span>
        <button className="rounded border px-2 py-1" disabled={page >= totalPages} onClick={() => onChange(page + 1, pageSize)}>다음</button>
      </div>
    </div>
  );
}

function CreateModal({ onClose, groups, defaultType, defaultGroupId, onCreate }: { onClose: () => void; groups: CategoryGroup[]; defaultType: "I" | "E" | "T"; defaultGroupId?: number; onCreate: (payload: { type: "I" | "E" | "T"; groupId: number; code_cc: number; name: string }) => Promise<void> }) {
  const [type, setType] = useState<"I" | "E" | "T">(defaultType);
  const [groupId, setGroupId] = useState<number | "">(defaultGroupId ?? "");
  const [codeCc, setCodeCc] = useState<number | "">("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const filteredGroups = useMemo(() => groups.filter(g => g.type === type), [groups, type]);
  const valid = type && groupId && codeCc !== "" && name.trim().length > 0;
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">새 카테고리</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600">유형</label>
            <select className="mt-1 w-full rounded border px-2 py-1" value={type} onChange={(e) => { setType(e.target.value as any); setGroupId(""); }}>
              <option value="E">지출(E)</option>
              <option value="I">수입(I)</option>
              <option value="T">이체(T)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600">그룹</label>
            <select className="mt-1 w-full rounded border px-2 py-1" value={groupId || ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : "") }>
              <option value="">선택</option>
              {filteredGroups.map(g => (
                <option key={g.id} value={g.id}>{g.code_gg.toString().padStart(2,'0')} {g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600">세부 코드(CC)</label>
            <input className="mt-1 w-full rounded border px-2 py-1" type="number" min={0} max={99} value={codeCc === "" ? "" : codeCc} onChange={(e) => {
              const v = e.target.value === "" ? "" : Math.max(0, Math.min(99, Number(e.target.value)));
              setCodeCc(v as any);
            }} placeholder="00-99" />
          </div>
          <div>
            <label className="block text-xs text-gray-600">이름</label>
            <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50" disabled={!valid || busy} onClick={async () => {
            if (!valid) return;
            try {
              setBusy(true);
              await onCreate({ type, groupId: groupId as number, code_cc: codeCc as number, name: name.trim() });
            } finally { setBusy(false); }
          }}>생성</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ initial, onClose, onSave }: { initial: { id: number; name: string }; onClose: () => void; onSave: (id: number, name: string) => Promise<void> }) {
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-sm rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">카테고리 수정</h2>
        <div>
          <label className="block text-xs text-gray-600">이름</label>
          <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50" disabled={busy || !name.trim()} onClick={async () => { try { setBusy(true); await onSave(initial.id, name.trim()); } finally { setBusy(false); } }}>저장</button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ id, categories, onClose, onDelete }: { id: number; categories: Category[]; onClose: () => void; onDelete: (id: number, reassignTo?: number) => Promise<void> }) {
  const [reassignTo, setReassignTo] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const options = categories.filter(c => c.id !== id);
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md rounded bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">카테고리 삭제</h2>
        <p className="text-sm text-gray-700">해당 카테고리를 삭제합니다. 연결된 트랜잭션이 있다면 선택한 카테고리로 재분류됩니다. 미선택 시 서버의 기본 미분류(00-00)로 재분류될 수 있습니다.</p>
        <div>
          <label className="block text-xs text-gray-600">재분류 대상 (선택)</label>
          <select className="mt-1 w-full rounded border px-2 py-1" value={reassignTo || ""} onChange={(e) => setReassignTo(e.target.value ? Number(e.target.value) : "") }>
            <option value="">선택 안함</option>
            {options.map(c => (
              <option key={c.id} value={c.id}>{c.full_code} {c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-3 py-1" onClick={onClose}>취소</button>
          <button className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50" disabled={busy} onClick={async () => { try { setBusy(true); await onDelete(id, reassignTo || undefined); } finally { setBusy(false); } }}>삭제</button>
        </div>
      </div>
    </div>
  );
}
