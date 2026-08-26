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
