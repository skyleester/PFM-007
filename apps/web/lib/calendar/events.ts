import { apiDelete, apiGet, apiPatch, apiPost } from "../api";
import type { CalendarEvent, CalendarEventType } from "./types";

function normaliseDate(value: string): string {
  return value.slice(0, 10);
}

export async function listCalendarEvents(
  userId: number,
  start?: string,
  end?: string
): Promise<CalendarEvent[]> {
  const params: Record<string, string> = { user_id: String(userId) };
  if (start) params.start = normaliseDate(start);
  if (end) params.end = normaliseDate(end);
  return apiGet<CalendarEvent[]>("/api/calendar-events", params);
}

export type CalendarEventDraft = {
  userId: number;
  date: string;
  type: CalendarEventType;
  title: string;
  description?: string | null;
  color?: string | null;
};

export async function createCalendarEvent(input: CalendarEventDraft): Promise<CalendarEvent> {
  const payload = {
    user_id: input.userId,
    date: normaliseDate(input.date),
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    color: input.color ?? null,
  };
  return apiPost<CalendarEvent>("/api/calendar-events", payload);
}

export type CalendarEventUpdateInput = {
  id: number;
  userId: number;
  date?: string;
  type?: CalendarEventType;
  title?: string;
  description?: string | null;
  color?: string | null;
};

export async function updateCalendarEvent(input: CalendarEventUpdateInput): Promise<CalendarEvent> {
  const { id, userId, ...rest } = input;
  const body: Record<string, unknown> = {};
  if (rest.date !== undefined) body.date = normaliseDate(rest.date);
  if (rest.type !== undefined) body.type = rest.type;
  if (rest.title !== undefined) body.title = rest.title;
  if (rest.description !== undefined) body.description = rest.description ?? null;
  if (rest.color !== undefined) body.color = rest.color ?? null;
  return apiPatch<CalendarEvent>(`/api/calendar-events/${id}`, body, { user_id: userId });
}

export async function deleteCalendarEvent(userId: number, id: number): Promise<void> {
  await apiDelete(`/api/calendar-events/${id}`, { user_id: userId });
}

export async function loadCalendarEvents(userId: number, start: string, end: string): Promise<CalendarEvent[]> {
  return listCalendarEvents(userId, start, end);
}
