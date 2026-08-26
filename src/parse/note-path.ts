/**
 * Turning what somebody typed into a note that can be made.
 *
 * The carry picker used to offer only notes that exist, on the reasoning that a
 * new note has a name, a folder and often a template behind it. In practice the
 * missing note is the point: sorting a day's work means sending things to
 * places that do not exist yet, and leaving the wheel to make one first is the
 * detour the wheel is meant to remove (owner, 20 aug 2026).
 *
 * What is typed is a **path from the root of the vault**, the way it reads in
 * the file list. `Archief/2026/Klussen` is a note called *Klussen* in two
 * folders, and both folders get made. No default-folder setting is consulted:
 * this box shows the whole path of every note it lists, so the path is the
 * thing the reader is already thinking in.
 */

/** A note that does not exist yet, and what has to be made for it to. */
export interface NewNote {
	/** Full path including the extension. */
	path: string;
	/** Folders to make first, outermost first. Empty when it lands in the root. */
	folders: string[];
}

/**
 * Characters a note's name may not hold.
 *
 * Obsidian's own list, minus the slash — here the slash is the whole point,
 * because it is what says "and this folder above it".
 */
const FORBIDDEN = /[\\:*?"<>|]/;

/**
 * The note this text asks for, or `null` when it asks for nothing usable.
 *
 * `null` covers the empty answer, a path that is only slashes, and a name with
 * a character no file can carry. Each of those is better refused here than
 * turned into a file with a surprising name.
 */
export function newNotePath(typed: string): NewNote | null {
	const parts = typed
		.split("/")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

	if (parts.length === 0) return null;
	if (parts.some((part) => FORBIDDEN.test(part))) return null;

	// A leading dot would make a hidden file, and `.` and `..` would climb out
	// of the vault. Nothing typed into this box may mean either.
	if (parts.some((part) => part.startsWith("."))) return null;

	const folders = parts.slice(0, -1);
	const name = parts[parts.length - 1];
	const file = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;

	// A name that is nothing but the extension is not a name.
	if (file === ".md") return null;

	return {
		path: [...folders, file].join("/"),
		// Each folder with everything above it, because that is what has to be
		// made and in that order.
		folders: folders.map((_, at) => folders.slice(0, at + 1).join("/")),
	};
}
