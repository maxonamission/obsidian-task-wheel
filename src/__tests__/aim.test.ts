import { describe, expect, it } from "vitest";
import { aimedAt, type Target } from "../layout/aim";

/**
 * What a tap meant (BC_E3_S117).
 *
 * The numbers are the ones off the owner's own phone, converted from his
 * screenshot: scale 1.665, so a tap disc is 18 pixels across, and the dot of a
 * heading sits 45 pixels from the dot of the task under it. The discs never
 * touch — which is why "the discs overlap" was the wrong answer.
 *
 * What does overlap is the *word*. A label hangs `READING_GAP` (11 units, 18
 * pixels) outward from its own dot, so it begins where its own node stops
 * taking taps and lies over the ring where the children are drawn.
 */

const disc = (x: number, y: number, r = 18): Target["boxes"][number] => ({
	left: x - r,
	top: y - r,
	right: x + r,
	bottom: y + r,
});

/** The heading: its dot, and the word sitting 18 pixels above it. */
const HEADING: Target = {
	id: "heading",
	boxes: [disc(100, 200), { left: 40, top: 170, right: 160, bottom: 188 }],
};

/** The task one ring out, 45 pixels up. Its disc reaches down to 155. */
const TASK: Target = { id: "task", boxes: [disc(100, 155)] };

const WHEEL = [HEADING, TASK];

describe("what a tap named", () => {
	it("gives you the branch when you tapped its word", () => {
		// The finding, in one line: this point is inside the task's disc and
		// outside the heading's, and it is the middle of the heading's own label.
		expect(aimedAt({ x: 100, y: 179 }, WHEEL)).toBe("heading");
	});

	it("still gives you the task when you tapped the task", () => {
		expect(aimedAt({ x: 100, y: 155 }, WHEEL)).toBe("task");
	});

	it("gives you the branch when you tapped its dot", () => {
		expect(aimedAt({ x: 100, y: 200 }, WHEEL)).toBe("heading");
	});

	it("lets being inside a shape beat being near one", () => {
		// A pixel above the word, and there the task's disc still reaches: inside
		// its shape, so it is the task. Being *in* something is a stronger claim
		// than being beside it, and the word is only a pixel away — no rule can
		// separate those two honestly, so the simple one wins.
		expect(aimedAt({ x: 100, y: 169 }, WHEEL)).toBe("task");
	});

	it("takes a near miss on the word over a bigger miss on the dot", () => {
		// Off the left end of the word, past everything else: two pixels from the
		// label, sixty from the nearest dot.
		expect(aimedAt({ x: 38, y: 179 }, WHEEL)).toBe("heading");
	});

	it("names nothing at all out in the empty middle", () => {
		expect(aimedAt({ x: 100, y: 400 }, WHEEL)).toBeNull();
	});

	it("keeps its reach short enough to leave the far side alone", () => {
		// Ten pixels below the heading's disc: still its own. Forty is nobody's.
		expect(aimedAt({ x: 100, y: 228 }, WHEEL)).toBe("heading");
		expect(aimedAt({ x: 100, y: 258 }, WHEEL)).toBeNull();
	});

	it("prefers the shape whose middle you were nearest, inside both", () => {
		// Where the word and a disc genuinely overlap, being *in* both says
		// nothing. Then the finger's distance to the middle of each decides.
		const wide: Target = {
			id: "wide",
			boxes: [{ left: 0, top: 150, right: 200, bottom: 210 }],
		};
		expect(aimedAt({ x: 100, y: 156 }, [wide, TASK])).toBe("task");
		expect(aimedAt({ x: 100, y: 180 }, [wide, TASK])).toBe("wide");
	});

	it("names nothing when nothing is drawn", () => {
		expect(aimedAt({ x: 100, y: 100 }, [])).toBeNull();
	});
});
