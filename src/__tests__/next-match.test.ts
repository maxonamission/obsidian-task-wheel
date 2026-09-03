import { describe, expect, it } from "vitest";
import { type Detent, nextMatching } from "../layout/detents";

/**
 * Where Enter in the search box takes you (BC_E3_S121).
 *
 * The words are applied before this is asked, so everything still on the wheel
 * is a match and "the next match" is the next task stop in the turn direction.
 * What the rule has to get right is the *direction* and the *exclusion*: from
 * here, forwards, never the stop you are already standing on — that reads as a
 * key that did nothing.
 */

const stop = (id: string, index: number, turnStop = true): Detent =>
	({ id, index, rotation: -30 * index, angle: 30 * index, depth: 2, turnStop }) as unknown as Detent;

/** Four tasks with a heading between them: the heading is not a turn stop. */
const DETENTS: Detent[] = [
	stop("a", 0),
	stop("heading", 1, false),
	stop("b", 2),
	stop("c", 3),
	stop("d", 4),
];

const tasks = (id: string): boolean => id !== "heading";

describe("the next match in the turn direction", () => {
	it("goes forwards from where you stand", () => {
		expect(nextMatching(DETENTS, 0, tasks)?.id).toBe("b");
		expect(nextMatching(DETENTS, 2, tasks)?.id).toBe("c");
	});

	it("never answers the stop you are already on", () => {
		// Standing on the only match still means the only match — but a wheel
		// with four of them must move.
		expect(nextMatching(DETENTS, 3, tasks)?.id).not.toBe("c");
	});

	it("wraps round the circle rather than stopping at the end", () => {
		expect(nextMatching(DETENTS, 4, tasks)?.id).toBe("a");
	});

	it("passes over what turning does not rest on", () => {
		// The heading sits between a and b in the flat order; the walk skips it
		// because turning never stops there.
		expect(nextMatching(DETENTS, 0, () => true)?.id).toBe("b");
	});

	it("comes back to the one match there is, even from itself", () => {
		const only = (id: string): boolean => id === "c";
		expect(nextMatching(DETENTS, 3, only)?.id).toBe("c");
	});

	it("says nothing rather than moving to nowhere", () => {
		expect(nextMatching(DETENTS, 0, () => false)).toBeNull();
		expect(nextMatching([], 0, () => true)).toBeNull();
	});

	it("starts at the beginning when the wheel stands nowhere in particular", () => {
		// -1 is "no focus yet": the round has not been entered, so the first
		// stop in the turn order is the honest answer.
		expect(nextMatching(DETENTS, -1, tasks)?.id).toBe("a");
	});
});
