import { describe, expect, it } from "vitest";
import {
	clampZoom,
	fractionOf,
	viewBoxAttr,
	viewBoxFor,
	ZOOM_RANGE,
} from "../layout/zoom";

const HALF = 300;
const WEDGE = -210;

describe("clampZoom", () => {
	it("keeps the whole wheel as the widest view", () => {
		expect(clampZoom(0.2)).toBe(ZOOM_RANGE.min);
		expect(clampZoom(-4)).toBe(ZOOM_RANGE.min);
	});

	it("stops closing in past the point where it helps", () => {
		expect(clampZoom(40)).toBe(ZOOM_RANGE.max);
	});

	it("has something sensible to say about nonsense", () => {
		expect(clampZoom(Number.NaN)).toBe(ZOOM_RANGE.min);
	});
});

describe("viewBoxFor", () => {
	it("shows the whole drawing at zoom one, wherever the anchor is", () => {
		for (const anchor of [0, WEDGE, -HALF, 120]) {
			expect(viewBoxFor(HALF, anchor, 1)).toEqual({
				x: -HALF,
				y: -HALF,
				width: HALF * 2,
				height: HALF * 2,
			});
		}
	});

	it("stays square, so the wheel never goes oval", () => {
		for (const zoom of [1, 1.5, 2.7, 4]) {
			const box = viewBoxFor(HALF, WEDGE, zoom);
			expect(box.width).toBeCloseTo(box.height, 9);
		}
	});

	it("closes in as the zoom rises", () => {
		let previous = viewBoxFor(HALF, WEDGE, 1).width;
		for (const zoom of [1.5, 2, 3, 4]) {
			const width = viewBoxFor(HALF, WEDGE, zoom).width;
			expect(width).toBeLessThan(previous);
			previous = width;
		}
	});

	it("holds the anchor in the same spot on screen", () => {
		const at = (zoom: number): number =>
			fractionOf(viewBoxFor(HALF, WEDGE, zoom), 0, WEDGE)[1];

		const base = at(1);
		for (const zoom of [1.3, 2, 3.4, 4]) {
			expect(at(zoom)).toBeCloseTo(base, 9);
		}
	});

	it("keeps the reading wedge in view all the way in", () => {
		for (const zoom of [1, 2, 3, 4]) {
			const box = viewBoxFor(HALF, WEDGE, zoom);
			expect(WEDGE).toBeGreaterThanOrEqual(box.y);
			expect(WEDGE).toBeLessThanOrEqual(box.y + box.height);
		}
	});

	it("keeps the wheel horizontally centred", () => {
		for (const zoom of [1, 2, 4]) {
			const box = viewBoxFor(HALF, WEDGE, zoom);
			expect(box.x + box.width / 2).toBeCloseTo(0, 9);
		}
	});

	it("refuses to be pushed past its range", () => {
		expect(viewBoxFor(HALF, WEDGE, 99)).toEqual(
			viewBoxFor(HALF, WEDGE, ZOOM_RANGE.max),
		);
	});
});

describe("viewBoxAttr", () => {
	it("writes four numbers an SVG will take", () => {
		expect(viewBoxAttr(viewBoxFor(HALF, WEDGE, 1))).toBe("-300 -300 600 600");
	});
});
