import { describe, expect, it } from "vitest";
import { pinnedAngle, type PinSlice } from "../layout/pin";
import { angleDelta } from "../layout/geometry";

/**
 * Holding a container still while the wheel turns under it (BC_E3_S39).
 *
 * The property that matters is not any one angle but that the answer never
 * jumps: a container that steps from one place to another is exactly the
 * restlessness this rule exists to remove.
 */

const slice = (start: number, end: number): PinSlice => ({
	startAngle: start,
	endAngle: end,
	angle: (start + end) / 2,
	span: end - start,
});

/** Where it ends up on screen: the wheel turns by -reading. */
const shown = (drawn: number, reading: number): number =>
	angleDelta(reading, drawn);

describe("pinnedAngle — a container stands still while you turn under it", () => {
	const wedge = slice(30, 90);

	it("sits on the reading angle while the wedge is inside its slice", () => {
		for (const reading of [30, 45, 60, 89]) {
			expect(pinnedAngle(wedge, reading)).toBeCloseTo(reading, 6);
			// Which is to say: nailed to twelve o'clock on screen.
			expect(shown(pinnedAngle(wedge, reading), reading)).toBeCloseTo(0, 6);
		}
	});

	/** How far past its edge a container is still on its way home. */
	const release = wedge.span * 0.35;

	it("rests in the middle of its slice when the wedge is far away", () => {
		expect(pinnedAngle(wedge, 200)).toBeCloseTo(60, 6);
		expect(pinnedAngle(wedge, 300)).toBeCloseTo(60, 6);
		// A third of its own width past the edge is already home.
		expect(pinnedAngle(wedge, 30 - release)).toBeCloseTo(60, 6);
	});

	it("slides home from the edge it was last held on", () => {
		// Just past the end: still at the edge it left by.
		expect(pinnedAngle(wedge, 90.001)).toBeCloseTo(90, 2);
		// A third of its width later: home.
		expect(pinnedAngle(wedge, 90 + release)).toBeCloseTo(60, 6);
		// And halfway is halfway.
		expect(pinnedAngle(wedge, 90 + release / 2)).toBeCloseTo(75, 6);
	});

	it("does the same on the other side", () => {
		expect(pinnedAngle(wedge, 29.999)).toBeCloseTo(30, 2);
		expect(pinnedAngle(wedge, 30 - release / 2)).toBeCloseTo(45, 6);
		expect(pinnedAngle(wedge, 30 - release)).toBeCloseTo(60, 6);
	});

	it("never jumps, at any angle of the circle", () => {
		// The whole point. Walked in tenths of a degree all the way round, the
		// drawn angle may never move more than a step and a half — which is the
		// slide-home rate, and it is what "rustig" means here.
		let worst = 0;
		let previous = pinnedAngle(wedge, 0);
		for (let reading = 0.1; reading <= 360; reading += 0.1) {
			const now = pinnedAngle(wedge, reading);
			worst = Math.max(worst, Math.abs(angleDelta(previous, now)));
			previous = now;
		}
		expect(worst).toBeLessThan(0.2);
	});

	it("never slides home faster than a few turns of the wheel", () => {
		// On screen. Inside the slice it stands still (rate 0); released it
		// travels with the wheel (rate 1); in between it does both at once. The
		// sum is `1 + half its width / the release`, so a third of its width puts
		// it just under two and a half — the price of getting out of the way of
		// the container that is being held next.
		let worst = 0;
		let previous = shown(pinnedAngle(wedge, 0), 0);
		for (let reading = 0.1; reading <= 360; reading += 0.1) {
			const now = shown(pinnedAngle(wedge, reading), reading);
			worst = Math.max(worst, Math.abs(angleDelta(previous, now)) / 0.1);
			previous = now;
		}
		expect(worst).toBeLessThanOrEqual(2.5 + 1e-6);
	});

	it("gives a sliver of a slice room to slide in", () => {
		// A one-degree slice would be home again within a degree, which is a jump
		// however short the distance it covers.
		const sliver = slice(100, 101);
		expect(pinnedAngle(sliver, 103)).not.toBeCloseTo(sliver.angle, 3);
		expect(pinnedAngle(sliver, 108)).toBeCloseTo(sliver.angle, 6);
	});

	it("works across twelve o'clock, where the numbers wrap", () => {
		// The reading wedge lives at zero, so this is not an edge case but the
		// ordinary one.
		const over = slice(350, 370);

		expect(pinnedAngle(over, 355)).toBeCloseTo(355, 6);
		expect(pinnedAngle(over, 5)).toBeCloseTo(5, 6);
		expect(shown(pinnedAngle(over, 0), 0)).toBeCloseTo(0, 6);
		expect(pinnedAngle(over, 180)).toBeCloseTo(360, 6);
	});
});
