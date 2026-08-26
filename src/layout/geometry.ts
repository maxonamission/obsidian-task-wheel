/**
 * The wheel's arithmetic: angles, radii and the paths between them.
 *
 * Angles are **degrees, zero at twelve o'clock, growing clockwise** — the same
 * convention the reading wedge uses, so a number from this module can be
 * compared with the wedge position without a mental conversion. Screen
 * coordinates follow SVG: x to the right, y downwards, origin at the hub.
 *
 * Nothing here knows about the DOM, Obsidian or d3. The build brief allows
 * `d3-shape` for the branch paths, but a radial link is one arc followed by
 * one line — a handful of numbers. Writing it out keeps the plugin free of a
 * runtime dependency and keeps the paths inspectable in a test.
 */

export const FULL_CIRCLE = 360;

export interface Point {
	x: number;
	y: number;
}

/** Ring radii by depth, with a step for the rings past the table. */
export interface RingConfig {
	/** Radius per depth, innermost first. Index 0 is the hub, at zero. */
	radii: number[];
	/** Added per extra ring once the table runs out. */
	step: number;
}

export function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/** Where a node at this radius and angle lands on the canvas. */
export function pointAt(radius: number, degrees: number): Point {
	const radians = toRadians(degrees);
	return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) };
}

/** The same angle expressed in [0, 360). */
export function normaliseAngle(degrees: number): number {
	const wrapped = degrees % FULL_CIRCLE;
	return wrapped < 0 ? wrapped + FULL_CIRCLE : wrapped;
}

/** Signed shortest way from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
	const raw = normaliseAngle(to - from);
	return raw > 180 ? raw - FULL_CIRCLE : raw;
}

/** Whether `degrees` falls in the half-open span [start, start + width). */
export function containsAngle(
	startAngle: number,
	endAngle: number,
	degrees: number,
): boolean {
	const width = endAngle - startAngle;
	if (width <= 0) return false;
	if (width >= FULL_CIRCLE) return true;
	return normaliseAngle(degrees - startAngle) < width;
}

/** Radius of the ring a node at this depth sits on. */
export function ringRadius(depth: number, config: RingConfig): number {
	if (depth < config.radii.length) return config.radii[depth];
	const last = config.radii[config.radii.length - 1];
	return last + (depth - config.radii.length + 1) * config.step;
}

/** Outermost ring the config will ever draw, for a tree of this depth. */
export function outerRadius(maxDepth: number, config: RingConfig): number {
	return ringRadius(maxDepth, config);
}

/**
 * The branch from a parent to a child: along the parent's ring, then out.
 *
 * An arc-then-line rather than a bezier because it makes the ring structure
 * legible — you can see which ring a branch leaves from, which is the whole
 * point of a node-link tree over a sunburst (kaderdocument §4).
 */
export function branchPath(
	parentRadius: number,
	parentAngle: number,
	childRadius: number,
	childAngle: number,
): string {
	const from = pointAt(parentRadius, parentAngle);
	const to = pointAt(childRadius, childAngle);
	const sweep = childAngle > parentAngle ? 1 : 0;
	const delta = Math.abs(childAngle - parentAngle);

	if (delta < 1e-9 || parentRadius < 1e-9) {
		return `M${round(from.x)},${round(from.y)}L${round(to.x)},${round(to.y)}`;
	}

	const elbow = pointAt(parentRadius, childAngle);
	const largeArc = delta > 180 ? 1 : 0;
	return (
		`M${round(from.x)},${round(from.y)}` +
		`A${round(parentRadius)},${round(parentRadius)} 0 ${largeArc} ${sweep} ` +
		`${round(elbow.x)},${round(elbow.y)}` +
		`L${round(to.x)},${round(to.y)}`
	);
}

/** A bare arc at one radius, used for the wedge bands on the rim. */
export function arcPath(
	radius: number,
	startAngle: number,
	endAngle: number,
): string {
	const width = Math.min(endAngle - startAngle, FULL_CIRCLE - 0.001);
	const from = pointAt(radius, startAngle);
	const to = pointAt(radius, startAngle + width);
	const largeArc = width > 180 ? 1 : 0;
	return (
		`M${round(from.x)},${round(from.y)}` +
		`A${round(radius)},${round(radius)} 0 ${largeArc} 1 ${round(to.x)},${round(to.y)}`
	);
}

/** Three decimals is well under a pixel at any sensible canvas size. */
function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
