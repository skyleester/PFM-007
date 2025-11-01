import { NextRequest, NextResponse } from "next/server";
import { config, getHolidaysByMonthCount, setServiceKey } from "holidays-kr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawHoliday = {
  name: string;
  dateStr: string;
};

type HolidayResponse = {
  holidays: { date: string; name: string }[];
  error?: string;
};

function parseBoundaries(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("잘못된 날짜 형식입니다.");
  }
  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error("종료일은 시작일 이후여야 합니다.");
  }
  return { startDate, endDate };
}

function calculateMonthSpan(startDate: Date, endDate: Date) {
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth() + 1;
  const span = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  return { startYear, startMonth, monthCount: Math.min(Math.max(span, 1), 12) };
}

function filterByRange(raw: RawHoliday[], start: string, end: string) {
  return raw.filter((holiday) => holiday.dateStr >= start && holiday.dateStr < end);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json<HolidayResponse>({ holidays: [], error: "start와 end는 필수입니다." }, { status: 400 });
  }

  let serviceKey = process.env.KR_HOLIDAYS_SERVICE_KEY ?? process.env.HOLIDAYS_KR_SERVICE_KEY ?? process.env.NEXT_PUBLIC_HOLIDAYS_KR_SERVICE_KEY ?? "";
  serviceKey = serviceKey.trim();

  if (!serviceKey) {
    return NextResponse.json<HolidayResponse>({ holidays: [], error: "서비스 키가 설정되지 않았습니다." }, { status: 200 });
  }

  if (config.serviceKey !== serviceKey) {
    setServiceKey(serviceKey);
  }

  try {
    const { startDate, endDate } = parseBoundaries(start, end);
    const { startYear, startMonth, monthCount } = calculateMonthSpan(startDate, endDate);
    const raw = await getHolidaysByMonthCount(startYear, startMonth, monthCount);
    const filtered = filterByRange(raw as RawHoliday[], start, end);
    return NextResponse.json<HolidayResponse>({
      holidays: filtered.map((holiday) => ({ date: holiday.dateStr, name: holiday.name })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json<HolidayResponse>({ holidays: [], error: message }, { status: 500 });
  }
}
