/**
 * Ordering inside a wedge — the second hard design requirement.
 *
 * The sequence is derived from the node's own structural key (`sortKey`, which
 * the parser builds from path and document position) with the id as a
 * tiebreaker. It is therefore:
 *
 *  - **reproducible** — the same vault yields the same sequence, whatever
 *    order the notes were handed to the parser in;
 *  - **stable under edits** — adding or removing a task changes nothing about
 *    where the *other* tasks fall relative to each other, because no other
 *    node's key depends on it (kaderdocument §3.2).
 *
 * The parser already sorts; sorting again here is deliberate. It makes the
 * layout's guarantee its own rather than something it inherits and hopes for,
 * and it costs nothing on a tree of this size.
 */

import type { WheelNode } from "../model/types";

/** A node's children in wedge order. */
export function orderedChildren(node: WheelNode): WheelNode[] {
	return [...node.children].sort(byStructuralKey);
}

/**
 * Depth-first walk in wedge order: the sequence a turn steps through.
 *
 * Parents come before their children, which is what makes one detent per item
 * a coherent notion — you meet a project, then the tasks inside it.
 */
export function wedgeOrder(node: WheelNode, out: WheelNode[] = []): WheelNode[] {
	for (const child of orderedChildren(node)) {
		out.push(child);
		wedgeOrder(child, out);
	}
	return out;
}

/** Only the tasks, in the same order. */
export function taskOrder(node: WheelNode): WheelNode[] {
	return wedgeOrder(node).filter((child) => child.kind === "task");
}

/**
 * The same walk, children before their parents.
 *
 * Where `wedgeOrder` meets a project and then the tasks inside it, this meets
 * the deepest subtask first and the task it hangs under last. That is the order
 * work is actually finished in: a task with subtasks is not done until they
 * are, so landing on it before them would be landing on something that cannot
 * yet be answered (owner, 20 aug 2026).
 */
export function deepestFirst(node: WheelNode, out: WheelNode[] = []): WheelNode[] {
	for (const child of orderedChildren(node)) {
		deepestFirst(child, out);
		out.push(child);
	}
	return out;
}

/**
 * The task an action sends the reader to next.
 *
 * Deepest first, and only tasks: a heading is not somewhere to be *put* by an
 * action you took on a task. Every task is in the walk exactly once, so nothing
 * can be stepped over — which is the whole requirement (owner, 20 aug 2026:
 * "je mag nooit een volgende tak overslaan").
 *
 * Wraps round at the end, and answers `null` when there is nowhere else to go:
 * an id the tree does not hold, or a round with one task in it. Both mean "stay
 * where you are", and saying that as an id would send the wheel to an item that
 * may not be there any more.
 */
export function taskAfter(root: WheelNode, id: string | null): string | null {
	if (id === null) return null;

	const tasks = deepestFirst(root).filter((node) => node.kind === "task");
	if (tasks.length < 2) return null;

	const at = tasks.findIndex((task) => task.id === id);
	if (at < 0) return null;

	return tasks[(at + 1) % tasks.length].id;
}

/** Position of every node in the walk, for comparing two scans. */
export function orderIndex(node: WheelNode): Map<string, number> {
	const index = new Map<string, number>();
	wedgeOrder(node).forEach((child, position) => index.set(child.id, position));
	return index;
}

function byStructuralKey(a: WheelNode, b: WheelNode): number {
	return compare(a.sortKey, b.sortKey) || compare(a.id, b.id);
}

/**
 * Plain code-unit comparison, matching the parser.
 *
 * `localeCompare` depends on the host's ICU data, which differs between a
 * desktop Electron build, a mobile WebView and the test runner — and a wedge
 * that orders itself differently per device is not a stable wedge.
 */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every node in the order the wheel puts them round the circle — **drawn or
 * not** (BC_E3_S93, BC_E3_S94).
 *
 * The one order both sideways moves are cut from, which is why they can never
 * disagree about which way is forwards. `domains` is the wedge order the layout
 * dealt (`WheelLayout.budgets`), which a round freezes and which therefore need
 * not match the tree's own child order (BC_E3_S82); everything below the first
 * ring is in structural order, which is angular order.
 *
 * Taken from the tree rather than from the drawing because the drawing holds
 * only part of it: the fisheye gives the branch under the reading wedge extra
 * rings, so on those rings nothing else is drawn at all. A step read off the
 * drawing changed the reader's depth and had no way back (eigenaar, 1 sep 2026).
 */
export function wheelOrder(
	root: WheelNode,
	domains: readonly string[],
): WheelNode[] {
	const rank = (node: WheelNode): number => {
		const at = domains.indexOf(node.domain);
		return at < 0 ? domains.length : at;
	};

	const wedges = [...root.children].sort(
		(a, b) => rank(a) - rank(b) || byStructuralKey(a, b),
	);

	const out: WheelNode[] = [];
	for (const wedge of wedges) {
		out.push(wedge);
		out.push(...wedgeOrder(wedge));
	}
	return out;
}

/** That order, narrowed to one ring. */
export function ringOrder(
	root: WheelNode,
	depth: number,
	domains: readonly string[],
): WheelNode[] {
	return wheelOrder(root, domains).filter((node) => node.depth === depth);
}

/** That order, narrowed to the work — every task, wherever it hangs. */
export function taskRing(
	root: WheelNode,
	domains: readonly string[],
): WheelNode[] {
	return wheelOrder(root, domains).filter((node) => node.kind === "task");
}

/**
 * One step sideways from `id`, along a ring of the reader's choosing.
 *
 * Two rings are on offer, and the difference only shows deep in a tree
 * (BC_E3_S94):
 *
 *  - **`"tasks"`** — every task on the wheel, in wheel order. Nothing is ever
 *    skipped and no branch is a dead end, which is what a reader walking their
 *    work wants. The default.
 *  - **`"ring"`** — only the items at the reader's own depth. Keeps the eye at
 *    one radius, which is the move for comparing across branches — but a depth
 *    that exists in one branch only is a ring of that branch alone, and then
 *    this walks in a small circle. Measured on a vault where one branch ran to
 *    six rings and nothing else did: a ring of three, walked round and round
 *    (eigenaar, 1 sep 2026).
 *
 * Standing somewhere that is not on the chosen ring — a heading, when walking
 * tasks — the step is measured from the reader's place in the wheel order, so
 * "the next one" still means the next one *after where you are*.
 *
 * Answers `null` when there is nowhere to go: an empty ring, or a ring holding
 * nothing but the reader.
 */
export type SidewaysAlong = "tasks" | "ring";

export function sidewaysFrom(
	root: WheelNode,
	domains: readonly string[],
	id: string,
	delta: number,
	along: SidewaysAlong = "ring",
): string | null {
	const order = wheelOrder(root, domains);
	const here = order.findIndex((node) => node.id === id);
	if (here < 0) return null;

	const ring =
		along === "tasks"
			? order.filter((node) => node.kind === "task")
			: order.filter((node) => node.depth === order[here].depth);
	if (ring.length === 0) return null;

	const at = ring.findIndex((node) => node.id === id);
	if (at >= 0) {
		if (ring.length <= 1) return null;
		const next = ring[(((at + delta) % ring.length) + ring.length) % ring.length];
		return next.id;
	}

	// Not on this ring at all: step to the nearest member in the direction of
	// travel, so the walk carries on from where the reader stands rather than
	// from wherever they last were on it.
	const seek = delta >= 0 ? ring.find((node) => order.indexOf(node) > here) : null;
	if (seek !== undefined && seek !== null) return seek.id;

	if (delta < 0) {
		const before = ring.filter((node) => order.indexOf(node) < here);
		if (before.length > 0) return before[before.length - 1].id;
		return ring[ring.length - 1].id;
	}
	return ring[0].id;
}
