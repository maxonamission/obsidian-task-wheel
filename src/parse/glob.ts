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

/**
 * How loose a bare word is in the box it was typed into (BC_E3_S181).
 *
 * `anywhere` is prose: a heading is a sentence someone wrote, and asking for
 * *bonnetjes* means the section called *Project bonnetjes* too. `prefix` is an
 * identifier: a tag has structure, `#werk` is the root of `#werk/klant`, and a
 * rule that matched anywhere would let `#werk` be found by *erk* and let
 * *thuis* pull in `#nietthuis`.
 */
export type Looseness = "anywhere" | "prefix";

/**
 * Whether a name answers to what someone typed in a filter box.
 *
 * The three text boxes of the filter panel each had their own rule and none of
 * them said so: the words box matched part of a word, the heading box wanted
 * the whole name, and the tag box wanted the whole tag and did not even accept
 * a star — while the box directly above it did (eigenaarsmelding 8 sep 2026,
 * BC_E3_S181). Three places deciding one thing, which is the shape every bug
 * in this plugin has had.
 *
 * A written pattern is loosened the same way a bare word is, so that typing a
 * star can never make a box *stricter* than leaving it out. In a prefix box
 * that means `*urgent` asks for "with urgent in it" rather than "ending in
 * urgent" — the wider reading of the two, and the one a reader who reached for
 * a star was after.
 */
export function looselyMatches(
	name: string,
	raw: string,
	how: Looseness,
): boolean {
	const needle = raw.trim().toLowerCase();
	// A blank entry, or one that is nothing but stars, would select everything.
	// That is never what an empty-ish box means.
	if (isBlankPattern(needle)) return false;

	return globMatches(name, how === "anywhere" ? `*${needle}*` : `${needle}*`);
}
