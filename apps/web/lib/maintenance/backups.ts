import { apiDelete, apiGet, apiPost } from "../api";

export type BackupInfo = {
  filename: string;
  size_bytes: number;
  created_at: string;
  memo: string | null;
  pending_credit_card_statements: number;
};

export type BackupListResponse = {
  backups: BackupInfo[];
};

export async function listBackups() {
  return apiGet<BackupListResponse>("/api/maintenance/backups");
}

export async function createBackup(memo?: string) {
  const payload: { memo?: string } = {};
  if (memo && memo.trim().length > 0) {
    payload.memo = memo.trim();
  }
  return apiPost<BackupInfo>("/api/maintenance/backups", payload);
}

export async function restoreBackup(filename: string) {
  return apiPost<{ applied: string }>("/api/maintenance/backups/apply", { filename });
}

export async function deleteBackup(filename: string) {
  return apiDelete(`/api/maintenance/backups/${encodeURIComponent(filename)}`);
}
