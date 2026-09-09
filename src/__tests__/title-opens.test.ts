import { describe, expect, it } from "vitest";
import { titleOpens, type OutlineActions } from "../view/reading-card";

/**
 * What a click on the task's title opens (BC_E3_S101).
 *
 * Two inputs, and the interesting case is where they disagree: the reader has
 * asked for the Tasks window, and there is no Tasks window to open. A setting
 * that points at something absent has to degrade to the thing that is there —
 * anything else leaves a gesture that silently does nothing, which is how a
 * surface earns the reputation of being broken.
 */

const nothing = (): void => undefined;

const outline = (extra: Partial<OutlineActions> = {}): OutlineActions => ({
	rename: nothing,
	add: nothing,
	move: nothing,
	moveTo: nothing,
	moveUnder: nothing,
	remove: nothing,
	...extra,
});

describe("what the title opens", () => {
	it("opens the card's own box when there is no outline at all", () => {
		expect(titleOpens(undefined)).toBe("inline");
	});

	it("opens the card's own box when that is what the reader asked for", () => {
		expect(titleOpens(outline({ editInTasks: nothing }))).toBe("inline");
		expect(
			titleOpens(outline({ editInTasks: nothing, titleOpensTasks: false })),
		).toBe("inline");
	});

	it("opens Tasks when it is asked for and there is one to open", () => {
		expect(
			titleOpens(outline({ editInTasks: nothing, titleOpensTasks: true })),
		).toBe("tasks");
	});

	it("falls back to the box when Tasks is asked for but not installed", () => {
		// The setting survives uninstalling the plugin, and so does a vault
		// carried to another machine. Neither may leave the title dead.
		expect(titleOpens(outline({ titleOpensTasks: true }))).toBe("inline");
	});
});
