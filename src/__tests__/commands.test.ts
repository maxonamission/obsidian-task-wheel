import { describe, expect, it } from "vitest";
import { presetCommandId, reconcileCommands } from "../model/commands";

/**
 * The command list and the destinations, kept in step (BC_E3_S46, audit C1).
 */

describe("a destination's command id", () => {
	it("is the same for the same name", () => {
		expect(presetCommandId("Do this week")).toBe(presetCommandId("Do this week"));
		expect(presetCommandId("Do this week")).toBe("preset-do-this-week");
	});

	it("survives a name that is nothing but punctuation", () => {
		// It still has to be a usable id, and two such names sharing one is the
		// same "do not name two destinations the same" as everywhere else.
		expect(presetCommandId("!!!")).toBe("preset-destination");
		expect(presetCommandId("")).toBe("preset-destination");
	});

	it("folds case and runs of punctuation together", () => {
		expect(presetCommandId("GTD — Waiting For!")).toBe("preset-gtd-waiting-for");
	});
});

describe("keeping the palette in step", () => {
	it("adds what is new", () => {
		expect(reconcileCommands([], ["preset-a"])).toEqual({
			add: ["preset-a"],
			remove: [],
		});
	});

	it("takes back a destination that was deleted", () => {
		expect(reconcileCommands(["preset-a", "preset-b"], ["preset-a"])).toEqual({
			add: [],
			remove: ["preset-b"],
		});
	});

	it("swaps the command of a renamed destination", () => {
		expect(
			reconcileCommands(["preset-later"], ["preset-maybe-later"]),
		).toEqual({ add: ["preset-maybe-later"], remove: ["preset-later"] });
	});

	it("leaves an unchanged command alone", () => {
		// The point of this test: registering it again would make it a *new*
		// command as far as Obsidian is concerned, and the key the reader bound
		// to it would go with the old one.
		expect(
			reconcileCommands(["preset-a", "preset-b"], ["preset-b", "preset-a"]),
		).toEqual({ add: [], remove: [] });
	});

	it("has nothing to do for an empty list on both sides", () => {
		expect(reconcileCommands([], [])).toEqual({ add: [], remove: [] });
	});
});
