import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { invariant } from "@/lib/errors";
export type BusinessHour = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const weeklyHoursSchema = z
  .array(
    z
      .object({
        day_of_week: z.number().int().min(0).max(6),
        start_time: timeSchema,
        end_time: timeSchema,
      })
      .strict(),
  )
  .max(7)
  .refine(
    (hours) => new Set(hours.map((hour) => hour.day_of_week)).size === hours.length,
    "Cadastre somente um horário por dia.",
  );
const minute = (t: string) =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export function validateHours(hours: BusinessHour[]) {
  const intervals = hours.map((h) => {
    invariant(
      h.day_of_week >= 0 &&
        h.day_of_week <= 6 &&
        /^([01]\d|2[0-3]):[0-5]\d/.test(h.start_time) &&
        /^([01]\d|2[0-3]):[0-5]\d/.test(h.end_time),
      "Horário inválido.",
    );
    const start = h.day_of_week * 1440 + minute(h.start_time);
    let end = h.day_of_week * 1440 + minute(h.end_time);
    invariant(start !== end, "Abertura e fechamento devem ser diferentes.");
    if (end < start) end += 1440;
    return { start, end };
  });
  for (let i = 0; i < intervals.length; i++)
    for (let j = i + 1; j < intervals.length; j++)
      for (const shift of [-10080, 0, 10080])
        invariant(
          !(
            intervals[i].start < intervals[j].end + shift &&
            intervals[j].start + shift < intervals[i].end
          ),
          "Os períodos de funcionamento se sobrepõem.",
        );
}
export function getStoreOpenStatus(
  hours: BusinessHour[],
  timezone: string,
  mode: string,
  now = new Date(),
) {
  const local = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(
    timezone,
  );
  const day = local.dayOfWeek % 7;
  const mins = day * 1440 + local.hour * 60 + local.minute;
  let currentPeriod: BusinessHour | undefined;
  for (const h of hours) {
    const start = h.day_of_week * 1440 + minute(h.start_time);
    let end = h.day_of_week * 1440 + minute(h.end_time);
    if (end <= start) end += 1440;
    if ([mins, mins + 10080].some((t) => t >= start && t < end))
      currentPeriod = h;
  }
  return {
    isOpen:
      mode === "forced_open" || (mode !== "forced_closed" && !!currentPeriod),
    reason: mode === "automatic" ? "schedule" : mode,
    currentPeriod,
    nextOpening: getNextOpeningTime(hours, timezone, now),
  };
}
export function getNextOpeningTime(
  hours: BusinessHour[],
  timezone: string,
  now = new Date(),
) {
  const local = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(
    timezone,
  );
  let next: Temporal.ZonedDateTime | undefined;
  for (let offset = 0; offset <= 7; offset++) {
    const day = local.add({ days: offset });
    for (const h of hours.filter((x) => x.day_of_week === day.dayOfWeek % 7)) {
      const candidate = day.with({
        hour: Number(h.start_time.slice(0, 2)),
        minute: Number(h.start_time.slice(3, 5)),
        second: 0,
        millisecond: 0,
      });
      if (
        Temporal.ZonedDateTime.compare(candidate, local) > 0 &&
        (!next || Temporal.ZonedDateTime.compare(candidate, next) < 0)
      )
        next = candidate;
    }
  }
  return next?.toInstant().toString() || null;
}
