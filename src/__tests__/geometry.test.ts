import { describe, expect, it } from "vitest";
import {
	angleDelta,
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
});
