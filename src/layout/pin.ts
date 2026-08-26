import { angleDelta, containsAngle } from "./geometry";

/**
 * Holding the branch still while the wheel turns under it.
 *
 * BC_E3_S38 put the branch being read on one straight line, and that was only
 * half the calm. The other half is *time*: between two stops the whole drawing
 * turns rigidly, so the containers drifted along with the leaves and then
 * snapped back when the wheel settled and the branch was straightened again —
 * *"eerst een stukje mee en dan weer terug"* (eigenaar, 22 aug 2026). A branch
 * that swings out and returns still reads as a branch that moves.
 *
 * So a container is not drawn on the settled focus's angle but on **the angle
 * under the reading wedge right now**, for as long as that angle is inside its
 * own slice. Turning between leaves of the same branch keeps the whole trunk
 * exactly where it stands; the same holds a ring further in, so the wedge is
 * still while you turn anywhere inside it. Only when the wedge crosses into the
 * next branch — or the next wedge — does that container let go.
 *
 * Nothing here changes what a node *means*: the stops, their order and the
 * sweep all keep the slice they were given. This is where a container is drawn
 * inside a slice it keeps either way.
 */

/** What a container needs to say where it should be drawn. */
export interface PinSlice {
	startAngle: number;
	endAngle: number;
	/** The middle of the slice: where it rests when nothing is being read here. */
	angle: number;
	span: number;
}

/**
 * The smallest slide-back, in degrees.
 *
 * A slice narrower than this would otherwise snap home in a degree or two,
 * which is a jump however small the distance.
 */
const MIN_RELEASE = 6;

/**
 * How much of its own width a container slides home over.
 *
 * It began as the whole width, which reads beautifully and collides: at the
 * seam between two wedges the one you are leaving is still being held near
 * twelve o'clock while the one you are entering is held *at* twelve, and on the
 * innermost ring their two dots — nine units apart — sat on top of each other,
 * so a tap on one landed on the other (gemeten in het tekenharnas, 22 aug
 * 2026). Over a third of its width a container is out of its neighbour's way
 * within a few degrees of turning, at the price of sliding home at about two
 * and a half times the turn instead of one and a half.
 */
const RELEASE_SHARE = 0.35;

/**
 * Where to draw a container, given the angle under the reading wedge.
 *
 * Three regimes, and the seams between them line up exactly, so the answer is
 * continuous — no step, anywhere:
 *
 *  - **Inside its slice**: on the reading angle. On screen that is twelve
 *    o'clock, so the container does not move at all while you turn.
 *  - **Just outside**: sliding home. It starts at the edge it was last held on
 *    — which is where it already stood — and reaches its middle after a turn of
 *    its own width. Over its own width rather than a fixed distance, because
 *    that keeps the slide slower than one and a half times the turn itself: a
 *    container that shot home faster than the wheel would draw the eye, which
 *    is the thing this whole rule is trying to stop.
 *  - **Well outside**: in the middle of its slice, where it belongs, turning
 *    with everything else.
 */
export function pinnedAngle(slice: PinSlice, reading: number): number {
	if (containsAngle(slice.startAngle, slice.endAngle, reading)) return reading;

	const fromStart = angleDelta(reading, slice.startAngle);
	const fromEnd = angleDelta(reading, slice.endAngle);
	const away = Math.min(Math.abs(fromStart), Math.abs(fromEnd));

	const release = Math.max(slice.span * RELEASE_SHARE, MIN_RELEASE);
	if (away >= release) return slice.angle;

	const edge =
		Math.abs(fromStart) < Math.abs(fromEnd) ? slice.startAngle : slice.endAngle;
	return edge + (away / release) * angleDelta(edge, slice.angle);
}
