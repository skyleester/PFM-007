"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  differenceInCalendarMonths,
  differenceInCalendarYears,
  format,
  parseISO,
  startOfYear,
  subMonths,
  subYears,
} from "date-fns";
import clsx from "clsx";

import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { SplitLayout } from "@/components/layout/SplitLayout";
import { StickyAside } from "@/components/layout/StickyAside";

import type { StatisticsFilters, StatisticsPreset } from "@/lib/statistics/types";
import { useStatisticsData } from "@/lib/statistics/useStatisticsData";
import { fetchCategories, fetchCategoryGroups, type Category, type CategoryGroup } from "@/lib/categories";
import {
  updateStatisticsSettings,
  fetchStatisticsPresets,
  createStatisticsPreset,
  updateStatisticsPreset,
  deleteStatisticsPreset,
} from "@/lib/statistics/api";
import { AccountTimelineCard } from "@/components/statistics/AccountTimelineCard";
import { CategoryShareCard } from "@/components/statistics/CategoryShareCard";
import { InsightsList } from "@/components/statistics/InsightsList";
import { KpiSummary } from "@/components/statistics/KpiSummary";
import { MonthlyFlowCard } from "@/components/statistics/MonthlyFlowCard";
import { AdvancedMetricsCard } from "@/components/statistics/AdvancedMetricsCard";
import { ForecastCard } from "@/components/statistics/ForecastCard";
import { CategoryMomentumCard } from "@/components/statistics/CategoryMomentumCard";
import { CategoryTrendsTable } from "@/components/statistics/CategoryTrendsTable";
import { CategoryTrendChart } from "@/components/statistics/CategoryTrendChart";
import { WeeklyHeatmapCard } from "@/components/statistics/WeeklyHeatmapCard";
import { ExpenseAnomalyList } from "@/components/statistics/ExpenseAnomalyList";
import { RecurringCoverageCard } from "@/components/statistics/RecurringCoverageCard";

type Props = {
  initialFilters: StatisticsFilters;
};

const DATE_FORMAT = "yyyy-MM-dd";
const USER_ID = 1;
import { MemberSelector } from "@/components/MemberSelector";
import { usePersistentState } from "@/lib/hooks/usePersistentState";

type RangePreset = "1M" | "3M" | "6M" | "YTD" | "YOY" | "CUSTOM";


function areIdListsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((left, right) => left - right);
  const sortedB = [...b].sort((left, right) => left - right);
  return sortedA.every((value, index) => value === sortedB[index]);
}

function sortPresetsByName(list: StatisticsPreset[]): StatisticsPreset[] {
  return [...list].sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

function inferPreset(filters: StatisticsFilters): RangePreset {
  const startDate = parseDate(filters.start);
  const endDate = parseDate(filters.end);
  if (!startDate || !endDate) {
    return "CUSTOM";
  }
  const months = Math.abs(differenceInCalendarMonths(endDate, startDate));
  if (months === 1 || months === 0) {
    return "1M";
  }
  if (months === 3 || months === 2) {
    return "3M";
  }
  if (months === 6 || months === 5) {
    return "6M";
  }
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === 0 && startDate.getDate() === 1) {
    return "YTD";
  }
  const years = Math.abs(differenceInCalendarYears(endDate, startDate));
  if (years === 1) {
    return "YOY";
  }
  return "CUSTOM";
}

function computePresetRange(preset: RangePreset, referenceEnd: Date): { start: string; end: string } | null {
  const end = format(referenceEnd, DATE_FORMAT);
  switch (preset) {
    case "1M": {
      const start = subMonths(referenceEnd, 1);
      return { start: format(start, DATE_FORMAT), end };
    }
    case "3M": {
      const start = subMonths(referenceEnd, 3);
      return { start: format(start, DATE_FORMAT), end };
    }
    case "6M": {
      const start = subMonths(referenceEnd, 6);
      return { start: format(start, DATE_FORMAT), end };
    }
    case "YTD": {
      const start = startOfYear(referenceEnd);
      return { start: format(start, DATE_FORMAT), end };
    }
    case "YOY": {
      const start = addDays(subYears(referenceEnd, 1), 1);
      return { start: format(start, DATE_FORMAT), end };
    }
    default:
      return null;
  }
}

function normalizeDate(value: string): string {
  if (!value) return "";
  try {
    return format(parseISO(value), DATE_FORMAT);
  } catch {
    return value;
  }
}

export default function StatisticsClient({ initialFilters }: Props) {
  const [filters, setFilters] = useState<StatisticsFilters>(initialFilters);
  const [activePreset, setActivePreset] = useState<RangePreset>(() => inferPreset(initialFilters));
  const [memberIds, setMemberIds] = usePersistentState<number[]>("pfm:members:selection:v1", [USER_ID]);
  const { data, loading, error, refresh } = useStatisticsData(filters, memberIds);
  // Persist includeSettlements globally and per-preset (client-only, no backend schema change)
  const [persistedIncludeSettlements, setPersistedIncludeSettlements] = usePersistentState<boolean>(
    "pfm:statistics:includeSettlements:v1",
    initialFilters.includeSettlements ?? false,
  );
  const [presetIncludeSettlementsMap, setPresetIncludeSettlementsMap] = usePersistentState<Record<number, boolean>>(
    "pfm:statistics:presetIncludeSettlements:v1",
    {},
  );
  const [selectedDraft, setSelectedDraft] = useState<number[]>([]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [activeGroupIds, setActiveGroupIds] = useState<number[]>([]);
  const [presets, setPresets] = useState<StatisticsPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetMemo, setPresetMemo] = useState("");
  const [presetFormError, setPresetFormError] = useState<string | null>(null);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetMutationId, setPresetMutationId] = useState<number | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<number | null>(null);
  const [activePresetId, setActivePresetId] = useState<number | null>(null);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadCategories = useCallback(
    async (cancelRef?: { current: boolean }) => {
      setCategoryLoading(true);
      setCategoryError(null);
      try {
        const [categoryList, groupList] = await Promise.all([
          fetchCategories({ user_id: USER_ID, page: 1, page_size: 500 }),
          fetchCategoryGroups({ user_id: USER_ID }),
        ]);
        if (cancelRef?.current) return;
        setCategories(categoryList);
        setCategoryGroups(groupList);
      } catch (err) {
        if (cancelRef?.current) return;
        const message = err instanceof Error ? err.message : "카테고리 정보를 불러오지 못했습니다.";
        setCategoryError(message);
      } finally {
        if (cancelRef?.current) return;
        setCategoryLoading(false);
      }
    },
    [],
  );

  const loadPresets = useCallback(
    async (cancelRef?: { current: boolean }) => {
      setPresetsLoading(true);
      setPresetsError(null);
      try {
        const list = await fetchStatisticsPresets(USER_ID);
        if (cancelRef?.current) return;
        setPresets(sortPresetsByName(list));
      } catch (err) {
        if (cancelRef?.current) return;
        const message = err instanceof Error ? err.message : "프리셋을 불러오지 못했습니다.";
        setPresetsError(message);
      } finally {
        if (cancelRef?.current) return;
        setPresetsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const cancelRef = { current: false };
    void loadCategories(cancelRef);
    return () => {
      cancelRef.current = true;
    };
  }, [loadCategories]);

  useEffect(() => {
    const cancelRef = { current: false };
    void loadPresets(cancelRef);
    return () => {
      cancelRef.current = true;
    };
  }, [loadPresets]);

  // Sync persisted includeSettlements into current filters on mount/when persistence changes
  useEffect(() => {
    setFilters((prev) => (prev.includeSettlements === persistedIncludeSettlements
      ? prev
      : { ...prev, includeSettlements: persistedIncludeSettlements }));
  }, [persistedIncludeSettlements]);

  const handleReloadPresets = useCallback(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    setActiveGroupIds((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const existingIds = new Set(categoryGroups.map((group) => group.id));
      const next = prev.filter((id) => existingIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [categoryGroups]);

  const handleReloadCategories = useCallback(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (!data?.filters) return;
    const next = data.filters.excludedCategoryIds ?? [];
    setFilters((prev) => (areIdListsEqual(prev.excludedCategoryIds ?? [], next) ? prev : { ...prev, excludedCategoryIds: next }));
  }, [data?.filters]);

  useEffect(() => {
    if (!settingsMessage) return;
    const timer = window.setTimeout(() => setSettingsMessage(null), 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [settingsMessage]);

  useEffect(() => {
    if (!presetMessage) return;
    const timer = window.setTimeout(() => setPresetMessage(null), 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [presetMessage]);

  useEffect(() => {
    setPresetFormError(null);
  }, [presetName, presetMemo, selectedDraft]);

  useEffect(() => {
    const nextActive = presets.length === 0
      ? null
      : presets.find((preset) => areIdListsEqual(preset.selectedCategoryIds ?? [], selectedDraft))?.id ?? null;
    setActivePresetId((prev) => (prev === nextActive ? prev : nextActive));
  }, [presets, selectedDraft]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const { style } = document.body;
    const previousOverflow = style.overflow;
    style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      style.overflow = previousOverflow;
    };
  }, [settingsOpen]);

  const baselineExcluded = useMemo(
    () => data?.filters?.excludedCategoryIds ?? filters.excludedCategoryIds ?? [],
    [data?.filters?.excludedCategoryIds, filters.excludedCategoryIds],
  );

  const categoryGroupsById = useMemo(() => new Map(categoryGroups.map((group) => [group.id, group])), [categoryGroups]);

  const groupToCategoryIds = useMemo(() => {
    const map = new Map<number, number[]>();
    categories.forEach((category) => {
      if (!map.has(category.group_id)) {
        map.set(category.group_id, []);
      }
      map.get(category.group_id)!.push(category.id);
    });
    return map;
  }, [categories]);

  const sortedCategories = useMemo(() => {
    return categories
      .slice()
      .sort((a, b) => a.full_code.localeCompare(b.full_code));
  }, [categories]);

  const filteredGroupsByType = useMemo(() => {
    const searchValue = groupSearch.trim().toLowerCase();
    const grouped: Record<"I" | "E" | "T", CategoryGroup[]> = { I: [], E: [], T: [] };
    categoryGroups
      .slice()
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type.localeCompare(b.type);
        }
        return a.code_gg - b.code_gg;
      })
      .forEach((group) => {
        const label = `${group.type}${String(group.code_gg).padStart(2, "0")} ${group.name}`.toLowerCase();
        if (searchValue && !label.includes(searchValue)) {
          return;
        }
        grouped[group.type].push(group);
      });
    return grouped;
  }, [categoryGroups, groupSearch]);

  const hasAnyFilteredGroups = useMemo(
    () => filteredGroupsByType.I.length + filteredGroupsByType.E.length + filteredGroupsByType.T.length > 0,
    [filteredGroupsByType],
  );

  const visibleCategories = useMemo(() => {
    const searchValue = categorySearch.trim().toLowerCase();
    const activeSet = activeGroupIds.length > 0 ? new Set(activeGroupIds) : null;
    return sortedCategories.filter((category) => {
      if (activeSet && !activeSet.has(category.group_id)) {
        return false;
      }
      if (searchValue && !`${category.full_code} ${category.name}`.toLowerCase().includes(searchValue)) {
        return false;
      }
      return true;
    });
  }, [sortedCategories, activeGroupIds, categorySearch]);

  const categoryLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    sortedCategories.forEach((category) => {
      const group = categoryGroupsById.get(category.group_id);
      const groupLabel = group ? `${group.type}${String(group.code_gg).padStart(2, "0")} ${group.name}` : null;
      const label = groupLabel ? `${category.full_code} ${category.name} (${groupLabel})` : `${category.full_code} ${category.name}`;
      map.set(category.id, label);
    });
    return map;
  }, [sortedCategories, categoryGroupsById]);

  const allCategoryIds = useMemo(() => sortedCategories.map((category) => category.id), [sortedCategories]);

  const handleRefreshClick = useCallback(() => {
    const applySelection = (selection: number[]) => {
      if (allCategoryIds.length === 0) {
        return;
      }
      const normalized = Array.from(new Set(selection)).sort((a, b) => a - b);
      const normalizedExcluded = allCategoryIds.filter((id) => !normalized.includes(id));
      setFilters((prev) => (areIdListsEqual(prev.excludedCategoryIds ?? [], normalizedExcluded)
        ? prev
        : { ...prev, excludedCategoryIds: normalizedExcluded }));
    };

    if (activePresetId !== null) {
      const activePreset = presets.find((item) => item.id === activePresetId);
      if (activePreset) {
        const normalized = Array.from(new Set(activePreset.selectedCategoryIds ?? [])).sort((a, b) => a - b);
        setSelectedDraft((prev) => (areIdListsEqual(prev, normalized) ? prev : normalized));
        applySelection(normalized);
      } else {
        applySelection(selectedDraft);
      }
    } else {
      applySelection(selectedDraft);
    }

    refresh();
  }, [activePresetId, presets, allCategoryIds, selectedDraft, refresh]);

  const baselineSelected = useMemo(() => {
    if (sortedCategories.length === 0) {
      return [];
    }
    const excludedSet = new Set(baselineExcluded);
    return sortedCategories
      .filter((category) => !excludedSet.has(category.id))
      .map((category) => category.id);
  }, [sortedCategories, baselineExcluded]);

  const baselineSyncKey = useMemo(() => {
    const categoriesKey = allCategoryIds.join(",");
    return `${baselineSelected.join(",")}|${categoriesKey}`;
  }, [baselineSelected, allCategoryIds]);

  const isSettingsDirty = useMemo(() => !areIdListsEqual(selectedDraft, baselineSelected), [selectedDraft, baselineSelected]);

  useEffect(() => {
    if (sortedCategories.length === 0) {
      return;
    }
    setSelectedDraft((prev) => {
      const allowed = new Set(allCategoryIds);
      const normalizedPrev = prev.filter((id) => allowed.has(id));
      const shouldRespectDirty = isSettingsDirty && !(prev.length === 0 && baselineSelected.length > 0);
      if (normalizedPrev.length !== prev.length) {
        return normalizedPrev;
      }
      if (shouldRespectDirty) {
        return prev;
      }
      if (!areIdListsEqual(prev, baselineSelected)) {
        return baselineSelected;
      }
      return prev;
    });
  }, [baselineSyncKey, baselineSelected, sortedCategories, allCategoryIds, isSettingsDirty, selectedDraft.length]);

  const selectedIdSet = useMemo(() => new Set(selectedDraft), [selectedDraft]);

  const selectedCategorySummaries = useMemo(() => {
    return selectedDraft
      .map((id) => ({ id, label: categoryLabelMap.get(id) ?? `카테고리 ${id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [categoryLabelMap, selectedDraft]);

  const toggleGroupFilter = useCallback((groupId: number) => {
    setActiveGroupIds((prev) => {
      const set = new Set(prev);
      if (set.has(groupId)) {
        set.delete(groupId);
      } else {
        set.add(groupId);
      }
      return Array.from(set);
    });
  }, []);

  const handleResetGroupFilters = useCallback(() => {
    setActiveGroupIds([]);
  }, []);

  const handleToggleGroupSelection = useCallback(
    (groupId: number, shouldSelectAll: boolean) => {
      const targetIds = groupToCategoryIds.get(groupId) ?? [];
      if (targetIds.length === 0) {
        return;
      }
      setSelectedDraft((prev) => {
        const set = new Set(prev);
        if (shouldSelectAll) {
          targetIds.forEach((id) => set.add(id));
        } else {
          targetIds.forEach((id) => set.delete(id));
        }
        return Array.from(set).sort((a, b) => a - b);
      });
    },
    [groupToCategoryIds],
  );

  const allSelected = useMemo(() => selectedDraft.length > 0 && selectedDraft.length === allCategoryIds.length, [selectedDraft, allCategoryIds]);

  const toggleAllCategories = useCallback(() => {
    if (allCategoryIds.length === 0) {
      return;
    }
    setSelectedDraft(allSelected ? [] : [...allCategoryIds].sort((a, b) => a - b));
  }, [allCategoryIds, allSelected]);

  const handleToggleVisibleCategories = useCallback(() => {
    if (visibleCategories.length === 0) {
      return;
    }
    setSelectedDraft((prev) => {
      const set = new Set(prev);
      const everyVisibleSelected = visibleCategories.every((category) => set.has(category.id));
      if (everyVisibleSelected) {
        visibleCategories.forEach((category) => set.delete(category.id));
      } else {
        visibleCategories.forEach((category) => set.add(category.id));
      }
      return Array.from(set).sort((a, b) => a - b);
    });
  }, [visibleCategories]);

  const handleToggleCategory = useCallback((categoryId: number) => {
    setSelectedDraft((prev) => {
      if (prev.includes(categoryId)) {
        return prev.filter((id) => id !== categoryId);
      }
      return [...prev, categoryId].sort((a, b) => a - b);
    });
  }, []);

  const handleSaveSettings = useCallback(async () => {
    const normalizedSelected = Array.from(new Set(selectedDraft)).sort((a, b) => a - b);
    const normalizedExcluded = allCategoryIds.filter((id) => !normalizedSelected.includes(id));
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      await updateStatisticsSettings(USER_ID, normalizedExcluded);
      setSettingsMessage("선택한 카테고리 설정을 저장했습니다.");
      setSelectedDraft(normalizedSelected);
      setFilters((prev) => ({ ...prev, excludedCategoryIds: normalizedExcluded }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "설정을 저장하지 못했습니다.";
      setSettingsError(message);
    } finally {
      setSettingsSaving(false);
    }
  }, [selectedDraft, allCategoryIds]);

  const handleApplyPreset = useCallback((preset: StatisticsPreset) => {
    const normalized = Array.from(new Set(preset.selectedCategoryIds)).sort((a, b) => a - b);
    setSelectedDraft((prev) => (areIdListsEqual(prev, normalized) ? prev : normalized));
    setPresetFormError(null);
    setPresetMessage(null);
    setEditingPresetId(null);
    setPresetName("");
    setPresetMemo("");
    setActivePresetId(preset.id);
    // Apply per-preset includeSettlements if saved; otherwise keep current setting
    const presetFlag = presetIncludeSettlementsMap[preset.id];
    if (typeof presetFlag === "boolean") {
      setFilters((prev) => ({ ...prev, includeSettlements: presetFlag }));
    }
  }, [presetIncludeSettlementsMap, setFilters]);

  const handleEditPreset = useCallback((preset: StatisticsPreset) => {
    setEditingPresetId(preset.id);
    setPresetName(preset.name);
    setPresetMemo(preset.memo ?? "");
    const normalized = Array.from(new Set(preset.selectedCategoryIds)).sort((a, b) => a - b);
    setSelectedDraft((prev) => (areIdListsEqual(prev, normalized) ? prev : normalized));
    setPresetFormError(null);
    setPresetMessage(null);
  }, []);

  const handleResetPresetForm = useCallback(() => {
    setEditingPresetId(null);
    setPresetName("");
    setPresetMemo("");
    setPresetFormError(null);
  }, []);

  const handleSubmitPreset = useCallback(async () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) {
      setPresetFormError("프리셋 이름을 입력해주세요.");
      return;
    }
    if (selectedDraft.length === 0) {
      setPresetFormError("최소 한 개의 카테고리를 선택해야 합니다.");
      return;
    }
    const memoValue = presetMemo.trim();
    setPresetFormError(null);
    setPresetSaving(true);
    if (editingPresetId !== null) {
      setPresetMutationId(editingPresetId);
    }
    try {
      if (editingPresetId === null) {
        const created = await createStatisticsPreset({
          userId: USER_ID,
          name: trimmedName,
          memo: memoValue ? memoValue : null,
          selectedCategoryIds: selectedDraft,
        });
        setPresets((prev) => sortPresetsByName([...prev, created]));
        setPresetMessage("프리셋을 저장했습니다.");
        setActivePresetId(created.id);
        // Save includeSettlements for this preset locally
        setPresetIncludeSettlementsMap((prev) => ({ ...prev, [created.id]: filters.includeSettlements }));
      } else {
        const updated = await updateStatisticsPreset(editingPresetId, USER_ID, {
          name: trimmedName,
          memo: memoValue,
          selectedCategoryIds: selectedDraft,
        });
        setPresets((prev) => sortPresetsByName(prev.map((item) => (item.id === updated.id ? updated : item))));
        setPresetMessage("프리셋을 업데이트했습니다.");
        setActivePresetId(updated.id);
        // Update local includeSettlements mapping for this preset
        setPresetIncludeSettlementsMap((prev) => ({ ...prev, [updated.id]: filters.includeSettlements }));
      }
      setPresetName("");
      setPresetMemo("");
      setEditingPresetId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "프리셋을 저장하지 못했습니다.";
      setPresetFormError(message);
    } finally {
      setPresetSaving(false);
      setPresetMutationId(null);
    }
  }, [presetName, presetMemo, selectedDraft, editingPresetId, filters.includeSettlements, setPresetIncludeSettlementsMap]);

  const handleDeletePreset = useCallback(
    async (preset: StatisticsPreset) => {
      if (typeof window !== "undefined") {
        const confirmed = window.confirm(`'${preset.name}' 프리셋을 삭제할까요?`);
        if (!confirmed) {
          return;
        }
      }
      setPresetFormError(null);
      setPresetMutationId(preset.id);
      try {
        await deleteStatisticsPreset(preset.id, USER_ID);
        setPresets((prev) => prev.filter((item) => item.id !== preset.id));
        setPresetMessage("프리셋을 삭제했습니다.");
        // Clean up local mapping
        setPresetIncludeSettlementsMap((prev) => {
          const { [preset.id]: _, ...rest } = prev;
          return rest;
        });
        if (editingPresetId === preset.id) {
          setEditingPresetId(null);
          setPresetName("");
          setPresetMemo("");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "프리셋을 삭제하지 못했습니다.";
        setPresetFormError(message);
      } finally {
        setPresetMutationId(null);
      }
    },
    [editingPresetId, setPresetIncludeSettlementsMap],
  );
  const presetButtons: Array<{ key: RangePreset; label: string }> = [
    { key: "1M", label: "1개월" },
    { key: "3M", label: "3개월" },
    { key: "6M", label: "6개월" },
    { key: "YTD", label: "YTD" },
    { key: "YOY", label: "YoY" },
    { key: "CUSTOM", label: "임의기간" },
  ];

  const handlePresetSelect = (preset: RangePreset) => {
    setActivePreset(preset);
    if (preset === "CUSTOM") {
      return;
    }
    const endDate = parseDate(filters.end) ?? new Date();
    const range = computePresetRange(preset, endDate);
    if (!range) {
      return;
    }
    setFilters((prev) => ({
      ...prev,
      start: range.start,
      end: range.end,
    }));
  };
  const FiltersSection = () => (
    <SectionCard
      title="분석 범위"
      description="기간과 대상 구성원을 조정하면 대시보드 전반이 즉시 갱신됩니다."
      headerAction={
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <button
            className="rounded border px-3 py-1"
            onClick={handleRefreshClick}
            disabled={loading}
            type="button"
          >
            새로고침
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => setSettingsOpen(true)}
          >
            설정
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-xs text-gray-700 sm:text-sm">
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase text-gray-500">구성원</span>
          <MemberSelector value={memberIds} onChange={setMemberIds} />
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase text-gray-500">기간 프리셋</p>
          <div className="flex flex-wrap items-center gap-2">
            {presetButtons.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={clsx(
                  "rounded border px-3 py-1",
                  activePreset === preset.key ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-600",
                )}
                onClick={() => handlePresetSelect(preset.key)}
                disabled={loading && activePreset === preset.key}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-gray-600">
            <span className="text-[11px] font-semibold uppercase">시작일</span>
            <input
              type="date"
              className="rounded border px-2 py-1"
              value={filters.start}
              onChange={(event) => {
                const next = normalizeDate(event.target.value);
                setFilters((prev) => {
                  if (!next) {
                    setActivePreset("CUSTOM");
                    return { ...prev, start: "" };
                  }
                  const adjustedEnd = prev.end && prev.end < next ? next : prev.end;
                  setActivePreset("CUSTOM");
                  return { ...prev, start: next, end: adjustedEnd };
                });
              }}
              max={filters.end}
            />
          </label>
          <label className="flex flex-col gap-1 text-gray-600">
            <span className="text-[11px] font-semibold uppercase">종료일</span>
            <input
              type="date"
              className="rounded border px-2 py-1"
              value={filters.end}
              onChange={(event) => {
                const next = normalizeDate(event.target.value);
                setFilters((prev) => {
                  if (!next) {
                    setActivePreset("CUSTOM");
                    return { ...prev, end: "" };
                  }
                  const adjustedStart = prev.start && prev.start > next ? next : prev.start;
                  setActivePreset("CUSTOM");
                  return { ...prev, end: next, start: adjustedStart ?? next };
                });
              }}
              min={filters.start}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-semibold uppercase text-gray-500" htmlFor="statistics-preset-select">
            프리셋
          </label>
          <select
            id="statistics-preset-select"
            className="min-w-[160px] rounded border px-2 py-1 text-sm"
            value={activePresetId ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) {
                setActivePresetId(null);
                return;
              }
              const presetId = Number(value);
              const target = presets.find((item) => item.id === presetId);
              if (target) {
                handleApplyPreset(target);
              }
            }}
          >
            <option value="">프리셋 선택</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Statistics"
        subtitle="지출, 수입, 계좌 흐름을 한눈에 살펴보는 대시보드입니다."
      />
      <SplitLayout
        sidebar={
          <StickyAside
            className="static lg:sticky overflow-visible border-transparent bg-transparent p-0 shadow-none lg:overflow-y-auto"
            offset={104}
          >
            <FiltersSection />
          </StickyAside>
        }
        main={
          <>
            <KpiSummary loading={loading} kpis={data?.kpis ?? null} />
            <AdvancedMetricsCard loading={loading} data={data?.advanced ?? null} />
            <div className={clsx("grid gap-4", "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
              <div className="space-y-4">
                <div className={clsx("grid gap-4", "md:grid-cols-2")}>
                  <MonthlyFlowCard loading={loading} data={data?.monthlyFlow ?? []} />
                  <CategoryShareCard loading={loading} data={data?.categoryShare ?? []} />
                </div>
                <WeeklyHeatmapCard loading={loading} data={data?.weeklyHeatmap ?? null} />
                <CategoryTrendChart loading={loading} trends={data?.categoryTrends ?? []} />
                <CategoryTrendsTable loading={loading} trends={data?.categoryTrends ?? []} />
                <ExpenseAnomalyList loading={loading} anomalies={data?.expenseAnomalies ?? []} />
              </div>
              <div className="space-y-4">
                <ForecastCard loading={loading} data={data?.forecast ?? null} />
                <CategoryMomentumCard loading={loading} momentum={data?.categoryMomentum ?? null} />
                <RecurringCoverageCard
                  loading={loading}
                  coverage={data?.recurringCoverage ?? null}
                  alerts={data?.incomeAlerts ?? []}
                />
              </div>
            </div>
            <AccountTimelineCard loading={loading} series={data?.accountTimeline ?? []} />
            <InsightsList loading={loading} insights={data?.insights ?? []} />
          </>
        }
      />

      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex">
          <button
            type="button"
            className="flex-1 bg-slate-900/40"
            aria-label="통계 설정 닫기"
            onClick={() => setSettingsOpen(false)}
          />
          <aside className="relative flex h-full w-full max-w-[420px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">통계 설정</h2>
                <p className="text-[11px] text-gray-500">집계 대상 카테고리와 필터를 조정하면 통계 카드와 차트에 즉시 반영됩니다.</p>
              </div>
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs"
                onClick={() => setSettingsOpen(false)}
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="space-y-4">
                <section className="rounded border bg-gray-50 p-3 text-xs">
                  <p className="text-[11px] font-semibold text-gray-600">데이터 범위</p>
                  <div className="mt-2 space-y-2">
                    <label className="flex flex-col gap-1 text-xs text-gray-600">
                      <span>계정 선택</span>
                      <select
                        className="rounded border px-2 py-1"
                        value={filters.accountId ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setFilters((prev) => ({
                            ...prev,
                            accountId: value === "" ? null : Number(value),
                          }));
                        }}
                      >
                        <option value="">전체 계정</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2">
                      <span className="text-xs text-gray-600">이체 포함</span>
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        checked={filters.includeTransfers}
                        onChange={(event) => {
                          setFilters((prev) => ({ ...prev, includeTransfers: event.target.checked }));
                        }}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2">
                      <span className="text-xs text-gray-600" title="체크 해제 시 카드 사용만 통계에 반영되고, 결제(정산)는 제외됩니다.">카드 결제(정산) 포함</span>
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        checked={filters.includeSettlements}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setFilters((prev) => ({ ...prev, includeSettlements: next }));
                          // persist globally
                          setPersistedIncludeSettlements(next);
                          // if preset active, remember per-preset
                          if (activePresetId !== null) {
                            setPresetIncludeSettlementsMap((prev) => ({ ...prev, [activePresetId]: next }));
                          }
                        }}
                      />
                    </label>
                    <p className="text-[11px] text-gray-500">기본값은 결제(정산) 제외입니다. 필요 시 이 옵션을 켜서 정산을 함께 포함할 수 있습니다.</p>
                  </div>
                </section>

                <section className="rounded border bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">카테고리 선택</h3>
                      <p className="mt-1 text-xs text-gray-500">체크된 카테고리만 KPI와 차트 집계에 포함됩니다.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        className="rounded border px-3 py-1"
                        onClick={toggleAllCategories}
                        disabled={settingsSaving || allCategoryIds.length === 0}
                      >
                        {allSelected ? "전체 해제" : "전체 선택"}
                      </button>
                      <button
                        type="button"
                        className={clsx(
                          "rounded border px-3 py-1",
                          settingsSaving || !isSettingsDirty ? "border-gray-200 text-gray-400" : "border-blue-500 bg-blue-50 text-blue-600",
                        )}
                        onClick={handleSaveSettings}
                        disabled={settingsSaving || !isSettingsDirty}
                      >
                        {settingsSaving ? "저장 중..." : "변경 적용"}
                      </button>
                    </div>
                  </div>
                  {settingsError && <p className="mt-2 text-xs text-red-600">{settingsError}</p>}
                  {settingsMessage && <p className="mt-2 text-xs text-green-600">{settingsMessage}</p>}
                  <div className="mt-3 rounded border bg-gray-50 p-3">
                    {categoryLoading ? (
                      <p className="text-xs text-gray-500">카테고리를 불러오는 중입니다...</p>
                    ) : categoryError ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-red-600">
                        <span>{categoryError}</span>
                        <button
                          type="button"
                          className="rounded border px-2 py-1"
                          onClick={handleReloadCategories}
                          disabled={settingsSaving}
                        >
                          다시 시도
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 text-xs">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold text-gray-600">대분류 (카테고리 그룹)</p>
                            <button
                              type="button"
                              className="rounded border px-2 py-1"
                              onClick={handleResetGroupFilters}
                              disabled={activeGroupIds.length === 0}
                            >
                              필터 초기화
                            </button>
                          </div>
                          <input
                            type="text"
                            className="mt-2 w-full rounded border px-2 py-1"
                            placeholder="대분류 검색"
                            value={groupSearch}
                            onChange={(event) => setGroupSearch(event.target.value)}
                          />
                          <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                            {(["I", "E", "T"] as const).map((type) => {
                              const groups = filteredGroupsByType[type];
                              if (groups.length === 0) {
                                return null;
                              }
                              const typeLabel = type === "I" ? "수입" : type === "E" ? "지출" : "이체";
                              return (
                                <div key={type} className="space-y-1">
                                  <p className="text-[11px] font-semibold uppercase text-gray-500">{typeLabel}</p>
                                  <ul className="space-y-1">
                                    {groups.map((group) => {
                                      const categoryIds = groupToCategoryIds.get(group.id) ?? [];
                                      const selectedCount = categoryIds.reduce((count, categoryId) => count + (selectedIdSet.has(categoryId) ? 1 : 0), 0);
                                      const groupAllSelected = categoryIds.length > 0 && selectedCount === categoryIds.length;
                                      const partiallySelected = selectedCount > 0 && !groupAllSelected;
                                      const isActive = activeGroupIds.includes(group.id);
                                      const groupLabel = `${group.type}${String(group.code_gg).padStart(2, "0")} ${group.name}`;
                                      return (
                                        <li key={group.id}>
                                          <div className="flex items-center gap-2 rounded px-1 py-1 hover:bg-gray-100">
                                            <input
                                              type="checkbox"
                                              className="accent-blue-500"
                                              ref={(element) => {
                                                if (element) {
                                                  element.indeterminate = partiallySelected;
                                                }
                                              }}
                                              checked={groupAllSelected}
                                              onChange={(event) => handleToggleGroupSelection(group.id, event.target.checked)}
                                              disabled={settingsSaving || categoryIds.length === 0}
                                            />
                                            <button
                                              type="button"
                                              className={clsx(
                                                "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors",
                                                isActive ? "bg-blue-50 text-blue-600" : "text-gray-700",
                                              )}
                                              onClick={() => toggleGroupFilter(group.id)}
                                            >
                                              <span className="truncate">{groupLabel}</span>
                                              <span className="ml-auto text-[10px] text-gray-500">{selectedCount}/{categoryIds.length}</span>
                                            </button>
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              );
                            })}
                            {categoryGroups.length === 0 && (
                              <p className="text-[11px] text-gray-500">등록된 카테고리 그룹이 없습니다.</p>
                            )}
                            {categoryGroups.length > 0 && !hasAnyFilteredGroups && (
                              <p className="text-[11px] text-gray-500">조건에 맞는 대분류가 없습니다.</p>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex min-w-[200px] flex-1 flex-col">
                              <p className="text-[11px] font-semibold text-gray-600">소분류 (카테고리)</p>
                              <input
                                type="text"
                                className="mt-2 w-full rounded border px-2 py-1"
                                placeholder="소분류 검색"
                                value={categorySearch}
                                onChange={(event) => setCategorySearch(event.target.value)}
                              />
                            </div>
                            <button
                              type="button"
                              className="rounded border px-3 py-1"
                              onClick={handleToggleVisibleCategories}
                              disabled={settingsSaving || visibleCategories.length === 0}
                            >
                              {visibleCategories.length > 0 && visibleCategories.every((category) => selectedIdSet.has(category.id))
                                ? "현재 목록 해제"
                                : "현재 목록 선택"}
                            </button>
                          </div>
                          <div className="mt-2 max-h-52 overflow-y-auto rounded border bg-white p-2">
                            {visibleCategories.length > 0 ? (
                              <div className="grid gap-1 sm:grid-cols-2">
                                {visibleCategories.map((category) => {
                                  const group = categoryGroupsById.get(category.group_id);
                                  const groupLabel = group ? `${group.type}${String(group.code_gg).padStart(2, "0")} ${group.name}` : null;
                                  const isChecked = selectedIdSet.has(category.id);
                                  return (
                                    <label
                                      key={category.id}
                                      className="flex items-center gap-2 rounded px-1 py-1 hover:bg-gray-100"
                                    >
                                      <input
                                        type="checkbox"
                                        className="accent-blue-500"
                                        checked={isChecked}
                                        onChange={() => handleToggleCategory(category.id)}
                                        disabled={settingsSaving}
                                      />
                                      <span className="flex min-w-0 flex-col">
                                        <span className="truncate">{`${category.full_code} ${category.name}`}</span>
                                        {groupLabel && <span className="text-[10px] text-gray-500">{groupLabel}</span>}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500">조건에 맞는 카테고리가 없습니다.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 rounded border border-dashed bg-gray-50 p-2 text-[11px] text-gray-600">
                    <p className="font-semibold">선택된 카테고리 {selectedCategorySummaries.length}개</p>
                    {selectedCategorySummaries.length > 0 ? (
                      <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto pr-1">
                        {selectedCategorySummaries.map((item) => (
                          <li key={item.id} className="truncate">{item.label}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1">현재 선택된 카테고리가 없습니다.</p>
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded border bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-[200px] flex-1 flex-col">
                      <label className="text-[11px] font-semibold text-gray-600" htmlFor="statistics-preset-name">프리셋 이름</label>
                      <input
                        id="statistics-preset-name"
                        type="text"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                        value={presetName}
                        onChange={(event) => setPresetName(event.target.value)}
                        maxLength={120}
                        disabled={presetSaving || presetMutationId !== null}
                        placeholder="예: 월간 지출 체크"
                      />
                    </div>
                    <div className="flex min-w-[200px] flex-1 flex-col">
                      <label className="text-[11px] font-semibold text-gray-600" htmlFor="statistics-preset-memo">메모 (선택)</label>
                      <input
                        id="statistics-preset-memo"
                        type="text"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                        value={presetMemo}
                        onChange={(event) => setPresetMemo(event.target.value)}
                        maxLength={2000}
                        disabled={presetSaving || presetMutationId !== null}
                        placeholder="설명을 추가하세요"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        className={clsx(
                          "rounded border px-3 py-1",
                          presetSaving ? "border-gray-200 text-gray-400" : "border-blue-500 bg-blue-50 text-blue-600",
                        )}
                        onClick={handleSubmitPreset}
                        disabled={presetSaving || presetMutationId !== null}
                      >
                        {presetSaving ? "저장 중..." : editingPresetId === null ? "프리셋 저장" : "프리셋 업데이트"}
                      </button>
                      {editingPresetId !== null && (
                        <button
                          type="button"
                          className="rounded border px-3 py-1"
                          onClick={handleResetPresetForm}
                          disabled={presetSaving || presetMutationId !== null}
                        >
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-600">현재 선택된 카테고리 {selectedDraft.length}개가 프리셋에 저장됩니다.</p>
                  {presetFormError && <p className="text-[11px] text-red-600">{presetFormError}</p>}
                  {presetMessage && <p className="text-[11px] text-green-600">{presetMessage}</p>}
                </section>

                <section className="rounded border bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">저장된 카테고리 프리셋</p>
                      <p className="text-[11px] text-gray-500">저장된 프리셋을 적용하거나 편집할 수 있습니다.</p>
                    </div>
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      onClick={handleReloadPresets}
                      disabled={presetsLoading}
                    >
                      새로고침
                    </button>
                  </div>
                  {presetsError && <p className="mt-2 text-[11px] text-red-600">{presetsError}</p>}
                  {presetsLoading ? (
                    <p className="mt-2 text-[11px] text-gray-500">프리셋을 불러오는 중입니다...</p>
                  ) : presets.length === 0 ? (
                    <p className="mt-2 text-[11px] text-gray-500">저장된 프리셋이 없습니다. 현재 선택을 프리셋으로 저장해보세요.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {presets.map((preset) => {
                        const isActivePreset = activePresetId === preset.id;
                        const isMutating = presetMutationId === preset.id;
                        return (
                          <li key={preset.id} className="rounded border bg-white p-3 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-gray-800">{preset.name}</p>
                                  {isActivePreset && <span className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">현재 선택</span>}
                                </div>
                                {preset.memo && <p className="text-[11px] text-gray-600">{preset.memo}</p>}
                                <p className="text-[10px] text-gray-500">카테고리 {preset.selectedCategoryIds.length}개</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <button
                                  type="button"
                                  className="rounded border px-3 py-1"
                                  onClick={() => handleApplyPreset(preset)}
                                  disabled={isMutating}
                                >
                                  적용
                                </button>
                                <button
                                  type="button"
                                  className="rounded border px-3 py-1"
                                  onClick={() => handleEditPreset(preset)}
                                  disabled={isMutating}
                                >
                                  편집
                                </button>
                                <button
                                  type="button"
                                  className="rounded border px-3 py-1 text-red-600"
                                  onClick={() => handleDeletePreset(preset)}
                                  disabled={isMutating}
                                >
                                  삭제
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
