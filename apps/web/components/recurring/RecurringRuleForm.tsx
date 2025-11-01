import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { AccountRecord } from "@/lib/accounts";
import type { Category, CategoryGroup } from "@/lib/categories";
import { formatDate } from "@/lib/recurring/format";
import type { RecurringRule, RecurringRuleCreateInput, RecurringRuleUpdateInput } from "@/lib/recurring/types";
import { createRule, updateRule } from "@/lib/recurring/hooks";
import { usePersistentState } from "@/lib/hooks/usePersistentState";

const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const FREQUENCY_OPTIONS = [
  { value: "DAILY", label: "매일" },
  { value: "WEEKLY", label: "매주" },
  { value: "MONTHLY", label: "매월" },
  { value: "YEARLY", label: "매년" },
] as const;

const TXN_TYPE_OPTIONS = [
  { value: "INCOME", label: "수입" },
  { value: "EXPENSE", label: "지출" },
  { value: "TRANSFER", label: "이체" },
] as const;

export type RecurringRuleFormProps = {
  mode: "create" | "edit";
  open: boolean;
  userId: number;
  accounts: AccountRecord[];
  incomeCategories: Category[];
  expenseCategories: Category[];
  incomeGroups: CategoryGroup[];
  expenseGroups: CategoryGroup[];
  initialRule?: RecurringRule | null;
  onClose(): void;
  onSuccess(rule: RecurringRule): void;
  externalPrefill?: Partial<FormState> | null;
};

type FormState = {
  name: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  day_of_month: number | null;
  weekday: number | null;
  amount: string;
  currency: string;
  account_id: number | null;
  counter_account_id: number | null;
  category_group_id: number | null;
  category_id: number | null;
  memo: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  is_variable_amount: boolean;
};

type FormErrors = Partial<Record<keyof FormState, string>> & { form?: string };

const INITIAL_STATE: FormState = {
  name: "",
  type: "INCOME",
  frequency: "MONTHLY",
  day_of_month: 1,
  weekday: null,
  amount: "0",
  currency: "KRW",
  account_id: null,
  counter_account_id: null,
  category_group_id: null,
  category_id: null,
  memo: "",
  start_date: "",
  end_date: "",
  is_active: true,
  is_variable_amount: false,
};

export function RecurringRuleForm({
  mode,
  open,
  userId,
  accounts,
  incomeCategories,
  expenseCategories,
  incomeGroups,
  expenseGroups,
  initialRule,
  onClose,
  onSuccess,
  externalPrefill,
}: RecurringRuleFormProps) {
  const storageKey = useMemo(() => {
    if (mode === "edit" && initialRule) {
      return `pfm:recurring:form:edit:${initialRule.id}:v1`;
    }
    return "pfm:recurring:form:create:v1";
  }, [mode, initialRule]);

  const initialFormFactory = useMemo(() => {
    return () => {
      if (mode === "edit" && initialRule) {
        const allCategories = [...incomeCategories, ...expenseCategories];
        const matchedCategory = allCategories.find((category) => category.id === initialRule.category_id);
        const groupId = matchedCategory?.group_id ?? null;
        return {
          name: initialRule.name,
          type: initialRule.type,
          frequency: initialRule.frequency,
          day_of_month: initialRule.day_of_month ?? null,
          weekday: initialRule.weekday ?? null,
          amount:
            initialRule.is_variable_amount || initialRule.amount == null
              ? ""
              : String(Math.abs(initialRule.amount)),
          currency: initialRule.currency,
          account_id: initialRule.account_id,
          counter_account_id: initialRule.counter_account_id ?? null,
          category_group_id: groupId,
          category_id: initialRule.category_id ?? null,
          memo: initialRule.memo ?? "",
          start_date: initialRule.start_date ?? "",
          end_date: initialRule.end_date ?? "",
          is_active: initialRule.is_active,
          is_variable_amount: initialRule.is_variable_amount,
        } satisfies FormState;
      }

      const base: FormState = { ...INITIAL_STATE };
      const defaultAccount = accounts.find((acc) => !acc.is_archived) ?? accounts[0] ?? null;
      if (defaultAccount) {
        base.account_id = defaultAccount.id;
        base.currency = defaultAccount.currency ?? base.currency;
      }

      const groups = base.type === "INCOME" ? incomeGroups : expenseGroups;
      const defaultGroupId = groups[0]?.id ?? null;
      base.category_group_id = defaultGroupId;
      if (defaultGroupId != null) {
        const categoriesPool = base.type === "INCOME" ? incomeCategories : expenseCategories;
        base.category_id = categoriesPool.find((category) => category.group_id === defaultGroupId)?.id ?? null;
      }

      return base;
    };
  }, [mode, initialRule, accounts, incomeCategories, expenseCategories, incomeGroups, expenseGroups]);

  const [form, setForm, resetFormState, formHydrated] = usePersistentState<FormState>(
    storageKey,
    initialFormFactory
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEdit = mode === "edit";

  // Apply external prefill when provided (e.g., from scan candidates quick-create)
  useEffect(() => {
    if (!open || !formHydrated) return;
    if (!externalPrefill) return;
    setForm((prev) => ({ ...prev, ...externalPrefill }));
    // keep errors clean after prefill
    setErrors({});
  }, [open, formHydrated, externalPrefill, setForm]);

  useEffect(() => {
    if (!open || !formHydrated) return;
    setErrors({});
  }, [open, formHydrated]);

  useEffect(() => {
    if (!open || !formHydrated) return;
    if (mode !== "create") return;
    setForm((prev) => {
      let changed = false;
      const updates: Partial<FormState> = {};

      const currentAccountValid = prev.account_id != null && accounts.some((account) => account.id === prev.account_id);
      if (!currentAccountValid) {
        const defaultAccount = accounts.find((acc) => !acc.is_archived) ?? accounts[0] ?? null;
        if (defaultAccount) {
          updates.account_id = defaultAccount.id;
          updates.currency = defaultAccount.currency ?? prev.currency;
          changed = true;
        }
      }

      if ((!prev.currency || prev.currency.trim().length === 0) && accounts.length > 0) {
        const effectiveAccountId = updates.account_id ?? prev.account_id ?? undefined;
        const fallbackAccount =
          effectiveAccountId != null
            ? accounts.find((account) => account.id === effectiveAccountId) ?? accounts[0]
            : accounts[0];
        if (fallbackAccount?.currency && fallbackAccount.currency !== prev.currency) {
          updates.currency = fallbackAccount.currency;
          changed = true;
        }
      }

      if (prev.type === "TRANSFER") {
        if (prev.category_group_id !== null || prev.category_id !== null) {
          updates.category_group_id = null;
          updates.category_id = null;
          changed = true;
        }
      } else {
        const groups = prev.type === "INCOME" ? incomeGroups : expenseGroups;
        const categoriesPool = prev.type === "INCOME" ? incomeCategories : expenseCategories;
        const groupIsValid = prev.category_group_id != null && groups.some((group) => group.id === prev.category_group_id);
        let categoryGroupId = prev.category_group_id;
        if (!groupIsValid) {
          categoryGroupId = groups[0]?.id ?? null;
          if (categoryGroupId !== prev.category_group_id) {
            updates.category_group_id = categoryGroupId;
            changed = true;
          }
        }
        if (categoryGroupId != null) {
          const categoryIsValid = prev.category_id != null && categoriesPool.some((category) => category.id === prev.category_id);
          if (!categoryIsValid) {
            const fallbackCategory = categoriesPool.find((category) => category.group_id === categoryGroupId)?.id ?? null;
            if (fallbackCategory !== prev.category_id) {
              updates.category_id = fallbackCategory;
              changed = true;
            }
          }
        } else if (prev.category_id !== null) {
          updates.category_id = null;
          changed = true;
        }
      }

      if (!changed) {
        return prev;
      }
      return { ...prev, ...updates };
    });
  }, [accounts, incomeCategories, expenseCategories, incomeGroups, expenseGroups, formHydrated, mode, open, setForm]);

  const availableGroups = useMemo(() => {
    if (form.type === "INCOME") return incomeGroups;
    if (form.type === "EXPENSE") return expenseGroups;
    return [];
  }, [form.type, incomeGroups, expenseGroups]);

  const availableCategories = useMemo(() => {
    if (form.type === "TRANSFER") return [];
    const base = form.type === "INCOME" ? incomeCategories : expenseCategories;
    if (form.category_group_id == null) {
      return base;
    }
    return base.filter((category) => category.group_id === form.category_group_id);
  }, [form.type, form.category_group_id, incomeCategories, expenseCategories]);

  const counterAccountOptions = useMemo(() => {
    if (form.type !== "TRANSFER") return [];
    const currentAccountId = form.account_id;
    return accounts.filter((account) => account.id !== currentAccountId);
  }, [form.type, accounts, form.account_id]);

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "type") {
        if (value !== "TRANSFER") {
          next.counter_account_id = null;
        }
        if (value === "TRANSFER") {
          next.category_group_id = null;
          next.category_id = null;
        } else {
          const groups = value === "INCOME" ? incomeGroups : expenseGroups;
          next.category_group_id = groups[0]?.id ?? null;
          next.category_id = null;
        }
      }
      if (key === "frequency") {
        if (value !== "MONTHLY") next.day_of_month = null;
        if (value !== "WEEKLY") next.weekday = null;
      }
      if (key === "category_group_id") {
        const groupId = value as FormState["category_group_id"];
        const categoriesPool = next.type === "INCOME" ? incomeCategories : expenseCategories;
        const firstMatch = categoriesPool.find((category) => category.group_id === groupId);
        next.category_id = firstMatch ? firstMatch.id : null;
      }
      if (key === "is_variable_amount" && value === true) {
        next.amount = "";
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};
    if (!form.name.trim()) {
      nextErrors.name = "규칙명을 입력하세요.";
    }
    if (form.account_id == null) {
      nextErrors.account_id = "계좌를 선택하세요.";
    }
    if (!form.is_variable_amount) {
      if (!form.amount || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
        nextErrors.amount = "양수 금액을 입력하세요.";
      }
    } else if (form.type === "TRANSFER") {
      nextErrors.is_variable_amount = "이체 규칙은 변동 금액을 사용할 수 없습니다.";
    }
    if (!form.currency.trim()) {
      nextErrors.currency = "통화를 입력하세요.";
    } else if (form.currency.trim().length !== 3) {
      nextErrors.currency = "통화는 3자리 코드여야 합니다.";
    }
    if (form.type === "TRANSFER" && form.counter_account_id == null) {
      nextErrors.counter_account_id = "상대 계좌를 선택하세요.";
    }
    if (form.type !== "TRANSFER") {
      if (form.category_group_id == null) {
        nextErrors.category_group_id = "대분류를 선택하세요.";
      }
      if (form.category_id == null) {
        nextErrors.category_id = "카테고리를 선택하세요.";
      }
    }
    if (
      form.frequency === "MONTHLY" &&
      (form.day_of_month == null || form.day_of_month < 1 || form.day_of_month > 31)
    ) {
      nextErrors.day_of_month = "1~31 사이의 날짜를 입력하세요.";
    }
    if (form.frequency === "WEEKLY" && form.weekday == null) {
      nextErrors.weekday = "요일을 선택하세요.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const variableFlag = form.is_variable_amount;
      const parsedAmount = variableFlag ? null : Number(form.amount);
      if (isEdit && initialRule) {
        const payload: RecurringRuleUpdateInput = {
          id: initialRule.id,
          userId,
          name: form.name.trim(),
          frequency: form.frequency,
          amount: parsedAmount,
          currency: form.currency.trim().toUpperCase(),
          accountId: form.account_id ?? undefined,
          counterAccountId: form.type === "TRANSFER" ? form.counter_account_id ?? null : null,
          categoryId: form.type !== "TRANSFER" ? form.category_id ?? null : null,
          memo: form.memo || null,
          startDate: form.start_date || null,
          endDate: form.end_date || null,
          isActive: form.is_active,
          dayOfMonth: form.frequency === "MONTHLY" ? form.day_of_month ?? undefined : undefined,
          weekday: form.frequency === "WEEKLY" ? form.weekday ?? undefined : undefined,
          isVariableAmount: variableFlag,
        };
        const updated = await updateRule(payload);
        resetFormState();
        onSuccess(updated);
      } else {
        const payload: RecurringRuleCreateInput = {
          userId,
          name: form.name.trim(),
          type: form.type,
          frequency: form.frequency,
          dayOfMonth: form.frequency === "MONTHLY" ? form.day_of_month : null,
          weekday: form.frequency === "WEEKLY" ? form.weekday : null,
          amount: parsedAmount,
          currency: form.currency.trim().toUpperCase(),
          accountId: form.account_id as number,
          counterAccountId: form.type === "TRANSFER" ? form.counter_account_id : null,
          categoryId: form.type !== "TRANSFER" ? form.category_id : null,
          memo: form.memo || null,
          payeeId: undefined,
          startDate: form.start_date || null,
          endDate: form.end_date || null,
          isActive: form.is_active,
          isVariableAmount: variableFlag,
        };
        const created = await createRule(payload);
        resetFormState();
        onSuccess(created);
      }
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrors((prev) => ({ ...prev, form: message }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  if (!formHydrated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 text-sm text-gray-600 shadow-xl">
          폼 상태를 복원하는 중입니다…
        </div>
      </div>
    );
  }

  const categoryOptions = availableCategories;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{isEdit ? "규칙 수정" : "새 규칙 생성"}</h2>
            <p className="text-xs text-gray-500">필수 정보를 입력하고 저장을 눌러 정기 규칙을 {isEdit ? "업데이트" : "추가"}하세요.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            닫기
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[80vh] overflow-y-auto px-6 py-4">
          {errors.form && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{errors.form}</div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="규칙명" error={errors.name} required>
              <input
                type="text"
                value={form.name}
                onChange={(event) => handleChange("name", event.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </Field>

            <Field label="상태" error={errors.is_active}>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => handleChange("is_active", event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                활성화됨
              </label>
            </Field>

            <Field label="유형" required>
              <select
                value={form.type}
                onChange={(event) => handleChange("type", event.target.value as FormState["type"])}
                disabled={isEdit}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500"
              >
                {TXN_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="주기" required>
              <select
                value={form.frequency}
                onChange={(event) => handleChange("frequency", event.target.value as FormState["frequency"])}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {form.frequency === "MONTHLY" && (
              <Field label="일자" required error={errors.day_of_month}>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={form.day_of_month ?? ""}
                  onChange={(event) => handleChange("day_of_month", event.target.value === "" ? null : Number(event.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </Field>
            )}

            {form.frequency === "WEEKLY" && (
              <Field label="요일" required error={errors.weekday}>
                <select
                  value={form.weekday ?? ""}
                  onChange={(event) => handleChange("weekday", event.target.value === "" ? null : Number(event.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">요일 선택</option>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <option key={index} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field
              label="금액"
              required={!form.is_variable_amount}
              error={errors.amount ?? errors.is_variable_amount}
            >
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => handleChange("amount", event.target.value)}
                  disabled={form.is_variable_amount}
                  placeholder={form.is_variable_amount ? "변동 금액" : undefined}
                  className={clsx(
                    "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none",
                    form.is_variable_amount && "bg-gray-100 text-gray-500",
                  )}
                />
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={form.is_variable_amount}
                    onChange={(event) => handleChange("is_variable_amount", event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  변동 금액
                </label>
              </div>
              {form.is_variable_amount && (
                <p className="mt-1 text-[11px] text-gray-500">발생 시 실제 금액을 입력하여 확정합니다.</p>
              )}
            </Field>

            <Field label="통화" required error={errors.currency}>
              <input
                type="text"
                maxLength={3}
                value={form.currency}
                onChange={(event) => handleChange("currency", event.target.value.toUpperCase())}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm uppercase focus:border-emerald-500 focus:outline-none"
              />
            </Field>

            <Field label="계좌" required error={errors.account_id}>
              <select
                value={form.account_id ?? ""}
                onChange={(event) => handleChange("account_id", event.target.value === "" ? null : Number(event.target.value))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="">계좌 선택</option>
                {accounts
                  .filter((account) => !account.is_archived)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} (#{account.id})
                    </option>
                  ))}
              </select>
            </Field>

            {form.type === "TRANSFER" ? (
              <Field label="상대 계좌" required error={errors.counter_account_id}>
                <select
                  value={form.counter_account_id ?? ""}
                  onChange={(event) =>
                    handleChange("counter_account_id", event.target.value === "" ? null : Number(event.target.value))
                  }
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">계좌 선택</option>
                  {counterAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} (#{account.id})
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <>
                <Field label="대분류" required error={errors.category_group_id}>
                  <select
                    value={form.category_group_id ?? ""}
                    onChange={(event) =>
                      handleChange(
                        "category_group_id",
                        event.target.value === "" ? null : Number(event.target.value),
                      )
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">대분류 선택</option>
                    {availableGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="카테고리" required error={errors.category_id}>
                  <select
                    value={form.category_id ?? ""}
                    onChange={(event) =>
                      handleChange("category_id", event.target.value === "" ? null : Number(event.target.value))
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                    disabled={form.category_group_id == null}
                  >
                    <option value="">카테고리 선택</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name} ({category.full_code})
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            <Field label="시작일">
              <input
                type="date"
                value={form.start_date}
                onChange={(event) => handleChange("start_date", event.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </Field>

            <Field label="종료일">
              <input
                type="date"
                min={form.start_date || undefined}
                value={form.end_date}
                onChange={(event) => handleChange("end_date", event.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </Field>

            <Field label="메모" className="sm:col-span-2">
              <textarea
                value={form.memo}
                onChange={(event) => handleChange("memo", event.target.value)}
                rows={3}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </Field>

            {isEdit && initialRule && (
              <Field label="마지막 생성일" className="sm:col-span-2">
                <input
                  type="text"
                  value={formatDate(initialRule.last_generated_at)}
                  readOnly
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                />
              </Field>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={clsx(
                "rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700",
                isSubmitting && "cursor-not-allowed opacity-70",
              )}
            >
              {isSubmitting ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  children: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
};

function Field({ label, children, error, required, className }: FieldProps) {
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <label className="text-xs font-semibold uppercase text-gray-500">
        {label}
        {required ? <span className="ml-1 text-rose-500">*</span> : null}
      </label>
      {children}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}
