/**
 * The links inside a task's own words.
 *
 * A task like `Sportprogramma [[week-01]]` says half of what it is about in the
 * link, and reading it as four square brackets is reading it wrong. The card is
 * where a task is read out in full, so the links belong there as links.
 *
 * Three shapes, and no more:
 *
 *  - `[[note]]`, `[[note|what to call it]]`, `[[note#heading]]` — Obsidian's own
 *  - `[label](target)` — markdown's own, internal or external
 *  - a bare `https://…`, because people paste those straight into a task
 *
 * Deliberately no embeds (`![[…]]`), no block references rendered as anything
 * but text, and no attempt at markdown emphasis. The card is not a renderer; it
 * is a card that knows what a link is.
 */

export interface TextPiece {
	kind: "text";
	text: string;
}

export interface LinkPiece {
	kind: "link";
	/** What to show. */
	text: string;
	/** What to open. A vault path for internal, a URL for external. */
	target: string;
	/** Whether it leaves the vault. */
	external: boolean;
}

export type Piece = TextPiece | LinkPiece;

/**
 * One pass, so the pieces come out in the order they were written.
 *
 * The alternation is ordered: a wiki link first, because `[[a]](b)` is a wiki
 * link followed by text and not a markdown link; then a markdown link; then a
 * bare URL, which must not swallow the target of the markdown link above it.
 */
const LINK =
	/(!?)\[\[([^\]\n]+)\]\]|\[([^\]\n]*)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()[\]]+)/g;

/** Split a task's words into plain text and the links inside it. */
export function splitLinks(text: string): Piece[] {
	const pieces: Piece[] = [];
	let cursor = 0;

	LINK.lastIndex = 0;
	for (let match = LINK.exec(text); match !== null; match = LINK.exec(text)) {
		if (match.index > cursor) {
			pieces.push({ kind: "text", text: text.slice(cursor, match.index) });
		}
		cursor = match.index + match[0].length;

		const [whole, bang, wiki, label, href, url] = match;

		// An embed is a link with a `!` in front. The card cannot embed anything,
		// and showing it as a link would open something the reader asked to have
		// shown in place — so it stays as it was written.
		if (bang === "!") {
			pieces.push({ kind: "text", text: whole });
			continue;
		}

		if (wiki !== undefined) {
			const bar = wiki.indexOf("|");
			const target = (bar < 0 ? wiki : wiki.slice(0, bar)).trim();
			const shown = (bar < 0 ? wiki : wiki.slice(bar + 1)).trim();

			// `[[|alias]]` and `[[]]` point at nothing; there is no note to open.
			if (target.length === 0) {
				pieces.push({ kind: "text", text: whole });
				continue;
			}

			pieces.push({
				kind: "link",
				text: shown.length > 0 ? shown : target,
				target,
				external: false,
			});
			continue;
		}

		if (href !== undefined) {
			pieces.push({
				kind: "link",
				text: label !== undefined && label.length > 0 ? label : href,
				target: href,
				external: isExternal(href),
			});
			continue;
		}

		if (url !== undefined) {
			pieces.push({ kind: "link", text: url, target: url, external: true });
		}
	}

	if (cursor < text.length) {
		pieces.push({ kind: "text", text: text.slice(cursor) });
	}

	return pieces;
}

/**
 * The same words with the link syntax taken off — what a link *says*.
 *
 * For the places that can only show plain text: the label beside a dot on the
 * wheel, the trail on the card, a line in a picker. `Sportprogramma [[week-01]]`
 * reads as `Sportprogramma week-01` there, which is what the writer meant; four
 * square brackets in the middle of a name is reading it wrong (owner, 19 aug
 * 2026).
 *
 * Not for anything that is written back. This throws information away — that is
 * the point — so the note keeps whatever was typed and only the drawing is
 * tidied.
 */
export function plainText(text: string): string {
	return splitLinks(text)
		.map((piece) => piece.text)
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

/** Whether this task's words hold anything to follow. */
export function hasLinks(text: string): boolean {
	return splitLinks(text).some((piece) => piece.kind === "link");
}

/**
 * Whether a markdown target leaves the vault.
 *
 * A scheme means away — including `obsidian://`, which is away as far as this
 * card is concerned even though it comes back. Everything else is a path in the
 * vault, which is what Obsidian's own link resolution expects.
 */
function isExternal(target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target);
}
