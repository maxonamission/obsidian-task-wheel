import type { WheelNode, WheelScope, WheelTree } from "./types";

/**
 * Where a wheel should come to rest when something opened it *on purpose*.
 *
 * A wheel that opens picks its stop from what that blikveld remembered — the
 * place the round was left. That is right when you are resuming: coming back
 * to the middle of a round and having to find your place by hand is what the
 * memory exists to prevent.
 *
 * It is wrong when the act of opening already said where to go, and two acts
 * do (eigenaar, 2 sep 2026):
 *
 *  - **Stepping out.** Backspace, the button in the corner and the command all
 *    walk the ladder — vault → folder → note → section — and the wider wheel
 *    contains everything the narrower one did. So the answer is not "the
 *    blikveld you left" but the plainer one: **stay on what you were reading**,
 *    now seen from further out. Landing on the branch that item hangs from
 *    instead is close enough to look deliberate and wrong enough to confuse
 *    (eigenaar, 2 sep 2026). The blikveld you left is the fallback, for when
 *    what you were reading has no place out here — standing on a wedge, say.
 *  - **Opening from the editor.** Your cursor is on a task and you open the
 *    wheel: you are pointing at something. Landing anywhere else answers a
 *    question you did not ask.
 *
 * Both are the same shape — *this is where I mean* — so they are one type and
 * one lookup, and both fall back to the remembered place when what they name
 * is not on the wheel. That fallback is not a failure case: a filter, a folded
 * branch or the visibility budget can all legitimately leave it out, and the
 * remembered place is exactly the right second choice.
 */
export type Landing =
	/** The blikveld just stepped out of: land on whatever stands for it here. */
	| { kind: "scope"; scope: WheelScope }
	/** A line in a note, as the editor's cursor names it. */
	| { kind: "line"; path: string; line: number };

/** Read a landing out of a leaf's stored state, if it holds one. */
export function readLanding(state: unknown): Landing | null {
	if (typeof state !== "object" || state === null) return null;

	const raw = (state as { landing?: unknown }).landing;
	if (typeof raw !== "object" || raw === null) return null;

	const kind = (raw as { kind?: unknown }).kind;
	if (kind === "line") {
		const { path, line } = raw as { path?: unknown; line?: unknown };
		if (typeof path !== "string" || typeof line !== "number") return null;
		return { kind: "line", path, line };
	}
	if (kind === "scope") {
		const scope = (raw as { scope?: unknown }).scope;
		if (typeof scope !== "object" || scope === null) return null;
		return { kind: "scope", scope: scope as WheelScope };
	}
	return null;
}

/** The node this landing names, or null when it is not on this wheel. */
export function landingId(tree: WheelTree, landing: Landing): string | null {
	return landing.kind === "line"
		? nodeAt(tree, landing.path, landing.line)
		: standsFor(tree, landing.scope);
}

function nodes(tree: WheelTree): WheelNode[] {
	return [...tree.byId.values()];
}

/**
 * Whatever sits on this line, or the task it has just walked past.
 *
 * Exact first, and on **any** kind of node: a task line names its task, a
 * heading line names that heading. That is what makes one lookup serve both
 * callers — a cursor points at a line, and a step out points at the line the
 * item you were reading came from (BC_E3_S109).
 *
 * Failing an exact hit, the last *task* at or above: a cursor three lines into
 * a task's notes, or on a blank line under it, still means that task. Never
 * anything *below* the line — that is guessing forward about something the
 * reader has not reached.
 */
function nodeAt(tree: WheelTree, path: string, line: number): string | null {
	let best: WheelNode | null = null;

	for (const node of nodes(tree)) {
		const source = node.source;
		if (source === undefined || source.path !== path) continue;

		// `raw === null` means the node is not really *on* that line: a note
		// ring carries `line: 0` to say "this document starts here", and the
		// bucket above the first heading does the same. Without this a cursor on
		// line 0 lands on the note instead of on the task that is actually
		// there — and every note has a line 0.
		if (source.line === line && source.raw !== null) return node.id;
		if (node.kind !== "task" || source.line > line) continue;
		if (best === null || source.line > (best.source?.line ?? -1)) best = node;
	}

	return best?.id ?? null;
}

/** The node in this wheel that stands for a narrower blikveld. */
function standsFor(tree: WheelTree, scope: WheelScope): string | null {
	if (scope.kind === "vault") return null;

	if (scope.kind === "section") {
		for (const node of nodes(tree)) {
			const source = node.source;
			if (node.kind !== "group" || source === undefined) continue;
			if (source.path !== scope.path) continue;
			if (sameHeading([...source.headingPath, node.label], scope.heading)) {
				return node.id;
			}
		}
		return null;
	}

	if (scope.kind === "note") {
		// A note is a ring of its own inside a folder wheel, and its own wedge
		// where the folder holds nothing else — both carry the note's path, so
		// neither needs a case here.
		for (const node of nodes(tree)) {
			if (node.kind === "project" && node.source?.path === scope.path) {
				return node.id;
			}
		}
		return null;
	}

	// A folder is a wedge one level up, and its label there is the last segment
	// of its path — `Werk/Klanten` is the wedge `Klanten` in the wheel over
	// `Werk`.
	const name = scope.path.split("/").filter((part) => part.length > 0).pop();
	if (name === undefined) return null;

	for (const node of nodes(tree)) {
		if (node.kind === "domain" && node.depth === 1 && node.label === name) {
			return node.id;
		}
	}
	return null;
}

function sameHeading(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((part, at) => part === b[at]);
}
