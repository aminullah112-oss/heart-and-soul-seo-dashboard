import salonInfo from "./salonInfo.json";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// Returns 30-minute slot start times (HH:mm) for the given date, based on the
// salon's posted hours, leaving a gap so the last slot still fits the service duration.
export function getSlotsForDate(dateISO: string, durationMinutes: number): string[] {
  const date = new Date(`${dateISO}T00:00:00`);
  const dayName = DAY_NAMES[date.getDay()];
  const hoursForDay = salonInfo.hours.find((h) => h.day === dayName);

  if (!hoursForDay || hoursForDay.closed || !hoursForDay.open || !hoursForDay.close) {
    return [];
  }

  const openMin = toMinutes(hoursForDay.open);
  const closeMin = toMinutes(hoursForDay.close);
  const slots: string[] = [];

  for (let start = openMin; start + durationMinutes <= closeMin; start += 30) {
    slots.push(toHHMM(start));
  }

  return slots;
}

export function isSalonOpenOnDate(dateISO: string): boolean {
  const date = new Date(`${dateISO}T00:00:00`);
  const dayName = DAY_NAMES[date.getDay()];
  const hoursForDay = salonInfo.hours.find((h) => h.day === dayName);
  return !!hoursForDay && !hoursForDay.closed;
}

export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

export function nextNDates(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
