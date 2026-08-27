import { describe, expect, it } from "vitest";
import { aWeekOut } from "../model/dates";

/**
 * Where *Push a week out* parks a task (BC_E3_S65).
 *
 * The promise in the button's name is that the task leaves the round and
 * comes back: the result must always lie in the future, and pressing again
 * must move forward rather than snap back.
 */

const TODAY = "2026-08-27";

describe("aWeekOut", () => {
	it("parks a week from today when nothing is parked yet", () => {
		expect(aWeekOut(undefined, TODAY)).toBe("2026-09-03");
	});

	it("counts on from a parked date that lies ahead — pressing again moves forward", () => {
		expect(aWeekOut("2026-09-03", TODAY)).toBe("2026-09-10");
	});

	it("never lands in the past, whatever stale date the line still carries", () => {
		// A week after a long-gone ⏳ would itself be gone — the exact mismatch
		// the old due-date deferral had: a park button that parked nothing.
		expect(aWeekOut("2026-01-01", TODAY)).toBe("2026-09-03");
	});

	it("treats a malformed date as no date", () => {
		expect(aWeekOut("volgende week", TODAY)).toBe("2026-09-03");
	});

	it("steps over a month boundary on the calendar, not on a clock", () => {
		expect(aWeekOut(undefined, "2026-12-28")).toBe("2027-01-04");
	});
});
