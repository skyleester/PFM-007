import { apiGet } from "./api";

export type AccountRecord = {
  id: number;
  user_id: number;
  name: string;
  type: string;
  currency: string | null;
  balance: number | string;
  is_archived: boolean;
};

export async function fetchAccounts(params: { user_id: number; include_archived?: boolean }) {
  return apiGet<AccountRecord[]>("/api/accounts", params);
}
