import type { WheelNode, WheelTree } from "./types";

/**
 * Carrying a node's marks across an edit that changes its identity.
 *
 * A node's id is built from its place in the tree plus its text (`build-tree`),
 * and that is deliberate: it is what lets a task keep its seen-mark when a line
 * is inserted above it. The cost is that the edits which change the text or the
 * place — renaming a task, moving it under another heading, moving a whole
 * section — hand back a node the wheel has never met, and its seen-mark falls
 * on the floor. A round then walks backwards for no reason the reader can see.
 *
 * So the marks are carried across by hand. What survives every edit the wheel
 * makes is the pair **(which note, what it says)**, plus the kind of thing it
 * is. Renaming changes the second half, and that is why a rename says up front
 * what it changed it *to*.
 *
 * Duplicates are paired off one for one, in order. Two tasks with the same
 * words in the same note, one of them seen, come out as two tasks of which one
 * is seen — which one is arbitrary, the count is not. That is the honest answer
 * without inventing an identity the vault does not have.
 */

/** What a rename changed, so the node can be recognised on the other side. */
export interface Rename {
	path: string;
	from: string;
	to: string;
}

/**
 * What a carry moved, so the round's marks travel with it (BC_E3_S137).
 *
 * The gap this closes: the pair that survives an edit is *(which note, what it
 * says)*, and carrying to another note changes the first half. So the one action
 * the wheel is most used for — sorting a day's work into four notes — was the
 * one that dropped its own seen-marks. You reviewed a task in one wedge, moved
 * it, and met it again unreviewed in the wedge you moved it to; the round asked
 * you to do the same task twice (eigenaar, 4 sep 2026).
 *
 * Only for a **move**. A copy leaves the original where it is, and there the
 * mark belongs to the original — the new one is genuinely new work in another
 * note, and it should be met.
 *
 * `lines` says **which lines left**, rather than what they were called
 * (BC_E3_S144). Naming them was the first attempt and it was wrong in the case
 * the wheel meets every day: a note holding two tasks called "Bellen", one of
 * which is carried away. Matching on the label re-keyed both, so the twin that
 * stayed behind lost the mark it had honestly earned — the round went backwards
 * for a task nobody touched. Lines are what actually travelled, they are read
 * off the same block the write took out, and no two of them are alike.
 */
export interface Moved {
	/** The note the block came out of. */
	from: string;
	/** The note it landed in. */
	to: string;
	/** The lines that left, as half-open ranges in the note as it was. */
	lines: readonly LineRange[];
}

/** A run of lines: `start` included, `end` not. */
export interface LineRange {
	start: number;
	end: number;
}

/**
 * What a write that has just landed asks of the wheel.
 *
 * Carried by the write itself rather than remembered on the view. `advance` —
 * "I am finished with this one, take me to the next" — used to be worked out
 * and stored the moment a card button was pressed, which was *before* the
 * pickers opened. Cancel the picker and the aim stayed behind: the next
 * unrelated keyboard move consumed it, jumped the reader forward and marked an
 * item seen they had never turned to (audit, 23 aug 2026). An aim that travels
 * with the write cannot outlive an action that never wrote.
 */
export interface AfterWrite {
	rename?: Rename;
	moved?: Moved;
	advance?: boolean;
}

const SEP = "";

/**
 * Which node each node of the old tree became.
 *
 * Ids that mean the same thing on both sides map to themselves, so running this
 * over an edit that changed nothing is free rather than wrong.
 */
export function mapIds(
	before: WheelTree,
	after: WheelTree,
	rename?: Rename,
	moved?: Moved,
): Map<string, string> {
	const was = group(before, rename, moved);
	const now = group(after);
	const mapping = new Map<string, string>();

	for (const [key, olds] of was) {
		const news = now.get(key);
		if (news === undefined) continue;

		for (let i = 0; i < olds.length && i < news.length; i++) {
			mapping.set(olds[i], news[i]);
		}
	}

	return mapping;
}

/** The seen-marks of a round, as they stand after an edit. */
export function carrySeen(
	before: WheelTree,
	after: WheelTree,
	seen: readonly string[],
	rename?: Rename,
	moved?: Moved,
): string[] {
	const mapping = mapIds(before, after, rename, moved);
	const carried = new Set<string>();

	for (const id of seen) {
		// An id the mapping does not know is kept as it is: it may belong to a
		// note this edit never touched, and dropping it would undo a round for
		// no reason. What is genuinely gone is pruned elsewhere, against the
		// tree that is actually on the disc.
		carried.add(mapping.get(id) ?? id);
	}

	return [...carried];
}

/**
 * Where the wheel lands after an action that finished with an item.
 *
 * `aim` is the item the reader was sent on to — worked out *before* the write,
 * because afterwards the one they acted on may be gone. It wins whenever it is
 * still on the wheel; otherwise the ordinary rule applies, which is carrying
 * the old reading wedge across whatever the edit did to it.
 *
 * An aim that no longer exists is not an error: the wheel was rescanned, and a
 * filter or another edit may have taken that item too. Falling back is the
 * whole of the handling (BC_E3_S32).
 */
export function landAfter(
	aim: string | null,
	carried: string | null,
	has: (id: string) => boolean,
): string | null {
	return aim !== null && has(aim) ? aim : carried;
}

/** Where the reading wedge should land, now that the item has changed. */
export function carryFocus(
	before: WheelTree,
	after: WheelTree,
	id: string | null,
	rename?: Rename,
	moved?: Moved,
): string | null {
	if (id === null) return null;
	return mapIds(before, after, rename, moved).get(id) ?? id;
}

/**
 * The nodes of a tree, by the key that survives an edit.
 *
 * Order within a key is by where the node sits in its note, so pairing up
 * duplicates is at least stable from one rebuild to the next.
 */
function group(
	tree: WheelTree,
	rename?: Rename,
	moved?: Moved,
): Map<string, string[]> {
	const rows: Array<{ key: string; line: number; id: string }> = [];

	for (const [id, node] of tree.byId) {
		if (node.kind === "root") continue;
		rows.push({
			key: keyOf(node, rename, moved),
			line: node.source?.line ?? -1,
			id,
		});
	}

	rows.sort((a, b) => a.line - b.line || compare(a.id, b.id));

	const grouped = new Map<string, string[]>();
	for (const row of rows) {
		const list = grouped.get(row.key);
		if (list === undefined) grouped.set(row.key, [row.id]);
		else list.push(row.id);
	}

	return grouped;
}

function keyOf(node: WheelNode, rename?: Rename, moved?: Moved): string {
	const path = node.source?.path ?? "";
	const label =
		rename !== undefined && path === rename.path && node.label === rename.from
			? rename.to
			: node.label;

	// A node that travelled is keyed by where it *landed*, so the tree before the
	// carry and the tree after it agree about which node is which. Applied to the
	// old tree only, exactly like the rename hint.
	//
	// Whether it travelled is decided by the line it stood on, not by what it is
	// called: two tasks in one note may read the same, and only one of them left
	// (BC_E3_S144). A node standing for a whole note has no line of its own —
	// `raw` is null — so it is never taken along by a block that happens to start
	// at the top of the file.
	const line = node.source?.raw === null ? -1 : node.source?.line ?? -1;
	const at =
		moved !== undefined && path === moved.from && travelled(line, moved)
			? moved.to
			: path;

	return `${node.kind}${SEP}${at}${SEP}${label}`;
}

/** Whether this line was inside one of the blocks that left. */
function travelled(line: number, moved: Moved): boolean {
	if (line < 0) return false;
	return moved.lines.some((range) => line >= range.start && line < range.end);
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
