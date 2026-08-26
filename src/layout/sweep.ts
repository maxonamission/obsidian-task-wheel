import { normaliseAngle } from "./geometry";
import type { WheelLayout } from "./radial";
import type { WheelTree } from "../model/types";

/**
 * How far round this round has got.
 *
 * The sweep is what turns "I looked at some tasks" into "I have been all the
 * way round" (kaderdocument §5). It is kept per node id rather than per angle,
 * because angles move: the fisheye swells whatever is under the wedge, and a
 * re-layout gives every item a slightly different slice. An id survives that,
 * and it survives a rescan and a restart too.
 *
 * What is *drawn* is angular, though — a reader wants to see which part of the
 * circle is behind them, not read a percentage. So the ids are turned back into
 * arcs here, at drawing time, from the layout as it stands.
 */

export interface SweepSpan {
	/** Both in degrees on the unturned wheel, start before end. */
	start: number;
	end: number;
}

export interface SweepProgress {
	seen: number;
	total: number;
	/** Every stop on the wheel has been under the reading wedge. */
	complete: boolean;
}

/**
 * The arcs of the circle that have been passed.
 *
 * Adjacent items merge into one arc, which is the point: a round that has done
 * two whole wedges should read as two solid bands, not as forty ticks.
 */
export function sweepSpans(
	layout: WheelLayout,
	seen: ReadonlySet<string>,
): SweepSpan[] {
	const slices = layout.nodes
		.filter((laid) => laid.depth > 0 && seen.has(laid.id))
		.map((laid) => ({
			start: normaliseAngle(laid.angle - laid.span / 2),
			end: normaliseAngle(laid.angle - laid.span / 2) + laid.span,
		}))
		.sort((a, b) => a.start - b.start);

	const merged: SweepSpan[] = [];
	for (const slice of slices) {
		const last = merged[merged.length - 1];
		// A hair of tolerance: neighbouring slices share an edge in theory and
		// differ in the last decimal in practice, and a seam of a thousandth of a
		// degree would still draw as a gap.
		if (last !== undefined && slice.start <= last.end + 0.01) {
			last.end = Math.max(last.end, slice.end);
		} else {
			merged.push({ ...slice });
		}
	}

	// The wheel has no beginning, so an arc that ends at 360 and one that starts
	// at 0 are the same arc.
	if (merged.length > 1) {
		const first = merged[0];
		const last = merged[merged.length - 1];
		if (first.start <= 0.01 && last.end >= 359.99) {
			first.start = last.start - 360;
			merged.pop();
		}
	}

	return merged;
}

/** How many of the wheel's stops have been under the reading wedge. */
export function sweepProgress(
	tree: WheelTree,
	seen: ReadonlySet<string>,
): SweepProgress {
	// Counted against the tree, the same set the marks are kept against. It used
	// to count what was *drawn*, which is a third set again and a far smaller
	// one — the visibility budget draws a couple of hundred of twenty thousand,
	// so "you have seen everything" fired for everything currently on screen
	// (18 aug 2026). The promise is about the round, and the round is the tree:
	// turn towards a stump and it opens, so everything in it is reachable.
	let total = 0;
	let passed = 0;

	for (const id of tree.byId.keys()) {
		if (id === tree.root.id) continue;
		total += 1;
		if (seen.has(id)) passed += 1;
	}

	return { seen: passed, total, complete: total > 0 && passed === total };
}

/**
 * Drop what this round can no longer be about.
 *
 * A task that was ticked off, or a note that was deleted, leaves its id behind
 * in the seen set. Left alone the round could never complete — it would be
 * waiting for an item that no longer exists — so the set is trimmed whenever it
 * is read back.
 *
 * Trimmed against the **tree**, not against the drawing. Those are wildly
 * different sets: the visibility budget means a vault of twenty thousand nodes
 * is drawn as a couple of hundred, and the rest sit behind stumps that count
 * them. Trimming to what is drawn therefore threw away the mark on everything
 * currently folded away — and since turning the wheel opens different branches,
 * a round kept forgetting behind itself. Walking every stop of a 150-stop wheel
 * ended with 126 marked, so the circle could not be closed at all (measured
 * 18 aug 2026). An item that is behind a stump is still in the round; it is
 * hidden, not gone, and §3.3 turns on exactly that difference.
 */
export function prune(
	tree: WheelTree,
	seen: readonly string[],
): Set<string> {
	return new Set(seen.filter((id) => tree.byId.has(id)));
}
