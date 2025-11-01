import { useEffect, useState } from "react";
import {
  confirmRecurringRuleOccurrence,
  confirmRecurringRuleBulk,
  createRecurringRule,
  deleteRecurringRule,
  deleteRecurringDraft,
  getRecurringRule,
  getRecurringRuleHistory,
  listRecurringRules,
  previewRecurringRule,
  updateRecurringRule,
  upsertRecurringDraft,
  updateRecurringTransaction,
} from "./api";
import type {
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRuleDeleteInput,
  RecurringRuleDetailParams,
  RecurringRuleHistory,
  RecurringRulePreviewParams,
  RecurringRuleUpdateInput,
  RecurringSummary,
  RecurringRuleConfirmInput,
  RecurringRulePreviewResponse,
  RecurringRuleBulkConfirmInput,
  RecurringOccurrenceDraftUpsertInput,
  RecurringTransactionUpdateInput,
} from "./types";

export type RecurringDataPayload = {
  rules: RecurringRule[];
  summary: RecurringSummary;
  fetchedAt: Date;
};

export type RecurringSummaryMap = RecurringSummary["currencyTotals"];

type UseRecurringDataState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: RecurringDataPayload; error?: undefined }
  | { status: "error"; data?: undefined; error: Error };

export type UseRecurringDataResult = UseRecurringDataState & {
  refresh: () => void;
};

type UseRecurringPreviewState =
  | { status: "idle"; data?: undefined; error?: undefined }
  | { status: "loading"; data?: RecurringRulePreviewResponse; error?: undefined }
  | { status: "success"; data: RecurringRulePreviewResponse; error?: undefined }
  | { status: "error"; data?: RecurringRulePreviewResponse; error: Error };

export type UseRecurringPreviewParams = RecurringRulePreviewParams & {
  enabled?: boolean;
};

export type UseRecurringPreviewResult = UseRecurringPreviewState & {
  refresh: () => void;
};

type UseRecurringHistoryState =
  | { status: "idle"; data?: undefined; error?: undefined }
  | { status: "loading"; data?: RecurringRuleHistory; error?: undefined }
  | { status: "success"; data: RecurringRuleHistory; error?: undefined }
  | { status: "error"; data?: RecurringRuleHistory; error: Error };

export type UseRecurringHistoryParams = {
  ruleId: number | null;
  userId: number;
  limit?: number;
  enabled?: boolean;
};

export type UseRecurringHistoryResult = UseRecurringHistoryState & {
  refresh: () => void;
};

function normaliseCurrency(value: string | null | undefined): string {
  return (value || "KRW").toUpperCase();
}

function createEmptyCurrencyBucket() {
  return { income: 0, expense: 0, transfer: 0, net: 0 };
}

function buildRecurringSummary(rules: RecurringRule[]): RecurringSummary {
  const totals = new Map<string, ReturnType<typeof createEmptyCurrencyBucket>>();
  let activeRules = 0;

  for (const rule of rules) {
    if (rule.is_active) {
      activeRules += 1;
    }
    const currency = normaliseCurrency(rule.currency);
    const bucket = totals.get(currency) ?? createEmptyCurrencyBucket();

    if (rule.is_active) {
      const amountAbs = Math.abs(rule.amount ?? 0);
      switch (rule.type) {
        case "INCOME":
          bucket.income += amountAbs;
          bucket.net += amountAbs;
          break;
        case "EXPENSE":
          bucket.expense += amountAbs;
          bucket.net -= amountAbs;
          break;
        case "TRANSFER":
          bucket.transfer += amountAbs;
          break;
        default:
          break;
      }
    }

    totals.set(currency, bucket);
  }

  const currencyTotals = Array.from(totals.entries())
    .map(([currency, stats]) => ({ currency, ...stats }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    totalRules: rules.length,
    activeRules,
    inactiveRules: rules.length - activeRules,
    currencyTotals,
  };
}

export function useRecurringData(userId: number): UseRecurringDataResult {
  const [state, setState] = useState<UseRecurringDataState>({ status: "idle" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) =>
      prev.status === "success" ? { status: "loading" } : { status: "loading" }
    );

    listRecurringRules(userId)
      .then((rules) => {
        if (cancelled) return;
        const summary = buildRecurringSummary(rules);
        setState({
          status: "success",
          data: {
            rules,
            summary,
            fetchedAt: new Date(),
          },
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      });

    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  const refresh = () => setVersion((prev) => prev + 1);

  return { ...state, refresh };
}

export function useRecurringPreview({ ruleId, start, end, page = 1, pageSize = 20, enabled = true }: UseRecurringPreviewParams): UseRecurringPreviewResult {
  const [state, setState] = useState<UseRecurringPreviewState>({ status: "idle" });
  const [version, setVersion] = useState(0);

  const shouldFetch = enabled && ruleId !== undefined && ruleId !== null;

  useEffect(() => {
    if (!shouldFetch) {
      setState((prev) => (prev.status === "loading" ? { status: "idle" } : prev));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ status: "loading", data: prev.status === "success" ? prev.data : undefined }));

    previewRecurringRule({ ruleId, start, end, page, pageSize })
      .then((response) => {
        if (cancelled) return;
        setState({ status: "success", data: response });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          data: undefined,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ruleId, start, end, page, pageSize, shouldFetch, version]);

  const refresh = () => setVersion((prev) => prev + 1);

  return { ...state, refresh };
}

export function useRecurringHistory({ ruleId, userId, limit = 12, enabled = true }: UseRecurringHistoryParams): UseRecurringHistoryResult {
  const [state, setState] = useState<UseRecurringHistoryState>({ status: "idle" });
  const [version, setVersion] = useState(0);

  const shouldFetch = enabled && ruleId !== null && ruleId !== undefined;

  useEffect(() => {
    if (!shouldFetch) {
      setState((prev) => (prev.status === "loading" ? { status: "idle" } : prev));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ status: "loading", data: prev.status === "success" ? prev.data : undefined }));

    getRecurringRuleHistory({ ruleId, userId, limit })
      .then((data) => {
        if (cancelled) return;
        setState({ status: "success", data });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          data: undefined,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [ruleId, userId, limit, shouldFetch, version]);

  const refresh = () => setVersion((prev) => prev + 1);

  return { ...state, refresh };
}

export async function createRule(input: RecurringRuleCreateInput) {
  return createRecurringRule(input);
}

export async function updateRule(input: RecurringRuleUpdateInput) {
  return updateRecurringRule(input);
}

export async function deleteRule(input: RecurringRuleDeleteInput) {
  return deleteRecurringRule(input);
}

export async function fetchRule(input: RecurringRuleDetailParams) {
  return getRecurringRule(input);
}

export async function confirmRuleOccurrence(input: RecurringRuleConfirmInput) {
  return confirmRecurringRuleOccurrence(input);
}

export async function confirmRuleOccurrencesBulk(input: RecurringRuleBulkConfirmInput) {
  return confirmRecurringRuleBulk(input);
}

export async function saveRecurringDraft(input: RecurringOccurrenceDraftUpsertInput) {
  return upsertRecurringDraft(input);
}

export async function removeRecurringDraft(ruleId: number, occurredAt: string) {
  return deleteRecurringDraft(ruleId, occurredAt);
}

export async function updateRecurringTransactionRecord(input: RecurringTransactionUpdateInput) {
  return updateRecurringTransaction(input);
}