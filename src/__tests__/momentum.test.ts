import { describe, expect, it } from "vitest";
import {
	coastFrom,
	DEFAULT_COAST,
	DEFAULT_SNAP,
	snapDuration,
	type TravelSample,
	tweenAt,
} from "../layout/momentum";

/** A steady sweep: `degrees` covered over `ms`, sampled every 16 milliseconds. */
function sweep(degrees: number, ms: number): TravelSample[] {
	const samples: TravelSample[] = [];
	for (let time = 0; time <= ms; time += 16) {
		samples.push({ time, angle: (degrees * time) / ms });
	}
	return samples;
}

describe("coastFrom — what a flick is worth", () => {
	it("stands still when there is nothing to go on", () => {
		expect(coastFrom([])).toBe(0);
		expect(coastFrom([{ time: 0, angle: 0 }])).toBe(0);
	});

	it("stands still when every sample shares a timestamp", () => {
		expect(
			coastFrom([
				{ time: 5, angle: 0 },
				{ time: 5, angle: 40 },
			]),
		).toBe(0);
	});

	it("carries a flick on in the direction it was going", () => {
		expect(coastFrom(sweep(60, 100))).toBeGreaterThan(0);
		expect(coastFrom(sweep(-60, 100))).toBeLessThan(0);
	});

	it("projects the speed forward over its window", () => {
		// 30 degrees in 100 ms is 0.3 per ms; 90 ms of that is 27.
		expect(coastFrom(sweep(30, 100))).toBeCloseTo(27, 6);
	});

	it("gives a slow drag almost nothing to coast on", () => {
		expect(Math.abs(coastFrom(sweep(4, 600)))).toBeLessThan(1);
	});

	it("never throws the wheel further than its cap", () => {
		expect(coastFrom(sweep(400, 50))).toBe(DEFAULT_COAST.maxDegrees);
		expect(coastFrom(sweep(-400, 50))).toBe(-DEFAULT_COAST.maxDegrees);
	});

	it("caps at a quarter turn, so a flick never crosses the wheel", () => {
		expect(DEFAULT_COAST.maxDegrees).toBeLessThanOrEqual(90);
	});

	it("takes its own options when it is given them", () => {
		const slow = coastFrom(sweep(30, 100), { projectMs: 10, maxDegrees: 90 });
		expect(slow).toBeCloseTo(3, 6);
	});
});

describe("snapDuration — how long a stop takes to reach", () => {
	it("gives a longer move a longer run", () => {
		expect(snapDuration(120)).toBeGreaterThan(snapDuration(60));
	});

	it("never dawdles and never blinks", () => {
		expect(snapDuration(0)).toBe(DEFAULT_SNAP.minMs);
		expect(snapDuration(10_000)).toBe(DEFAULT_SNAP.maxMs);
	});

	it("does not care which way round the move goes", () => {
		expect(snapDuration(-90)).toBe(snapDuration(90));
	});
});

describe("tweenAt — the snap itself", () => {
	it("starts where it started", () => {
		expect(tweenAt(20, 80, 0)).toBe(20);
	});

	it("ends exactly on the stop, not near it", () => {
		expect(tweenAt(20, 80, 1)).toBe(80);
		expect(tweenAt(352.8, 318.6, 1)).toBe(318.6);
		expect(tweenAt(0, 1 / 3, 1)).toBe(1 / 3);
	});

	it("holds the stop once it is past the end", () => {
		expect(tweenAt(20, 80, 1.4)).toBe(80);
	});

	it("moves without ever turning back", () => {
		let previous = tweenAt(0, 100, 0);
		for (let t = 0.05; t <= 1; t += 0.05) {
			const value = tweenAt(0, 100, t);
			expect(value).toBeGreaterThanOrEqual(previous);
			previous = value;
		}
	});

	it("eases out: more of the distance is covered early", () => {
		expect(tweenAt(0, 100, 0.5)).toBeGreaterThan(50);
	});

	it("runs backwards just as exactly", () => {
		expect(tweenAt(80, 20, 1)).toBe(20);
		expect(tweenAt(80, 20, 0.5)).toBeLessThan(50);
	});
});
