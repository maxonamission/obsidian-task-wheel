/**
 * Calendar arithmetic, done on the calendar.
 *
 * Dates in Tasks syntax are plain calendar days — `2026-08-20` means that day,
 * not an instant — so anything that moves one has to work in whole days and
 * never pass through a timestamp. The obvious shortcut does not: `new
 * Date("2026-08-20T00:00:00")` is parsed as *local* midnight, and reading it
 * back with `toISOString()` converts to UTC, which in Amsterdam moves the day
 * one back. "Push a week out" then wrote six days, and every repeat lost
 * another one.
 *
 * Headless and pure, with today handed in rather than read from the clock, so
 * the arithmetic is testable without pretending it is a particular Tuesday.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether this is a calendar day we can do arithmetic on. */
export function isIsoDate(value: string | undefined): value is string {
	return value !== undefined && ISO.test(value);
}

/**
 * A number of days after a calendar day.
 *
 * Done entirely in UTC — not because the days are UTC, but because UTC is the
 * one zone with no offsets to fall into. The date carries no time of day, so
 * the choice of zone is bookkeeping, and this is the bookkeeping that cannot
 * shift a day.
 */
export function addDays(date: string, days: number): string {
	const match = ISO.exec(date);
	if (match === null) return date;

	const [, year, month, day] = match;
	const at = new Date(
		Date.UTC(Number(year), Number(month) - 1, Number(day)),
	);
	at.setUTCDate(at.getUTCDate() + days);

	return at.toISOString().slice(0, 10);
}

/**
 * Today, as the reader's own calendar has it.
 *
 * Built from the local year, month and day rather than from `toISOString()`:
 * at nine in the evening in Amsterdam those two disagree, and the one the
 * reader means is the one on their own wall.
 */
export function today(now: Date = new Date()): string {
	const year = String(now.getFullYear()).padStart(4, "0");
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Where *Push a week out* parks a task: a week beyond today, or beyond the
 * existing parked date when that lies further ahead.
 *
 * Counting on from a future ⏳ keeps a twice-deferred task moving forward
 * rather than snapping back to a week from today each time. Counting from a
 * *past* ⏳ is where the old due-date version went wrong: a week after a date
 * long gone can itself be gone, and a button called "push a week out" that
 * parks nothing is a broken promise (BC_E3_S65). The result of this function
 * is always in the future, which is what "parked" means.
 */
export function aWeekOut(scheduled: string | undefined, from: string): string {
	const base = isIsoDate(scheduled) && scheduled > from ? scheduled : from;
	return addDays(base, 7);
}
