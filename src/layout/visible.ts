/**
 * The visibility budget: how much of the vault the wheel is allowed to draw.
 *
 * Hard requirement 6 (kaderdocument §3, added in the revision of 13 aug 2026).
 * Without it the drawing scales with the vault, and that stops working far
 * earlier than anyone expects — at five thousand tasks a single task is 0.035°
 * wide, thirty of them share the space of one tick mark, and a full round is
 * 5393 click stops. Measurements in §8.
 *
 * So the wheel draws a bounded number of items and the degree of interest
 * decides which. Everything left out stays on the wheel as a counter on the
 * branch it belongs to, exactly as a hand-folded branch does: nothing
 * disappears, it is summarised (§3.3). A review round becomes a drill-down —
 * past the counters, opening what you want to see — instead of a flat walk
 * past every task in the vault.
 *
 * Four things bound what a branch may show, and the smallest one wins:
 *
 *  1. **What its ring can hold.** Ring two is 452 units round; a dot is eight
 *     across. The cap comes from the circumference, not from a number someone
 *     picked.
 *  2. **What its wedge owns of that ring.** A domain with an eighth of the
 *     circle gets an eighth of every ring. Without this the first domains
 *     alphabetically eat the whole ring and half the wheel is bare — which is
 *     exactly what the first version did.
 *  3. **The total budget**, as a ceiling on the drawing as a whole.
 *  4. **A readable fan-out.** Ninety siblings are a smear however much room
 *     the arithmetic says there is.
 *
 * A branch that cannot show all its children shows the first few and counts
 * the rest. Partial opening is what makes the fairness in rule 2 possible at
 * all: all-or-nothing expansion would leave a domain with nineteen projects
 * showing nothing, because nineteen does not fit in eight.
 *
 * Two things override all four. The **domain ring** is always drawn whole — it
 * is the map. And the **path to the focus** opens whatever it costs, down to
 * every child of the item under the reading wedge: that is the "shows its
 * deeper rings" half of the fisheye, and it is what keeps everything reachable
 * by turning to it.
 */

import type { WheelNode } from "../model/types";
import type { DoiField } from "./doi";
import { ringRadius, type RingConfig } from "./geometry";

/** Sensible middle for a sidebar-width wheel. The setting names three. */
export const DEFAULT_VISIBLE_BUDGET = 240;

/**
 * Room one item needs along its ring, in the same units as the radii.
 *
 * A dot is eight units across. Seven gives dots that touch at worst and ticks
 * that stay apart, which is the point where a ring stops being a row of items
 * and becomes a smear.
 */
const MIN_SPACING = 7;

/** How many siblings a branch may open by itself before it is unreadable. */
const AMBIENT_FANOUT = 24;

export interface VisibleOptions {
	/** Ceiling on how many items the wheel draws. */
	budget: number;
	/** Ring radii, so each ring's own capacity can be worked out. */
	rings: RingConfig;
	/** Share of the circle each domain owns, keyed by domain. */
	share: ReadonlyMap<string, number>;
}

export interface Visible {
	/** Ids whose children are drawn, in whole or in part. */
	expanded: ReadonlySet<string>;
	/**
	 * How many children each opened node draws, in wedge order.
	 *
	 * The first `n` rather than a chosen `n`: the order inside a wedge is
	 * stable and reproducible (§3.2), and picking by size would reshuffle the
	 * wheel every time a task was ticked off.
	 */
	shown: ReadonlyMap<string, number>;
	/** How many nodes this selection draws, the hub excluded. */
	drawn: number;
	/** True when something was left to a counter rather than drawn. */
	truncated: boolean;
}

/**
 * Choose what the wheel shows.
 *
 * The result is always a connected subtree from the root down: a node is only
 * considered once its parent is drawn, so there is never a child on the wheel
 * whose branch was left out.
 */
export function selectVisible(
	root: WheelNode,
	field: DoiField,
	options: VisibleOptions,
): Visible {
	const { budget, rings, share } = options;

	const parents = parentMap(root);
	const ordered = orderedChildrenMap(root);
	const expanded = new Set<string>();
	const shown = new Map<string, number>();
	const used = new Map<string, number>();

	let drawn = 0;
	let truncated = false;

	const open = (node: WheelNode, count: number): void => {
		expanded.add(node.id);
		shown.set(node.id, count);
		drawn += count;
		const slot = ringSlot(node.depth + 1, node.domain);
		used.set(slot, (used.get(slot) ?? 0) + count);
	};

	// The domain ring is the map, and a map with a fold in it is no map.
	open(root, root.children.length);

	// Then the way to what you are looking at, whatever it costs.
	for (const node of pathToFocus(root, parents, field.focusId)) {
		if (expanded.has(node.id) || node.children.length === 0) continue;
		open(node, node.children.length);
	}

	for (const node of candidates(root, field)) {
		if (expanded.has(node.id) || node.children.length === 0) continue;

		const parent = parents.get(node.id);
		if (parent === undefined || !isDrawn(node, parent, shown, ordered)) {
			continue;
		}

		const ring = node.depth + 1;
		const slot = ringSlot(ring, node.domain);
		const ringRoom =
			Math.floor(capacityAt(ring, rings) * (share.get(node.domain) ?? 1)) -
			(used.get(slot) ?? 0);

		const room = Math.min(ringRoom, budget - drawn, AMBIENT_FANOUT);
		if (room < 1) {
			truncated = true;
			continue;
		}

		const take = Math.min(node.children.length, room);
		if (take < node.children.length) truncated = true;
		open(node, take);
	}

	return { expanded, shown, drawn, truncated };
}

/** How many items fit side by side on a ring before it becomes a smear. */
export function capacityAt(depth: number, rings: RingConfig): number {
	const radius = ringRadius(depth, rings);
	if (radius <= 0) return Number.MAX_SAFE_INTEGER;
	return Math.max(4, Math.floor((2 * Math.PI * radius) / MIN_SPACING));
}

/**
 * Whether a node made the cut among its own siblings.
 *
 * A partly opened parent draws its first few children; the ones past that are
 * counted, not drawn, so they cannot open anything themselves.
 */
function isDrawn(
	node: WheelNode,
	parent: WheelNode,
	shown: ReadonlyMap<string, number>,
	ordered: Map<string, WheelNode[]>,
): boolean {
	const limit = shown.get(parent.id);
	if (limit === undefined) return false;

	const siblings = ordered.get(parent.id) ?? [];
	return siblings.findIndex((child) => child.id === node.id) < limit;
}

function ringSlot(ring: number, domain: string): string {
	return `${ring}${domain}`;
}

/** Everything below the root, shallowest first and nearest the focus first. */
function candidates(root: WheelNode, field: DoiField): WheelNode[] {
	const all: WheelNode[] = [];
	collect(root, all);

	return all.sort(
		(a, b) =>
			a.depth - b.depth ||
			distanceOf(a, field) - distanceOf(b, field) ||
			compare(a.sortKey, b.sortKey) ||
			compare(a.id, b.id),
	);
}

/**
 * Without a focus every node is equally far away, which leaves depth and the
 * structural key to order by — a plain breadth-first fill. That is the right
 * answer for a wheel nobody is looking at yet.
 */
function distanceOf(node: WheelNode, field: DoiField): number {
	return field.distance.get(node.id) ?? Number.MAX_SAFE_INTEGER;
}

/** The root, the focus and everything between them. */
function pathToFocus(
	root: WheelNode,
	parents: Map<string, WheelNode>,
	focusId: string | null,
): WheelNode[] {
	if (focusId === null) return [];

	const byId = new Map<string, WheelNode>([[root.id, root]]);
	collect(root, [], byId);

	let current = byId.get(focusId);
	if (current === undefined) return [];

	const path: WheelNode[] = [];
	while (current !== undefined) {
		path.unshift(current);
		current = parents.get(current.id);
	}
	return path;
}

/**
 * The two walks below, kept per tree.
 *
 * Both answer questions about the *shape* of the tree and nothing about where
 * the reader is, yet they were rebuilt on every call — and there are two calls
 * per settle, one for the drawing and one for the focus-independent angles. On
 * a vault of five thousand tasks that is four full walks plus a sort per node,
 * every time the wheel comes to rest (audit, 23 aug 2026).
 *
 * Keyed on the root node in a `WeakMap`: a scan builds a fresh tree, so a new
 * tree simply has no entry, and the old one is collected along with its maps.
 * Safe because nothing edits a tree after `buildTree` has handed it over —
 * every change to the vault comes back as a new tree.
 */
const parentsByRoot = new WeakMap<WheelNode, Map<string, WheelNode>>();
const orderedByRoot = new WeakMap<WheelNode, Map<string, WheelNode[]>>();

function parentMap(root: WheelNode): Map<string, WheelNode> {
	const already = parentsByRoot.get(root);
	if (already !== undefined) return already;

	const built = buildParentMap(root);
	parentsByRoot.set(root, built);
	return built;
}

function buildParentMap(root: WheelNode): Map<string, WheelNode> {
	const parents = new Map<string, WheelNode>();
	const walk = (node: WheelNode): void => {
		for (const child of node.children) {
			parents.set(child.id, node);
			walk(child);
		}
	};
	walk(root);
	return parents;
}

/** Children per node in wedge order, worked out once rather than per lookup. */
function orderedChildrenMap(root: WheelNode): Map<string, WheelNode[]> {
	const already = orderedByRoot.get(root);
	if (already !== undefined) return already;

	const built = buildOrderedChildrenMap(root);
	orderedByRoot.set(root, built);
	return built;
}

function buildOrderedChildrenMap(root: WheelNode): Map<string, WheelNode[]> {
	const map = new Map<string, WheelNode[]>();
	const walk = (node: WheelNode): void => {
		map.set(
			node.id,
			[...node.children].sort(
				(a, b) => compare(a.sortKey, b.sortKey) || compare(a.id, b.id),
			),
		);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return map;
}

/** Every node below `root`, in no particular order. */
function collect(
	root: WheelNode,
	into: WheelNode[],
	byId?: Map<string, WheelNode>,
): void {
	for (const child of root.children) {
		into.push(child);
		byId?.set(child.id, child);
		collect(child, into, byId);
	}
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
