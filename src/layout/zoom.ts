/**
 * Zooming, as a viewBox.
 *
 * The drawing never changes size — the window onto it does. That keeps zoom
 * free of everything else: no re-layout, no re-render, one attribute.
 *
 * The anchor is the point that stays put while the window closes in, and here
 * it is the **reading wedge**, not the hub. Zooming towards the middle would
 * magnify the part you are not reading and push the item under the wedge off
 * the top edge. Anchoring on the wedge does the opposite: the thing you are
 * looking at holds its place on screen and everything else falls away around
 * it, which is the same bargain the fisheye already makes (kaderdocument §5).
 */

export interface ViewBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One is the whole wheel. Past four a ring fills the pane and stops helping. */
export const ZOOM_RANGE = { min: 1, max: 4 } as const;

/** How much one step of a keyboard or button zoom moves. */
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return ZOOM_RANGE.min;
	return Math.min(Math.max(zoom, ZOOM_RANGE.min), ZOOM_RANGE.max);
}

/**
 * The window onto the drawing at this zoom.
 *
 * `half` is half the width of the whole drawing; `anchorY` is the height that
 * holds still, negative being upwards towards the reading wedge. At zoom one
 * this is exactly the whole drawing, whatever the anchor — which is what makes
 * the anchor invisible until someone actually zooms.
 */
export function viewBoxFor(
	half: number,
	anchorY: number,
	zoom: number,
): ViewBox {
	const scale = clampZoom(zoom);
	const size = (half * 2) / scale;

	return {
		x: -half / scale,
		y: anchorY - (anchorY + half) / scale,
		width: size,
		height: size,
	};
}

export function viewBoxAttr(box: ViewBox): string {
	return `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`;
}

/** Where a point sits in the window, as a fraction from its top left corner. */
export function fractionOf(box: ViewBox, x: number, y: number): [number, number] {
	return [(x - box.x) / box.width, (y - box.y) / box.height];
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
