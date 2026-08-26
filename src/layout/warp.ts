import { angleDelta, normaliseAngle } from "./geometry";

/**
 * The magnifying glass over the reading wedge.
 *
 * Until now the fisheye was anchored to the **settled focus**: the angles were
 * allocated with the focused branch swollen, so every time the wheel came to
 * rest on a different item the whole drawing was re-divided. You saw the wheel
 * turn towards the next task and then shuffle back — *"heen en weer"* (eigenaar,
 * 22 aug 2026, drie keer gemeld). Every attempt to calm it down ran into the
 * same wall: the anchor moves in jumps, so the drawing jumps with it.
 *
 * So the anchor moves to where the reading actually happens: **twelve o'clock**.
 * Angles are handed out once, structurally, and never change while the tree does
 * not; what changes is where they are *drawn*, through a magnifier centred on
 * the reading wedge and carried along by the turn. Items swell as they arrive
 * under the wedge and shrink as they leave, continuously, at the speed of your
 * own turning. Nothing is re-divided, so nothing can shuffle.
 *
 * Three properties make it safe to draw through:
 *
 *  - **It holds the reading angle still.** Whatever is under the wedge stays
 *    under the wedge, so the drawing and the stops can never disagree about
 *    what you are looking at.
 *  - **It is order-preserving.** Two items never swap places, and a branch
 *    never turns inside out.
 *  - **It is the identity outside its window.** The far side of the wheel is
 *    drawn exactly where its angles say, so turning moves it and nothing else
 *    does — and the drawing only has to be re-placed within the window.
 */

export interface WarpOptions {
	/** How far either side of the reading wedge the magnifier reaches. */
	window: number;
	/**
	 * How hard it magnifies, per pass.
	 *
	 * The window keeps its own width — what is stretched in the middle is
	 * squeezed at the edges — so this cannot be turned up without limit: past
	 * about 1,5 the squeeze would run backwards and two items would swap places.
	 */
	strength: number;
	/**
	 * How often to apply it.
	 *
	 * Magnification compounds where strength cannot: two passes of 2,4× make
	 * 5,8× under the wedge, and a composition of order-preserving maps is
	 * order-preserving, so the guarantee survives.
	 */
	passes: number;
}

export const DEFAULT_WARP: WarpOptions = {
	window: 90,
	strength: 1.4,
	passes: 2,
};

/** No magnifier at all: the drawing is exactly where the angles say. */
export const NO_WARP: WarpOptions = { window: 90, strength: 0, passes: 1 };

/**
 * How far the drawing is pushed at an offset of `u` window-widths.
 *
 * `u(1 − u²)³`, which is where the three properties come from: it is zero at
 * the middle (the reading angle stays put) and zero with a flat tangent at
 * ±1 (the window's edges stay put, and the drawing does not kink there). Its
 * derivative — the local magnification — is `1 − 9u² + 15u⁴ − 7u⁶`, which is 1
 * in the middle and dips to about −0,65 at two thirds out: that dip is the
 * squeeze that pays for the stretch, and it is what caps the strength.
 */
function push(u: number): number {
	const square = u * u;
	return u * (1 - square) ** 3;
}

/** One pass of the magnifier over an offset from the reading angle. */
function once(offset: number, options: WarpOptions): number {
	const { window: reach, strength } = options;
	if (reach <= 0 || strength === 0) return offset;
	if (Math.abs(offset) >= reach) return offset;

	return offset + strength * reach * push(offset / reach);
}

/**
 * Where an angle is drawn, given what is under the reading wedge.
 *
 * Both in degrees clockwise from twelve; the answer is normalised the same way.
 */
export function warpAngle(
	angle: number,
	reading: number,
	options: WarpOptions = DEFAULT_WARP,
): number {
	let offset = angleDelta(reading, angle);
	for (let pass = 0; pass < options.passes; pass += 1) {
		offset = once(offset, options);
	}
	return normaliseAngle(reading + offset);
}

/**
 * Whether an angle is close enough to the wedge for the magnifier to touch it.
 *
 * The drawing outside the window never has to be re-placed, which is what keeps
 * a turn cheap: on a busy wheel that is a few dozen items instead of hundreds.
 */
export function withinWarp(
	angle: number,
	reading: number,
	options: WarpOptions = DEFAULT_WARP,
): boolean {
	return Math.abs(angleDelta(reading, angle)) < options.window;
}

/**
 * How much magnification this wheel actually needs.
 *
 * A magnifier with one setting is wrong twice over: on a vault of five thousand
 * tasks an item is a tenth of a degree and needs all the help it can get, while
 * on a wheel of twenty the items already stand twelve degrees apart and blowing
 * them further apart under the wedge would be its own kind of restlessness.
 *
 * So the strength comes from the drawing: how wide the items are that the wheel
 * is actually showing, against how wide one wants to be to be readable. A wheel
 * with room to spare is not magnified at all — the drawing simply *is* its
 * angles, which is the calmest thing it can be.
 *
 * Worked out once per layout, not per turn: it is a property of what is on the
 * wheel, and a magnifier whose strength changed as you turned would be the
 * shuffling all over again.
 */
export function warpFor(
	/** The angular width of everything the wheel draws. */
	spans: readonly number[],
	options: WarpOptions = DEFAULT_WARP,
): WarpOptions {
	const drawn = spans.filter((span) => span > 0).sort((a, b) => a - b);
	if (drawn.length === 0) return { ...options, strength: 0 };

	const typical = drawn[Math.floor(drawn.length / 2)];
	if (typical >= READABLE) return { ...options, strength: 0 };

	// Split over the passes, because that is how they compound.
	const wanted = READABLE / typical;
	const perPass = wanted ** (1 / options.passes) - 1;
	return { ...options, strength: Math.min(perPass, options.strength) };
}

/**
 * How wide an item wants to be under the reading wedge, in degrees.
 *
 * Above `labelSpan` with room around it: this is the width at which an item
 * stops being a mark on a ring and becomes something you can read.
 */
const READABLE = 9;
