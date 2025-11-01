"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { StickyAside } from "@/components/layout/StickyAside";
import { RecurringRuleDetail } from "@/components/recurring/RecurringRuleDetail";
import { RecurringRuleForm } from "@/components/recurring/RecurringRuleForm";
import { RecurringRuleTable } from "@/components/recurring/RecurringRuleTable";
import { fetchAccounts, type AccountRecord } from "@/lib/accounts";
import { fetchCategories, fetchCategoryGroups, type Category, type CategoryGroup } from "@/lib/categories";
import { formatCurrency } from "@/lib/recurring/format";
import { confirmRuleOccurrence, deleteRule, updateRule } from "@/lib/recurring/hooks";
import type { RecurringRule, RecurringSummary, RecurringScanCandidate, RecurringCandidateExclusion } from "@/lib/recurring/types";
import {
  listRecurringRules,
  scanRecurringCandidates,
  confirmRecurringRuleBulk,
  attachTransactionsToRule,
  listRecurringExclusions,
  createRecurringExclusion,
  deleteRecurringExclusion,
} from "@/lib/recurring/api";
import { apiPost } from "@/lib/api";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { MemberSelector } from "@/components/MemberSelector";

const USER_ID = 1;

const docs = [
  {
    title: "정기 규칙",
    description: "반복 수입/지출/이체 규칙을 구성합니다.",
  },
  {
    title: "미리보기",
    description: "선택한 규칙이 다음에 생성할 거래 일정을 확인합니다.",
  },
];

const roadmapSections: Array<{ heading: string; body: string }> = [
  {
    heading: "다음 실행 미리보기",
    body: "선택된 규칙에 대해 미리보기 API를 호출해 향후 발생 일정을 표와 타임라인으로 보여줍니다.",
  },
  {
    heading: "규칙 CRUD 폼",
    body: "활성/비활성 전환과 수정, 신규 생성 폼을 모달/슬라이드오버 형태로 연결합니다.",
  },
  {
    heading: "필터 및 정렬",
    body: "계좌, 카테고리, 상태 기준 필터와 정렬 기능을 추가해 대규모 규칙도 관리하기 쉽게 만듭니다.",
  },
];
function formatCount(value: number) {
  return value.toLocaleString();
}

type MetaStatus = "idle" | "loading" | "success" | "error";
type FormPanelState = {
  mode: "create" | "edit";
  open: boolean;
  editingRuleId: number | null;
};

type CandidateTab = "candidates" | "processed" | "excluded";
type ProcessedCandidate = {
  candidate: RecurringScanCandidate;
  rule: RecurringRule;
};

function normalizeCurrency(value: string | null | undefined): string { return (value || "KRW").toUpperCase(); }
function buildRecurringSummary(rules: RecurringRule[]): RecurringSummary {
  const totals = new Map<string, { income: number; expense: number; transfer: number; net: number }>();
  let activeRules = 0;
  for (const rule of rules) {
    if (rule.is_active) activeRules += 1;
    const currency = normalizeCurrency(rule.currency);
    const bucket = totals.get(currency) ?? { income: 0, expense: 0, transfer: 0, net: 0 };
    if (rule.is_active) {
      const amountAbs = Math.abs(rule.amount ?? 0);
      switch (rule.type) {
        case "INCOME": bucket.income += amountAbs; bucket.net += amountAbs; break;
        case "EXPENSE": bucket.expense += amountAbs; bucket.net -= amountAbs; break;
        case "TRANSFER": bucket.transfer += amountAbs; break;
        default: break;
      }
    }
    totals.set(currency, bucket);
  }
  const currencyTotals = Array.from(totals.entries()).map(([currency, stats]) => ({ currency, ...stats })).sort((a, b) => a.currency.localeCompare(b.currency));
  return { totalRules: rules.length, activeRules, inactiveRules: rules.length - activeRules, currencyTotals };
}

export default function RecurringPage() {
  const [memberIds, setMemberIds] = usePersistentState<number[]>("pfm:members:selection:v1", [USER_ID]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [summary, setSummary] = useState<RecurringSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RecurringScanCandidate[]>([]);
  const [processedCandidates, setProcessedCandidates] = useState<ProcessedCandidate[]>([]);
  const [candidateModal, setCandidateModal] = useState<{ open: boolean; candidate: RecurringScanCandidate | null; selected: Set<number> }>({ open: false, candidate: null, selected: new Set() });
  const [scanHorizon, setScanHorizon] = useState<number>(180);
  const [scanMinOccur, setScanMinOccur] = useState<number>(3);
  const [scanIncludeTransfers, setScanIncludeTransfers] = useState<boolean>(false);
  const [scanIgnoreCategory, setScanIgnoreCategory] = useState<boolean>(false);
  const [candidateTab, setCandidateTab] = useState<CandidateTab>("candidates");
  const [exclusions, setExclusions] = useState<RecurringCandidateExclusion[]>([]);
  const [exclusionStatus, setExclusionStatus] = useState<MetaStatus>("idle");
  const [exclusionError, setExclusionError] = useState<string | null>(null);
  const [exclusionVersion, setExclusionVersion] = useState(0);
  const [excludeBusy, setExcludeBusy] = useState<string | null>(null);
  const [excludeError, setExcludeError] = useState<string | null>(null);
  const [bulkExcludeBusy, setBulkExcludeBusy] = useState<boolean>(false);
  const [restoreBusy, setRestoreBusy] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const users = (memberIds && memberIds.length > 0) ? memberIds : [USER_ID];
    setStatus("loading");
    setError(null);
    Promise.all(users.map((uid) => listRecurringRules(uid)))
      .then((lists) => {
        if (cancelled) return;
        const merged = lists.flat();
        setRules(merged);
        setSummary(buildRecurringSummary(merged));
        setStatus("success");
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => { cancelled = true; };
  }, [memberIds, version]);
  const [selectedRuleId, setSelectedRuleId, , selectedRuleHydrated] = usePersistentState<number | null>(
    "pfm:recurring:selected-rule:v1",
    null
  );
  const [formPanel, setFormPanel, , formPanelHydrated] = usePersistentState<FormPanelState>(
    "pfm:recurring:form-panel:v1",
    () => ({ mode: "create", open: false, editingRuleId: null })
  );
  const [formPrefillVersion, setFormPrefillVersion] = useState(0);
  const formPrefill = useMemo(() => {
    void formPrefillVersion;
    try {
      const raw = window.sessionStorage.getItem("pfm:recurring:form:create:v1");
      if (!raw) return null;
      return JSON.parse(raw) as any;
    } catch {
      return null;
    }
  }, [formPrefillVersion]);
  const formMode = formPanel.mode;
  const isFormOpen = formPanel.open;
  const editingRuleId = formPanel.editingRuleId;

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Category[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<CategoryGroup[]>([]);
  const [expenseGroups, setExpenseGroups] = useState<CategoryGroup[]>([]);
  const [metaStatus, setMetaStatus] = useState<MetaStatus>("idle");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaVersion, setMetaVersion] = useState(0);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const editingRule = useMemo(() => {
    if (editingRuleId == null) return null;
    return rules.find((rule) => rule.id === editingRuleId) ?? null;
  }, [editingRuleId, rules]);

  useEffect(() => {
    let cancelled = false;
    setMetaStatus("loading");
    setMetaError(null);

    const users = (memberIds && memberIds.length > 0) ? memberIds : [USER_ID];
    Promise.all([
      (async () => {
        const lists = await Promise.all(users.map((uid) => fetchAccounts({ user_id: uid, include_archived: true })));
        const map = new Map<number, AccountRecord>();
        for (const list of lists) for (const acc of list) map.set(acc.id, acc);
        return Array.from(map.values());
      })(),
      (async () => {
        const catLists = await Promise.all(users.map((uid) => fetchCategories({ user_id: uid, type: "I", page: 1, page_size: 500 })));
        const grpLists = await Promise.all(users.map((uid) => fetchCategoryGroups({ user_id: uid, type: "I" })));
        const seen = new Set<number>();
        const cats: Category[] = [];
        for (const list of catLists) for (const c of list) { if (!seen.has(c.id)) { seen.add(c.id); cats.push(c); } }
        const gSeen = new Set<number>();
        const groups: CategoryGroup[] = [];
        for (const list of grpLists) for (const g of list) { if (!gSeen.has(g.id)) { gSeen.add(g.id); groups.push(g); } }
        return { cats, groups };
      })(),
      (async () => {
        const catLists = await Promise.all(users.map((uid) => fetchCategories({ user_id: uid, type: "E", page: 1, page_size: 500 })));
        const grpLists = await Promise.all(users.map((uid) => fetchCategoryGroups({ user_id: uid, type: "E" })));
        const seen = new Set<number>();
        const cats: Category[] = [];
        for (const list of catLists) for (const c of list) { if (!seen.has(c.id)) { seen.add(c.id); cats.push(c); } }
        const gSeen = new Set<number>();
        const groups: CategoryGroup[] = [];
        for (const list of grpLists) for (const g of list) { if (!gSeen.has(g.id)) { gSeen.add(g.id); groups.push(g); } }
        return { cats, groups };
      })(),
    ])
      .then(([accountList, incomePack, expensePack]) => {
        if (cancelled) return;
        setAccounts(accountList);
        setIncomeCategories(incomePack.cats);
        setIncomeGroups(incomePack.groups);
        setExpenseCategories(expensePack.cats);
        setExpenseGroups(expensePack.groups);
        setMetaStatus("success");
      })
      .catch((err) => {
        if (cancelled) return;
        setMetaStatus("error");
        setMetaError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [metaVersion, memberIds]);

  useEffect(() => {
    let cancelled = false;
    const users = (memberIds && memberIds.length > 0) ? memberIds : [USER_ID];
    setExclusionStatus("loading");
    setExclusionError(null);
    listRecurringExclusions(users)
      .then((items) => {
        if (cancelled) return;
        const sorted = [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setExclusions(sorted);
        setExclusionStatus("success");
      })
      .catch((err) => {
        if (cancelled) return;
        setExclusionStatus("error");
        setExclusionError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [memberIds, exclusionVersion]);

  const reloadMeta = useCallback(() => {
    setMetaVersion((prev) => prev + 1);
  }, []);
  const refreshExclusions = useCallback(() => {
    setExclusionVersion((prev) => prev + 1);
  }, []);

  const summaryCards = useMemo(() => {
    if (!summary) {
      return [
        { label: "전체 규칙", value: "-", tone: "text-gray-400" },
        { label: "활성", value: "-", tone: "text-gray-400" },
        { label: "비활성", value: "-", tone: "text-gray-400" },
      ];
    }
    return [
      { label: "전체 규칙", value: formatCount(summary.totalRules), tone: "text-gray-900" },
      { label: "활성", value: formatCount(summary.activeRules), tone: "text-emerald-600" },
      { label: "비활성", value: formatCount(summary.inactiveRules), tone: "text-amber-600" },
    ];
  }, [summary]);

  useEffect(() => {
    if (!selectedRuleHydrated) {
      return;
    }
    if (rules.length === 0) {
      if (selectedRuleId !== null) {
        setSelectedRuleId(null);
      }
      return;
    }
    if (selectedRuleId == null || !rules.some((rule) => rule.id === selectedRuleId)) {
      setSelectedRuleId(rules[0].id);
    }
  }, [rules, selectedRuleId, selectedRuleHydrated, setSelectedRuleId]);

  useEffect(() => {
    if (!formPanelHydrated) return;
    if (editingRuleId == null) return;
    if (rules.some((rule) => rule.id === editingRuleId)) return;
    setFormPanel((prev) => ({ ...prev, editingRuleId: null, open: prev.mode === "edit" ? false : prev.open }));
  }, [editingRuleId, formPanelHydrated, rules, setFormPanel]);

  const selectedRule = useMemo(() => {
    if (selectedRuleId == null) return null;
    return rules.find((rule) => rule.id === selectedRuleId) ?? null;
  }, [rules, selectedRuleId]);

  const handleSelectRule = useCallback(
    (ruleId: number) => {
      setSelectedRuleId(ruleId);
      setDeleteError(null);
      setToggleError(null);
    },
    [setSelectedRuleId]
  );

  const handleOpenCreate = useCallback(() => {
    if (metaStatus !== "success") return;
    setFormPanel((prev) => ({ ...prev, mode: "create", open: true, editingRuleId: null }));
  }, [metaStatus, setFormPanel]);

  const openCandidateSelection = useCallback((c: RecurringScanCandidate) => {
    if (metaStatus !== "success") return;
    const initial = new Set<number>((c.history || []).map((h) => h.transaction_id));
    setCandidateModal({ open: true, candidate: c, selected: initial });
  }, [metaStatus]);

  const handleOpenEdit = useCallback(() => {
    if (!selectedRule || metaStatus !== "success") return;
    setFormPanel((prev) => ({ ...prev, mode: "edit", open: true, editingRuleId: selectedRule.id }));
  }, [selectedRule, metaStatus, setFormPanel]);

  const handleCloseForm = useCallback(() => {
    setFormPanel((prev) => ({ ...prev, open: false }));
  }, [setFormPanel]);

  const handleFormSuccess = useCallback(
    async (rule: RecurringRule) => {
      setFormPanel((prev) => ({ ...prev, editingRuleId: rule.id, mode: "edit", open: false }));
      setSelectedRuleId(rule.id);
      refresh();

      let candidateSnapshot: RecurringScanCandidate | null = null;
      const candidateKey = "pfm:recurring:form:create:candidate";
      try {
        const rawCandidate = window.sessionStorage.getItem(candidateKey);
        if (rawCandidate) {
          candidateSnapshot = JSON.parse(rawCandidate) as RecurringScanCandidate;
        }
      } catch (candidateParseError) {
        // eslint-disable-next-line no-console
        console.warn("Failed to parse stored candidate snapshot", candidateParseError);
      } finally {
        try {
          window.sessionStorage.removeItem(candidateKey);
        } catch {}
      }
      if (candidateSnapshot) {
        const snapshot = candidateSnapshot;
        setCandidates((prev) => prev.filter((item) => item.signature_hash !== snapshot.signature_hash));
        setProcessedCandidates((prev) => {
          if (prev.some((item) => item.candidate.signature_hash === snapshot.signature_hash)) {
            return prev;
          }
          return [...prev, { candidate: snapshot, rule }];
        });
        setCandidateTab("processed");
      }

      // If creation originated from scan candidate:
      try {
        const attachIdsKey = "pfm:recurring:form:create:attachTxIds";
        const rawAttach = window.sessionStorage.getItem(attachIdsKey);
          if (rawAttach) {
          window.sessionStorage.removeItem(attachIdsKey);
          const ids = JSON.parse(rawAttach) as number[];
          if (Array.isArray(ids) && ids.length > 0) {
            // Use the created rule's user_id to avoid tenant mismatch
            const userId = rule.user_id;
            // If rule has a concrete category (non-transfer), ask user to bulk-change categories of those transactions
            if (rule.type !== "TRANSFER" && rule.category_id) {
              const ok = window.confirm("선택한 거래들의 카테고리를 이 규칙의 카테고리로 변경할까요? (권장)");
              if (ok) {
                try {
                  await apiPost<{
                    updated: number;
                    items: Array<{ id: number }>;
                    skipped: number[];
                    missing: number[];
                  }>("/api/transactions/bulk-update", {
                    user_id: userId,
                    transaction_ids: ids,
                    updates: { category_id: rule.category_id },
                  });
                } catch (e) {
                  // Non-blocking: proceed to attach regardless
                  // eslint-disable-next-line no-console
                  console.warn("카테고리 일괄 변경 실패, 첨부만 진행합니다.", e);
                }
              }
            }
            const result = await attachTransactionsToRule(rule.id, userId, ids);
            const attachedCount = result.attached?.length ?? 0;
            const errorCount = result.errors?.length ?? 0;
            if (attachedCount > 0 || errorCount > 0) {
              window.alert(`기존 거래 연결 ${attachedCount}건${errorCount ? `, 실패 ${errorCount}건` : ""}`);
            }
            if (attachedCount > 0) {
              refresh();
            }
            return; // prefer attach path over backfill
          }
        }

        // Fallback: auto backfill past occurrences for variable-amount rules (legacy flow)
        const backfillKey = "pfm:recurring:form:create:backfill:v1";
        const raw = window.sessionStorage.getItem(backfillKey);
        if (!raw) return;
        const plan = JSON.parse(raw) as {
          type: RecurringRule["type"]; is_variable_amount: boolean; account_id: number; category_id: number | null; items: { occurredAt: string; amount: number; memo: string | null }[];
        };
        // Clean up early to avoid duplicate runs on subsequent creations
        window.sessionStorage.removeItem(backfillKey);
        if (!plan || !plan.is_variable_amount) return;
        if (rule.type !== plan.type || rule.account_id !== plan.account_id) return;
        if (rule.type !== "TRANSFER" && rule.category_id && plan.category_id && rule.category_id !== plan.category_id) {
          // category mismatch likely means user changed it; continue anyway
        }
        if (!plan.items || plan.items.length === 0) return;

        const todayIso = new Date().toISOString().slice(0, 10);
        const items = plan.items.filter((it) => it.occurredAt <= todayIso);
        if (items.length === 0) return;
        const result = await confirmRecurringRuleBulk({ ruleId: rule.id, items });
        const confirmedCount = result.confirmed?.length ?? 0;
        const errorCount = result.errors?.length ?? 0;
        if (confirmedCount > 0 || errorCount > 0) {
          // Minimal feedback; can be replaced with toast later
          window.alert(`과거 발생 ${confirmedCount}건 생성${errorCount ? `, 실패 ${errorCount}건` : ""}`);
        }
        if (confirmedCount > 0) {
          refresh();
        }
      } catch (e) {
        // Non-blocking: log to console for now
        // eslint-disable-next-line no-console
        console.error("백필 처리 중 오류", e);
      }
    },
    [refresh, setFormPanel, setSelectedRuleId, setCandidates, setProcessedCandidates, setCandidateTab],
  );

  const handleDelete = useCallback(async () => {
    if (!selectedRule) return;
    const target = selectedRule;
    const confirmed = window.confirm(`'${target.name}' 규칙을 삭제할까요?`);
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteRule({ id: target.id, userId: target.user_id });
      setIsDeleting(false);
      setSelectedRuleId((prev) => (prev === target.id ? null : prev));
      refresh();
    } catch (err) {
      setIsDeleting(false);
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedRule, refresh, setSelectedRuleId]);

  const handleToggleActive = useCallback(async () => {
    if (!selectedRule) return;
    const target = selectedRule;
    setIsToggling(true);
    setToggleError(null);
    try {
      await updateRule({ id: target.id, userId: target.user_id, isActive: !target.is_active });
      setIsToggling(false);
      refresh();
    } catch (err) {
      setIsToggling(false);
      setToggleError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedRule, refresh]);

  const handleConfirmPending = useCallback(
    async ({ occurredAt, amount, memo }: { occurredAt: string; amount: number; memo?: string | null }) => {
      const target = selectedRule;
      if (!target) {
        throw new Error("선택된 규칙이 없습니다.");
      }
      await confirmRuleOccurrence({ ruleId: target.id, occurredAt, amount, memo: memo ?? null });
      refresh();
    },
    [selectedRule, refresh],
  );

  const currencyRows = summary?.currencyTotals ?? [];
  // Avoid hydration mismatch: render lastSynced only after client mount
  const [lastSynced, setLastSynced] = useState<string>("");
  useEffect(() => {
    setLastSynced(new Date().toLocaleString());
  }, []);
  const primaryUserId = useMemo(() => (memberIds && memberIds.length > 0 ? memberIds[0] : USER_ID), [memberIds]);
  const isLoading = status === "idle" || status === "loading";
  const createDisabled = metaStatus !== "success";
  const createDisabledReason =
    metaStatus === "loading" || metaStatus === "idle"
      ? "계좌와 카테고리를 불러오는 중입니다."
      : metaStatus === "error"
      ? "계좌/카테고리 데이터를 불러오지 못했습니다. 다시 시도 후 이용하세요."
      : undefined;

  const rulesError = status === "error" ? error?.message ?? "데이터를 불러오지 못했습니다." : null;
  const rulesRetry = status === "error" ? refresh : undefined;

  const handleScan = useCallback(async () => {
    const userId = primaryUserId;
    setScanLoading(true);
    setScanError(null);
    try {
      const result = await scanRecurringCandidates({ userId, horizonDays: scanHorizon, minOccurrences: scanMinOccur, includeTransfers: scanIncludeTransfers, ignoreCategory: scanIgnoreCategory });
      setProcessedCandidates([]);
      setCandidateTab("candidates");
      setCandidates(result);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanLoading(false);
    }
  }, [primaryUserId, scanHorizon, scanMinOccur, scanIncludeTransfers, scanIgnoreCategory]);

  const handleExcludeCandidate = useCallback(
    async (candidate: RecurringScanCandidate) => {
      if (!candidate) return;
      setExcludeBusy(candidate.signature_hash);
      setExcludeError(null);
      try {
        await createRecurringExclusion({ userId: primaryUserId, signatureHash: candidate.signature_hash, snapshot: candidate });
        setCandidates((prev) => prev.filter((item) => item.signature_hash !== candidate.signature_hash));
        refreshExclusions();
      } catch (err) {
        setExcludeError(err instanceof Error ? err.message : String(err));
      } finally {
        setExcludeBusy(null);
      }
    },
    [primaryUserId, refreshExclusions],
  );

  const handleRestoreExclusion = useCallback(
    async (item: RecurringCandidateExclusion) => {
      setRestoreBusy(item.id);
      setRestoreError(null);
      try {
        await deleteRecurringExclusion(item.id, item.user_id);
        refreshExclusions();
      } catch (err) {
        setRestoreError(err instanceof Error ? err.message : String(err));
      } finally {
        setRestoreBusy(null);
      }
    },
    [refreshExclusions],
  );

  const handleBulkExclude = useCallback(async () => {
    if (!candidates || candidates.length === 0) return;
    setBulkExcludeBusy(true);
    setExcludeError(null);
    try {
      const userId = primaryUserId;
      const tasks = candidates.map((c) =>
        createRecurringExclusion({ userId, signatureHash: c.signature_hash, snapshot: c })
          .then(() => ({ ok: true as const, sig: c.signature_hash }))
          .catch((e) => ({ ok: false as const, sig: c.signature_hash, error: e instanceof Error ? e.message : String(e) }))
      );
      const results = await Promise.all(tasks);
      const succeeded = results.filter((r) => r.ok).map((r) => r.sig);
      const failed = results.filter((r) => !r.ok) as Array<{ ok: false; sig: string; error?: string }>;
      if (succeeded.length > 0) {
        setCandidates((prev) => prev.filter((item) => !succeeded.includes(item.signature_hash)));
        refreshExclusions();
      }
      if (failed.length > 0) {
        setExcludeError(`일부 배제 실패(${failed.length}건): ${failed.slice(0, 3).map((f) => f.error || "오류").join(", ")}${failed.length > 3 ? " …" : ""}`);
      }
      // Lightweight feedback
      try {
        window.alert(`배제 완료: ${succeeded.length}건${failed.length ? `, 실패 ${failed.length}건` : ""}`);
      } catch {}
    } finally {
      setBulkExcludeBusy(false);
    }
  }, [candidates, primaryUserId, refreshExclusions]);

  const headerActions = (
    <div className="flex flex-col items-start gap-2 text-xs text-gray-500 sm:flex-row sm:items-center sm:gap-3 sm:text-sm">
      <MemberSelector value={memberIds} onChange={setMemberIds} />
      <span suppressHydrationWarning>마지막 동기화: {lastSynced || "—"}</span>
      <button
        type="button"
        onClick={refresh}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 sm:text-xs"
      >
        새로고침
      </button>
    </div>
  );

  return (
    <>
      <div className="space-y-8">
        <PageHeader
          title="Recurring Rules"
          subtitle="정기적으로 반복되는 거래를 구성하고 관리하는 공간입니다."
          actions={headerActions}
        />

        <SectionCard
          title="규칙 요약"
          description="활성 상태와 통화별 예상 합계를 확인하세요."
        >
          {isLoading && <p className="text-xs text-gray-400">로딩 중…</p>}
          {status === "error" && rulesError ? (
            <p className="text-xs text-red-600">데이터를 불러오지 못했습니다: {rulesError}</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="text-xs uppercase text-gray-500">{card.label}</div>
                <div className={`mt-1 text-base font-semibold ${card.tone}`}>{card.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase text-gray-500">통화별 예상 합계 (활성 규칙 기준)</h4>
            {currencyRows.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">활성화된 정기 규칙이 없거나 아직 데이터를 불러오는 중입니다.</p>
            ) : (
              <div className="mt-2 overflow-hidden rounded border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">통화</th>
                      <th className="px-3 py-2">수입</th>
                      <th className="px-3 py-2">지출</th>
                      <th className="px-3 py-2">이체</th>
                      <th className="px-3 py-2">예상 순수익</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white text-[13px] text-gray-700">
                    {currencyRows.map((row) => (
                      <tr key={row.currency}>
                        <td className="px-3 py-2 font-medium text-gray-900">{row.currency}</td>
                        <td className="px-3 py-2 text-emerald-600">{formatCurrency(row.income, row.currency)}</td>
                        <td className="px-3 py-2 text-rose-600">{formatCurrency(row.expense, row.currency)}</td>
                        <td className="px-3 py-2 text-gray-600">{formatCurrency(row.transfer, row.currency)}</td>
                        <td className={`px-3 py-2 font-semibold ${row.net >= 0 ? "text-gray-900" : "text-rose-600"}`}>
                          {formatCurrency(row.net, row.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SectionCard>

        {(metaStatus === "loading" || metaStatus === "idle") && (
          <SectionCard tone="muted">
            <p className="text-sm text-emerald-700">계좌와 카테고리 정보를 불러오는 중입니다…</p>
          </SectionCard>
        )}

        {metaStatus === "error" && (
          <SectionCard
            tone="muted"
            headerAction={
              <button
                type="button"
                onClick={reloadMeta}
                className="rounded border border-rose-400 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100"
              >
                다시 시도
              </button>
            }
          >
            <p className="text-sm text-rose-700">계좌/카테고리 정보를 불러오지 못했습니다: {metaError}</p>
          </SectionCard>
        )}

        <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
          <div className="space-y-6">
            <RecurringRuleTable
              rules={rules}
              selectedRuleId={selectedRuleId}
              onSelect={handleSelectRule}
              onCreate={handleOpenCreate}
              isLoading={isLoading}
              errorMessage={rulesError}
              onRetry={rulesRetry}
              createDisabled={createDisabled}
              createDisabledReason={createDisabledReason}
            />

            <SectionCard title="연결된 API" description="정기 규칙 기능과 연동된 백엔드 엔드포인트입니다.">
              <dl className="grid gap-3 sm:grid-cols-2">
                {docs.map((item) => (
                  <div key={item.title} className="rounded border border-dashed border-gray-200 p-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.title}</dt>
                    <dd className="mt-1 text-sm text-gray-600">{item.description}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[11px] text-gray-500">
                백엔드 엔드포인트: <code className="font-mono text-[11px]">GET /api/recurring-rules</code>,{" "}
                <code className="font-mono text-[11px]">GET /api/recurring-rules/:id/preview</code>
              </p>
            </SectionCard>

            <SectionCard
              title="반복 후보 스캔"
              description="과거 거래 기록을 분석해 자동 규칙 후보를 찾아줍니다."
              headerAction={
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanLoading}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scanLoading ? "스캔 중…" : "스캔 실행"}
                </button>
              }
            >
              <div className="flex flex-wrap items-end gap-3 text-xs text-gray-700">
                <label className="flex items-center gap-2">
                  <span className="text-gray-500">기간(일)</span>
                  <input
                    type="number"
                    min={7}
                    max={730}
                    value={scanHorizon}
                    onChange={(e) => setScanHorizon(Math.max(7, Math.min(730, Number(e.target.value))))}
                    className="w-24 rounded border border-gray-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-gray-500">최소 발생</span>
                  <input
                    type="number"
                    min={2}
                    max={36}
                    value={scanMinOccur}
                    onChange={(e) => setScanMinOccur(Math.max(2, Math.min(36, Number(e.target.value))))}
                    className="w-20 rounded border border-gray-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scanIncludeTransfers}
                    onChange={(e) => setScanIncludeTransfers(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-gray-500">이체 포함</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scanIgnoreCategory}
                    onChange={(e) => setScanIgnoreCategory(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-gray-500">카테고리 무시</span>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-gray-600">
                <button
                  type="button"
                  onClick={() => setCandidateTab("candidates")}
                  className={`rounded px-3 py-1 ${candidateTab === "candidates" ? "bg-emerald-600 text-white" : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}
                >
                  <span>스캔 후보</span>
                  <span className={`${candidateTab === "candidates" ? "bg-white text-emerald-700" : "bg-gray-200 text-gray-700"} ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold`}>{candidates.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCandidateTab("processed")}
                  className={`rounded px-3 py-1 ${candidateTab === "processed" ? "bg-emerald-600 text-white" : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}
                >
                  <span>생성 완료</span>
                  <span className={`${candidateTab === "processed" ? "bg-white text-emerald-700" : "bg-gray-200 text-gray-700"} ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold`}>{processedCandidates.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCandidateTab("excluded")}
                  className={`rounded px-3 py-1 ${candidateTab === "excluded" ? "bg-emerald-600 text-white" : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}
                >
                  <span>배제 목록</span>
                  <span className={`${candidateTab === "excluded" ? "bg-white text-emerald-700" : "bg-gray-200 text-gray-700"} ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold`}>{exclusions.length}</span>
                </button>
              </div>
              {candidateTab === "candidates" ? (
                <>
                  {scanError && <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">스캔 실패: {scanError}</div>}
                  {excludeError && <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">배제 처리 실패: {excludeError}</div>}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-gray-600">
                    <div>후보 {candidates.length.toLocaleString()}건</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleBulkExclude}
                        disabled={bulkExcludeBusy || candidates.length === 0}
                        className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {bulkExcludeBusy ? "모두 배제 중…" : "모두 배제"}
                      </button>
                    </div>
                  </div>
                  {candidates.length === 0 ? (
                    <p className="mt-3 text-xs text-gray-500">스캔 결과가 없습니다. 조건을 조정해 다시 시도해보세요.</p>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-3 py-2">이름</th>
                            <th className="px-3 py-2">유형/주기</th>
                            <th className="px-3 py-2">금액</th>
                            <th className="px-3 py-2">발견 횟수</th>
                            <th className="px-3 py-2">기간</th>
                            <th className="px-3 py-2 text-right">동작</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white text-[13px] text-gray-700">
                          {candidates.map((c) => (
                            <tr key={c.signature_hash}>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-gray-900">{c.name}</div>
                                <div className="mt-0.5 text-[11px] text-gray-500">계좌 #{c.account_id}{c.category_id ? ` · 카테고리 #${c.category_id}` : ""}</div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="text-[11px] uppercase text-gray-600">{c.type}</div>
                                <div className="mt-0.5 text-[11px] text-gray-500">{c.frequency}{c.day_of_month ? ` · D${c.day_of_month}` : c.weekday != null ? ` · W${c.weekday}` : ""}</div>
                              </td>
                              <td className="px-3 py-2">
                                {c.is_variable_amount ? (
                                  <span className="text-amber-600">변동</span>
                                ) : (
                                  <span className="font-semibold text-gray-900">{formatCurrency(Math.abs(c.amount ?? 0), c.currency)}</span>
                                )}
                                <div className="mt-0.5 text-[11px] text-gray-500">범위 {formatCurrency(Math.abs(c.amount_min ?? 0), c.currency)} ~ {formatCurrency(Math.abs(c.amount_max ?? 0), c.currency)}</div>
                              </td>
                              <td className="px-3 py-2">{c.occurrences}</td>
                              <td className="px-3 py-2">{c.first_date} ~ {c.last_date}</td>
                              <td className="px-3 py-2">
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleExcludeCandidate(c)}
                                    disabled={excludeBusy === c.signature_hash}
                                    className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {excludeBusy === c.signature_hash ? "처리 중…" : "규칙 아님"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openCandidateSelection(c)}
                                    className="rounded border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50"
                                  >
                                    규칙 생성
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : candidateTab === "processed" ? (
                <>
                  {processedCandidates.length === 0 ? (
                    <p className="mt-3 text-xs text-gray-500">현재 스캔 결과에서 규칙으로 전환한 항목이 없습니다.</p>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-3 py-2">이름</th>
                            <th className="px-3 py-2">유형/주기</th>
                            <th className="px-3 py-2">금액</th>
                            <th className="px-3 py-2">발견 횟수</th>
                            <th className="px-3 py-2">기간</th>
                            <th className="px-3 py-2 text-right">동작</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white text-[13px] text-gray-700">
                          {processedCandidates.map(({ candidate: c, rule }) => (
                            <tr key={c.signature_hash}>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-gray-900">{c.name}</div>
                                <div className="mt-0.5 text-[11px] text-gray-500">계좌 #{c.account_id}{c.category_id ? ` · 카테고리 #${c.category_id}` : ""}</div>
                                <div className="mt-0.5 text-[11px] text-emerald-600">새 규칙: {rule.name} (#{rule.id})</div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="text-[11px] uppercase text-gray-600">{c.type}</div>
                                <div className="mt-0.5 text-[11px] text-gray-500">{c.frequency}{c.day_of_month ? ` · D${c.day_of_month}` : c.weekday != null ? ` · W${c.weekday}` : ""}</div>
                              </td>
                              <td className="px-3 py-2">
                                {c.is_variable_amount ? (
                                  <span className="text-amber-600">변동</span>
                                ) : (
                                  <span className="font-semibold text-gray-900">{formatCurrency(Math.abs(c.amount ?? 0), c.currency)}</span>
                                )}
                                <div className="mt-0.5 text-[11px] text-gray-500">범위 {formatCurrency(Math.abs(c.amount_min ?? 0), c.currency)} ~ {formatCurrency(Math.abs(c.amount_max ?? 0), c.currency)}</div>
                              </td>
                              <td className="px-3 py-2">{c.occurrences}</td>
                              <td className="px-3 py-2">{c.first_date} ~ {c.last_date}</td>
                              <td className="px-3 py-2">
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedRuleId(rule.id);
                                      if (metaStatus === "success") {
                                        setFormPanel((prev) => ({ ...prev, mode: "edit", open: true, editingRuleId: rule.id }));
                                      }
                                    }}
                                    className="rounded border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={metaStatus !== "success"}
                                  >
                                    규칙 보기
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {restoreError && <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">복원 실패: {restoreError}</div>}
                  {exclusionStatus === "loading" && <p className="mt-3 text-xs text-gray-500">배제 목록을 불러오는 중입니다…</p>}
                  {exclusionStatus === "error" && (
                    <div className="mt-3 flex items-center justify-between rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                      <span>배제 목록을 불러오지 못했습니다: {exclusionError}</span>
                      <button type="button" onClick={refreshExclusions} className="rounded border border-rose-500 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-100">다시 시도</button>
                    </div>
                  )}
                  {exclusionStatus === "success" && exclusions.length === 0 && (
                    <p className="mt-3 text-xs text-gray-500">배제된 후보가 없습니다. 스캔 후보에서 &quot;규칙 아님&quot;을 선택하면 목록에 보관됩니다.</p>
                  )}
                  {exclusionStatus === "success" && exclusions.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-3 py-2">이름</th>
                            <th className="px-3 py-2">유형/주기</th>
                            <th className="px-3 py-2">스캔 기간</th>
                            <th className="px-3 py-2">배제일</th>
                            <th className="px-3 py-2 text-right">동작</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white text-[13px] text-gray-700">
                          {exclusions.map((item) => {
                            const snap = item.snapshot;
                            const currency = snap?.currency ?? "KRW";
                            const amountLabel = snap?.is_variable_amount
                              ? "변동"
                              : formatCurrency(Math.abs(snap?.amount ?? 0), currency);
                            const categoryLabel = snap && snap.category_id ? ` · 카테고리 #${snap.category_id}` : "";
                            const frequencyLabel = snap
                              ? `${snap.frequency}${snap.day_of_month ? ` · D${snap.day_of_month}` : snap.weekday != null ? ` · W${snap.weekday}` : ""}`
                              : "?";
                            return (
                              <tr key={item.id}>
                                <td className="px-3 py-2">
                                  <div className="font-semibold text-gray-900">{snap?.name ?? "(삭제된 후보)"}</div>
                                  <div className="mt-0.5 text-[11px] text-gray-500">
                                    {snap ? `계좌 #${snap.account_id}${categoryLabel}` : "계좌 정보 없음"}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="text-[11px] uppercase text-gray-600">{snap?.type ?? "?"}</div>
                                  <div className="mt-0.5 text-[11px] text-gray-500">{frequencyLabel}{snap?.is_variable_amount ? " · 변동" : ` · ${amountLabel}`}</div>
                                </td>
                                <td className="px-3 py-2">{snap?.first_date} ~ {snap?.last_date}</td>
                                <td className="px-3 py-2">{new Date(item.created_at).toLocaleString()}</td>
                                <td className="px-3 py-2">
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => handleRestoreExclusion(item)}
                                      disabled={restoreBusy === item.id}
                                      className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {restoreBusy === item.id ? "복원 중…" : "복원"}
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
                </>
              )}
            </SectionCard>

            <SectionCard title="향후 계획" description="현재 구현이 진행 중인 다음 단계들입니다.">
              <div className="space-y-3">
                {roadmapSections.map(({ heading, body }) => (
                  <div key={heading} className="rounded border border-dashed border-gray-200 bg-white p-3">
                    <h3 className="text-sm font-semibold text-gray-800">{heading}</h3>
                    <p className="mt-1 text-sm text-gray-600">{body}</p>
                    <p className="mt-2 text-xs text-gray-400">※ 현재 목록/상세/폼이 연결된 상태이며, 이후 단계에서 미리보기 확장과 필터 고도화를 진행합니다.</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <StickyAside
            className="static lg:sticky overflow-visible border-transparent bg-transparent p-0 shadow-none"
            offset={104}
          >
            <RecurringRuleDetail
              rule={selectedRule}
              userId={selectedRule ? selectedRule.user_id : ((memberIds && memberIds.length > 0) ? memberIds[0] : USER_ID)}
              onEdit={handleOpenEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
              isDeleting={isDeleting}
              isToggling={isToggling}
              deleteError={deleteError}
              toggleError={toggleError}
              onConfirmPending={selectedRule ? handleConfirmPending : undefined}
              onRefreshRule={refresh}
            />
          </StickyAside>
        </div>
      </div>

      <RecurringRuleForm
        mode={formMode}
        open={isFormOpen}
        userId={(memberIds && memberIds.length > 0) ? memberIds[0] : USER_ID}
        accounts={accounts}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        incomeGroups={incomeGroups}
        expenseGroups={expenseGroups}
        initialRule={formMode === "edit" ? editingRule : null}
        onClose={handleCloseForm}
        onSuccess={handleFormSuccess}
        externalPrefill={formMode === "create" ? (formPrefill as any) : null}
      />

      {candidateModal.open && candidateModal.candidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded bg-white shadow-lg">
            <div className="border-b px-4 py-2">
              <h3 className="text-sm font-semibold text-gray-800">후보 상세 · 포함할 거래 선택</h3>
              <p className="mt-0.5 text-xs text-gray-500">정기규칙 생성 시 아래에서 선택한 거래들을 규칙 히스토리에 연결합니다.</p>
            </div>
            <div className="max-h-[60vh] overflow-auto px-4 py-3">
              <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">포함</th>
                    <th className="px-3 py-2">날짜</th>
                    <th className="px-3 py-2">금액</th>
                    <th className="px-3 py-2">메모</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-[13px] text-gray-700">
                  {candidateModal.candidate.history.map((h) => {
                    const checked = candidateModal.selected.has(h.transaction_id);
                    return (
                      <tr key={h.transaction_id}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setCandidateModal((prev) => {
                                const sel = new Set(prev.selected);
                                if (e.target.checked) sel.add(h.transaction_id); else sel.delete(h.transaction_id);
                                return { ...prev, selected: sel };
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">{h.occurred_at}</td>
                        <td className="px-3 py-2">{formatCurrency(Math.abs(h.amount), candidateModal.candidate!.currency)}</td>
                        <td className="px-3 py-2">{h.memo ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
              <button
                type="button"
                className="rounded border px-3 py-1 text-xs"
                onClick={() => setCandidateModal({ open: false, candidate: null, selected: new Set() })}
              >
                취소
              </button>
              <button
                type="button"
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                onClick={() => {
                  const c = candidateModal.candidate!;
                  // Prefill rule form
                  const storageKey = "pfm:recurring:form:create:v1";
                  let categoryGroupId: number | null = null;
                  if (c.type !== "TRANSFER" && c.category_id != null) {
                    const all = [...incomeCategories, ...expenseCategories];
                    const matched = all.find((cat) => cat.id === c.category_id);
                    categoryGroupId = matched?.group_id ?? null;
                  }
                  const formState = {
                    name: c.name ?? "",
                    type: c.type,
                    frequency: c.frequency,
                    day_of_month: c.day_of_month,
                    weekday: c.weekday,
                    amount: c.is_variable_amount ? "" : String(Math.abs(c.amount ?? 0)),
                    currency: c.currency,
                    account_id: c.account_id,
                    counter_account_id: c.type === "TRANSFER" ? (c.counter_account_id ?? null) : null,
                    category_group_id: categoryGroupId,
                    category_id: c.type !== "TRANSFER" ? (c.category_id ?? null) : null,
                    memo: c.memo ?? "",
                    start_date: "",
                    end_date: "",
                    is_active: true,
                    is_variable_amount: c.is_variable_amount,
                  };
                  try {
                    window.sessionStorage.setItem(storageKey, JSON.stringify(formState));
                    const attachIds = Array.from(candidateModal.selected);
                    window.sessionStorage.setItem("pfm:recurring:form:create:attachTxIds", JSON.stringify(attachIds));
                    window.sessionStorage.setItem("pfm:recurring:form:create:candidate", JSON.stringify(c));
                  } catch {}
                  setCandidateModal({ open: false, candidate: null, selected: new Set() });
                  setFormPanel((prev) => ({ ...prev, mode: "create", open: true, editingRuleId: null }));
                  setFormPrefillVersion((v) => v + 1);
                }}
              >
                선택 포함 후 규칙 생성
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
