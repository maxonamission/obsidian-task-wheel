/**
 * A note, read as lines.
 *
 * Two things about the text of a note are not *in* the note, and both have to
 * come off before it is read and go back on before it is written:
 *
 *  - the **line endings**, handled in `splice.ts` — a CRLF note splits with the
 *    carriage return attached, and every pattern here anchors on `$`;
 *  - the **byte-order mark**, handled here. Some editors and sync tools put a
 *    `U+FEFF` at the very start of a UTF-8 file. It is invisible, it belongs to
 *    the encoding rather than to the content, and every pattern that anchors on
 *    `^` refuses the line it sits on — so front matter was not skipped, the
 *    first heading was not a heading, and a task on the first line was simply
 *    not on the wheel (audit, 23 aug 2026).
 *
 * That last one matters more than it looks: a task the wheel does not draw and
 * does not count is exactly the lie hard requirement §3.1 rules out.
 *
 * This repo writes UTF-8 without a BOM, but a reader's vault promises nothing.
 */

/** The byte-order mark, as a string. */
export const BOM = "\uFEFF";

/**
 * Split a note into lines, without the mark.
 *
 * The mark comes off the first line only, and nothing else moves: line numbers,
 * and therefore every reference the wheel holds, are exactly what they were.
 */
export function linesOf(content: string): string[] {
	return withoutBom(content).split(/\r?\n/);
}

/** The mark a note starts with, or an empty string. */
export function bomOf(content: string): string {
	return content.startsWith(BOM) ? BOM : "";
}

/** The same text with any leading mark taken off. */
export function withoutBom(content: string): string {
	return content.startsWith(BOM) ? content.slice(BOM.length) : content;
}
