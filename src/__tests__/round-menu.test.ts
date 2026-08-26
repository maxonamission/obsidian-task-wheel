import { describe, expect, it } from "vitest";
import {
	type MenuRow,
	type RoundAction,
	roundMenu,
	type RoundMenuState,
} from "../view/round-menu";

/**
 * The round menu (BC_E3_S33).
 *
 * What is measured here is what the menu *says*, because that is the part that
 * can be wrong: a lens that is on without a tick, a row offering to unfold
 * nothing, a count that disagrees with the sweep. The wiring — Obsidian's own
 * `Menu` — needs a workspace and is not measured.
 */

const wheel = (over: Partial<RoundMenuState> = {}): RoundMenuState => ({
	seen: 12,
	total: 40,
	filtering: false,
	filterText: "",
	due: "any",
	folded: 0,
	stale: false,
	outward: null,
	...over,
});

const find = (rows: MenuRow[], action: RoundAction): MenuRow => {
	const row = rows.find((one) => one.action === action);
	if (row === undefined) throw new Error(`no row for ${action}`);
	return row;
};

describe("roundMenu — the round's own actions", () => {
	it("opens with how far the round has got", () => {
		expect(roundMenu(wheel())[0]).toMatchObject({
			title: "Seen 12 of 40 this round",
			// It reports; it does not act. Greyed for that reason.
			disabled: true,
			action: null,
		});
	});

	it("holds every action the palette holds, and each one once", () => {
		const actions = roundMenu(wheel({ outward: "Werk" }))
			.map((row) => row.action)
			.filter((action): action is RoundAction => action !== null);

		expect(new Set(actions)).toEqual(
			new Set([
				"outward",
				"new-round",
				"overdue",
				"soon",
				"clear-filter",
				"unfold",
				"rescan",
				"skip-report",
				"add-preset",
			]),
		);
		expect(actions).toHaveLength(new Set(actions).size);
	});

	it("offers the way out, and names where it goes", () => {
		const rows = roundMenu(wheel({ outward: "Klanten" }));

		expect(find(rows, "outward").title).toBe("Out to Klanten");
	});

	it("leaves the way out off the vault wheel entirely", () => {
		// Not greyed: a row that could never do anything only invites the question
		// of what it would have done. There is nothing wider than the vault.
		expect(
			roundMenu(wheel()).some((row) => row.action === "outward"),
		).toBe(false);
	});

	it("puts the way out with where-you-are, above the round", () => {
		const rows = roundMenu(wheel({ outward: "Werk" }));
		const at = (action: RoundAction): number =>
			rows.findIndex((row) => row.action === action);

		expect(at("outward")).toBeLessThan(at("new-round"));
		expect(rows[at("outward") - 1]?.separator).toBeUndefined();
	});

	it("says what the wheel is filtered to, only when it is", () => {
		expect(roundMenu(wheel()).some((row) => row.icon === "filter")).toBe(false);

		const rows = roundMenu(
			wheel({ filtering: true, filterText: "overdue", due: "overdue" }),
		);
		expect(rows[1]).toMatchObject({
			title: "Filtered to: overdue",
			disabled: true,
		});
	});

	it("ticks the lens that is on, and only that one", () => {
		const rows = roundMenu(wheel({ filtering: true, due: "soon" }));

		expect(find(rows, "soon").checked).toBe(true);
		expect(find(rows, "overdue").checked).toBe(false);
	});

	it("leaves both lenses unticked when the filter is something else", () => {
		// A filter on words or priority is still a filter — it just is not one of
		// these two, and ticking one of them would say it was.
		const rows = roundMenu(
			wheel({ filtering: true, filterText: "knsb", due: "any" }),
		);

		expect(find(rows, "overdue").checked).toBe(false);
		expect(find(rows, "soon").checked).toBe(false);
		expect(find(rows, "clear-filter").disabled).toBeFalsy();
	});

	it("offers nothing to clear when nothing is filtered", () => {
		expect(find(roundMenu(wheel()), "clear-filter").disabled).toBe(true);
	});

	it("counts the folded branches, and says so in the singular too", () => {
		expect(find(roundMenu(wheel({ folded: 3 })), "unfold").title).toBe(
			"Unfold 3 folded branches",
		);
		expect(find(roundMenu(wheel({ folded: 1 })), "unfold").title).toBe(
			"Unfold 1 folded branch",
		);
	});

	it("says there is nothing folded rather than offering to unfold it", () => {
		expect(find(roundMenu(wheel()), "unfold")).toMatchObject({
			title: "Nothing is folded away",
			disabled: true,
		});
	});

	it("will not start a round that has not begun", () => {
		expect(find(roundMenu(wheel({ seen: 0 })), "new-round").disabled).toBe(true);
		expect(find(roundMenu(wheel({ seen: 1 })), "new-round").disabled).toBe(false);
	});

	it("says on the rescan row when the vault has moved on", () => {
		expect(find(roundMenu(wheel()), "rescan").title).toBe("Rescan the vault");
		expect(find(roundMenu(wheel({ stale: true })), "rescan").title).toBe(
			"Rescan the vault — it changed",
		);
	});

	it("separates the round, the filter and the vault", () => {
		const rows = roundMenu(wheel());
		const at = (action: RoundAction): number =>
			rows.findIndex((row) => row.action === action);

		// Not a count of separators — that would break on any regrouping. What
		// matters is that a divider falls between each pair of unlike things.
		const between = (from: number, to: number): boolean =>
			rows.slice(from + 1, to).some((row) => row.separator === true);

		expect(between(at("new-round"), at("overdue"))).toBe(true);
		expect(between(at("clear-filter"), at("unfold"))).toBe(true);
		expect(between(at("unfold"), at("rescan"))).toBe(true);
	});

	it("gives every row that acts an icon, and no separator one", () => {
		for (const row of roundMenu(wheel({ filtering: true, folded: 2 }))) {
			if (row.separator === true) expect(row.icon).toBeUndefined();
			else expect(row.icon).toBeTruthy();
		}
	});
});
