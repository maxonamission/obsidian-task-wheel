import type { CarryPreset } from "./types";

/**
 * Where a named destination points after something in the vault was renamed.
 *
 * A destination holds a vault-relative path, and nothing kept it up to date:
 * rename the note or one of the folders above it and the destination pointed
 * at a place that no longer existed. Carrying then refused with a sentence
 * about a note that is "not there any more", which is true and unhelpful — it
 * *is* there, under another name (eigenaar, 8 sep 2026).
 *
 * That is out of step with the vault the plugin lives in: Obsidian carries your
 * `[[links]]` along on a rename. A destination is the same kind of reference
 * and should travel the same way.
 *
 * Two shapes of rename, because Obsidian fires this event for both:
 *
 * - **the note itself** — the path matches exactly;
 * - **a folder above it** — the path starts with the old folder plus a
 *   separator. A folder rename does not fire an event per file inside it, so
 *   without this half the ordinary case (*"I renamed the folder"*) would still
 *   break every destination in it.
 *
 * Pure, and here rather than in the listener, because it is a rule about paths
 * and not about Obsidian. The listener's whole job is to hand it two strings.
 *
 * Nothing is said out loud when a destination travels. The plugin is otherwise
 * strict about announcing what it changed, but that rule is for things the
 * reader did not ask for: a round that disappears, work that is left out. A
 * reference that follows the file it names is what renaming already means
 * everywhere else in Obsidian, and a notice for it would be noise.
 */
export function presetsAfterRename(
	presets: readonly CarryPreset[],
	oldPath: string,
	newPath: string,
): { presets: CarryPreset[]; moved: number } {
	// A rename that changes nothing about the path cannot move anything, and
	// asking would only cost a rewrite of the list.
	if (oldPath === newPath || oldPath === "") {
		return { presets: [...presets], moved: 0 };
	}

	const inside = `${oldPath}/`;
	let moved = 0;

	const next = presets.map((preset) => {
		const path = preset.notePath;

		if (path === oldPath) {
			moved += 1;
			return { ...preset, notePath: newPath };
		}

		if (path.startsWith(inside)) {
			moved += 1;
			return { ...preset, notePath: `${newPath}/${path.slice(inside.length)}` };
		}

		return preset;
	});

	return { presets: next, moved };
}
