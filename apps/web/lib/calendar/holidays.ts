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

  const text = await res.text();
  if (!text || text.trim() === "") {
    return [];
  }
  try {
    const data = JSON.parse(text) as HolidaysApiResponse;
    if (!Array.isArray(data.holidays)) {
      return [];
    }
    return data.holidays;
  } catch {
    // 비정상 응답은 비워서 반환 (캘린더 UI는 공휴일 없음을 허용)
    return [];
  }
}
