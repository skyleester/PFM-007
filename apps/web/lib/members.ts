import { apiDelete, apiGet, apiPatch, apiPost } from "./api";

export type MemberRecord = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  display_name?: string | null;
  base_currency?: string | null;
  locale?: string | null;
  timezone?: string | null;
};

export type MemberCreateInput = {
  email: string;
  display_name?: string | null;
  base_currency?: string | null;
  locale?: string | null;
  timezone?: string | null;
  is_active?: boolean;
};

export type MemberUpdateInput = {
  email?: string;
  display_name?: string | null;
  base_currency?: string | null;
  locale?: string | null;
  timezone?: string | null;
  is_active?: boolean;
};

export async function fetchMembersDetailed() {
  return apiGet<MemberRecord[]>("/api/members");
}

export async function createMember(payload: MemberCreateInput) {
  return apiPost<MemberRecord>("/api/members", payload);
}

export async function updateMember(memberId: number, payload: MemberUpdateInput) {
  return apiPatch<MemberRecord>(`/api/members/${memberId}`, payload);
}

export async function deleteMember(memberId: number) {
  await apiDelete(`/api/members/${memberId}`);
  return { deleted: memberId };
}
