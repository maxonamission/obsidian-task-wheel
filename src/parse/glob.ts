/**
 * A star for "and everything like it".
 *
 * One character, one meaning, everywhere in the plugin: `*` stands for any run
 * of characters. It is the only pattern syntax there is — no `?`, no character
 * classes, no anchors — because a skip list and a search box are things you
 * have to be able to read back a week later.
 *
 * Matching is anchored: `accepta*` matches a *heading* that starts with it, not
 * one that contains it somewhere. Callers that want "contained anywhere" say so
 * by wrapping the pattern in stars themselves, which is what the search box
 * does — a bare word there has always matched part of a word.
 *
 * Walking the fixed parts rather than building a RegExp: no escaping of
 * whatever punctuation a heading or a task happens to carry, and no cache to
 * keep — this runs over every task in the vault.
 */

/** Whether the pattern holds a star at all, and is therefore a pattern. */
export function isPattern(text: string): boolean {
	return text.includes("*");
}

/** Whether a pattern says nothing: empty, or nothing but stars. */
export function isBlankPattern(text: string): boolean {
	return text.split("*").join("").trim().length === 0;
}

/** Whether `name` matches `pattern`, the whole of it, stars and all. */
export function globMatches(name: string, pattern: string): boolean {
	if (!isPattern(pattern)) return name === pattern;

	const parts = pattern.split("*");
	const head = parts[0];
	const tail = parts[parts.length - 1];

	if (!name.startsWith(head)) return false;
	if (!name.endsWith(tail)) return false;

	// Everything between the first and last fixed part has to appear in order,
	// inside what is left over once the two ends are accounted for.
	let cursor = head.length;
	const end = name.length - tail.length;
	if (cursor > end) return false;

	for (const part of parts.slice(1, -1)) {
		if (part.length === 0) continue;
		const at = name.indexOf(part, cursor);
		if (at < 0 || at + part.length > end) return false;
		cursor = at + part.length;
	}

	return true;
}
