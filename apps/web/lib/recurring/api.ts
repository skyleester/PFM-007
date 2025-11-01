import { apiDelete, apiGet, apiPatch, apiPost, apiPostWithMetaLoose, apiPut } from "../api";
import type {
  RecurringRuleDetailParams,
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRulePreviewParams,
  RecurringRuleDeleteInput,
  RecurringRuleUpdateInput,
  RecurringRuleConfirmInput,
  RecurringRuleHistory,
  RecurringRuleHistoryParams,
  RecurringRulePreviewResponse,
  RecurringOccurrenceDraftUpsertInput,
  RecurringOccurrenceDraft,
  RecurringRuleBulkConfirmInput,
  RecurringRuleBulkConfirmResult,
  RecurringTransactionUpdateInput,
  RecurringScanParams,
  RecurringScanCandidate,
  RecurringCandidateExclusion,
  RecurringCandidateExclusionCreateInput,
  AttachToOccurrenceInput,
} from "./types";

function normalizeCurrency(value: string): string {
  return value.toUpperCase();
}

function serializeCreateInput(input: RecurringRuleCreateInput) {
  const isVariable = Boolean(input.isVariableAmount);
  const amount = isVariable ? null : input.amount ?? null;
  return {
    user_id: input.userId,
    name: input.name,
    type: input.type,
    frequency: input.frequency,
    day_of_month: input.dayOfMonth ?? null,
    weekday: input.weekday ?? null,
    amount,
    currency: normalizeCurrency(input.currency),
    account_id: input.accountId,
    counter_account_id: input.counterAccountId ?? null,
    category_id: input.categoryId ?? null,
    memo: input.memo ?? null,
    payee_id: input.payeeId ?? null,
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    is_active: input.isActive ?? true,
    is_variable_amount: isVariable,
  };
}

function serializeUpdateInput(input: RecurringRuleUpdateInput) {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.frequency !== undefined) payload.frequency = input.frequency;
  if (input.dayOfMonth !== undefined) payload.day_of_month = input.dayOfMonth;
  if (input.weekday !== undefined) payload.weekday = input.weekday;
  if (input.amount !== undefined) payload.amount = input.amount;
  if (input.currency !== undefined) payload.currency = normalizeCurrency(input.currency);
  if (input.accountId !== undefined) payload.account_id = input.accountId;
  if (input.counterAccountId !== undefined) payload.counter_account_id = input.counterAccountId;
  if (input.categoryId !== undefined) payload.category_id = input.categoryId;
  if (input.memo !== undefined) payload.memo = input.memo ?? null;
  if (input.payeeId !== undefined) payload.payee_id = input.payeeId;
  if (input.startDate !== undefined) payload.start_date = input.startDate ?? null;
  if (input.endDate !== undefined) payload.end_date = input.endDate ?? null;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  if (input.isVariableAmount !== undefined) payload.is_variable_amount = input.isVariableAmount;
  return payload;
}

export async function listRecurringRules(userId: number): Promise<RecurringRule[]> {
  return apiGet<RecurringRule[]>("/api/recurring-rules", { user_id: userId });
}

export async function getRecurringRule({ id, userId }: RecurringRuleDetailParams): Promise<RecurringRule> {
  return apiGet<RecurringRule>(`/api/recurring-rules/${id}`, { user_id: userId });
}

export async function createRecurringRule(input: RecurringRuleCreateInput): Promise<RecurringRule> {
  return apiPost<RecurringRule>("/api/recurring-rules", serializeCreateInput(input));
}

export async function updateRecurringRule(input: RecurringRuleUpdateInput): Promise<RecurringRule> {
  const payload = serializeUpdateInput(input);
  return apiPatch<RecurringRule>(`/api/recurring-rules/${input.id}`, payload, { user_id: input.userId });
}

export async function deleteRecurringRule({ id, userId }: RecurringRuleDeleteInput): Promise<void> {
  await apiDelete(`/api/recurring-rules/${id}`, { user_id: userId });
}

export async function previewRecurringRule({ ruleId, start, end, page, pageSize }: RecurringRulePreviewParams): Promise<RecurringRulePreviewResponse> {
  const params: Record<string, string | number | boolean | undefined> = {
    start,
    end,
    page,
    page_size: pageSize,
  };
  return apiGet<RecurringRulePreviewResponse>(`/api/recurring-rules/${ruleId}/preview`, params);
}

export async function confirmRecurringRuleOccurrence({ ruleId, occurredAt, amount, memo }: RecurringRuleConfirmInput): Promise<void> {
  await apiPost(`/api/recurring-rules/${ruleId}/confirm`, {
    occurred_at: occurredAt,
    amount,
    memo: memo ?? null,
  });
}

export async function confirmRecurringRuleBulk({ ruleId, items }: RecurringRuleBulkConfirmInput): Promise<RecurringRuleBulkConfirmResult> {
  const payload = {
    items: items.map((item) => ({
      occurred_at: item.occurredAt,
      amount: item.amount,
      memo: item.memo ?? null,
    })),
  };
  return apiPost<RecurringRuleBulkConfirmResult>(`/api/recurring-rules/${ruleId}/confirm-bulk`, payload);
}

export async function upsertRecurringDraft(input: RecurringOccurrenceDraftUpsertInput): Promise<RecurringOccurrenceDraft> {
  const payload = {
    amount: input.amount ?? null,
    memo: input.memo ?? null,
  };
  return apiPut<RecurringOccurrenceDraft>(`/api/recurring-rules/${input.ruleId}/drafts/${input.occurredAt}`, payload);
}

export async function deleteRecurringDraft(ruleId: number, occurredAt: string): Promise<void> {
  await apiDelete(`/api/recurring-rules/${ruleId}/drafts/${occurredAt}`);
}

export async function getRecurringRuleHistory({ ruleId, userId, limit }: RecurringRuleHistoryParams): Promise<RecurringRuleHistory> {
  const params: Record<string, string | number | boolean | undefined> = { user_id: userId };
  if (typeof limit === "number") {
    params.limit = limit;
  }
  return apiGet<RecurringRuleHistory>(`/api/recurring-rules/${ruleId}/history`, params);
}

export async function updateRecurringTransaction({ transactionId, amount, memo }: RecurringTransactionUpdateInput): Promise<void> {
  const payload: Record<string, unknown> = {
    amount,
  };
  if (memo !== undefined) {
    payload.memo = memo;
  }
  await apiPatch(`/api/transactions/${transactionId}`, payload);
}

export async function scanRecurringCandidates({ userId, horizonDays, minOccurrences, includeTransfers, ignoreCategory }: RecurringScanParams): Promise<RecurringScanCandidate[]> {
  const payload = {
    user_id: userId,
    horizon_days: horizonDays ?? 180,
    min_occurrences: minOccurrences ?? 3,
    include_transfers: includeTransfers ?? false,
    ignore_category: ignoreCategory ?? false,
  };
  return apiPost<RecurringScanCandidate[]>("/api/recurring/scan-candidates", payload);
}

export async function listRecurringExclusions(userIds: number | number[]): Promise<RecurringCandidateExclusion[]> {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  return apiGet<RecurringCandidateExclusion[]>("/api/recurring/exclusions", { user_id: ids });
}

export async function createRecurringExclusion(input: RecurringCandidateExclusionCreateInput): Promise<RecurringCandidateExclusion> {
  const payload = {
    user_id: input.userId,
    signature_hash: input.signatureHash,
    snapshot: input.snapshot,
  };
  return apiPost<RecurringCandidateExclusion>("/api/recurring/exclusions", payload);
}

export async function deleteRecurringExclusion(id: number, userId: number): Promise<void> {
  await apiDelete(`/api/recurring/exclusions/${id}`, { user_id: userId });
}

export async function listRuleCandidates(ruleId: number, userId: number, opts?: { start?: string; end?: string; includeLinked?: boolean }): Promise<any[]> {
  const params: Record<string, string> = { user_id: String(userId) };
  if (opts?.start) params.start = opts.start;
  if (opts?.end) params.end = opts.end;
  if (opts?.includeLinked) params.include_linked = String(!!opts.includeLinked);
  return apiGet<any[]>(`/api/recurring-rules/${ruleId}/candidates`, params);
}

export type AttachResult = { attached: any[]; errors: { transaction_id: number; detail: string }[] };
export async function attachTransactionsToRule(ruleId: number, userId: number, transactionIds: number[]): Promise<AttachResult> {
  const payload = { transaction_ids: transactionIds };
  return apiPost<AttachResult>(`/api/recurring-rules/${ruleId}/attach`, payload, { user_id: userId });
}

export async function consumeRecurringCandidates(
  ruleId: number,
  userId: number,
  transactionIds: number[],
  reason: "attached" | "ignored",
): Promise<AttachResult> {
  const payload = { transaction_ids: transactionIds, reason };
  return apiPost<AttachResult>(`/api/recurring-rules/${ruleId}/consume`, payload, { user_id: userId });
}

export async function attachTransactionToOccurrence(input: AttachToOccurrenceInput): Promise<AttachResult> {
  const payload = { transaction_id: input.transactionId, occurred_at: input.occurredAt };
  return apiPost<AttachResult>(`/api/recurring-rules/${input.ruleId}/attach-to-occurrence`, payload, { user_id: input.userId });
}

export async function retargetLinkedTransaction(input: AttachToOccurrenceInput): Promise<AttachResult> {
  const payload = { transaction_id: input.transactionId, occurred_at: input.occurredAt };
  return apiPost<AttachResult>(`/api/recurring-rules/${input.ruleId}/retarget`, payload, { user_id: input.userId });
}

export async function skipRecurringOccurrence(ruleId: number, userId: number, occurredAt: string, reason?: string | null): Promise<any> {
  const payload: Record<string, any> = { occurred_at: occurredAt };
  if (reason != null && reason.trim() !== "") payload.reason = reason;
  return apiPost(`/api/recurring-rules/${ruleId}/skip`, payload, { user_id: userId });
}

export async function listRecurringSkips(ruleId: number, userId: number): Promise<any[]> {
  return apiGet<any[]>(`/api/recurring-rules/${ruleId}/skips`, { user_id: userId });
}

export async function unskipRecurringOccurrence(ruleId: number, userId: number, occurredAt: string): Promise<void> {
  await apiDelete(`/api/recurring-rules/${ruleId}/skip/${occurredAt}`, { user_id: userId });
}

export async function skipRecurringOccurrenceWithMeta(ruleId: number, userId: number, occurredAt: string, reason?: string | null): Promise<{ data: any; status: number; headers: Record<string, string> }> {
  const payload: Record<string, any> = { occurred_at: occurredAt };
  if (reason != null && reason.trim() !== "") payload.reason = reason;
  const { data, headers, status } = await apiPostWithMetaLoose<any>(`/api/recurring-rules/${ruleId}/skip`, payload, { user_id: userId });
  return { data, status, headers };
}

export async function detachRecurringLink(ruleId: number, userId: number, transactionId: number): Promise<AttachResult> {
  const payload = { transaction_id: transactionId };
  return apiPost<AttachResult>(`/api/recurring-rules/${ruleId}/detach`, payload, { user_id: userId });
}
