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
 *    walk the ladder — vault → folder → note → section, plus a heading wheel
 *    where the domain comes from headings — and the wider wheel
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
 * Whatever sits on this line, or the last thing above it.
 *
 * **The** answer to "which node is at this line", for every caller that asks —
 * opening the wheel on the cursor, stepping out onto what you were reading, and
 * the wheel following the cursor as you move around a note. There used to be
 * two of these, this one and `nodeAtLine` in the view, and they disagreed on
 * five lines out of twelve in an ordinary note (audit 6 sep 2026, BC_E3_S159).
 * Each had a test pinning its own answer and neither tested the other's.
 *
 * They disagreed in two places, and the merged rule below is not a compromise:
 * each was right about one of them and the two corrections do not collide.
 *
 *  - **Line 0.** `raw === null` says a node is not really *on* its line: a note
 *    ring carries `line: 0` to mean "this document starts here", and so does the
 *    bucket above the first heading. Skipping those is what stops a cursor on
 *    line 0 landing on the note instead of on the task that is actually there —
 *    and every note has a line 0.
 *  - **A paragraph under a heading.** The nearest node above, *whatever kind*.
 *    Reaching back for the last **task** instead walked straight past the
 *    heading in between and answered with work from the previous section:
 *    measured, a cursor in a paragraph under *Volgende week* pointed at a task
 *    under *Deze week*. Standing halfway down a paragraph means standing in the
 *    section that paragraph belongs to.
 *
 * A cursor three lines into a task's notes still means that task, which falls
 * out of the same rule rather than needing one of its own: the task *is* the
 * nearest node above. Never anything below the line — that is guessing forward
 * about something the reader has not reached.
 */
export function nodeAt(tree: WheelTree, path: string, line: number): string | null {
	let best: WheelNode | null = null;

	for (const node of nodes(tree)) {
		const source = node.source;
		if (source === undefined || source.path !== path) continue;
		if (source.raw === null || source.line > line) continue;
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
			// Whatever kind the note's own node has: a ring, a wedge of its own,
			// or — since BC_E3_S130 — a task, because the note declared itself
			// one. `raw === null` is what says "this node is that whole note",
			// and asking the kind instead left the reader landing nowhere when
			// they stepped out of a task document's wheel.
			if (
				(node.kind === "project" || node.kind === "task") &&
				node.source?.path === scope.path &&
				node.source.raw === null
			) {
				return node.id;
			}
		}
		return null;
	}

	// A heading is a wedge one level up, under its own name (BC_E3_S146). Same
	// shape as the folder case below, and the reason is the same: stepping out
	// should put the reader back on the thing they stepped into.
	if (scope.kind === "heading") {
		for (const node of nodes(tree)) {
			if (node.kind === "domain" && node.depth === 1 && node.label === scope.heading) {
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
