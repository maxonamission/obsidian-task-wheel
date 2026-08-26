/**
 * The half-typed link under the cursor.
 *
 * Obsidian's own editor offers notes the moment you type `[[`, and the card's
 * rename box did not — so writing a link there meant knowing the note's name by
 * heart (owner, 19 aug 2026). The offering itself needs Obsidian; *whether*
 * there is an open link at the cursor, and what goes back into the line when
 * one is chosen, do not. Those are here, where they can be tested.
 */

/** An unclosed `[[` before the cursor, and what has been typed into it. */
export interface LinkQuery {
	/** Where the `[[` itself starts. */
	from: number;
	/** Where the cursor is — the end of what has been typed so far. */
	to: number;
	/** The words between the two, which is what to match notes against. */
	query: string;
}

/** How a link is opened and closed, in the one syntax this understands. */
const OPEN = "[[";
const CLOSE = "]]";

/**
 * Is the cursor inside a link that has been opened and not yet closed?
 *
 * Answered by looking backwards only. What comes *after* the cursor is not this
 * function's business: `[[wee|]]` with the cursor in the middle is an open link
 * being typed, and the closing brackets after it are already there because
 * somebody typed them.
 *
 * Three things end it, and each for its own reason:
 *
 *  - a `]]` in between, because then the link is closed and this is text after
 *    it;
 *  - a line break, because a link does not run over one;
 *  - a `|` or a `#`, because those ask for an alias or a heading. Both are
 *    real Obsidian syntax and neither is offered here — a task line is not the
 *    place to go hunting for a heading, and an alias is the writer's own words.
 */
export function openLink(text: string, caret: number): LinkQuery | null {
	const before = text.slice(0, caret);

	// The *last* one, so `[[a [[b` is the second link and not the first.
	const from = before.lastIndexOf(OPEN);
	if (from < 0) return null;

	const query = before.slice(from + OPEN.length);
	if (query.includes(CLOSE) || query.includes("]")) return null;
	if (/[\n\r|#]/.test(query)) return null;

	return { from, to: caret, query };
}

/**
 * The line as it reads once a note has been chosen.
 *
 * Hands back where the cursor goes as well, because it does not go where it
 * was: after `[[week-01]]` the writing carries on, and putting the cursor back
 * inside the brackets would be the one place it must not be.
 *
 * A `]]` already sitting after the cursor is taken up rather than doubled —
 * somebody who typed both halves before the name should not end up with four
 * closing brackets.
 */
export function withLink(
	text: string,
	at: LinkQuery,
	name: string,
): { text: string; caret: number } {
	const tail = text.slice(at.to);
	const rest = tail.startsWith(CLOSE) ? tail.slice(CLOSE.length) : tail;
	const link = `${OPEN}${name}${CLOSE}`;

	return {
		text: `${text.slice(0, at.from)}${link}${rest}`,
		caret: at.from + link.length,
	};
}
