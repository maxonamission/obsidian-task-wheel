import { describe, expect, it } from "vitest";
import { pixelsOf, scrollTurn, WHEEL_STEP } from "../layout/scroll";

/**
 * One notch, one stop (BC_E3_S66).
 *
 * How much distance a notch is worth is a system-wide setting made for
 * documents; here it must never buy more than one item, or a round loses the
 * one property it is built on — that nothing passes unseen.
 */

/** Turn a stream of deltas into the stops it buys, from a standing start. */
function stopsFor(...deltas: number[]): number[] {
	let travel = 0;
	const steps: number[] = [];
	for (const delta of deltas) {
		const turn = scrollTurn(travel, delta);
		travel = turn.travel;
		steps.push(turn.steps);
	}
	return steps;
}

describe("one event never buys more than one stop", () => {
	it("gives a fat notch exactly one stop, not seven", () => {
		// Windows sends 100 per notch by default, and several hundred when the
		// reader asked for faster scrolling. This was the bug.
		expect(stopsFor(100)).toEqual([1]);
		expect(stopsFor(300)).toEqual([1]);
		expect(stopsFor(3000)).toEqual([1]);
	});

	it("counts a fast spin by its events, so spinning still travels", () => {
		expect(stopsFor(100, 100, 100, 100)).toEqual([1, 1, 1, 1]);
	});

	it("does not bank the remainder of a fat notch", () => {
		// Keeping it is what let one notch spend as several stops, one event
		// after the next.
		expect(scrollTurn(0, 300).travel).toBe(0);
	});

	it("goes the other way for a scroll the other way", () => {
		expect(stopsFor(-100)).toEqual([-1]);
	});
});

describe("fine travel still adds up", () => {
	it("holds a trackpad's small pieces until they make a stop", () => {
		// Eight-pixel pieces: five of them are under the threshold, the sixth
		// crosses it.
		expect(stopsFor(8, 8, 8, 8, 8, 8)).toEqual([0, 0, 0, 0, 0, 1]);
	});

	it("starts banking again after each stop", () => {
		const first = scrollTurn(0, WHEEL_STEP);
		expect(first).toEqual({ steps: 1, travel: 0 });
		expect(scrollTurn(first.travel, 8).steps).toBe(0);
	});

	it("ignores an event that says nothing", () => {
		expect(scrollTurn(17, 0)).toEqual({ steps: 0, travel: 17 });
		expect(scrollTurn(17, Number.NaN)).toEqual({ steps: 0, travel: 17 });
	});
});

describe("turning back answers at once", () => {
	it("spends nothing it banked going the other way", () => {
		// Half a step forward, then a notch back: the notch must not be eaten
		// by the travel that was heading the other way.
		const forward = scrollTurn(0, 20);
		expect(forward.steps).toBe(0);
		expect(scrollTurn(forward.travel, -100).steps).toBe(-1);
	});

	it("makes a reversal take a full step of its own on a trackpad", () => {
		const forward = scrollTurn(0, 30);
		const back = scrollTurn(forward.travel, -8);
		expect(back).toEqual({ steps: 0, travel: -8 });
	});
});

describe("pixelsOf", () => {
	it("passes pixels through untouched", () => {
		expect(pixelsOf(100, 0)).toBe(100);
	});

	it("reads lines and pages as the sizes browsers themselves use", () => {
		expect(pixelsOf(3, 1)).toBe(48);
		expect(pixelsOf(1, 2)).toBe(200);
	});

	it("keeps the sign whatever the unit", () => {
		expect(pixelsOf(-3, 1)).toBe(-48);
	});
});
