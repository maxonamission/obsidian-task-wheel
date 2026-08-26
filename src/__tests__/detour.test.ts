import { describe, expect, it } from "vitest";
import { paneChange } from "../model/detour";

/**
 * What a change of pane means for a wheel (BC_E3_S53).
 *
 * The reader found this by watching the wheel jump back to the same item over
 * and over, and by noticing that closing the wheel opened a note with its
 * cursor at the top (eigenaar, 24 aug 2026). Those two turned out to be one
 * thing: the wheel read the cursor of a note nobody was in.
 */

/** A wheel over the whole vault: every note is in scope. */
const vault = () => true;
/** A wheel over one folder. */
const folder = (path: string) => path.startsWith("Werk/");

describe("what a change of pane means", () => {
	it("remembers a note this wheel is about", () => {
		expect(paneChange("Werk/Plan.md", false, vault)).toEqual({
			kind: "into",
			path: "Werk/Plan.md",
		});
	});

	it("comes back when this wheel's own pane is the one in front", () => {
		expect(paneChange(null, true, vault)).toEqual({ kind: "back" });
	});

	it("ignores a note outside this wheel", () => {
		// A folder wheel has no business following the cursor in someone's diary.
		expect(paneChange("Gezin/Weekend.md", false, folder)).toEqual({
			kind: "away",
		});
	});

	it("ignores another pane that is not a note and not this wheel", () => {
		// The graph view, a second wheel, the file explorer: none of them is a
		// detour and none of them is coming back.
		expect(paneChange(null, false, vault)).toEqual({ kind: "away" });
	});

	it("does not treat opening a note as coming back", () => {
		// The defect, stated: on the vault wheel a note is always in scope, so
		// before this every opened note counted — and a note that was merely
		// opened has its cursor at the top, which is the first task in it.
		expect(paneChange("Werk/Plan.md", false, vault).kind).not.toBe("back");
	});
});
