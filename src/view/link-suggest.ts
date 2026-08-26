import { type App, prepareFuzzySearch, renderResults, type TFile } from "obsidian";
import { openLink, withLink } from "../parse/link-query";

/**
 * Notes offered while a link is being typed.
 *
 * Obsidian's editor does this the moment you write `[[`, and the card's rename
 * box did not — so putting a link in a task from the wheel meant knowing the
 * note's name by heart (owner, 19 aug 2026). This is the same gesture in the
 * two places where a task line is typed: renaming one on the card, and adding
 * one in the box.
 *
 * Deliberately built rather than borrowed. Obsidian's own `AbstractInputSuggest`
 * takes an `<input>` or a content-editable div and replaces the *whole* value;
 * what is needed here is a suggestion inserted at the cursor, inside brackets,
 * in a `<textarea>`. The matching itself is Obsidian's (`prepareFuzzySearch`,
 * `renderResults`), so a note is found the same way it is found anywhere else.
 *
 * What it does not do, and each for a reason: no headings after `#` and no
 * aliases after `|` (see `openLink`), no new notes from the box, and no
 * embeds. A task line is a line of words with a link in it.
 */

/** How many notes to show at once. More is a list to read, not a suggestion. */
const SHOWN = 8;

/** What the suggester needs to give back to whoever opened the box. */
export interface LinkSuggest {
	/** Whether the list is up — the caller's keys must yield while it is. */
	open(): boolean;
	/** Take it down and let go of the document listener. */
	close(): void;
	/** Stop listening altogether; the field is going away. */
	detach(): void;
}

/**
 * Watch this field, and offer notes whenever a link is open at the cursor.
 *
 * The keydown listener is registered here, so attach *before* the field's own
 * one: listeners on one element run in the order they were added, and while the
 * list is up the arrows, Enter and Escape belong to the list.
 */
export function attachLinkSuggest(
	app: App,
	field: HTMLTextAreaElement | HTMLInputElement,
): LinkSuggest {
	let list: HTMLElement | null = null;
	let choices: TFile[] = [];
	let index = 0;

	const close = (): void => {
		list?.remove();
		list = null;
		choices = [];
		index = 0;
	};

	const choose = (file: TFile): void => {
		const at = openLink(field.value, field.selectionStart ?? 0);
		if (at === null) {
			close();
			return;
		}

		// The basename, as Obsidian's own link autocomplete writes it: a vault
		// resolves a name to a note by itself, and the full path is only needed
		// when two notes share a name — which is a knot this box does not untie.
		const done = withLink(field.value, at, file.basename);
		field.value = done.text;
		field.setSelectionRange(done.caret, done.caret);
		close();

		// The field's own listeners have not seen this, and something may be
		// watching what was typed.
		field.dispatchEvent(new Event("input", { bubbles: true }));
	};

	const draw = (): void => {
		close();

		const at = openLink(field.value, field.selectionStart ?? 0);
		if (at === null) return;

		choices = matches(app, at.query);
		if (choices.length === 0) return;

		// Measured before anything is created: a read after a write costs a
		// forced layout, and this runs on every keystroke.
		const box = field.getBoundingClientRect();

		list = field.ownerDocument.body.createDiv({ cls: "task-wheel-suggest" });
		list.style.top = `${box.bottom}px`;
		list.style.left = `${box.left}px`;
		list.style.width = `${box.width}px`;

		const search = prepareFuzzySearch(at.query);

		choices.forEach((file, at_) => {
			const row = (list as HTMLElement).createDiv({
				cls: at_ === 0 ? ["task-wheel-suggest-row", "is-on"] : "task-wheel-suggest-row",
			});

			const name = row.createDiv({ cls: "task-wheel-suggest-name" });
			const hit = at.query.length > 0 ? search(file.basename) : null;
			if (hit === null) {
				name.setText(file.basename);
			} else {
				// Obsidian's own highlighting, so a match reads here the way it
				// reads in the quick switcher.
				renderResults(name, file.basename, hit);
			}

			row.createDiv({
				cls: "task-wheel-suggest-path",
				text: file.parent?.path === "/" ? "" : `${file.parent?.path ?? ""}/`,
			});

			// The press must not take the focus off the field: a blur commits the
			// rename, and the note would be chosen into a box that had closed.
			row.addEventListener("mousedown", (event) => event.preventDefault());
			row.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				choose(file);
			});
		});
	};

	const highlight = (): void => {
		if (list === null) return;
		const rows = Array.from(list.children);
		rows.forEach((row, at_) => row.toggleClass("is-on", at_ === index));
		rows[index]?.scrollIntoView({ block: "nearest" });
	};

	const onKeyDown = (raw: Event): void => {
		const event = raw as KeyboardEvent;
		if (list === null || choices.length === 0) return;

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			event.stopImmediatePropagation();
			index =
				(index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) %
				choices.length;
			highlight();
			return;
		}

		if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			// Not just `stopPropagation`: the field's own Enter handler is on this
			// same element, and it would otherwise commit the rename with a
			// half-typed link in it.
			event.stopImmediatePropagation();
			choose(choices[index]);
			return;
		}

		if (event.key === "Escape") {
			// The list goes, the box stays: one Escape at a time.
			event.preventDefault();
			event.stopImmediatePropagation();
			close();
		}
	};

	// Before the field's own listeners, by being added first — see the note on
	// this function.
	field.addEventListener("keydown", onKeyDown);

	// After the key has done its work, so `field.value` is what it now says.
	const onInput = (): void => draw();
	field.addEventListener("input", onInput);
	field.addEventListener("click", onInput);

	return {
		open: () => list !== null,
		close,
		detach: () => {
			close();
			field.removeEventListener("keydown", onKeyDown);
			field.removeEventListener("input", onInput);
			field.removeEventListener("click", onInput);
		},
	};
}

/**
 * The notes worth offering for what has been typed.
 *
 * With nothing typed yet, the ones touched most recently — the same guess the
 * quick switcher makes, and usually the right one, because a link written now
 * tends to point at what was being worked on just before.
 */
function matches(app: App, query: string): TFile[] {
	const files = app.vault.getMarkdownFiles();

	if (query.trim().length === 0) {
		return [...files]
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, SHOWN);
	}

	const search = prepareFuzzySearch(query);
	const scored: Array<{ file: TFile; score: number }> = [];

	for (const file of files) {
		const hit = search(file.basename) ?? search(file.path);
		if (hit !== null) scored.push({ file, score: hit.score });
	}

	return scored
		.sort((a, b) => b.score - a.score)
		.slice(0, SHOWN)
		.map((one) => one.file);
}
