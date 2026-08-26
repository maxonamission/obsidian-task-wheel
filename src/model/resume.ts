/**
 * Where a wheel opens.
 *
 * Three answers, in order, and the order is the rule:
 *
 *  1. **What is already in focus.** A redraw within a session — a rescan after
 *     an edit, a fold, a filter change — must not move the reader.
 *  2. **Where this blikveld was left.** Closing the tab or closing Obsidian
 *     ends the session but not the round, and coming back to the start of a
 *     round you are halfway through means finding your place again by hand
 *     (eigenaar, 23 aug 2026).
 *  3. **Nowhere**, meaning the first stop. A wheel that has never been read
 *     starts at the beginning of its round — and so does one whose round was
 *     just started afresh, because starting a round clears what was remembered.
 *
 * Both of the first two are checked against the tree as it is *now*. The task
 * you were reading may have been finished in the editor, renamed, or carried
 * away while the wheel was closed; an id that is no longer there is not an
 * error, it is just not an answer.
 */
export function openAround(
	/** The item under the reading wedge right now, if the wheel is drawn. */
	focusId: string | null,
	/** What this blikveld remembered from last time. */
	remembered: string | null | undefined,
	/** Whether an id is on the wheel as it stands. */
	onWheel: (id: string) => boolean,
): string | null {
	if (focusId !== null && onWheel(focusId)) return focusId;
	if (remembered != null && onWheel(remembered)) return remembered;
	return null;
}
