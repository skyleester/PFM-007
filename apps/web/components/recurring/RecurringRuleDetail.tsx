import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { addMonths, addDays, format, startOfToday } from "date-fns";
import {
  AmountTrendSummary,
  describeFrequency,
  formatCurrency,
  formatDate,
  formatFrequencyComparisonLabel,
  formatRuleAmount,
  formatTxnTypeLabel,
  summariseAmountTrend,
} from "@/lib/recurring/format";
import type { RecurringRule, RecurringRuleHistoryEntry } from "@/lib/recurring/types";
import {
  removeRecurringDraft,
  saveRecurringDraft,
  updateRecurringTransactionRecord,
  useRecurringHistory,
  useRecurringPreview,
} from "@/lib/recurring/hooks";
import { attachTransactionsToRule, listRuleCandidates, type AttachResult, consumeRecurringCandidates, attachTransactionToOccurrence, retargetLinkedTransaction, skipRecurringOccurrenceWithMeta, listRecurringSkips, unskipRecurringOccurrence, detachRecurringLink } from "@/lib/recurring/api";

export type RecurringRuleDetailProps = {
  rule: RecurringRule | null;
  userId: number;
  onEdit(): void;
  onDelete(): void;
  onToggleActive(): void;
  isDeleting: boolean;
  isToggling: boolean;
  deleteError?: string | null;
  toggleError?: string | null;
  onConfirmPending?: (input: { occurredAt: string; amount: number; memo?: string | null }) => Promise<void>;
  onRefreshRule?: () => void;
};

export function RecurringRuleDetail({
  rule,
  userId,
  onEdit,
  onDelete,
  onToggleActive,
  isDeleting,
  isToggling,
  deleteError,
  toggleError,
  onConfirmPending,
  onRefreshRule,
}: RecurringRuleDetailProps) {
  const [previewMonths, setPreviewMonths] = useState<number>(3);
  const [previewPage, setPreviewPage] = useState(0);

  const previewRange = useMemo(() => {
    const start = startOfToday();
    const end = addMonths(start, previewMonths);
    return {
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
    };
  }, [previewMonths]);

  const PREVIEW_PAGE_SIZE = 20;
  const previewRangeOptions = useMemo(() => [1, 3, 6, 12], []);

  const preview = useRecurringPreview({
    ruleId: rule?.id ?? 0,
    start: previewRange.start,
    end: previewRange.end,
    page: previewPage + 1,
    pageSize: PREVIEW_PAGE_SIZE,
    enabled: Boolean(rule),
  });

  const [historyLimit, setHistoryLimit] = useState(12);
  const [historyCollapsed, setHistoryCollapsed] = useState<boolean>(false);
  const history = useRecurringHistory({
    ruleId: rule?.id ?? null,
    userId,
    limit: historyLimit,
    enabled: Boolean(rule),
  });

  const [pendingForms, setPendingForms] = useState<Record<string, { amount: string; memo: string; isSubmitting: boolean; error?: string }>>({});
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  type FutureDraftState = {
    amount: string;
    memo: string;
    savedAt: string | null;
    isSaving: boolean;
    error: string | null;
    dirty: boolean;
  };
  const [futureDraftInputs, setFutureDraftInputs] = useState<Record<string, FutureDraftState>>({});
  const [historyEdits, setHistoryEdits] = useState<Record<number, { amount: string; memo: string; isSaving: boolean; error: string | null }>>({});

  useEffect(() => {
    setPendingForms({});
    setHistoryLimit(12);
    setPreviewPage(0);
    setFutureDraftInputs({});
    setHistoryEdits({});
  }, [rule?.id]);

  const previewData = preview.status === "success" ? preview.data : null;
  const previewItems = useMemo(() => (previewData?.items ? previewData.items : []), [previewData]);
  const previewTotalCount = previewData?.total_count ?? 0;
  const previewPageSize = previewData?.page_size ?? PREVIEW_PAGE_SIZE;
  const serverPageIndex = previewData ? Math.max(0, previewData.page - 1) : previewPage;
  const previewPageCount = Math.max(1, Math.ceil(previewTotalCount / previewPageSize));
  const currentPreviewPage = Math.min(serverPageIndex, previewPageCount - 1);

  useEffect(() => {
    setPreviewPage((prev) => {
      if (prev === currentPreviewPage) {
        return prev;
      }
      return currentPreviewPage;
    });
  }, [currentPreviewPage]);

  useEffect(() => {
    if (!previewData) {
      return;
    }
    const futureItems = previewItems.filter((item) => item.is_future);
    setFutureDraftInputs((prev) => {
      const next: Record<string, FutureDraftState> = { ...prev };
      futureItems.forEach((item) => {
        const dateKey = item.occurred_at;
        const baseAmount = item.draft_amount != null ? String(item.draft_amount) : "";
        const baseMemo = item.draft_memo ?? "";
        const savedAt = item.draft_updated_at ?? null;
        const existing = prev[dateKey];
        if (existing?.dirty) {
          next[dateKey] = { ...existing, savedAt };
        } else {
          next[dateKey] = {
            amount: baseAmount,
            memo: baseMemo,
            savedAt,
            isSaving: false,
            error: null,
            dirty: false,
          };
        }
      });
      return next;
    });
  }, [previewData, previewItems]);

  useEffect(() => {
    setPreviewPage((prev) => Math.min(prev, Math.max(0, previewPageCount - 1)));
  }, [previewPageCount]);

  const handlePreviewMonthsChange = useCallback(
    (months: number) => {
      setPreviewMonths(months);
      setPreviewPage(0);
    },
    [setPreviewMonths, setPreviewPage],
  );

  const handlePreviewPrevPage = useCallback(() => {
    setPreviewPage((prev) => Math.max(prev - 1, 0));
  }, [setPreviewPage]);

  const handlePreviewNextPage = useCallback(() => {
    setPreviewPage((prev) => Math.min(prev + 1, previewPageCount - 1));
  }, [previewPageCount, setPreviewPage]);
  const previewError = preview.status === "error" ? preview.error?.message : null;

  const historyData = history.status === "success" ? history.data : null;
  const historyError = history.status === "error" ? history.error?.message : null;
  const historyCurrency = historyData?.currency ?? rule?.currency ?? "KRW";

  // 후보 트랜잭션 패널 상태 (변동 금액 규칙 전용)
  type Candidate = { id: number; occurred_at: string; amount: number; memo: string | null; currency: string; external_id?: string | null };
  const [candLoading, setCandLoading] = useState(false);
  const [candError, setCandError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candSelected, setCandSelected] = useState<Set<number>>(new Set());
  const [candRangeMonths, setCandRangeMonths] = useState<number>(6);
  // date-specific matching state
  const [matchDate, setMatchDate] = useState<string>("");
  const [matchForOccurrence, setMatchForOccurrence] = useState<string | null>(null);
  const [dateMatchLoading, setDateMatchLoading] = useState(false);
  const [dateMatchError, setDateMatchError] = useState<string | null>(null);
  const [dateMatchList, setDateMatchList] = useState<Candidate[]>([]);
  const [dateIncludeLinked, setDateIncludeLinked] = useState<boolean>(false);
  const [matchRangeDays, setMatchRangeDays] = useState<number>(7);
  const [skips, setSkips] = useState<Array<{ id: number; occurred_at: string; reason?: string | null }>>([]);
  const [skipPanelOpen, setSkipPanelOpen] = useState<boolean>(false);
  const [skipMemoInput, setSkipMemoInput] = useState<string>("");

  const reloadCandidates = useCallback(async () => {
    if (!rule) return;
    setCandLoading(true);
    setCandError(null);
    try {
      const end = startOfToday();
      const start = addMonths(end, -candRangeMonths);
      const items = await listRuleCandidates(rule.id, rule.user_id, {
        start: format(start, "yyyy-MM-dd"),
        end: format(end, "yyyy-MM-dd"),
      });
      const rows = items.map((t: any) => ({ id: t.id, occurred_at: t.occurred_at, amount: t.amount, memo: t.memo, currency: t.currency, external_id: t.external_id }));
      setCandidates(rows);
      setCandSelected(new Set());
    } catch (e) {
      setCandError(e instanceof Error ? e.message : String(e));
    } finally {
      setCandLoading(false);
    }
  }, [rule, candRangeMonths]);

  useEffect(() => {
    setCandidates([]);
    setCandSelected(new Set());
    if (rule && rule.is_variable_amount) {
      void reloadCandidates();
    }
    // load skips for the rule
    (async () => {
      if (!rule) return;
      try {
        const rows = await listRecurringSkips(rule.id, rule.user_id);
        setSkips(rows.map((r: any) => ({ id: r.id, occurred_at: r.occurred_at, reason: r.reason })));
      } catch {
        // ignore
      }
    })();
  }, [rule, reloadCandidates]);

  useEffect(() => {
    if (rule && rule.is_variable_amount) {
      void reloadCandidates();
    }
  }, [candRangeMonths, rule, reloadCandidates]);

  const toggleSelect = useCallback((id: number) => {
    setCandSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const attachSelected = useCallback(async () => {
    if (!rule) return;
    const ids = Array.from(candSelected);
    if (ids.length === 0) return;
    try {
  const res: AttachResult = await attachTransactionsToRule(rule.id, rule.user_id, ids);
  const attached = Array.isArray((res as any).attached) ? (res as any).attached.length : 0;
  const errors = Array.isArray((res as any).errors) ? (res as any).errors.length : 0;
      if (attached > 0 || errors > 0) {
        window.alert(`편입 ${attached}건${errors ? `, 실패 ${errors}건` : ""}`);
      }
      await reloadCandidates();
  preview.refresh();
  history.refresh();
  onRefreshRule && onRefreshRule();
      // 부모에서 규칙 리스트를 갱신해 pending_occurrences가 즉시 반영되도록 한다
      onRefreshRule && onRefreshRule();
    } catch (e) {
      window.alert(`편입 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [rule, candSelected, reloadCandidates, preview, history, onRefreshRule]);

  const ignoreSelected = useCallback(async () => {
    if (!rule) return;
    const ids = Array.from(candSelected);
    if (ids.length === 0) return;
    const ok = window.confirm("선택한 후보를 이 정기규칙에서 배제할까요? 이후 스캔/후보 목록에 나타나지 않습니다.");
    if (!ok) return;
    try {
      const res: AttachResult = await consumeRecurringCandidates(rule.id, rule.user_id, ids, "ignored");
      const errors = Array.isArray((res as any).errors) ? (res as any).errors.length : 0;
      if (errors > 0) {
        window.alert(`일부 항목 배제 실패: ${errors}건`);
      }
      await reloadCandidates();
      preview.refresh();
      history.refresh();
      onRefreshRule && onRefreshRule();
    } catch (e) {
      window.alert(`배제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [rule, candSelected, reloadCandidates, preview, history, onRefreshRule]);

  const confirmDisabled = !onConfirmPending;

  // Derive a local view of pending occurrences that excludes skipped dates so UI reflects skips immediately
  const skippedDateSet = useMemo(() => new Set(skips.map((s) => s.occurred_at)), [skips]);
  const pendingList = useMemo(
    () => (rule?.pending_occurrences ?? []).filter((d) => !skippedDateSet.has(d)),
    [rule?.pending_occurrences, skippedDateSet],
  );
  const pendingDates = useMemo(() => new Set(pendingList), [pendingList]);

  const previewDraftIndex = useMemo(() => {
    const map: Record<string, { amount: string; memo: string; savedAt: string | null }> = {};
    previewItems.forEach((item) => {
      map[item.occurred_at] = {
        amount: item.draft_amount != null ? String(item.draft_amount) : "",
        memo: item.draft_memo ?? "",
        savedAt: item.draft_updated_at ?? null,
      };
    });
    return map;
  }, [previewItems]);

  const buildPendingEntryFromDraft = useCallback(
    (date: string) => {
      const draft = previewDraftIndex[date] ?? futureDraftInputs[date];
      return {
        amount: draft?.amount ?? "",
        memo: draft?.memo ?? "",
        isSubmitting: false,
        error: undefined as string | undefined,
      };
    },
    [previewDraftIndex, futureDraftInputs],
  );

  const getPendingEntry = useCallback(
    (date: string) => pendingForms[date] ?? buildPendingEntryFromDraft(date),
    [pendingForms, buildPendingEntryFromDraft],
  );

  const handlePendingFieldChange = (date: string, field: "amount" | "memo", value: string) => {
    setPendingForms((prev) => {
      const current = prev[date] ?? buildPendingEntryFromDraft(date);
      return {
        ...prev,
        [date]: { ...current, [field]: value, error: undefined },
      };
    });
    setBulkError(null);
  };

  const handlePendingSubmit = async (event: FormEvent<HTMLFormElement>, date: string) => {
    event.preventDefault();
    if (!onConfirmPending) {
      return;
    }
    const entry = getPendingEntry(date);
    const amountValue = Number(entry.amount);
    if (!entry.amount || Number.isNaN(amountValue) || amountValue <= 0) {
      setPendingForms((prev) => ({
        ...prev,
        [date]: { ...entry, error: "양수 금액을 입력하세요." },
      }));
      return;
    }

    setPendingForms((prev) => ({
      ...prev,
      [date]: { ...entry, isSubmitting: true, error: undefined },
    }));

    try {
      await onConfirmPending({
        occurredAt: date,
        amount: amountValue,
        memo: entry.memo ? entry.memo : null,
      });
      setPendingForms((prev) => {
        const next = { ...prev };
        delete next[date];
        return next;
      });
      setFutureDraftInputs((prev) => {
        if (!prev[date]) {
          return prev;
        }
        const next = { ...prev };
        delete next[date];
        return next;
      });
      preview.refresh();
      history.refresh();
    } catch (error) {
      setPendingForms((prev) => ({
        ...prev,
        [date]: {
          ...entry,
          isSubmitting: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const loadDateMatchList = useCallback(
    async (centerDate: string, includeLinked: boolean, rangeDays: number) => {
      if (!rule) return;
      setDateMatchLoading(true);
      setDateMatchError(null);
      try {
        const center = new Date(centerDate);
        const start = format(addDays(center, -rangeDays), "yyyy-MM-dd");
        const end = format(addDays(center, rangeDays), "yyyy-MM-dd");
        const items = await listRuleCandidates(rule.id, rule.user_id, { start, end, includeLinked });
        const rows = items.map((t: any) => ({ id: t.id, occurred_at: t.occurred_at, amount: t.amount, memo: t.memo, currency: t.currency, external_id: t.external_id }));
        setDateMatchList(rows);
      } catch (e) {
        setDateMatchError(e instanceof Error ? e.message : String(e));
      } finally {
        setDateMatchLoading(false);
      }
    },
    [rule],
  );

  const openMatchForDate = async (occDate: string) => {
    if (!rule) return;
    setMatchForOccurrence(occDate);
    setMatchDate(occDate);
    setDateMatchList([]);
    void loadDateMatchList(occDate, dateIncludeLinked, matchRangeDays);
  };

  const refreshAll = async () => {
    await reloadCandidates();
    preview.refresh();
    history.refresh();
    onRefreshRule && onRefreshRule();
  };

  const attachBySelectedDate = async (txnId: number) => {
    if (!rule || !matchForOccurrence) return;
    try {
      const res: AttachResult = await attachTransactionToOccurrence({
        ruleId: rule.id,
        userId: rule.user_id,
        transactionId: txnId,
        occurredAt: matchForOccurrence,
      });
      const ok = Array.isArray((res as any).attached) && (res as any).attached.length > 0;
      const errs = Array.isArray((res as any).errors) ? (res as any).errors.length : 0;
      if (ok) {
        window.alert("매칭 완료");
        setMatchForOccurrence(null);
        setDateMatchList([]);
        await refreshAll();
      } else if (errs) {
        const first = (res as any).errors[0];
        const detail = first?.detail ?? "";
        if (typeof detail === "string" && detail.includes("already linked")) {
          const confirm = window.confirm("이미 매칭된 회차입니다. 이 회차로 변경하시겠습니까?");
          if (confirm) {
            try {
              const rr = await retargetLinkedTransaction({ ruleId: rule.id, userId: rule.user_id, transactionId: txnId, occurredAt: matchForOccurrence });
              const ok2 = Array.isArray((rr as any).attached) && (rr as any).attached.length > 0;
              if (ok2) {
                window.alert("회차 재지정 완료");
                setMatchForOccurrence(null);
                setDateMatchList([]);
                await refreshAll();
                return;
              }
            } catch (err) {
              window.alert("재지정 실패: " + (err instanceof Error ? err.message : String(err)));
            }
          }
        } else {
          window.alert("매칭 실패: " + detail);
        }
      } else {
        window.alert("매칭할 수 없습니다.");
      }
    } catch (e) {
      window.alert(`매칭 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSkipOccurrence = async (date: string) => {
    if (!rule) return;
    const ok = window.confirm("이 회차를 건너뛰시겠습니까? 이후 미확정 목록에서 제외됩니다.");
    if (!ok) return;
    try {
      const { status } = await skipRecurringOccurrenceWithMeta(rule.id, rule.user_id, date, skipMemoInput);
      setSkipMemoInput("");
      // refresh skips and preview rule
      const rows = await listRecurringSkips(rule.id, rule.user_id);
      setSkips(rows.map((r: any) => ({ id: r.id, occurred_at: r.occurred_at, reason: r.reason })));
      onRefreshRule && onRefreshRule();
      preview.refresh();
      if (status === 201 || status === 200 || status === 409) {
        // 409 means already skipped or already satisfied; treat as idempotent success
        return;
      }
    } catch (e) {
      window.alert("건너뛰기 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleUnskip = async (date: string) => {
    if (!rule) return;
    const ok = window.confirm("해당 회차 건너뛰기를 취소할까요?");
    if (!ok) return;
    try {
      await unskipRecurringOccurrence(rule.id, rule.user_id, date);
      const rows = await listRecurringSkips(rule.id, rule.user_id);
      setSkips(rows.map((r: any) => ({ id: r.id, occurred_at: r.occurred_at, reason: r.reason })));
      onRefreshRule && onRefreshRule();
      preview.refresh();
    } catch (e) {
      window.alert("복원 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleBulkPendingSubmit = async () => {
    if (!onConfirmPending || !rule) {
      return;
    }

    const targets = pendingList.map((date) => {
      const entry = getPendingEntry(date);
      const amountValue = Number(entry.amount);
      return {
        date,
        entry,
        amountValue,
        isValid: Boolean(entry.amount) && !Number.isNaN(amountValue) && amountValue > 0,
      };
    });

    const invalidTargets = targets.filter((item) => !item.isValid);
    if (invalidTargets.length > 0) {
      setBulkError("모든 금액을 입력해야 일괄 확정할 수 있습니다.");
      setPendingForms((prev) => {
        const next = { ...prev };
        invalidTargets.forEach(({ date, entry }) => {
          next[date] = { ...entry, error: "양수 금액을 입력하세요." };
        });
        return next;
      });
      return;
    }

    setBulkError(null);
    setIsBulkSubmitting(true);
    setPendingForms((prev) => {
      const next = { ...prev };
      targets.forEach(({ date, entry }) => {
        next[date] = { ...entry, isSubmitting: true, error: undefined };
      });
      return next;
    });

    const failures: Array<{ date: string; message: string }> = [];

    for (const { date, entry, amountValue } of targets) {
      try {
        await onConfirmPending({
          occurredAt: date,
          amount: amountValue,
          memo: entry.memo ? entry.memo : null,
        });
        setPendingForms((prev) => {
          const next = { ...prev };
          delete next[date];
          return next;
        });
        setFutureDraftInputs((prev) => {
          if (!prev[date]) {
            return prev;
          }
          const next = { ...prev };
          delete next[date];
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ date, message });
        setPendingForms((prev) => ({
          ...prev,
          [date]: { ...entry, isSubmitting: false, error: message },
        }));
      }
    }

    setIsBulkSubmitting(false);
    if (failures.length > 0) {
      setBulkError(`${failures.length}건을 확정하지 못했습니다. 항목을 확인하고 다시 시도하세요.`);
    } else {
  setBulkError(null);
  preview.refresh();
  history.refresh();
  onRefreshRule && onRefreshRule();
    }
  };

  const handleFutureDraftFieldChange = useCallback((date: string, field: "amount" | "memo", value: string) => {
    setFutureDraftInputs((prev) => {
      const current = prev[date] ?? {
        amount: "",
        memo: "",
        savedAt: null,
        isSaving: false,
        error: null,
        dirty: false,
      };
      return {
        ...prev,
        [date]: {
          ...current,
          [field]: value,
          dirty: true,
          error: null,
        },
      };
    });
  }, []);

  const handleFutureDraftBlur = useCallback(
    async (date: string) => {
      if (!rule) {
        return;
      }
      const entry = futureDraftInputs[date];
      if (!entry) {
        return;
      }
      const amountRaw = entry.amount.trim();
      const memoRaw = entry.memo.trim();

      if (!entry.dirty && !entry.error) {
        return;
      }

      if (amountRaw !== "" && (Number.isNaN(Number(amountRaw)) || Number(amountRaw) <= 0)) {
        setFutureDraftInputs((prev) => ({
          ...prev,
          [date]: { ...entry, error: "양수 금액을 입력하세요.", dirty: true },
        }));
        return;
      }

      setFutureDraftInputs((prev) => ({
        ...prev,
        [date]: { ...entry, isSaving: true, error: null },
      }));

      try {
        if (amountRaw === "" && memoRaw === "") {
          await removeRecurringDraft(rule.id, date);
          setFutureDraftInputs((prev) => ({
            ...prev,
            [date]: {
              amount: "",
              memo: "",
              savedAt: null,
              isSaving: false,
              error: null,
              dirty: false,
            },
          }));
        } else {
          const amountNumber = amountRaw === "" ? undefined : Number(amountRaw);
          const result = await saveRecurringDraft({
            ruleId: rule.id,
            occurredAt: date,
            amount: amountNumber,
            memo: memoRaw === "" ? undefined : memoRaw,
          });
          setFutureDraftInputs((prev) => ({
            ...prev,
            [date]: {
              amount: amountRaw,
              memo: memoRaw,
              savedAt: result.updated_at,
              isSaving: false,
              error: null,
              dirty: false,
            },
          }));
        }
        preview.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFutureDraftInputs((prev) => ({
          ...prev,
          [date]: {
            ...entry,
            isSaving: false,
            error: message,
            dirty: true,
          },
        }));
      }
    },
    [futureDraftInputs, preview, rule],
  );

  const handleFutureDraftReset = useCallback(
    async (date: string) => {
      if (!rule) {
        return;
      }
      try {
        await removeRecurringDraft(rule.id, date);
        setFutureDraftInputs((prev) => ({
          ...prev,
          [date]: {
            amount: "",
            memo: "",
            savedAt: null,
            isSaving: false,
            error: null,
            dirty: false,
          },
        }));
        preview.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFutureDraftInputs((prev) => ({
          ...prev,
          [date]: {
            ...(prev[date] ?? {
              amount: "",
              memo: "",
              savedAt: null,
              isSaving: false,
              dirty: false,
            }),
            error: message,
          },
        }));
      }
    },
    [preview, rule],
  );

  const formatDraftSavedTimestamp = useCallback((value?: string) => {
    if (!value) {
      return null;
    }
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) {
      return null;
    }
    return format(asDate, "yyyy-MM-dd HH:mm");
  }, []);

  const formatHistoryAmount = (value: number | null | undefined) => {
    if (value == null) return "—";
    return formatCurrency(value, historyCurrency);
  };

  const formatHistoryDelta = (value: number | null | undefined) => {
    if (value == null) return "—";
    if (value === 0) {
      return `± ${formatCurrency(0, historyCurrency)}`;
    }
    const sign = value > 0 ? "+" : "−";
    return `${sign} ${formatCurrency(Math.abs(value), historyCurrency)}`;
  };

  const historyDeltaTone = (value: number | null | undefined) => {
    if (value == null || value === 0) {
      return "text-gray-500";
    }
    return value > 0 ? "text-emerald-600" : "text-rose-600";
  };

  const comparisonFrequency = rule?.frequency ?? null;

  const comparisonLabel = useMemo(
    () => (comparisonFrequency ? formatFrequencyComparisonLabel(comparisonFrequency) : "이전 대비"),
    [comparisonFrequency],
  );

  const historyTrendTone = (trend: AmountTrendSummary | null) => {
    if (!trend) {
      return "text-gray-400";
    }
    switch (trend.direction) {
      case "increase":
        return "text-rose-600";
      case "decrease":
        return "text-sky-600";
      default:
        return "text-gray-500";
    }
  };

  const formatHistoryTrend = (trend: AmountTrendSummary | null) => {
    if (!trend) {
      return null;
    }
    if (trend.direction === "flat") {
      return `${comparisonLabel} 변동 없음`;
    }
    const symbol = trend.direction === "increase" ? "▲" : "▼";
    const suffix = trend.direction === "increase" ? "증가" : "감소";
    return `${comparisonLabel} ${symbol} ${trend.formattedDelta} ${suffix}`;
  };

  const historyTransactions = useMemo<Array<RecurringRuleHistoryEntry & { trend: AmountTrendSummary | null }>>(
    () =>
      historyData
        ? historyData.transactions.map((item, index, array) => {
            const previous = index + 1 < array.length ? array[index + 1] : null;
            return {
              ...item,
              trend: summariseAmountTrend(item.amount, previous?.amount ?? null, historyCurrency),
            };
          })
        : [],
    [historyData, historyCurrency],
  );

  const handleStartHistoryEdit = useCallback(
    (entry: RecurringRuleHistoryEntry) => {
      setHistoryEdits((prev) => {
        if (prev[entry.transaction_id]) {
          return prev;
        }
        return {
          ...prev,
          [entry.transaction_id]: {
            amount: String(entry.amount != null ? Math.abs(entry.amount) : 0),
            memo: entry.memo ?? "",
            isSaving: false,
            error: null,
          },
        };
      });
    },
    [],
  );

  const handleCancelHistoryEdit = useCallback((transactionId: number) => {
    setHistoryEdits((prev) => {
      if (!prev[transactionId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[transactionId];
      return next;
    });
  }, []);

  const handleHistoryEditFieldChange = useCallback((transactionId: number, field: "amount" | "memo", value: string) => {
    setHistoryEdits((prev) => {
      const current = prev[transactionId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [transactionId]: {
          ...current,
          [field]: value,
          error: null,
        },
      };
    });
  }, []);

  const handleHistoryEditSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>, entry: RecurringRuleHistoryEntry) => {
      event.preventDefault();
      const current = historyEdits[entry.transaction_id];
      if (!rule || !current) {
        return;
      }
      const amountValue = Number(current.amount);
      if (!current.amount || Number.isNaN(amountValue) || amountValue <= 0) {
        setHistoryEdits((prev) => ({
          ...prev,
          [entry.transaction_id]: { ...current, error: "양수 금액을 입력하세요." },
        }));
        return;
      }

      setHistoryEdits((prev) => ({
        ...prev,
        [entry.transaction_id]: { ...current, isSaving: true, error: null },
      }));

      try {
        const signedAmount = rule.type === "EXPENSE" ? -Math.abs(amountValue) : Math.abs(amountValue);
        await updateRecurringTransactionRecord({
          transactionId: entry.transaction_id,
          amount: signedAmount,
          memo: current.memo.trim() === "" ? null : current.memo.trim(),
        });
        setHistoryEdits((prev) => {
          const next = { ...prev };
          delete next[entry.transaction_id];
          return next;
        });
        history.refresh();
        preview.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setHistoryEdits((prev) => ({
          ...prev,
          [entry.transaction_id]: { ...current, isSaving: false, error: message },
        }));
      }
    },
    [historyEdits, history, preview, rule],
  );

  const handleDetach = useCallback(
    async (transactionId: number) => {
      if (!rule) return;
      const ok = window.confirm("이 거래의 정기결제 매칭을 해제할까요?");
      if (!ok) return;
      try {
        const res = await detachRecurringLink(rule.id, rule.user_id, transactionId);
        const detached = Array.isArray((res as any).detached) && (res as any).detached.length > 0;
        if (detached) {
          window.alert("매칭을 해제했습니다.");
          history.refresh();
          preview.refresh();
          onRefreshRule && onRefreshRule();
        } else {
          const detail = (res as any).errors?.[0]?.detail ?? "알 수 없는 오류";
          window.alert("해제 실패: " + detail);
        }
      } catch (error) {
        window.alert("해제 실패: " + (error instanceof Error ? error.message : String(error)));
      }
    },
    [history, onRefreshRule, preview, rule],
  );

  const handleLoadMoreHistory = useCallback(() => {
    setHistoryLimit((prev) => Math.min(prev + 12, 365));
  }, []);

  const historySummaryItems: Array<{ label: string; value: string; tone: string }> = historyData
    ? [
        { label: "최근 건수", value: `${historyData.count}건`, tone: "text-gray-900" },
        { label: "기준 금액", value: formatHistoryAmount(historyData.base_amount), tone: "text-gray-900" },
        { label: "평균 금액", value: formatHistoryAmount(historyData.average_amount), tone: "text-gray-900" },
        { label: "최소 금액", value: formatHistoryAmount(historyData.min_amount), tone: "text-rose-600" },
        { label: "최대 금액", value: formatHistoryAmount(historyData.max_amount), tone: "text-emerald-600" },
        ...(historyData.base_amount != null
          ? [
              {
                label: "평균 변동",
                value: formatHistoryDelta(historyData.average_delta),
                tone: historyDeltaTone(historyData.average_delta),
              },
              {
                label: "최대 상승",
                value: formatHistoryDelta(historyData.max_delta),
                tone: historyDeltaTone(historyData.max_delta),
              },
              {
                label: "최대 하락",
                value: formatHistoryDelta(historyData.min_delta),
                tone: historyDeltaTone(historyData.min_delta),
              },
            ]
          : []),
      ]
    : [];

  if (!rule) {
    return (
      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="text-sm text-gray-500">
          왼쪽 목록에서 규칙을 선택하면 상세 정보와 미리보기를 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">선택된 규칙</h3>
          <p className="text-xs text-gray-500">향후 90일 이내 발생 일정을 미리 확인하고 관리할 수 있습니다.</p>
        </div>
        <span className="text-xs text-gray-400">ID #{rule.id}</span>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="text-base font-semibold text-gray-900">{rule.name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
              {rule.is_active ? "활성" : "비활성"}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
              {formatTxnTypeLabel(rule.type)}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
              {describeFrequency(rule)}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
              금액 {formatRuleAmount(rule)}
            </span>
            {rule.is_variable_amount && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                미확정 {pendingList.length}건
              </span>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase text-gray-500">세부 정보</h4>
          <dl className="mt-2 grid gap-2 text-sm text-gray-700">
            <DetailRow label="계좌" value={`#${rule.account_id}`} />
            <DetailRow label="상대 계좌" value={rule.counter_account_id ? `#${rule.counter_account_id}` : "-"} />
            <DetailRow label="카테고리" value={rule.category_id ? `#${rule.category_id}` : "-"} />
            <DetailRow label="시작일" value={formatDate(rule.start_date)} />
            <DetailRow label="종료일" value={formatDate(rule.end_date)} />
            <DetailRow label="마지막 생성일" value={formatDate(rule.last_generated_at)} />
            {rule.memo && (
              <div className="flex flex-col gap-1 text-left">
                <dt className="text-xs text-gray-500">메모</dt>
                <dd className="text-sm text-gray-700">{rule.memo}</dd>
              </div>
            )}
          </dl>
        </div>

        {rule.is_variable_amount && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-500">미확정 발생</h4>
            {pendingList.length === 0 ? (
              <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                처리할 미확정 발생이 없습니다.
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {pendingList.map((date) => {
                  const entry = getPendingEntry(date);
                  return (
                    <li key={date} className="rounded border border-gray-200 bg-gray-50 p-3">
                      <form
                        onSubmit={(event) => handlePendingSubmit(event, date)}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                      >
                        <div className="sm:min-w-[200px]">
                          <div className="text-sm font-medium text-gray-900">{formatDate(date)}</div>
                          <div className="text-[11px] text-gray-500">금액과 메모를 입력해 확정하세요.</div>
                        </div>
                        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
                          <div className="flex-1">
                            <label className="sr-only" htmlFor={`pending-amount-${date}`}>
                              금액
                            </label>
                            <input
                              id={`pending-amount-${date}`}
                              type="number"
                              min={0}
                              step="0.01"
                              value={entry.amount}
                              onChange={(event) => handlePendingFieldChange(date, "amount", event.target.value)}
                              disabled={confirmDisabled || entry.isSubmitting}
                              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                              placeholder="금액"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="sr-only" htmlFor={`pending-memo-${date}`}>
                              메모
                            </label>
                            <input
                              id={`pending-memo-${date}`}
                              type="text"
                              value={entry.memo}
                              onChange={(event) => handlePendingFieldChange(date, "memo", event.target.value)}
                              disabled={entry.isSubmitting}
                              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                              placeholder="메모 (선택)"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={confirmDisabled || entry.isSubmitting}
                            className={clsx(
                              "inline-flex items-center justify-center rounded px-3 py-2 text-sm font-medium text-white",
                              confirmDisabled || entry.isSubmitting
                                ? "cursor-not-allowed bg-gray-300"
                                : "bg-emerald-600 hover:bg-emerald-700",
                            )}
                          >
                            {entry.isSubmitting ? "확정 중…" : "확정"}
                          </button>
                          <div className="flex items-center gap-1">
                            <input type="text" value={skipMemoInput} onChange={(e) => setSkipMemoInput(e.target.value)} placeholder="건너뛰기 메모 (선택)" className="w-40 rounded border border-gray-300 px-2 py-2 text-xs focus:border-emerald-500 focus:outline-none" />
                            <button
                              type="button"
                              onClick={() => handleSkipOccurrence(date)}
                              className="inline-flex items-center justify-center rounded bg-gray-600 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                            >
                              건너뛰기
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => openMatchForDate(date)}
                            className="inline-flex items-center justify-center rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                          >
                            해당 회차 매칭…
                          </button>
                        </div>
                      </form>
                      {entry.error && <p className="mt-2 text-[11px] text-rose-600">{entry.error}</p>}

                      {matchForOccurrence === date && (
                        <div className="mt-3 rounded border border-indigo-200 bg-indigo-50 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-xs font-medium text-indigo-700">선택한 날짜의 트랜잭션을 매칭합니다.</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="date"
                                value={matchDate}
                                onChange={async (e) => {
                                  const d = e.target.value;
                                  setMatchDate(d);
                                  void loadDateMatchList(d, dateIncludeLinked, matchRangeDays);
                                }}
                                className="rounded border border-gray-300 px-2 py-1 text-xs"
                              />
                              <label className="ml-2 inline-flex items-center gap-1 text-[11px] text-gray-600">
                                <input type="checkbox" checked={dateIncludeLinked} onChange={async (e) => {
                                  const v = e.target.checked;
                                  setDateIncludeLinked(v);
                                  const d = matchDate || matchForOccurrence!;
                                  void loadDateMatchList(d, v, matchRangeDays);
                                }} />
                                링크된 거래 포함
                              </label>
                              <label className="ml-2 inline-flex items-center gap-1 text-[11px] text-gray-600">
                                범위
                                <select
                                  className="rounded border border-gray-300 px-1 py-0.5 text-[11px]"
                                  value={matchRangeDays}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setMatchRangeDays(v);
                                    const d = matchDate || matchForOccurrence!;
                                    void loadDateMatchList(d, dateIncludeLinked, v);
                                  }}
                                >
                                  {[0, 3, 7, 14].map((n) => (
                                    <option key={n} value={n}>
                                      ±{n}일
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button type="button" onClick={() => setMatchForOccurrence(null)} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">닫기</button>
                            </div>
                          </div>
                          {dateMatchError && <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">불러오기 실패: {dateMatchError}</div>}
                          {dateMatchLoading ? (
                            <div className="mt-2 text-xs text-gray-600">불러오는 중…</div>
                          ) : dateMatchList.length === 0 ? (
                            <div className="mt-2 rounded border border-dashed border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700">선택한 날짜에 규칙과 일치하는 거래가 없습니다.</div>
                          ) : (
                            <div className="mt-2 overflow-hidden rounded border border-indigo-200">
                              <table className="min-w-full divide-y divide-indigo-200 text-left text-xs">
                                <thead className="bg-indigo-100 text-[11px] uppercase tracking-wide text-indigo-700">
                                  <tr>
                                    <th className="px-3 py-2">날짜</th>
                                    <th className="px-3 py-2 text-right">금액</th>
                                    <th className="px-3 py-2">메모</th>
                                    <th className="px-3 py-2"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-indigo-200 bg-white">
                                  {dateMatchList.map((t) => (
                                    <tr key={t.id}>
                                      <td className="px-3 py-2">{formatDate(t.occurred_at)}</td>
                                      <td className="px-3 py-2 text-right">{formatCurrency(t.amount, t.currency)}</td>
                                      <td className="px-3 py-2">{t.memo ?? "-"}</td>
                                      <td className="px-3 py-2 text-right">
                                        {t && (t as any).external_id && String((t as any).external_id).startsWith(`rule-${rule!.id}-`) ? (
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const res: AttachResult = await retargetLinkedTransaction({
                                                  ruleId: rule!.id,
                                                  userId: rule!.user_id,
                                                  transactionId: (t as any).id,
                                                  occurredAt: matchForOccurrence!,
                                                });
                                                const ok = Array.isArray((res as any).attached) && (res as any).attached.length > 0;
                                                if (ok) {
                                                  window.alert("회차 재지정 완료");
                                                  setMatchForOccurrence(null);
                                                  setDateMatchList([]);
                                                  await refreshAll();
                                                } else {
                                                  window.alert("재지정 실패: " + ((res as any).errors?.[0]?.detail ?? "알 수 없는 오류"));
                                                }
                                              } catch (err) {
                                                window.alert("재지정 실패: " + (err instanceof Error ? err.message : String(err)));
                                              }
                                            }}
                                            className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                                          >
                                            링크 재지정
                                          </button>
                                        ) : null}
                                        {t && (t as any).external_id && String((t as any).external_id).startsWith(`rule-${rule!.id}-`) ? (
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              const ok = window.confirm("이 거래의 정기결제 매칭을 해제할까요?");
                                              if (!ok) return;
                                              try {
                                                const res = await detachRecurringLink(rule!.id, rule!.user_id, (t as any).id);
                                                const detached = Array.isArray((res as any).detached) && (res as any).detached.length > 0;
                                                if (detached) {
                                                  window.alert("매칭을 해제했습니다.");
                                                  await refreshAll();
                                                } else {
                                                  const detail = (res as any).errors?.[0]?.detail ?? "알 수 없는 오류";
                                                  window.alert("해제 실패: " + detail);
                                                }
                                              } catch (err) {
                                                window.alert("해제 실패: " + (err instanceof Error ? err.message : String(err)));
                                              }
                                            }}
                                            className="ml-2 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                                          >
                                            매칭 해제
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => attachBySelectedDate((t as any).id)}
                                            className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                                          >
                                            이 거래로 매칭
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {pendingList.length > 0 ? (
              <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={handleBulkPendingSubmit}
                  disabled={confirmDisabled || isBulkSubmitting}
                  className={clsx(
                    "inline-flex items-center justify-center rounded px-3 py-2 text-sm font-medium text-white",
                    confirmDisabled || isBulkSubmitting ? "cursor-not-allowed bg-gray-300" : "bg-emerald-700 hover:bg-emerald-800",
                  )}
                >
                  {isBulkSubmitting ? "일괄 확정 중…" : "모든 항목 일괄 확정"}
                </button>
                {bulkError && <p className="text-[11px] text-rose-600">{bulkError}</p>}
              </div>
            ) : null}
            {confirmDisabled && (
              <p className="mt-2 text-[11px] text-gray-500">확정 기능을 사용할 수 없습니다.</p>
            )}
          </div>
        )}

        {rule.is_variable_amount && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-500">후보 트랜잭션</h4>
            <div className="mb-2 flex items-center justify-between">
              <button type="button" className="text-[11px] text-gray-600 underline-offset-2 hover:underline" onClick={() => setSkipPanelOpen((v) => !v)}>
                {skipPanelOpen ? "건너뛴 회차 숨기기" : `건너뛴 회차 보기 (${skips.length})`}
              </button>
            </div>
            {skipPanelOpen && (
              <div className="mb-2 rounded border border-dashed border-gray-200 bg-gray-50 p-2">
                {skips.length === 0 ? (
                  <div className="text-[11px] text-gray-500">건너뛴 회차가 없습니다.</div>
                ) : (
                  <ul className="space-y-1">
                    {skips.map((s) => (
                      <li key={`${s.id}`} className="flex items-center justify-between text-[11px] text-gray-700">
                        <div>
                          <span className="font-medium">{formatDate(s.occurred_at)}</span>
                          {s.reason ? <span className="ml-2 text-gray-500">{s.reason}</span> : null}
                        </div>
                        <button type="button" onClick={() => handleUnskip(s.occurred_at)} className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100">복원</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <div className="text-[11px] text-gray-500">최근
                <select className="ml-1 rounded border px-1 py-0.5 text-[11px]" value={candRangeMonths} onChange={(e) => setCandRangeMonths(Number(e.target.value))}>
                  {[3,6,12,24].map((m) => (<option key={m} value={m}>{m}개월</option>))}
                </select>
                범위에서 규칙과 일치하는 거래를 표시합니다.
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => reloadCandidates()} disabled={candLoading} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-50">새로고침</button>
                <button type="button" onClick={attachSelected} disabled={candLoading || candSelected.size === 0} className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50">선택 편입</button>
                <button type="button" onClick={ignoreSelected} disabled={candLoading || candSelected.size === 0} className="rounded bg-gray-600 px-2 py-0.5 text-[11px] font-medium text-white shadow hover:bg-gray-700 disabled:opacity-50">선택 배제</button>
              </div>
            </div>
            {candError && (
              <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">불러오기 실패: {candError}</div>
            )}
            {candLoading ? (
              <div className="mt-2 text-xs text-gray-500">불러오는 중…</div>
            ) : candidates.length === 0 ? (
              <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">후보가 없습니다. 기간을 늘리거나 규칙 조건을 확인하세요.</div>
            ) : (
              <div className="mt-2 overflow-hidden rounded border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">선택</th>
                      <th className="px-3 py-2">날짜</th>
                      <th className="px-3 py-2">금액</th>
                      <th className="px-3 py-2">메모</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white text-[13px] text-gray-700">
                    {candidates.map((t) => (
                      <tr key={t.id} className={candSelected.has(t.id) ? "bg-emerald-50" : undefined}>
                        <td className="px-3 py-2"><input type="checkbox" checked={candSelected.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                        <td className="px-3 py-2">{t.occurred_at}</td>
                        <td className="px-3 py-2 font-medium">{formatCurrency(Math.abs(t.amount), t.currency)}</td>
                        <td className="px-3 py-2 text-gray-600">{t.memo ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-gray-500">선택한 항목을 이 규칙의 과거 발생으로 편입합니다. 편입된 항목은 이후 스캔에서 제외됩니다.</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase text-gray-500">
              최근 발생 내역
              {historyData ? (
                <span className="ml-1 text-[11px] text-gray-400">({historyData.transactions.length}건 조회 중)</span>
              ) : null}
            </h4>
            <button
              type="button"
              onClick={() => setHistoryCollapsed((v) => !v)}
              className="text-[11px] text-gray-600 underline-offset-2 hover:underline"
            >
              {historyCollapsed ? "펼치기" : "접기"}
            </button>
          </div>
          {!historyCollapsed && (history.status === "loading" ? (
            <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
              과거 발생 내역을 불러오는 중입니다…
            </div>
          ) : historyError ? (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              과거 발생 내역을 불러오지 못했습니다: {historyError}
              <button
                type="button"
                onClick={history.refresh}
                className="ml-3 inline-flex items-center rounded border border-rose-400 px-2 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-100"
              >
                다시 시도
              </button>
            </div>
          ) : !historyData || historyData.count === 0 ? (
            <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
              아직 기록된 발생 내역이 없습니다.
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {historySummaryItems.map((item) => (
                  <HistoryStat key={item.label} label={item.label} value={item.value} tone={item.tone} />
                ))}
              </div>
              <ul className="space-y-2">
                {historyTransactions.map((item) => {
                  const trendLabel = formatHistoryTrend(item.trend ?? null);
                  const ruleDeltaLabel =
                    item.delta_from_rule != null && historyData.base_amount != null
                      ? formatHistoryDelta(item.delta_from_rule)
                      : null;
                  const ruleDeltaTone =
                    item.delta_from_rule != null && historyData.base_amount != null
                      ? historyDeltaTone(item.delta_from_rule)
                      : "";
                  const editState = historyEdits[item.transaction_id] ?? null;
                  const isEditing = Boolean(editState);
                  const canEdit = rule.is_variable_amount;

                  return (
                    <li
                      key={item.transaction_id}
                      className="rounded border border-gray-200 bg-white px-3 py-3 text-xs text-gray-700"
                    >
                      {isEditing && editState ? (
                        <form onSubmit={(event) => handleHistoryEditSubmit(event, item)} className="space-y-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-gray-900">{formatDate(item.occurred_at)}</span>
                                <span className="text-[10px] font-medium text-emerald-600">금액 수정 중</span>
                              </div>
                              <label className="sr-only" htmlFor={`history-memo-${item.transaction_id}`}>
                                메모
                              </label>
                              <input
                                id={`history-memo-${item.transaction_id}`}
                                type="text"
                                value={editState.memo}
                                disabled={editState.isSaving}
                                onChange={(event) =>
                                  handleHistoryEditFieldChange(item.transaction_id, "memo", event.target.value)
                                }
                                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                                placeholder="메모 (선택)"
                              />
                            </div>
                            <div className="flex flex-col items-end gap-1 sm:w-40">
                              <label className="sr-only" htmlFor={`history-amount-${item.transaction_id}`}>
                                금액
                              </label>
                              <input
                                id={`history-amount-${item.transaction_id}`}
                                type="number"
                                min={0}
                                step="0.01"
                                value={editState.amount}
                                disabled={editState.isSaving}
                                onChange={(event) =>
                                  handleHistoryEditFieldChange(item.transaction_id, "amount", event.target.value)
                                }
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-right focus:border-emerald-500 focus:outline-none disabled:bg-gray-100"
                                placeholder="확정 금액"
                              />
                              <div className="text-right">
                                <div className="font-semibold text-gray-900">{formatHistoryAmount(item.amount)}</div>
                                {trendLabel ? (
                                  <div className={clsx("text-[11px] font-medium", historyTrendTone(item.trend ?? null))}>
                                    {trendLabel}
                                  </div>
                                ) : null}
                                {ruleDeltaLabel ? (
                                  <div className={clsx("text-[11px]", ruleDeltaTone)}>{ruleDeltaLabel}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleCancelHistoryEdit(item.transaction_id)}
                              disabled={editState.isSaving}
                              className={clsx(
                                "inline-flex items-center rounded border px-3 py-1 text-[11px] font-medium",
                                editState.isSaving
                                  ? "cursor-not-allowed border-gray-200 text-gray-400"
                                  : "border-gray-300 text-gray-600 hover:bg-gray-100",
                              )}
                            >
                              취소
                            </button>
                            <button
                              type="submit"
                              disabled={editState.isSaving}
                              className={clsx(
                                "inline-flex items-center rounded px-3 py-1 text-[11px] font-medium text-white",
                                editState.isSaving ? "cursor-not-allowed bg-gray-300" : "bg-emerald-600 hover:bg-emerald-700",
                              )}
                            >
                              {editState.isSaving ? "저장 중…" : "저장"}
                            </button>
                          </div>
                          {editState.error ? <p className="text-[11px] text-rose-600">{editState.error}</p> : null}
                        </form>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <span className="font-medium text-gray-900">{formatDate(item.occurred_at)}</span>
                              {item.memo ? <div className="text-[11px] text-gray-500">{item.memo}</div> : null}
                            </div>
                            <div className="text-right">
                              <div className="font-semibold text-gray-900">{formatHistoryAmount(item.amount)}</div>
                              {trendLabel ? (
                                <div className={clsx("text-[11px] font-medium", historyTrendTone(item.trend ?? null))}>
                                  {trendLabel}
                                </div>
                              ) : null}
                              {ruleDeltaLabel ? (
                                <div className={clsx("text-[11px]", ruleDeltaTone)}>{ruleDeltaLabel}</div>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => handleStartHistoryEdit(item)}
                                className="inline-flex items-center rounded border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                              >
                                금액 수정
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleDetach(item.transaction_id)}
                              className="inline-flex items-center rounded border border-rose-300 px-3 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                            >
                              매칭 해제
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {historyData.transactions.length >= historyLimit && historyLimit < 365 ? (
                <button
                  type="button"
                  onClick={handleLoadMoreHistory}
                  className="inline-flex items-center rounded border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                >
                  이전 내역 더 보기
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase text-gray-500">
            미리보기 <span className="ml-1 text-[11px] text-gray-400">({previewRange.start} ~ {previewRange.end})</span>
          </h4>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-medium text-gray-500">범위</span>
              {previewRangeOptions.map((months) => {
                const isActive = previewMonths === months;
                return (
                  <button
                    key={months}
                    type="button"
                    onClick={() => handlePreviewMonthsChange(months)}
                    disabled={preview.status === "loading"}
                    className={clsx(
                      "rounded border px-2 py-1 text-[11px] font-medium",
                      isActive
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-gray-300 text-gray-600 hover:bg-gray-100",
                      preview.status === "loading" ? "cursor-not-allowed opacity-60" : "",
                    )}
                  >
                    {months}개월
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-gray-500">
              총 {previewTotalCount}건 · {currentPreviewPage + 1}/{previewPageCount} 페이지
            </div>
          </div>
          {preview.status === "loading" ? (
            <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
              미리보기 데이터를 불러오는 중입니다…
            </div>
          ) : previewError ? (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              미리보기 데이터를 불러오지 못했습니다: {previewError}
              <button
                type="button"
                onClick={preview.refresh}
                className="ml-3 inline-flex items-center rounded border border-red-400 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-100"
              >
                다시 시도
              </button>
            </div>
          ) : previewTotalCount === 0 ? (
            <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
              지정한 기간 내 예정된 발생이 없습니다. 주기나 기간 설정을 확인해보세요.
            </div>
          ) : (
            <ol className="mt-2 space-y-2 text-xs text-gray-700">
              {previewItems.map((item) => {
                const date = item.occurred_at;
                const draftState = futureDraftInputs[date] ?? {
                  amount: item.draft_amount != null ? String(item.draft_amount) : "",
                  memo: item.draft_memo ?? "",
                  savedAt: item.draft_updated_at ?? null,
                  isSaving: false,
                  error: null,
                  dirty: false,
                };
                const savedLabel = formatDraftSavedTimestamp(draftState.savedAt ?? undefined);
                const isPending = pendingDates.has(date);
                const isEditable = item.is_future;
                return (
                  <li key={date} className="space-y-2 rounded border border-gray-100 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{formatDate(date)}</span>
                        {isPending ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            미확정 처리 필요
                          </span>
                        ) : null}
                      </div>
                      <span className="text-[11px] text-gray-500">{describeFrequency(rule)}</span>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                      <div className="sm:w-32">
                        <label className="sr-only" htmlFor={`future-amount-${date}`}>
                          금액
                        </label>
                        <input
                          id={`future-amount-${date}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={draftState.amount}
                          onChange={(event) => handleFutureDraftFieldChange(date, "amount", event.target.value)}
                          onBlur={() => handleFutureDraftBlur(date)}
                          disabled={!isEditable || draftState.isSaving}
                          className={clsx(
                            "w-full rounded border px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none",
                            !isEditable || draftState.isSaving ? "border-gray-200 bg-gray-100 text-gray-400" : "border-gray-300",
                          )}
                          placeholder="예상 금액"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="sr-only" htmlFor={`future-memo-${date}`}>
                          메모
                        </label>
                        <input
                          id={`future-memo-${date}`}
                          type="text"
                          value={draftState.memo}
                          onChange={(event) => handleFutureDraftFieldChange(date, "memo", event.target.value)}
                          onBlur={() => handleFutureDraftBlur(date)}
                          disabled={!isEditable || draftState.isSaving}
                          className={clsx(
                            "w-full rounded border px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none",
                            !isEditable || draftState.isSaving ? "border-gray-200 bg-gray-100 text-gray-400" : "border-gray-300",
                          )}
                          placeholder="메모 (선택)"
                        />
                      </div>
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() => handleFutureDraftReset(date)}
                          disabled={
                            !isEditable ||
                            draftState.isSaving ||
                            (draftState.amount.trim() === "" && draftState.memo.trim() === "" && !draftState.savedAt)
                          }
                          className={clsx(
                            "inline-flex items-center rounded border px-2 py-1 text-[11px] font-medium",
                            !isEditable || draftState.isSaving
                              ? "cursor-not-allowed border-gray-200 text-gray-300"
                              : draftState.amount.trim() === "" && draftState.memo.trim() === "" && !draftState.savedAt
                              ? "cursor-not-allowed border-gray-200 text-gray-300"
                              : "border-gray-300 text-gray-600 hover:bg-gray-100",
                          )}
                        >
                          초기화
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
                      <span>
                        {isEditable
                          ? "필드에서 포커스를 벗어나면 값이 저장됩니다."
                          : "지난 발생 기록으로 편집할 수 없습니다."}
                      </span>
                      {savedLabel ? <span>마지막 저장: {savedLabel}</span> : null}
                      {draftState.isSaving ? <span className="text-emerald-600">저장 중…</span> : null}
                    </div>
                    {draftState.error ? (
                      <div className="text-[10px] text-rose-600">{draftState.error}</div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {previewTotalCount > previewPageSize && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
              <button
                type="button"
                onClick={handlePreviewPrevPage}
                disabled={currentPreviewPage === 0}
                className={clsx(
                  "inline-flex items-center rounded border px-2 py-1",
                  currentPreviewPage === 0
                    ? "cursor-not-allowed border-gray-300 text-gray-300"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100",
                )}
              >
                이전 20개
              </button>
              <span>
                {currentPreviewPage + 1}/{previewPageCount} 페이지
              </span>
              <button
                type="button"
                onClick={handlePreviewNextPage}
                disabled={currentPreviewPage >= previewPageCount - 1}
                className={clsx(
                  "inline-flex items-center rounded border px-2 py-1",
                  currentPreviewPage >= previewPageCount - 1
                    ? "cursor-not-allowed border-gray-300 text-gray-300"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100",
                )}
              >
                다음 20개
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            오늘 이후 예정된 금액은 참고용으로만 저장되며 실제 발생 전까지 계좌 잔액에 반영되지 않습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleActive}
            disabled={isToggling}
            className="inline-flex items-center rounded border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isToggling ? "처리 중…" : rule.is_active ? "비활성화" : "활성화"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            수정
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="inline-flex items-center rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isDeleting ? "삭제 중…" : "삭제"}
          </button>
        </div>
        {toggleError && <p className="text-xs text-rose-600">상태 변경 실패: {toggleError}</p>}
        {deleteError && <p className="text-xs text-rose-600">삭제 실패: {deleteError}</p>}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function HistoryStat({ label, value, tone = "text-gray-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={clsx("mt-1 text-sm font-semibold", tone)}>{value}</div>
    </div>
  );
}
