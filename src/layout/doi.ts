/**
 * Degree of interest: how much of the wheel each item is worth right now.
 *
 * Focus-plus-context in the tradition of Furnas 1986 and Card & Nation 2002.
 * The item under the reading wedge swells and shows more of what hangs off it;
 * everything else recedes without ever leaving (kaderdocument §5).
 *
 * Two separate falls-off, because two different things fade:
 *
 *  - **Emphasis** is angular. It multiplies a node's share of its parent's
 *    slice, so the neighbourhood of the focus opens up and its cousins close.
 *  - **Presence** is visual. It says how strongly a node is drawn, which is how
 *    the far side of the wheel becomes a silhouette rather than a blank.
 *
 * The split matters because emphasis only ever acts *within* a group of
 * siblings. A domain wedge is a fixed budget and does not move for anything
 * (kaderdocument §3.1), so a far-away domain cannot be squeezed: it keeps its
 * angle and recedes in presence instead. That is the whole reconciliation
 * between the fixed budgets and the fisheye.
 */

import type { WheelNode } from "../model/types";

export interface DoiOptions {
	/** Angular multiplier for the focused item itself. */
	peak: number;
	/** Floor the angular multiplier decays to. Never zero: nothing vanishes. */
	floor: number;
	/** Share of the remaining emphasis kept per step away from the focus. */
	falloff: number;
	/** How faint a node may become. The silhouette, not an absence. */
	presenceFloor: number;
	/** Share of the remaining presence kept per step away. */
	presenceFalloff: number;
	/** Extra rings the focused branch may use beyond the global limit. */
	depthBonus: number;
}

export const DEFAULT_DOI: DoiOptions = {
	peak: 5,
	floor: 0.18,
	falloff: 0.5,
	presenceFloor: 0.45,
	presenceFalloff: 0.78,
	depthBonus: 2,
};

export interface DoiField {
	focusId: string | null;
	/** Steps through the tree from the focus, per node id. */
	distance: ReadonlyMap<string, number>;
	/** Angular multiplier, per node id. Absent means one. */
	emphasis: ReadonlyMap<string, number>;
	/** How strongly to draw it, from one down to the presence floor. */
	presence: ReadonlyMap<string, number>;
	/** The focus and everything below it — the branch allowed the extra rings. */
	subtree: ReadonlySet<string>;
	/**
	 * The focus and everything above it, up to the hub.
	 *
	 * The line you are reading along: this task, the heading it sits under, the
	 * note that holds it. Drawn differently from the rest of the wheel because
	 * it is the one branch the reader is actually in (BC_E3_S27).
	 */
	path: ReadonlySet<string>;
}

/** No focus: everything at its natural weight and fully present. */
export const NO_DOI: DoiField = {
	focusId: null,
	distance: new Map(),
	emphasis: new Map(),
	presence: new Map(),
	subtree: new Set(),
	path: new Set(),
};

export function emphasisAt(
	distance: number,
	options: DoiOptions = DEFAULT_DOI,
): number {
	return options.floor + (options.peak - options.floor) * options.falloff ** distance;
}

export function presenceAt(
	distance: number,
	options: DoiOptions = DEFAULT_DOI,
): number {
	return (
		options.presenceFloor +
		(1 - options.presenceFloor) * options.presenceFalloff ** distance
	);
}

/**
 * Work out the field around one focus.
 *
 * Distance is measured through the tree in both directions — up to a shared
 * ancestor and back down — so a sibling of the focus is two steps away and a
 * child is one. That is what makes the fisheye follow the structure rather
 * than the drawing: the items that open up around the focus are the ones
 * actually related to it.
 */
export function doiField(
	root: WheelNode,
	focusId: string | null,
	options: DoiOptions = DEFAULT_DOI,
): DoiField {
	if (focusId === null) return NO_DOI;

	const { parents, byId } = indexOf(root);

	const focus = byId.get(focusId);
	if (focus === undefined) return NO_DOI;

	const distance = new Map<string, number>();
	const emphasis = new Map<string, number>();
	const presence = new Map<string, number>();

	// Plain breadth-first over the tree read as undirected, so the first time a
	// node is reached is by its shortest route.
	const queue: Array<{ node: WheelNode; steps: number }> = [
		{ node: focus, steps: 0 },
	];

	// Walked with a moving read position rather than `shift()`: taking the front
	// off an array copies the rest of it, which turned a walk over the tree into
	// one that costs the square of its size — six thousand nodes is nineteen
	// million element moves for nothing (audit, 23 aug 2026).
	for (let at = 0; at < queue.length; at++) {
		const { node, steps } = queue[at];
		if (distance.has(node.id)) continue;

		distance.set(node.id, steps);
		emphasis.set(node.id, emphasisAt(steps, options));
		presence.set(node.id, presenceAt(steps, options));

		const parent = parents.get(node.id);
		if (parent !== undefined && !distance.has(parent.id)) {
			queue.push({ node: parent, steps: steps + 1 });
		}
		for (const child of node.children) {
			if (!distance.has(child.id)) queue.push({ node: child, steps: steps + 1 });
		}
	}

	return {
		focusId,
		distance,
		emphasis,
		presence,
		subtree: collect(focus, new Set()),
		path: upwards(focus, parents),
	};
}

/**
 * The tree's shape, kept per tree.
 *
 * Every focus asks the same two questions about the same tree — who is whose
 * parent, and which node is which id — and the answers were worked out again
 * on every stop. A `WeakMap` on the root: a scan builds a fresh tree, so there
 * is nothing stale to invalidate and the old entry goes when the old tree does.
 */
const shapeByRoot = new WeakMap<
	WheelNode,
	{ parents: Map<string, WheelNode>; byId: Map<string, WheelNode> }
>();

function indexOf(root: WheelNode): {
	parents: Map<string, WheelNode>;
	byId: Map<string, WheelNode>;
} {
	const already = shapeByRoot.get(root);
	if (already !== undefined) return already;

	const shape = {
		parents: new Map<string, WheelNode>(),
		byId: new Map<string, WheelNode>(),
	};
	index(root, null, shape.parents, shape.byId);
	shapeByRoot.set(root, shape);
	return shape;
}

/** The focus and every node above it, up to but not including the root. */
function upwards(
	focus: WheelNode,
	parents: ReadonlyMap<string, WheelNode>,
): Set<string> {
	const path = new Set<string>([focus.id]);
	let current = parents.get(focus.id);
	while (current !== undefined) {
		path.add(current.id);
		current = parents.get(current.id);
	}
	return path;
}

function index(
	node: WheelNode,
	parent: WheelNode | null,
	parents: Map<string, WheelNode>,
	byId: Map<string, WheelNode>,
): void {
	byId.set(node.id, node);
	if (parent !== null) parents.set(node.id, parent);
	for (const child of node.children) index(child, node, parents, byId);
}

function collect(node: WheelNode, into: Set<string>): Set<string> {
	into.add(node.id);
	for (const child of node.children) collect(child, into);
	return into;
}
