import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { StatisticsPreset, StatisticsSettings } from "./types";

type StatisticsSettingsResponse = {
  user_id: number;
  excluded_category_ids: number[];
};

function normalizeSettings(response: StatisticsSettingsResponse): StatisticsSettings {
  return {
    userId: response.user_id,
    excludedCategoryIds: response.excluded_category_ids ?? [],
  } satisfies StatisticsSettings;
}

export async function fetchStatisticsSettings(userId: number): Promise<StatisticsSettings> {
  const res = await apiGet<StatisticsSettingsResponse>("/api/statistics/settings", { user_id: userId });
  return normalizeSettings(res);
}

export async function updateStatisticsSettings(
  userId: number,
  excludedCategoryIds: number[],
): Promise<StatisticsSettings> {
  const res = await apiPut<StatisticsSettingsResponse>(
    "/api/statistics/settings",
    {
      user_id: userId,
      excluded_category_ids: excludedCategoryIds,
    },
  );
  return normalizeSettings(res);
}

type StatisticsPresetResponse = {
  id: number;
  user_id: number;
  name: string;
  memo: string | null;
  selected_category_ids: number[];
  created_at: string;
  updated_at: string;
};

function normalizePreset(response: StatisticsPresetResponse): StatisticsPreset {
  return {
    id: response.id,
    userId: response.user_id,
    name: response.name,
    memo: response.memo,
    selectedCategoryIds: response.selected_category_ids ?? [],
    createdAt: response.created_at,
    updatedAt: response.updated_at,
  } satisfies StatisticsPreset;
}

export async function fetchStatisticsPresets(userId: number): Promise<StatisticsPreset[]> {
  const res = await apiGet<StatisticsPresetResponse[]>("/api/statistics/presets", { user_id: userId });
  return res.map(normalizePreset);
}

export async function createStatisticsPreset(params: {
  userId: number;
  name: string;
  memo?: string | null;
  selectedCategoryIds: number[];
}): Promise<StatisticsPreset> {
  const res = await apiPost<StatisticsPresetResponse>("/api/statistics/presets", {
    user_id: params.userId,
    name: params.name,
    memo: params.memo,
    selected_category_ids: params.selectedCategoryIds,
  });
  return normalizePreset(res);
}

export async function updateStatisticsPreset(
  presetId: number,
  userId: number,
  changes: {
    name?: string;
    memo?: string | null;
    selectedCategoryIds?: number[];
  },
): Promise<StatisticsPreset> {
  const body: Record<string, unknown> = {};
  if (changes.name !== undefined) body.name = changes.name;
  if (changes.memo !== undefined) body.memo = changes.memo;
  if (changes.selectedCategoryIds !== undefined) body.selected_category_ids = changes.selectedCategoryIds;
  const res = await apiPut<StatisticsPresetResponse>(
    `/api/statistics/presets/${presetId}`,
    body,
    { user_id: userId },
  );
  return normalizePreset(res);
}

export async function deleteStatisticsPreset(presetId: number, userId: number): Promise<void> {
  await apiDelete(`/api/statistics/presets/${presetId}`, { user_id: userId });
}
