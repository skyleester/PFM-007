import type { CalendarHoliday } from "./types";

const HOLIDAY_ENDPOINT = "/api/holidays";

type HolidaysApiResponse = {
  holidays: CalendarHoliday[];
  error?: string;
};

export async function loadCalendarHolidays(start: string, end: string): Promise<CalendarHoliday[]> {
  const params = new URLSearchParams({ start, end });
  const res = await fetch(`${HOLIDAY_ENDPOINT}?${params.toString()}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`공휴일 정보를 불러오지 못했습니다: ${res.status} ${text}`);
  }

  const data = (await res.json()) as HolidaysApiResponse;
  if (!Array.isArray(data.holidays)) {
    return [];
  }
  return data.holidays;
}
