declare module "holidays-kr" {
  export const config: {
    serviceKey: string;
  };
  export function setServiceKey(key: string): void;
  export const ENDPOINT: string;
  export function getHolidaysByMonthCount(
    year: number,
    month: number,
    monthCount?: number
  ): Promise<Array<{ name: string; year: number; month: number; day: number; dateStr: string }>>;
}
