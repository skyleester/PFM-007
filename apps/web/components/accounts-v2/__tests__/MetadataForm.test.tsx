import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MetadataForm } from "../MetadataForm";

describe("MetadataForm", () => {
  it("renders CARD-specific fields and triggers onChange", () => {
    const onChange = vi.fn();
    render(<MetadataForm kind="CARD" value={{}} onChange={onChange} />);

    // CARD fields
    expect(screen.getByLabelText(/billing_cutoff_day/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/payment_day/i)).toBeInTheDocument();

    const billingInput = screen.getByLabelText(/billing_cutoff_day/i) as HTMLInputElement;
    fireEvent.change(billingInput, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalled();
  });
});
