import { apiGet } from "./api";

export type Category = { id: number; user_id: number; group_id: number; code_cc: number; name: string; full_code: string };
export type CategoryGroup = { id: number; user_id: number; type: "I" | "E" | "T"; code_gg: number; name: string };

export async function fetchCategories(params: { user_id: number; type?: "I" | "E" | "T"; group_code?: number; search?: string; page?: number; page_size?: number }) {
  return apiGet<Category[]>("/api/categories", params);
}

export async function fetchCategoryGroups(params: { user_id: number; type?: "I" | "E" | "T"; search?: string }) {
  return apiGet<CategoryGroup[]>("/api/category-groups", params);
}
