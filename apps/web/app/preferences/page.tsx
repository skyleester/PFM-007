"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { StickyAside } from "@/components/layout/StickyAside";
import { apiPost } from "@/lib/api";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { createMember, deleteMember, fetchMembersDetailed, MemberRecord, updateMember } from "@/lib/members";
import { createBackup, deleteBackup, listBackups, restoreBackup, type BackupInfo } from "@/lib/maintenance/backups";

type ResetKind = "transactions" | "accounts" | "categories" | "recurring";

type ResetResponse = { removed: number; details?: Record<string, number> | null };

type MemberFormDraft = {
  email: string;
  display_name: string;
  base_currency: string;
  timezone: string;
  locale: string;
  is_active: boolean;
};

const RESET_LABELS: Record<ResetKind, string> = {
  transactions: "트랜잭션",
  accounts: "계좌",
  categories: "카테고리",
  recurring: "정기 규칙",
};

const RESET_CONFIRM: Record<ResetKind, string> = {
  transactions: "해당 사용자의 모든 트랜잭션을 삭제하고 계좌 잔액을 초기화합니다. 계속할까요?",
  accounts: "모든 계좌와 관련 트랜잭션, 예산, 정기 규칙이 삭제됩니다. 계속할까요?",
  categories: "모든 카테고리와 그룹이 삭제되며 트랜잭션도 함께 초기화됩니다. 계속할까요?",
  recurring: "정기 규칙과 예정 금액(드래프트)을 삭제하고, 규칙과 연결된 트랜잭션 링크를 해제합니다. 트랜잭션 자체는 삭제하지 않습니다. 계속할까요?",
};

const DETAIL_LABELS: Record<string, string> = {
  transactions_removed: "트랜잭션",
  accounts_removed: "계좌",
  recurring_rules_removed: "정기 규칙",
  drafts_removed: "발생 드래프트",
  transactions_detached: "트랜잭션 링크 해제",
  budgets_removed: "예산",
  categories_removed: "카테고리",
  groups_removed: "카테고리 그룹",
  recurring_rules_detached: "정기 규칙 연결 해제",
};

const EMPTY_MEMBER_DRAFT = (): MemberFormDraft => ({
  email: "",
  display_name: "",
  base_currency: "",
  timezone: "",
  locale: "",
  is_active: true,
});

function summarizeDetails(details?: Record<string, number> | null) {
  if (!details) return "";
  const entries = Object.entries(details).filter(([, value]) => typeof value === "number" && value !== 0);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${DETAIL_LABELS[key] ?? key}: ${value.toLocaleString()}`).join(", ");
}

function memberToDraft(member: MemberRecord): MemberFormDraft {
  return {
    email: member.email,
    display_name: member.display_name ?? "",
    base_currency: member.base_currency ?? "",
    timezone: member.timezone ?? "",
    locale: member.locale ?? "",
    is_active: member.is_active,
  };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatBackupDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function PreferencesPage() {
  const [pending, setPending] = useState<ResetKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [savedMembers] = usePersistentState<number[]>("pfm:members:selection:v1", [1]);
  const defaultUserId = useMemo(() => (savedMembers && savedMembers.length > 0 ? savedMembers[0] : 1), [savedMembers]);
  const [userId, setUserId] = useState<number>(defaultUserId);

  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const selectedMember = useMemo(() => members.find((m) => m.id === selectedMemberId) ?? null, [members, selectedMemberId]);

  const [editDraft, setEditDraft] = useState<MemberFormDraft | null>(null);
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<MemberFormDraft>(EMPTY_MEMBER_DRAFT);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupsError, setBackupsError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupAction, setBackupAction] = useState<string | null>(null);
  const [backupMemo, setBackupMemo] = useState("");

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, []);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const data = await fetchMembersDetailed();
      setMembers(data);
      setUserId((prev) => {
        if (data.some((m) => m.id === prev)) return prev;
        if (data.some((m) => m.id === defaultUserId)) return defaultUserId;
        return data[0]?.id ?? prev;
      });
      setSelectedMemberId((prev) => {
        if (prev && data.some((m) => m.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch (err) {
      const fallback: MemberRecord[] = [
        { id: 1, name: "me", email: "me@example.com", is_active: true },
        { id: 2, name: "member1", email: "member1@example.com", is_active: true },
      ];
      setMembers(fallback);
      setMembersError(err instanceof Error ? err.message : String(err));
      setUserId((prev) => (fallback.some((m) => m.id === prev) ? prev : fallback[0].id));
      setSelectedMemberId((prev) => (prev && fallback.some((m) => m.id === prev) ? prev : fallback[0].id));
    } finally {
      setMembersLoading(false);
    }
  }, [defaultUserId]);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      const { backups } = await listBackups();
      setBackups(backups);
    } catch (err) {
      setBackupsError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  useEffect(() => {
    if (selectedMember) {
      setEditDraft(memberToDraft(selectedMember));
    } else {
      setEditDraft(null);
    }
    setMemberMessage(null);
    setMemberError(null);
  }, [selectedMember]);

  const handleReset = useCallback(
    async (kind: ResetKind) => {
      if (!window.confirm(RESET_CONFIRM[kind])) return;
      setPending(kind);
      setMessage(null);
      setError(null);
      try {
        const result = await apiPost<ResetResponse>(`/api/maintenance/reset-${kind}`, { user_id: userId });
        const removedCount = result?.removed ?? 0;
        const detailSummary = summarizeDetails(result?.details ?? undefined);
        const summary = `${RESET_LABELS[kind]} 초기화 완료: ${removedCount.toLocaleString()}건${detailSummary ? ` (${detailSummary})` : ""}`;
        setMessage(summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [userId]
  );

  const hasMemberChanges = useMemo(() => {
    if (!selectedMember || !editDraft) return false;
    const normalized = {
      email: editDraft.email.trim(),
      display_name: editDraft.display_name.trim(),
      base_currency: editDraft.base_currency.trim().toUpperCase(),
      timezone: editDraft.timezone.trim(),
      locale: editDraft.locale.trim(),
      is_active: editDraft.is_active,
    };
    const original = {
      email: selectedMember.email,
      display_name: (selectedMember.display_name ?? "").trim(),
      base_currency: (selectedMember.base_currency ?? "").trim().toUpperCase(),
      timezone: (selectedMember.timezone ?? "").trim(),
      locale: (selectedMember.locale ?? "").trim(),
      is_active: selectedMember.is_active,
    };
    return (
      normalized.email !== original.email ||
      normalized.display_name !== original.display_name ||
      normalized.base_currency !== original.base_currency ||
      normalized.timezone !== original.timezone ||
      normalized.locale !== original.locale ||
      normalized.is_active !== original.is_active
    );
  }, [selectedMember, editDraft]);

  const handleMemberSave = useCallback(async () => {
    if (!selectedMember || !editDraft) return;
    if (!editDraft.email.trim()) {
      setMemberError("이메일은 비워둘 수 없습니다.");
      return;
    }
    const payload = (() => {
      const update: Parameters<typeof updateMember>[1] = {};
      const trimmedEmail = editDraft.email.trim();
      if (trimmedEmail !== selectedMember.email) update.email = trimmedEmail;
      const trimmedDisplay = editDraft.display_name.trim();
      if (trimmedDisplay !== (selectedMember.display_name ?? "")) update.display_name = trimmedDisplay || null;
      const trimmedCurrency = editDraft.base_currency.trim().toUpperCase();
      if (trimmedCurrency !== (selectedMember.base_currency ?? "").toUpperCase()) update.base_currency = trimmedCurrency || null;
      const trimmedTimezone = editDraft.timezone.trim();
      if (trimmedTimezone !== (selectedMember.timezone ?? "")) update.timezone = trimmedTimezone || null;
      const trimmedLocale = editDraft.locale.trim();
      if (trimmedLocale !== (selectedMember.locale ?? "")) update.locale = trimmedLocale || null;
      if (editDraft.is_active !== selectedMember.is_active) update.is_active = editDraft.is_active;
      return update;
    })();
    if (Object.keys(payload).length === 0) {
      setMemberMessage("변경 사항이 없습니다.");
      setMemberError(null);
      return;
    }
    setMemberBusy(true);
    setMemberError(null);
    setMemberMessage(null);
    try {
      const updated = await updateMember(selectedMember.id, payload);
      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditDraft(memberToDraft(updated));
      setMemberMessage("멤버 정보를 저장했습니다.");
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : String(err));
    } finally {
      setMemberBusy(false);
    }
  }, [selectedMember, editDraft]);

  const handleMemberReset = useCallback(() => {
    if (selectedMember) {
      setEditDraft(memberToDraft(selectedMember));
      setMemberMessage(null);
      setMemberError(null);
    }
  }, [selectedMember]);

  const handleMemberDelete = useCallback(async () => {
    if (!selectedMember) return;
    if (!window.confirm(`${selectedMember.name} 멤버와 모든 관련 데이터(트랜잭션, 계좌, 예산 등)를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    setMemberBusy(true);
    setMemberError(null);
    setMemberMessage(null);
    try {
      await deleteMember(selectedMember.id);
      setMembers((prev) => prev.filter((m) => m.id !== selectedMember.id));
      setSelectedMemberId(null);
      setEditDraft(null);
      setMemberMessage(`${selectedMember.name} 멤버를 삭제했습니다.`);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : String(err));
    } finally {
      setMemberBusy(false);
    }
  }, [selectedMember]);

  const handleCreateMember = useCallback(async () => {
    const trimmedEmail = createDraft.email.trim();
    if (!trimmedEmail) {
      setCreateError("이메일을 입력하세요.");
      return;
    }
    const payload = {
      email: trimmedEmail,
      display_name: createDraft.display_name.trim() || null,
      base_currency: (createDraft.base_currency.trim().toUpperCase() || null) as string | null,
      timezone: createDraft.timezone.trim() || null,
      locale: createDraft.locale.trim() || null,
      is_active: createDraft.is_active,
    } satisfies Parameters<typeof createMember>[0];
    setCreateBusy(true);
    setCreateError(null);
    setMemberMessage(null);
    try {
      const created = await createMember(payload);
      setMembers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateDraft(EMPTY_MEMBER_DRAFT());
      setCreateOpen(false);
      setMemberMessage(`${created.name} 멤버를 추가했습니다.`);
      setSelectedMemberId(created.id);
      setUserId((prev) => prev ?? created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateBusy(false);
    }
  }, [createDraft]);

  const handleCreateBackup = useCallback(async () => {
    setBackupBusy(true);
    setBackupsError(null);
    setBackupMessage(null);
    try {
      const created = await createBackup(backupMemo.trim() || undefined);
      const pendingLabel = created.pending_credit_card_statements > 0 ? ` (미정산 명세서 ${created.pending_credit_card_statements.toLocaleString()}건 포함)` : "";
      setBackupMessage(`${created.filename} 백업을 생성했습니다.${pendingLabel}`);
      setBackupMemo("");
      await loadBackups();
    } catch (err) {
      setBackupsError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
    }
  }, [backupMemo, loadBackups]);

  const handleRestoreBackup = useCallback(async (filename: string) => {
    if (!window.confirm(`${filename} 백업을 적용하면 현재 DB가 덮어씌워집니다. 계속할까요?`)) {
      return;
    }
    setBackupBusy(true);
    setBackupAction(`restore:${filename}`);
    setBackupsError(null);
    setBackupMessage(null);
    try {
      await restoreBackup(filename);
      setBackupMessage(`${filename} 백업을 적용했습니다. 페이지를 새로고침하면 반영됩니다.`);
    } catch (err) {
      setBackupsError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
      setBackupAction(null);
      await loadBackups();
    }
  }, [loadBackups]);

  const handleDeleteBackup = useCallback(async (filename: string) => {
    if (!window.confirm(`${filename} 백업을 삭제할까요?`)) {
      return;
    }
    setBackupBusy(true);
    setBackupAction(`delete:${filename}`);
    setBackupsError(null);
    try {
      await deleteBackup(filename);
      setBackupMessage(`${filename} 백업을 삭제했습니다.`);
    } catch (err) {
      setBackupsError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
      setBackupAction(null);
      await loadBackups();
    }
  }, [loadBackups]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Preferences"
        subtitle="시스템 설정, 멤버 관리, 데이터 초기화를 수행합니다."
      />

      {error && (
        <SectionCard tone="muted">
          <p className="text-sm text-red-700">{error}</p>
        </SectionCard>
      )}
      {message && !error && (
        <SectionCard tone="muted">
          <p className="text-sm text-green-700">{message}</p>
        </SectionCard>
      )}

      <SectionCard title="데이터 초기화" description="엑셀 업로드 전 기존 데이터를 정리합니다. 실행 후에는 되돌릴 수 없습니다.">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <label>대상 멤버:</label>
          {membersLoading ? (
            <span className="text-xs text-gray-500">불러오는 중…</span>
          ) : (
            <select className="rounded border px-2 py-1 text-sm" value={userId} onChange={(e) => setUserId(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (ID: {m.id})
                </option>
              ))}
            </select>
          )}
          {membersError && <span className="text-xs text-red-600">멤버 목록 오류</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleReset("transactions")}
            className="rounded border border-amber-400 px-3 py-1 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:hover:bg-transparent"
            disabled={pending !== null}
          >
            {pending === "transactions" ? "초기화 중…" : "트랜잭션 초기화"}
          </button>
          <button
            type="button"
            onClick={() => handleReset("accounts")}
            className="rounded border border-red-400 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent"
            disabled={pending !== null}
          >
            {pending === "accounts" ? "초기화 중…" : "계좌 초기화"}
          </button>
          <button
            type="button"
            onClick={() => handleReset("categories")}
            className="rounded border border-purple-400 px-3 py-1 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50 disabled:hover:bg-transparent"
            disabled={pending !== null}
          >
            {pending === "categories" ? "초기화 중…" : "카테고리 초기화"}
          </button>
          <button
            type="button"
            onClick={() => handleReset("recurring")}
            className="rounded border border-blue-400 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:hover:bg-transparent"
            disabled={pending !== null}
          >
            {pending === "recurring" ? "초기화 중…" : "정기 규칙 초기화"}
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="데이터 백업"
        description="전체 데이터베이스를 백업 파일로 보관하고, 필요 시 선택하여 복원하거나 삭제합니다."
        headerAction={
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="w-48 rounded border px-2 py-1 text-sm"
              placeholder="백업 메모 (선택)"
              maxLength={200}
              value={backupMemo}
              onChange={(e) => setBackupMemo(e.target.value)}
              disabled={backupBusy}
            />
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              onClick={handleCreateBackup}
              disabled={backupBusy || backupsLoading}
            >
              {backupBusy && !backupAction ? "처리 중…" : "새 백업 생성"}
            </button>
          </div>
        }
      >
        {backupMessage && <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{backupMessage}</div>}
        {backupsError && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{backupsError}</div>}
        <p className="mt-2 text-xs text-gray-500">
          백업은 서버의 `backups/` 폴더에 저장됩니다. 복원 후에는 페이지를 새로고침하여 반영해 주세요.
        </p>
        <div className="mt-3 rounded border">
          <div className="border-b px-3 py-2 text-xs text-gray-500">백업 목록</div>
          {backupsLoading ? (
            <div className="px-3 py-4 text-sm text-gray-500">불러오는 중…</div>
          ) : backups.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500">생성된 백업이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">파일명</th>
                    <th className="px-3 py-2">생성 시각</th>
                    <th className="px-3 py-2">크기</th>
                    <th className="px-3 py-2">메모</th>
                    <th className="px-3 py-2">카드 정산</th>
                    <th className="px-3 py-2 text-right">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {backups.map((backup) => {
                    const restoreKey = `restore:${backup.filename}`;
                    const deleteKey = `delete:${backup.filename}`;
                    const isRowBusy = backupAction === restoreKey || backupAction === deleteKey;
                    return (
                      <tr key={backup.filename} className={isRowBusy ? "bg-blue-50" : "bg-white"}>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono text-xs text-gray-800">{backup.filename}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-600">{formatBackupDate(backup.created_at)}</td>
                        <td className="px-3 py-2 align-top text-xs text-gray-600">{formatBytes(backup.size_bytes)}</td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700">
                          {backup.memo ? <span className="whitespace-pre-wrap text-xs text-gray-700">{backup.memo}</span> : <span className="text-xs text-gray-400">(없음)</span>}
                        </td>
                        <td className="px-3 py-2 align-top text-xs">
                          {backup.pending_credit_card_statements > 0 ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                              미정산 {backup.pending_credit_card_statements.toLocaleString()}건
                            </span>
                          ) : (
                            <span className="text-gray-500">모두 정산</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex justify-end gap-2 text-xs">
                            <button
                              type="button"
                              className="rounded border border-blue-400 px-3 py-1 font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:hover:bg-transparent"
                              disabled={backupBusy && backupAction !== restoreKey}
                              onClick={() => handleRestoreBackup(backup.filename)}
                            >
                              {backupAction === restoreKey ? "복원 중…" : "복원"}
                            </button>
                            <button
                              type="button"
                              className="rounded border border-red-400 px-3 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent"
                              disabled={backupBusy && backupAction !== deleteKey}
                              onClick={() => handleDeleteBackup(backup.filename)}
                            >
                              {backupAction === deleteKey ? "삭제 중…" : "삭제"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="멤버 관리"
        description="가족 멤버의 이름, 통화, 시간대를 설정합니다."
        headerAction={
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => {
              setCreateOpen((prev) => !prev);
              setCreateError(null);
            }}
          >
            {createOpen ? "새 멤버 입력 닫기" : "새 멤버 추가"}
          </button>
        }
      >
        {memberMessage && <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{memberMessage}</div>}
        {memberError && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{memberError}</div>}

        <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(260px,1.5fr)]">
          <div>
            <div className="rounded border">
              <div className="border-b px-3 py-2 text-xs text-gray-500">멤버 목록</div>
              {membersLoading ? (
                <div className="px-3 py-4 text-sm text-gray-500">불러오는 중…</div>
              ) : members.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-500">등록된 멤버가 없습니다.</div>
              ) : (
                <ul className="divide-y">
                  {members.map((m) => {
                    const active = m.is_active;
                    const selected = selectedMemberId === m.id;
                    return (
                      <li key={m.id} className={selected ? "bg-blue-50" : "bg-white"}>
                        <button
                          type="button"
                          className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-blue-50"
                          onClick={() => setSelectedMemberId(m.id)}
                        >
                          <span className="text-sm font-medium text-gray-800">{m.name}</span>
                          <span className="text-xs text-gray-500">{m.email}</span>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                              {active ? "활성" : "비활성"}
                            </span>
                            {m.base_currency && (
                              <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{m.base_currency}</span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {membersError && <div className="mt-2 text-xs text-red-600">멤버 로드 실패: {membersError}</div>}
          </div>

          <div className="rounded border px-3 py-3">
            {selectedMember && editDraft ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">멤버 상세</h4>
                    <p className="text-xs text-gray-500">ID {selectedMember.id}</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={editDraft.is_active}
                      onChange={(e) => {
                        const value = e.target.checked;
                        setEditDraft((draft) => (draft ? { ...draft, is_active: value } : draft));
                      }}
                    />
                    활성 상태 유지
                  </label>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-600">이름(표시용)</label>
                    <input
                      className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      value={editDraft.display_name}
                      placeholder="예: 엄마"
                      onChange={(e) => setEditDraft((draft) => (draft ? { ...draft, display_name: e.target.value } : draft))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">이메일</label>
                    <input
                      className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      value={editDraft.email}
                      onChange={(e) => setEditDraft((draft) => (draft ? { ...draft, email: e.target.value } : draft))}
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <label className="block text-xs text-gray-600">기준 통화</label>
                      <input
                        className="mt-1 w-full rounded border px-2 py-1 text-sm uppercase"
                        maxLength={3}
                        value={editDraft.base_currency}
                        placeholder="KRW"
                        onChange={(e) => {
                          const value = e.target.value.toUpperCase();
                          setEditDraft((draft) => (draft ? { ...draft, base_currency: value } : draft));
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">로케일</label>
                      <input
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                        value={editDraft.locale}
                        placeholder="ko-KR"
                        onChange={(e) => setEditDraft((draft) => (draft ? { ...draft, locale: e.target.value } : draft))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">시간대</label>
                    <input
                      className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      value={editDraft.timezone}
                      placeholder="Asia/Seoul"
                      onChange={(e) => setEditDraft((draft) => (draft ? { ...draft, timezone: e.target.value } : draft))}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                      disabled={!hasMemberChanges || memberBusy}
                      onClick={handleMemberSave}
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                      disabled={!hasMemberChanges || memberBusy}
                      onClick={handleMemberReset}
                    >
                      변경 취소
                    </button>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-red-400 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    disabled={memberBusy}
                    onClick={handleMemberDelete}
                  >
                    멤버 삭제
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">왼쪽 목록에서 멤버를 선택하세요.</div>
            )}
          </div>
        </div>

        {createOpen && (
          <div className="mt-4 rounded border border-dashed px-3 py-3">
            <h4 className="text-sm font-semibold text-gray-800">새 멤버 추가</h4>
            <p className="text-xs text-gray-500">이메일은 멤버를 구분하는 고유 값입니다.</p>
            {createError && <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{createError}</div>}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600">이메일</label>
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={createDraft.email}
                  onChange={(e) => setCreateDraft((draft) => ({ ...draft, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600">표시 이름</label>
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={createDraft.display_name}
                  onChange={(e) => setCreateDraft((draft) => ({ ...draft, display_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600">기준 통화</label>
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm uppercase"
                  maxLength={3}
                  value={createDraft.base_currency}
                  placeholder="KRW"
                  onChange={(e) => setCreateDraft((draft) => ({ ...draft, base_currency: e.target.value.toUpperCase() }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600">로케일</label>
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={createDraft.locale}
                  placeholder="ko-KR"
                  onChange={(e) => setCreateDraft((draft) => ({ ...draft, locale: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600">시간대</label>
                <input
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={createDraft.timezone}
                  placeholder="Asia/Seoul"
                  onChange={(e) => setCreateDraft((draft) => ({ ...draft, timezone: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 md:col-span-2">
                <input
                  type="checkbox"
                  checked={createDraft.is_active}
                  onChange={(e) => setCreateDraft((draft) => ({ ...draft, is_active: e.target.checked }))}
                />
                활성 상태로 추가
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                disabled={createBusy}
                onClick={handleCreateMember}
              >
                멤버 추가
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                onClick={() => {
                  setCreateDraft(EMPTY_MEMBER_DRAFT());
                  setCreateOpen(false);
                  setCreateError(null);
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
