/**
 * Which commands the named destinations should have, and which they have.
 *
 * Obsidian owns the command palette and will not say what a plugin has put in
 * it, so the plugin keeps its own list — and that list drifted. Adding a
 * command was one call and taking one back looked impossible, so a deleted
 * destination kept offering to carry work to a place the reader had thrown
 * away, and a renamed one left its old command standing beside the new one
 * until Obsidian restarted (audit, 23 aug 2026). `Plugin.removeCommand` has in
 * fact existed since API 1.7, which the manifest already requires.
 *
 * The fix is a reconciliation rather than a remove here and an add there: every
 * route into the list — added, renamed, deleted, loaded from disk — asks the
 * same question, and this answers it. Pure, so the answer can be checked
 * without a palette to put anything in.
 */

/**
 * A command id built from a destination's name.
 *
 * Stable for the same name, so a key stays bound across restarts; two
 * destinations with the same name share a command, which is a good reason not
 * to name two of them the same.
 */
export function presetCommandId(name: string): string {
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "destination";

	return `preset-${slug}`;
}

export interface CommandChange {
	/** Ids to register. */
	add: string[];
	/** Ids to take back. */
	remove: string[];
}

/**
 * What to add and what to take back, to make `have` into `want`.
 *
 * A command that should stay is deliberately **left alone** rather than removed
 * and added again: re-registering it would be a new command as far as Obsidian
 * is concerned, and the key the reader bound to it would go with the old one.
 */
export function reconcileCommands(
	have: Iterable<string>,
	want: Iterable<string>,
): CommandChange {
	const there = new Set(have);
	const wanted = new Set(want);

	return {
		add: [...wanted].filter((id) => !there.has(id)),
		remove: [...there].filter((id) => !wanted.has(id)),
	};
}
