import { describe, expect, it } from "vitest";
import {
	clearFilter,
	DEFAULT_SETTINGS,
	filterOf,
	sameFilter,
	setFilter,
	stateFor,
	type TaskWheelSettings,
} from "../settings";
import { NO_FILTER, VAULT_SCOPE, type WheelScope } from "../model/types";

/**
 * The filter belongs to the blikveld, and a new selection is a new round.
 *
 * Two wheels open at once took each other's filter over — never decided, just a
 * consequence of where the fields had landed (owner, 18 aug 2026). The
 * kaderdocument is clear that a filter is *part of a round* (§4), and the round
 * already lives per blikveld, so the filter belongs beside it.
 */

const WERK: WheelScope = { kind: "folder", path: "Werk" };
const GEZIN: WheelScope = { kind: "folder", path: "Gezin" };

function fresh(): TaskWheelSettings {
	return {
		...DEFAULT_SETTINGS,
		filterWithTags: [],
		filterWithoutTags: [],
		state: { ...DEFAULT_SETTINGS.state, seen: [] },
		scopes: {},
	};
}

describe("every wheel filters for itself", () => {
	it("a folder wheel does not take the vault wheel's filter", () => {
		const settings = fresh();
		setFilter(settings, VAULT_SCOPE, { ...NO_FILTER, text: "northwind" });

		expect(filterOf(settings, VAULT_SCOPE).text).toBe("northwind");
		expect(filterOf(settings, WERK).text).toBe("");
	});

	it("and two folder wheels do not take each other's", () => {
		const settings = fresh();
		setFilter(settings, WERK, { ...NO_FILTER, text: "offerte" });
		setFilter(settings, GEZIN, { ...NO_FILTER, status: "in-progress" });

		expect(filterOf(settings, WERK).text).toBe("offerte");
		expect(filterOf(settings, WERK).status).toBe("any");
		expect(filterOf(settings, GEZIN).text).toBe("");
		expect(filterOf(settings, GEZIN).status).toBe("in-progress");
	});

	it("a blikveld nobody has filtered yet starts unfiltered", () => {
		// Opening a blikveld is beginning a round, and a round begins by seeing
		// everything.
		expect(sameFilter(filterOf(fresh(), WERK), NO_FILTER)).toBe(true);
	});

	it("keeps the vault wheel on the fields it always used", () => {
		// So an existing data.json needs no rewriting at all.
		const settings = fresh();
		setFilter(settings, VAULT_SCOPE, { ...NO_FILTER, text: "northwind" });

		expect(settings.filterText).toBe("northwind");
		expect(settings.state.filter).toBeUndefined();
	});
});

describe("a new selection is a new round", () => {
	it("gives up the marks, and says how many", () => {
		const settings = fresh();
		settings.state.seen = ["a", "b", "c"];

		const { restarted } = setFilter(settings, VAULT_SCOPE, {
			...NO_FILTER,
			text: "northwind",
		});

		expect(restarted).toBe(3);
		expect(settings.state.seen).toEqual([]);
		expect(settings.state.sweepStartedAt).toBeNull();
	});

	it("only for the wheel whose filter changed", () => {
		const settings = fresh();
		settings.state.seen = ["a", "b"];
		stateFor(settings, WERK).seen = ["x"];

		setFilter(settings, WERK, { ...NO_FILTER, text: "offerte" });

		expect(stateFor(settings, WERK).seen).toEqual([]);
		expect(settings.state.seen).toEqual(["a", "b"]);
	});

	it("costs nothing when the filter did not actually change", () => {
		// Flipping a control back to what it already said must not cost a round.
		const settings = fresh();
		setFilter(settings, VAULT_SCOPE, { ...NO_FILTER, text: "northwind" });
		settings.state.seen = ["a", "b"];

		const { restarted } = setFilter(settings, VAULT_SCOPE, {
			...NO_FILTER,
			text: "northwind",
		});

		expect(restarted).toBe(0);
		expect(settings.state.seen).toEqual(["a", "b"]);
	});

	it("counts turning a filter off as a new selection too", () => {
		const settings = fresh();
		setFilter(settings, VAULT_SCOPE, { ...NO_FILTER, text: "northwind" });
		settings.state.seen = ["a"];

		expect(clearFilter(settings, VAULT_SCOPE).restarted).toBe(1);
		expect(settings.state.seen).toEqual([]);
	});
});

describe("what counts as the same filter", () => {
	it("ignores the order two tags were typed in", () => {
		expect(
			sameFilter(
				{ ...NO_FILTER, withTags: ["werk", "thuis"] },
				{ ...NO_FILTER, withTags: ["thuis", "werk"] },
			),
		).toBe(true);
	});

	it("but not a tag that came or went", () => {
		expect(
			sameFilter(
				{ ...NO_FILTER, withTags: ["werk"] },
				{ ...NO_FILTER, withTags: ["werk", "thuis"] },
			),
		).toBe(false);
	});

	it("sees a changed horizon", () => {
		expect(
			sameFilter({ ...NO_FILTER, horizon: 7 }, { ...NO_FILTER, horizon: 14 }),
		).toBe(false);
	});
});
