import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecurringRuleTable, type RecurringRuleTableProps } from "../RecurringRuleTable";
import type { RecurringRule } from "@/lib/recurring/types";

const sampleRule: RecurringRule = {
  id: 1,
  user_id: 1,
  name: "월급 입금",
  type: "INCOME",
  frequency: "MONTHLY",
  day_of_month: 1,
  weekday: null,
  amount: 2_500_000,
  currency: "KRW",
  account_id: 12,
  counter_account_id: null,
  category_id: 341,
  memo: null,
  payee_id: null,
  start_date: "2024-01-01",
  end_date: null,
  is_active: true,
  last_generated_at: "2024-08-01",
};

function renderTable(overrides: Partial<RecurringRuleTableProps> = {}) {
  const props: RecurringRuleTableProps = {
    rules: [],
    selectedRuleId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    isLoading: false,
    errorMessage: undefined,
    onRetry: undefined,
    createDisabled: false,
    createDisabledReason: undefined,
    ...overrides,
  };

  return { props, ...render(<RecurringRuleTable {...props} />) };
}

describe("RecurringRuleTable", () => {
  it("disables create button when metadata is unavailable", () => {
    const disabledReason = "계좌와 카테고리를 불러오는 중입니다.";
    renderTable({ createDisabled: true, createDisabledReason: disabledReason });

    const button = screen.getByRole("button", { name: "새 규칙 추가" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", disabledReason);
  });

  it("triggers retry handler when error banner retry is clicked", () => {
    const onRetry = vi.fn();
    renderTable({ errorMessage: "네트워크 오류", onRetry });

    const retryButton = screen.getByRole("button", { name: "다시 시도" });
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect when a rule row is clicked", () => {
    const onSelect = vi.fn();
    renderTable({ rules: [sampleRule], onSelect });

    fireEvent.click(screen.getByText(sampleRule.name));

    expect(onSelect).toHaveBeenCalledWith(sampleRule.id);
  });
});
