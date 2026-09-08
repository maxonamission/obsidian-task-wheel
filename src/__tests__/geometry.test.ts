import { describe, expect, it } from "vitest";
import {
	angleDelta,
	arcPath,
	branchPath,
	containsAngle,
	normaliseAngle,
	pointAt,
	ringRadius,
} from "../layout/geometry";

describe("pointAt — zero is twelve o'clock, clockwise", () => {
	it("puts zero degrees straight up", () => {
		const point = pointAt(100, 0);
		expect(point.x).toBeCloseTo(0, 9);
		expect(point.y).toBeCloseTo(-100, 9);
	});

	it("puts ninety degrees to the right", () => {
		const point = pointAt(100, 90);
		expect(point.x).toBeCloseTo(100, 9);
		expect(point.y).toBeCloseTo(0, 9);
	});

	it("puts two-seventy to the left", () => {
		const point = pointAt(100, 270);
		expect(point.x).toBeCloseTo(-100, 9);
		expect(point.y).toBeCloseTo(0, 9);
	});

	it("keeps the radius whatever the angle", () => {
		for (let angle = 0; angle < 360; angle += 13) {
			const { x, y } = pointAt(42, angle);
			expect(Math.hypot(x, y)).toBeCloseTo(42, 9);
		}
	});
});

describe("angles", () => {
	it("normalises into a single turn", () => {
		expect(normaliseAngle(370)).toBeCloseTo(10, 9);
		expect(normaliseAngle(-10)).toBeCloseTo(350, 9);
		expect(normaliseAngle(0)).toBe(0);
	});

	it("takes the short way round", () => {
		expect(angleDelta(350, 10)).toBeCloseTo(20, 9);
		expect(angleDelta(10, 350)).toBeCloseTo(-20, 9);
	});

	it("treats a span as half open and wraps it", () => {
		expect(containsAngle(10, 20, 10)).toBe(true);
		expect(containsAngle(10, 20, 20)).toBe(false);
		expect(containsAngle(350, 370, 0)).toBe(true);
		expect(containsAngle(0, 360, 271)).toBe(true);
		expect(containsAngle(10, 10, 10)).toBe(false);
	});
});

describe("rings", () => {
	const config = { radii: [0, 40, 80], step: 10 };

	it("reads the table where it has one", () => {
		expect(ringRadius(0, config)).toBe(0);
		expect(ringRadius(2, config)).toBe(80);
	});

	it("steps on past the end of the table", () => {
		expect(ringRadius(3, config)).toBe(90);
		expect(ringRadius(5, config)).toBe(110);
	});
});

describe("branchPath", () => {
	it("arcs along the parent ring and then goes out", () => {
		const path = branchPath(40, 0, 80, 30);
		expect(path).toMatch(/^M/);
		expect(path).toContain("A40,40");
		expect(path).toContain("L");
	});

	it("turns clockwise for a child further round", () => {
		expect(branchPath(40, 0, 80, 30)).toContain(" 0 0 1 ");
		expect(branchPath(40, 30, 80, 0)).toContain(" 0 0 0 ");
	});

	it("is a straight line when there is no angle to cover", () => {
		const path = branchPath(40, 30, 80, 30);
		expect(path).not.toContain("A");
	});

	it("is a straight line out of the hub", () => {
		expect(branchPath(0, 0, 40, 90)).not.toContain("A");
	});

	/**
	 * The seam at 0°, and the line that went all the way round (BC_E3_S179).
	 *
	 * A child sits inside its parent's wedge, so the arc between them is a few
	 * degrees — except where that wedge lies across 0°, and since the wheel
	 * turns, some wedge always does. Subtracting the raw angles made 350° to
	 * 10° a journey of 340 degrees, and the path drew it: a thin line right
	 * round the wheel, through every other domain (eigenaar, 8 sep 2026).
	 */
	describe("across the seam at zero", () => {
		/** The two arc flags: large-arc, then sweep. */
		const flags = (path: string): string | undefined =>
			path.match(/A[\d.,-]+ 0 (\d \d) /)?.[1];

		it("never takes the long way round", () => {
			expect(flags(branchPath(40, 350, 80, 10))).toBe("0 1");
			expect(flags(branchPath(40, 10, 80, 350))).toBe("0 0");
			expect(flags(branchPath(40, 0, 80, 359))).toBe("0 0");
		});

		it("turns the way the child actually lies", () => {
			// 350° → 10° is twenty degrees clockwise, not 340 the other way.
			expect(flags(branchPath(40, 350, 80, 10))).toBe("0 1");
			// And back again is twenty degrees the other way.
			expect(flags(branchPath(40, 10, 80, 350))).toBe("0 0");
		});

		it("leaves an ordinary branch exactly as it was", () => {
			expect(flags(branchPath(40, 0, 80, 30))).toBe("0 1");
			expect(flags(branchPath(40, 30, 80, 0))).toBe("0 0");
			expect(flags(branchPath(40, 170, 80, 190))).toBe("0 1");
		});
	});
});

describe("arcPath — an arc's centre is derived from its endpoints", () => {
	/** Every anchor point the path visits, in order. */
	function anchors(path: string): Array<{ x: number; y: number }> {
		return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?=[AL]|$)/g)].map(
			(hit) => ({ x: Number(hit[1]), y: Number(hit[2]) }),
		);
	}

	function apart(a: { x: number; y: number }, b: { x: number; y: number }): number {
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	it("draws a partial arc as one arc", () => {
		expect(arcPath(340, 0, 90).match(/A/g)).toHaveLength(1);
		expect(arcPath(340, 0, 359).match(/A/g)).toHaveLength(1);
	});

	it("never hands the browser a vanishing chord", () => {
		// A full circle drawn as one arc leaves two endpoints a hair apart, and
		// the centre the browser re-derives from that chord lands tens of units
		// off the hub — the thick outer band the owner saw lurch (BC_E3_S70).
		// Whole circles become two half arcs, whose anchors stand a diameter
		// apart: the worst-conditioned chord any of them carries is no chord.
		for (const start of [0, 328, 337]) {
			const path = arcPath(340, start, start + 360);
			expect(path.match(/A/g)).toHaveLength(2);

			const points = anchors(path);
			for (let i = 1; i < points.length; i++) {
				expect(apart(points[i - 1], points[i])).toBeGreaterThan(340);
			}
		}
	});

	it("comes home exactly on a whole circle", () => {
		const points = anchors(arcPath(340, 328, 688));
		expect(points[0]).toEqual(points[points.length - 1]);
		for (const point of points) {
			expect(Math.hypot(point.x, point.y)).toBeCloseTo(340, 1);
		}
	});
});
