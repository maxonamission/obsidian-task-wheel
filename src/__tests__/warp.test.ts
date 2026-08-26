import { describe, expect, it } from "vitest";
import { DEFAULT_WARP, warpAngle, withinWarp } from "../layout/warp";
import { angleDelta } from "../layout/geometry";

/**
 * The magnifying glass over the reading wedge (BC_E3_S41).
 *
 * Three properties are what make it safe to draw a whole wheel through, and
 * they are worth more than any single number: it holds the reading angle still,
 * it never lets two items swap places, and outside its window it does nothing
 * at all.
 */

const at = (angle: number, reading = 0): number => warpAngle(angle, reading);

/** Signed offset from the reading angle, which is what the eye sees. */
const off = (angle: number, reading = 0): number =>
	angleDelta(reading, warpAngle(angle, reading));

describe("warpAngle — the fisheye follows the wedge", () => {
	it("holds whatever is under the wedge exactly under the wedge", () => {
		for (const reading of [0, 37, 180, 275, 359]) {
			expect(angleDelta(reading, warpAngle(reading, reading))).toBeCloseTo(0, 9);
		}
	});

	it("does nothing at all outside its window", () => {
		for (const angle of [90, 120, 180, 240, 270]) {
			expect(at(angle)).toBeCloseTo(angle, 6);
		}
		expect(withinWarp(89, 0)).toBe(true);
		expect(withinWarp(91, 0)).toBe(false);
	});

	it("leaves the window's own edges where they are", () => {
		// So the drawing does not tear at the seam: inside and outside agree.
		expect(at(DEFAULT_WARP.window)).toBeCloseTo(DEFAULT_WARP.window, 6);
		expect(off(-DEFAULT_WARP.window)).toBeCloseTo(-DEFAULT_WARP.window, 6);
	});

	it("magnifies under the wedge — that is the whole point", () => {
		// Two items a degree apart near the wedge are drawn several degrees
		// apart: this is the room that used to come from re-dividing the circle.
		// Two passes of 2,4× make about 5,8× either side of the wedge.
		const spread = off(1) - off(-1);
		expect(spread / 2).toBeGreaterThan(4);
		expect(spread / 2).toBeLessThan(8);
	});

	it("gives it back further out, so the window keeps its width", () => {
		// What is stretched in the middle is squeezed further out. The circle is
		// not made bigger; it is redistributed.
		const near = off(10) - off(0);
		const far = off(80) - off(70);
		expect(near).toBeGreaterThan(far);
	});

	it("never lets two items swap places, anywhere on the circle", () => {
		// Order-preserving, walked in tenths of a degree: this is what says a
		// branch can never turn inside out, whatever the strength is set to.
		let previous = off(-180 + 0.05);
		for (let angle = -180 + 0.15; angle < 180; angle += 0.1) {
			const now = off(angle);
			expect(now).toBeGreaterThan(previous);
			previous = now;
		}
	});

	it("moves nothing more than it has to", () => {
		// Nothing is thrown across the wheel: the largest displacement is a
		// fraction of the window, so the drawing stays recognisably itself.
		let worst = 0;
		for (let angle = -179; angle < 180; angle += 0.5) {
			worst = Math.max(worst, Math.abs(angleDelta(angle, off(angle))));
		}
		// Measured 51° with the window at 90 — a stretch, not a throw.
		expect(worst).toBeLessThan(DEFAULT_WARP.window * 0.6);
	});

	it("works the same wherever the wheel happens to stand", () => {
		// The magnifier travels with the reading wedge; it is not nailed to the
		// zero of the coordinate system.
		for (const reading of [0, 90, 200, 350]) {
			expect(off(reading + 5, reading)).toBeCloseTo(off(5, 0), 6);
			expect(off(reading - 40, reading)).toBeCloseTo(off(-40, 0), 6);
		}
	});

	it("is a straight pass-through when it is turned off", () => {
		for (const angle of [0, 12, 91, 300]) {
			expect(warpAngle(angle, 0, { window: 90, strength: 0, passes: 1 })).toBeCloseTo(
				angle,
				6,
			);
		}
	});
});
