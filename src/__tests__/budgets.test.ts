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

describe("assignBudgets — dividing by weight (kaderdocument §3.1, herzien)", () => {
	const division = (
		weights: Record<string, number>,
		minimum = 15,
	): Parameters<typeof assignBudgets>[2] => ({ weights, minimum });

	const widthOf = (
		budgets: ReturnType<typeof assignBudgets>,
		domain: string,
	): number => budgets.find((b) => b.domain === domain)?.degrees ?? Number.NaN;

	it("gives busier domains wider wedges, in proportion", () => {
		const budgets = assignBudgets(
			DOMAINS,
			{},
			division({ Gezin: 30, Gezondheid: 30, Huis: 30, Werk: 90 }),
		);
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		expect(widthOf(budgets, "Werk")).toBeCloseTo(180, 9);
		expect(widthOf(budgets, "Gezin")).toBeCloseTo(60, 9);
	});

	it("stops a quiet domain at the floor instead of shrinking it away", () => {
		// 1 task against 199: proportionally Gezin would get 1,8° — a sliver
		// that cannot carry its name. The floor is the whole point.
		const budgets = assignBudgets(
			["Gezin", "Werk"],
			{},
			division({ Gezin: 1, Werk: 199 }),
		);
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		expect(widthOf(budgets, "Gezin")).toBeCloseTo(15, 9);
		expect(widthOf(budgets, "Werk")).toBeCloseTo(345, 9);
	});

	it("gives a domain with no weight the floor, not nothing", () => {
		const budgets = assignBudgets(
			["Leeg", "Werk"],
			{},
			division({ Leeg: 0, Werk: 40 }),
		);
		expect(widthOf(budgets, "Leeg")).toBeCloseTo(15, 9);
		expect(widthOf(budgets, "Werk")).toBeCloseTo(345, 9);
	});

	it("divides equally when every weight is zero", () => {
		const budgets = assignBudgets(DOMAINS, {}, division({}));
		for (const budget of budgets) expect(budget.degrees).toBeCloseTo(90, 9);
	});

	it("lets the floor give way to the equal share when the circle cannot afford it", () => {
		// Twelve domains at a 40° floor would need 480°. Equal is the least-bad
		// reading of "readable" then — and the circle still adds up.
		const many = Array.from({ length: 12 }, (_, i) => `D${i}`);
		const weights = Object.fromEntries(many.map((d, i) => [d, i + 1]));
		const budgets = assignBudgets(many, {}, division(weights, 40));
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		for (const budget of budgets) {
			expect(budget.degrees).toBeGreaterThanOrEqual(30 - 1e-9);
		}
	});

	it("keeps a pinned wedge at its width and divides the rest by weight", () => {
		const budgets = assignBudgets(
			DOMAINS,
			{ Werk: 120 },
			division({ Gezin: 10, Gezondheid: 20, Huis: 50, Werk: 999 }),
		);
		expect(totalOf(budgets)).toBeCloseTo(360, 9);
		expect(widthOf(budgets, "Werk")).toBeCloseTo(120, 9);
		expect(widthOf(budgets, "Huis")).toBeCloseTo(150, 9);
		expect(widthOf(budgets, "Gezin")).toBeCloseTo(30, 9);
	});

	it("never hands out less than the hard minimum, whatever the setting says", () => {
		const budgets = assignBudgets(
			["Gezin", "Werk"],
			{},
			division({ Gezin: 1, Werk: 999 }, 0),
		);
		expect(widthOf(budgets, "Gezin")).toBeGreaterThanOrEqual(MIN_BUDGET - 1e-9);
	});

	it("still runs the wedges end to end from zero to 360", () => {
		const budgets = assignBudgets(
			DOMAINS,
			{},
			division({ Gezin: 3, Gezondheid: 1, Huis: 7, Werk: 2 }),
		);
		expect(budgets[0].startAngle).toBe(0);
		expect(budgets[budgets.length - 1].endAngle).toBe(360);
		for (let i = 1; i < budgets.length; i++) {
			expect(budgets[i].startAngle).toBeCloseTo(budgets[i - 1].endAngle, 9);
		}
	});
});
