import { Notice } from "obsidian";
import type { WheelLayout } from "../layout/radial";
import { sweepProgress, sweepSpans } from "../layout/sweep";
import type { TaskFilter, WheelScope, WheelTree } from "../model/types";
import { describe, isFiltering } from "../parse/filter";
import { filterOf, stateFor, type TaskWheelSettings } from "../settings";
import type { WheelRenderer } from "./render-wheel";

/**
 * The round: what has been under the reading wedge, and when the circle closes.
 *
 * Split out of `wheel-view.ts` under BC_E3_S13. This is the plugin's whole
 * promise in one file — being able to state that you have seen everything —
 * and it is worth having it somewhere you can read in one go.
 */

/** What the round needs from the view. Deliberately no wider than that. */
export interface RoundHost {
	readonly settings: TaskWheelSettings;
	scope(): WheelScope;
	tree(): WheelTree | null;
	layout(): WheelLayout | null;
	renderer(): WheelRenderer | null;
	persist(): void;
}

/**
 * Say so, once, when the circle is closed.
 *
 * The round is a round *of what is in play*, so when a filter is on it has to
 * be named — "all 213 seen" would otherwise read as "all of it".
 */
export function roundCompleteMessage(
	total: number,
	filter: TaskFilter,
): string {
	const of = isFiltering(filter) ? ` matching ${describe(filter)}` : "";
	return `Task wheel: round complete — all ${total} items${of} seen. Starting a new one.`;
}

/**
 * Note that this item has been under the reading wedge.
 *
 * Coming to rest on something *is* having reviewed it — that is what turning
 * the wheel past everything means, and asking for a second confirming tap
 * would make the round a chore rather than a pass. Kept by id so it survives
 * a rescan, a re-layout and a restart (kaderdocument §5).
 */
export function markSeen(host: RoundHost, id: string): void {
	const state = stateFor(host.settings, host.scope());
	if (state.seen.includes(id)) return;

	state.seen = [...state.seen, id];
	state.sweepStartedAt ??= new Date().toISOString();
	host.persist();

	drawSweep(host);
	announceIfComplete(host);
}

/** Paint the part of the circle this round has passed. */
export function drawSweep(host: RoundHost): void {
	const layout = host.layout();
	const renderer = host.renderer();
	if (layout === null || renderer === null) return;

	const state = stateFor(host.settings, host.scope());
	renderer.setSweep(sweepSpans(layout, new Set(state.seen)));
}

/**
 * Say so, once, when the circle is closed.
 *
 * The whole promise of the wheel is being able to state that you have seen
 * everything, and a promise kept in silence is not much of a promise. Saying
 * it once is enough: the round then ends, and the next turn starts a new one.
 */
export function announceIfComplete(host: RoundHost): void {
	const tree = host.tree();
	if (tree === null) return;

	const state = stateFor(host.settings, host.scope());
	const progress = sweepProgress(tree, new Set(state.seen));
	if (!progress.complete) return;

	new Notice(
		roundCompleteMessage(progress.total, filterOf(host.settings, host.scope())),
	);
	startRound(host);
}

/** Wipe the sweep and begin again. */
export function startRound(host: RoundHost): void {
	const state = stateFor(host.settings, host.scope());
	state.seen = [];
	state.sweepStartedAt = null;
	// A new round *does* begin at the beginning: the remembered place belongs to
	// the round that just ended (BC_E3_S52).
	state.reading = null;
	// And it deals the wedges again when they divide by open tasks: the round
	// boundary is the one moment re-division is allowed to move the drawing
	// (kaderdocument §3.1, herzien 26 aug 2026).
	state.roundWeights = null;
	// The wedges too: the order a round holds belongs to that round (BC_E3_S82).
	state.roundDomains = null;
	host.persist();
	drawSweep(host);
}

/** How far this round has got, for the command palette. */
export function progressOf(host: RoundHost): { seen: number; total: number } {
	const tree = host.tree();
	if (tree === null) return { seen: 0, total: 0 };

	const state = stateFor(host.settings, host.scope());
	return sweepProgress(tree, new Set(state.seen));
}
