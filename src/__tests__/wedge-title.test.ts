import { describe, expect, it } from "vitest";
import {
	anchorFor,
	HALO,
	type LabelPlan,
	placeLabels,
	RIM_CHAR,
	RIM_HEIGHT,
} from "../layout/labels";
import { LABEL_CHARS } from "../layout/window";

/**
 * The wedge you are reading says its own name (BC_E3_S79).
 *
 * The wheel already knew how to write a label out while it stands centred over
 * its own dot and cut it short the moment it swings aside — but only for
 * branches inside the rim. A wedge title had one form, eleven characters, which
 * left the wedge under the reading wedge carrying the *shortest* label on the
 * whole drawing: "Product launch" as "Product la…", three characters less than
 * an ordinary task beside it (owner, 28 aug 2026).
 *
 * These tests are about the composition, not the arithmetic: the arithmetic that
 * pays for it is held in `window.test.ts`, which measures that the drawing does
 * not have to grow for any of this.
 */

/** A wedge title of `words`, sitting at this angle on the unturned wheel. */
function title(words: string, angle: number): LabelPlan {
	const radius = 176;
	const radians = (angle * Math.PI) / 180;
	const long = words.slice(0, LABEL_CHARS.title);
	const short = words.slice(0, LABEL_CHARS.domain);

	return {
		angle,
		x: radius * Math.sin(radians),
		y: -radius * Math.cos(radians),
		width: long.length * RIM_CHAR,
		height: RIM_HEIGHT + HALO,
		onRim: true,
		centred: false,
		focus: false,
		near: false,
		long,
		short,
	};
}

const NAME = "Product launch";

describe("the title of the wedge being read", () => {
	it("is written out while it stands under the reading wedge", () => {
		const [placed] = placeLabels([title(NAME, 0)], 0);
		expect(placed.side).toBe("middle");
		expect(placed.words).toBe(NAME);
		expect(placed.words).not.toContain("…");
	});

	it("is still written out when the wedge is a little off twelve", () => {
		// A wedge is wider than the reading wedge, so its title sits at the
		// middle of the slice and is rarely exactly upright.
		for (const angle of [-12, -6, 6, 12]) {
			const [placed] = placeLabels([title(NAME, angle)], 0);
			expect(placed.words).toBe(NAME);
		}
	});

	it("goes short again once it swings round to the side", () => {
		// Which is what the drawing is sized for, and why the long form is free.
		const [placed] = placeLabels([title(NAME, 90)], 0);
		expect(placed.side).not.toBe("middle");
		expect(placed.words.length).toBeLessThanOrEqual(LABEL_CHARS.domain);
	});

	it("follows the turn, not the wedge's own angle", () => {
		// The same title, written out only while the wheel has turned it upright.
		const plan = title(NAME, 120);
		expect(placeLabels([plan], -120)[0].words).toBe(NAME);
		expect(placeLabels([plan], 0)[0].words).not.toBe(NAME);
	});

	it("gives a title room without giving it the whole rim", () => {
		// Long enough to hold the note and heading names people actually write,
		// short enough that the reading card still has a job.
		const long = "A heading name far longer than anything sensible";
		const [placed] = placeLabels([title(long, 0)], 0);
		expect(placed.words.length).toBeLessThanOrEqual(LABEL_CHARS.title);
		expect(LABEL_CHARS.title).toBeGreaterThan(LABEL_CHARS.leaf);
	});

	it("centres a title over a narrower band than a branch label", () => {
		// A wedge title is anchored on the rim, where its neighbours are; a branch
		// label is inside, where there is more room to be off-centre. So the two
		// give up centring at different angles, and `anchorFor` says so.
		expect(anchorFor(20, true, false)).not.toBe("middle");
		expect(anchorFor(20, false, true)).toBe("middle");
	});
});
