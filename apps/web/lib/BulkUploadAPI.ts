import { ParsedTransaction } from "@/hooks/useExcelParser";

export type BulkUploadResponse = {
  success: boolean;
  summary: {
    total: number;
    created: number;
    duplicates: number;
    errors: number;
  };
  details?: {
    created_ids: number[];
    duplicate_rows: Array<{ row: number; reason: string }>;
    error_rows: Array<{ row: number; error: string }>;
  };
  message?: string;
};

export type BulkUploadRequest = {
  user_id: number;
  transactions: Array<{
    type: "INCOME" | "EXPENSE" | "TRANSFER";
    amount: number;
    occurred_at: string;
    occurred_time?: string;
    memo?: string;
    category?: string;
    currency?: string;
    account_id?: number;
  }>;
};

export class BulkUploadAPI {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
  }

  async uploadTransactions(
    transactions: ParsedTransaction[],
    userId: number = 1
  ): Promise<BulkUploadResponse> {
    try {
      // Convert parsed transactions to API format
      const formattedTransactions = transactions.map(tx => ({
        type: tx.type,
        amount: tx.amount,
        occurred_at: this.formatDate(tx.date),
        occurred_time: this.extractTime(tx.date),
        memo: tx.memo || undefined,
        category: [tx.category_main, tx.category_sub].filter(Boolean).join(" > ") || undefined,
        currency: tx.currency || "KRW",
        account_id: undefined,
      }));

      const requestData: BulkUploadRequest = {
        user_id: userId,
        transactions: formattedTransactions,
      };

      const response = await fetch(`${this.baseUrl}/api/transactions/bulk-upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
      }

      const result: BulkUploadResponse = await response.json();
      return result;
    } catch (error) {
      console.error("Bulk upload error:", error);
      throw error;
    }
  }

  private formatDate(dateStr: string): string {
    // Try to parse various date formats and return YYYY-MM-DD
    if (!dateStr) {
      return new Date().toISOString().split('T')[0];
    }

    // Handle different date formats
    let date: Date;
    
    // Try ISO format first
    if (dateStr.includes('T') || dateStr.includes('Z')) {
      date = new Date(dateStr);
    } 
    // Try YYYY-MM-DD format
    else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      date = new Date(dateStr);
    }
    // Try MM/DD/YYYY format
    else if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
      const parts = dateStr.split('/');
      date = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    }
    // Try DD/MM/YYYY format
    else if (dateStr.match(/^\d{1,2}-\d{1,2}-\d{4}$/)) {
      const parts = dateStr.split('-');
      date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    // Default fallback
    else {
      date = new Date(dateStr);
    }

    // Validate date
    if (isNaN(date.getTime())) {
      return new Date().toISOString().split('T')[0];
    }

    return date.toISOString().split('T')[0];
  }

  private extractTime(dateStr: string): string | undefined {
    // Try to extract time from date string
    if (!dateStr) return undefined;

    // Look for time patterns like HH:MM or HH:MM:SS
    const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (timeMatch) {
      const hours = timeMatch[1].padStart(2, '0');
      const minutes = timeMatch[2];
      const seconds = timeMatch[3] || '00';
      return `${hours}:${minutes}:${seconds}`;
    }

    return undefined;
  }

  async validateTransactions(transactions: ParsedTransaction[]): Promise<{
    valid: ParsedTransaction[];
    invalid: Array<{ transaction: ParsedTransaction; errors: string[] }>;
  }> {
    const valid: ParsedTransaction[] = [];
    const invalid: Array<{ transaction: ParsedTransaction; errors: string[] }> = [];

    for (const tx of transactions) {
      const errors: string[] = [];

      // Validate required fields
      if (!tx.date) {
        errors.push("날짜가 필요합니다");
      }
      
      if (!tx.type || !["INCOME", "EXPENSE", "TRANSFER"].includes(tx.type)) {
        errors.push("유효한 거래 유형이 필요합니다 (INCOME/EXPENSE/TRANSFER)");
      }

      if (tx.amount === 0 || isNaN(tx.amount)) {
        errors.push("유효한 금액이 필요합니다");
      }

      // Validate date format
      try {
        const formatted = this.formatDate(tx.date);
        if (!formatted.match(/^\d{4}-\d{2}-\d{2}$/)) {
          errors.push("유효한 날짜 형식이 필요합니다");
        }
      } catch {
        errors.push("날짜 파싱 오류");
      }

      if (errors.length === 0) {
        valid.push(tx);
      } else {
        invalid.push({ transaction: tx, errors });
      }
    }

    return { valid, invalid };
  }
}

export const bulkUploadAPI = new BulkUploadAPI();
export default bulkUploadAPI;