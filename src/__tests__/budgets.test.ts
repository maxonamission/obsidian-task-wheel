import { describe, expect, it } from "vitest";
import { assignBudgets, MIN_BUDGET } from "../layout/budgets";

const DOMAINS = ["Gezin", "Gezondheid", "Huis", "Werk"];

/** Floating point makes exact 360 unreasonable to demand of every wedge sum. */
function totalOf(budgets: ReturnType<typeof assignBudgets>): number {
	return budgets.reduce((sum, budget) => sum + budget.degrees, 0);
}

describe("assignBudgets — the circle adds up", () => {
	it("sums to 360 degrees on an equal split", () => {
		expect(totalOf(assignBudgets(DOMAINS))).toBeCloseTo(360, 9);
	});

	it("sums to 360 degrees with one wedge pinned", () => {
		const budgets = assignBudgets(DOMAINS, { Werk: 180 });
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		expect(budgets.find((b) => b.domain === "Werk")?.degrees).toBeCloseTo(180, 9);
	});

	it("sums to 360 degrees when every wedge is pinned too small", () => {
		const budgets = assignBudgets(DOMAINS, {
			Gezin: 10,
			Gezondheid: 10,
			Huis: 10,
			Werk: 10,
		});
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		// Equal claims stay equal after the scaling.
		for (const budget of budgets) expect(budget.degrees).toBeCloseTo(90, 9);
	});

	it("sums to 360 degrees when the pins claim more than the circle", () => {
		const budgets = assignBudgets(DOMAINS, { Werk: 300, Huis: 300 });
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
	});

	it("leaves every unpinned domain a drawable wedge", () => {
		const budgets = assignBudgets(DOMAINS, { Werk: 359 });
		for (const budget of budgets) {
			expect(budget.degrees).toBeGreaterThanOrEqual(MIN_BUDGET - 1e-9);
		}
	});

	it("runs the wedges end to end from zero to 360", () => {
		const budgets = assignBudgets(DOMAINS, { Gezin: 120 });
		expect(budgets[0].startAngle).toBe(0);
		expect(budgets[budgets.length - 1].endAngle).toBe(360);
		for (let i = 1; i < budgets.length; i++) {
			expect(budgets[i].startAngle).toBeCloseTo(budgets[i - 1].endAngle, 9);
		}
	});

	it("keeps the wedge order it was given, and indexes hues by it", () => {
		const budgets = assignBudgets(DOMAINS);
		expect(budgets.map((b) => b.domain)).toEqual(DOMAINS);
		expect(budgets.map((b) => b.index)).toEqual([0, 1, 2, 3]);
	});

	it("ignores nonsense overrides rather than deforming the circle", () => {
		const budgets = assignBudgets(DOMAINS, {
			Werk: Number.NaN,
			Huis: -40,
			Onbekend: 90,
		});
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		for (const budget of budgets) expect(budget.pinned).toBe(false);
	});

	it("has nothing to hand out when there are no domains", () => {
		expect(assignBudgets([])).toEqual([]);
	});
});
