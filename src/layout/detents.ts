/**
 * Detents: the positions the wheel is allowed to stop in.
 *
 * The design asks for click stops rather than free spinning, and the reason is
 * not tactile pleasure — it is bookkeeping. "I have been all the way round" is
 * only a checkable fact if the wheel has a countable number of positions and
 * always comes to rest in one of them (kaderdocument §5).
 *
 * One detent per visible item. The **rotation** of a detent is the angle the
 * disc has to be turned to bring that item under the reading wedge at twelve
 * o'clock: an item drawn at angle θ shows up at θ + rotation, so the rotation
 * that puts it at zero is −θ.
 *
 * They are ordered **by angle, not by the tree walk**. A parent sits at the
 * midpoint of its children, so stepping in tree order would run backwards and
 * forwards across the wedge. Ordering by angle makes one step of the wheel one
 * step in the drawing, which is the only ordering a turning motion can honour.
 */

import { isRoundItem, type NodeKind } from "../model/types";
import { angleDelta, normaliseAngle } from "./geometry";
import type { WheelLayout } from "./radial";

export interface Detent {
	/** Position in the turn order. */
	index: number;
	id: string;
	kind: NodeKind;
	depth: number;
	/** Where the item sits on the unturned wheel. */
	angle: number;
	/** The stop this one hangs off, or null at the first ring. */
	parentId: string | null;
	/** Rotation that brings it under the reading wedge, in [0, 360). */
	rotation: number;
	/**
	 * Whether **turning** may come to rest here.
	 *
	 * True for the round's items and for stumps; false for the headings, notes
	 * and folders that merely hold them. Turning used to stop on all of them,
	 * which put the reader on a heading two times in five — "waar niets te doen
	 * is", as the measurement for the action-landing rule had already put it
	 * (kaderdocument §5). The same argument, so now the same answer
	 * (BC_E3_S67).
	 *
	 * A stump is a stop for exactly the reason a heading is not: there *is*
	 * something to do — it holds work nobody has seen, and turning into it is
	 * how that work is reached. Without it a round on a vault bigger than the
	 * drawing could never be closed by turning at all.
	 *
	 * The arrows, a tap and the card's side arrows keep every detent: a ring
	 * holds containers, and walking a ring is how you reach one to fold it.
	 */
	turnStop: boolean;
}

/** One stop per visible node, in turn order. */
export function buildDetents(layout: WheelLayout): Detent[] {
	const visible = layout.nodes.filter((laid) => laid.depth > 0);

	const sorted = [...visible].sort(
		(a, b) => a.angle - b.angle || a.depth - b.depth || compare(a.id, b.id),
	);

	return sorted.map((laid, index) => ({
		index,
		id: laid.id,
		kind: laid.node.kind,
		depth: laid.depth,
		angle: laid.angle,
		parentId: laid.parentId,
		rotation: normaliseAngle(-laid.angle),
		turnStop:
			isRoundItem(laid.node, layout.showsFinished) ||
			laid.collapsed ||
			laid.hiddenCount > 0,
	}));
}

/**
 * The stops turning is allowed to rest on, in turn order.
 *
 * Falls back to every detent when nothing qualifies — a wheel that could not
 * be turned at all would be a worse answer than one that stops on a heading.
 */
export function turnStops(detents: readonly Detent[]): Detent[] {
	const stops = detents.filter((detent) => detent.turnStop);
	return stops.length > 0 ? stops : [...detents];
}

/** Step to the next stop turning may rest on, wrapping round the circle. */
export function stepTurnStop(
	detents: readonly Detent[],
	index: number,
	delta: number,
): number {
	const stops = turnStops(detents);
	if (stops.length === 0) return index;

	const here = detents[index];
	// Where the reader stands may itself be a container — the arrows can put
	// them there. Then "the next one" is measured from the nearest turn stop
	// in the direction of travel, not from a place that is not in the walk.
	const at = here === undefined ? -1 : stops.findIndex((s) => s.id === here.id);
	if (at >= 0) {
		const next = stops[(((at + delta) % stops.length) + stops.length) % stops.length];
		return next.index;
	}

	return nearestTurnStop(detents, here?.rotation ?? 0)?.index ?? index;
}

/** The stop turning would settle on for this rotation. */
export function nearestTurnStop(
	detents: readonly Detent[],
	rotation: number,
): Detent | null {
	return detentAt(turnStops(detents), rotation);
}

/**
 * The detent a given rotation is nearest to.
 *
 * Ties go to the deeper item. Two nodes share an angle exactly when one is the
 * only child of the other, and in that pair the child is the thing being
 * reviewed — the parent is reachable with the arrow keys either way.
 */
export function detentAt(
	detents: readonly Detent[],
	rotation: number,
): Detent | null {
	let best: Detent | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const detent of detents) {
		const distance = Math.abs(angleDelta(rotation, detent.rotation));
		if (distance < bestDistance - EPSILON) {
			best = detent;
			bestDistance = distance;
			continue;
		}
		if (
			best !== null &&
			distance < bestDistance + EPSILON &&
			detent.depth > best.depth
		) {
			best = detent;
		}
	}

	return best;
}

/** Step through the ring of detents, wrapping at either end. */
export function stepIndex(
	detents: readonly Detent[],
	index: number,
	delta: number,
): number {
	if (detents.length === 0) return 0;
	const length = detents.length;
	return (((index + delta) % length) + length) % length;
}

/**
 * The next stop sideways on the same ring of the **drawing**, wrapping round.
 *
 * The fallback, and only that. What sideways actually means is a question about
 * the *tree* — `layout/order.ts`'s `sidewaysFrom` — because the ring the reader
 * is on is only partly drawn: the fisheye gives the branch under the reading
 * wedge extra rings, so on those rings this sees a ring of one and rightly
 * refuses to move. The view answers the arrows from the tree and falls back to
 * here when it has no tree to answer from (BC_E3_S93).
 *
 * A crossing rule lived here for a day (BC_E3_S88) and was wrong: it read the
 * neighbour off the drawing, where the neighbour is drawn shallower, so the
 * step changed the reader's ring — and a step that changes ring has no way
 * back, because the way back is computed from a different drawing.
 */
export function alongRing(
	detents: readonly Detent[],
	index: number,
	delta: number,
): number {
	const here = detents[index];
	if (here === undefined) return index;

	// Detents are already in angle order, so the ring is in angle order too.
	const ring = detents.filter((detent) => detent.depth === here.depth);
	if (ring.length <= 1) return index;

	const at = ring.findIndex((detent) => detent.id === here.id);
	const next = ring[(((at + delta) % ring.length) + ring.length) % ring.length];
	return detents.findIndex((detent) => detent.id === next.id);
}

/**
 * One ring outwards, to a child — or inwards, to the parent.
 *
 * Returns the index unchanged when there is nowhere to go: the outermost item
 * has no children drawn, and the first ring hangs off the hub, which is not a
 * stop. Refusing quietly is right here; a wrap-around would move the reader
 * somewhere they did not ask for.
 */
export function acrossRings(
	detents: readonly Detent[],
	index: number,
	outward: boolean,
): number {
	const here = detents[index];
	if (here === undefined) return index;

	if (!outward) {
		const parent = indexOfId(detents, here.parentId);
		return parent >= 0 ? parent : index;
	}

	// The first child in angle order, which is the one nearest the parent's own
	// angle in a layout that centres a parent over its children.
	const child = detents.findIndex((detent) => detent.parentId === here.id);
	return child >= 0 ? child : index;
}

export function indexOfId(
	detents: readonly Detent[],
	id: string | null,
): number {
	if (id === null) return -1;
	return detents.findIndex((detent) => detent.id === id);
}

/**
 * A rotation that reaches `to` from `from` the short way round.
 *
 * Returned unwrapped rather than in [0, 360): an animation has to travel from
 * one number to another, and 359 → 1 must be a two-degree move, not a
 * three-hundred-and-fifty-eight-degree one.
 */
export function approach(from: number, to: number): number {
	return from + angleDelta(from, to);
}

/** Angles closer together than this are the same angle as far as we care. */
const EPSILON = 1e-6;

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
