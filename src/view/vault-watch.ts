import {
	type App,
	type EventRef,
	type TAbstractFile,
	TFile,
	type WorkspaceLeaf,
	debounce,
} from "obsidian";
import type { ParseOptions, WheelScope, WheelTree } from "../model/types";
import { inScope, isExcludedFolder } from "../parse/domain";

/**
 * Keeping up with edits made outside the wheel.
 *
 * Split out of `wheel-view.ts` under BC_E3_S13. A button was the other option
 * and it is the wrong one: the wheel's whole promise is that a round is
 * complete, and a promise you have to remember to refresh is not one the
 * instrument keeps — it is one it hands back to you.
 */

/**
 * How long the vault has to be quiet before an outside edit is picked up.
 *
 * Obsidian already waits for typing to stop before it saves, so this is the
 * second wait rather than the first. It exists for the bursts: a sync that
 * lands twenty notes at once, or a find-and-replace across a folder, should
 * cost one scan and not twenty.
 */
export const SETTLE_MS = 1200;

/** What the watching needs from the view. Deliberately no wider than that. */
export interface WatchHost {
	readonly app: App;
	scope(): WheelScope;
	options(): ParseOptions;
	/** Mark the wheel behind the vault. */
	markStale(): void;
	/** Whether the wheel is behind the vault right now. */
	isStale(): boolean;
	/** Read again if being behind still matters. */
	catchUp(): void;
	/**
	 * The reader moved to another pane.
	 *
	 * Handed the leaf that became active, so the wheel can tell "I am being
	 * come back to" from "somebody opened a note somewhere".
	 */
	leafChanged(leaf: WorkspaceLeaf | null): void;
	/** Hand each subscription to the view, which owns unsubscribing. */
	own(ref: EventRef): void;
}

/**
 * Whether a saved file is this wheel's business at all.
 *
 * Two gates, and both are about cost rather than correctness: a wheel over one
 * note has no reason to re-read the vault because an unrelated note was saved,
 * and an archive folder that syncs a hundred notes is exactly the kind of thing
 * that syncs in bulk.
 */
export function concernsWheel(
	path: string,
	scope: WheelScope,
	options: ParseOptions,
): boolean {
	return inScope(path, scope) && !isExcludedFolder(path, options, scope);
}

/**
 * Subscribe to the vault, cheaply enough to leave on.
 *
 * Three things keep it cheap:
 *
 *  - **Only what this wheel is about** (`concernsWheel`).
 *  - **Only after the vault goes quiet** — a sync landing twenty notes costs
 *    one scan.
 *  - **Only while anyone is looking.** A wheel in a background tab marks itself
 *    stale and reads when it is brought back — which is also the moment the
 *    reader would have noticed it was behind.
 */
export function watchVault(host: WatchHost): void {
	const settle = debounce(() => host.catchUp(), SETTLE_MS, true);

	const touched = (file: TAbstractFile): void => {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (!concernsWheel(file.path, host.scope(), host.options())) return;
		host.markStale();
		settle();
	};

	// Registered one by one rather than over a list: each of these is its own
	// overload with its own handler shape, and a loop can only satisfy them
	// all by widening the type until it says nothing.
	host.own(host.app.vault.on("modify", touched));
	host.own(host.app.vault.on("create", touched));
	host.own(host.app.vault.on("delete", touched));
	// A rename changes a path, which can move a note into or out of scope.
	host.own(host.app.vault.on("rename", (file) => touched(file)));

	// Coming back to the tab is when a wheel that stayed behind has to catch
	// up, and it is the only moment a background wheel gets.
	host.own(
		host.app.workspace.on("active-leaf-change", (leaf) => {
			if (host.isStale()) settle();
			host.leafChanged(leaf);
		}),
	);
}

/**
 * The wheel's stop for a place in a note.
 *
 * The nearest node whose own line is at or above it — a task if the cursor is
 * on one, otherwise the heading it sits under. A cursor sits on a line and the
 * wheel has stops only for tasks and headings: standing halfway down a
 * paragraph means standing in the section that paragraph belongs to.
 */
export function nodeAtLine(
	tree: WheelTree,
	path: string,
	line: number,
): string | null {
	let best: { line: number; id: string } | null = null;

	for (const [id, node] of tree.byId) {
		const source = node.source;
		if (source === undefined || source.path !== path) continue;
		if (source.line > line) continue;
		if (best === null || source.line > best.line) best = { line: source.line, id };
	}

	return best?.id ?? null;
}
