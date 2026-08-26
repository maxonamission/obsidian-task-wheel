import {
	type App,
	Notice,
	prepareFuzzySearch,
	renderResults,
	type SearchResult,
	SuggestModal,
	TFile,
	TFolder,
} from "obsidian";
import { newNotePath } from "../parse/note-path";
import { handBack } from "./hand-back";

/**
 * Which note to carry something into.
 *
 * Reads like Obsidian's own quick switcher, so it needs no explaining: type two
 * letters of the name, or of the folder, and the list narrows. The note the task
 * is already in is left out — carrying it into itself is the one destination
 * that can only be a mistake.
 *
 * **And notes that do not exist yet** (herziening 20 aug 2026). Type a path the
 * vault does not have and the last row offers to make it, folders and all. The
 * old rule was that a new note has a name, a folder and often a template behind
 * it, and that none of those belong on a review wheel. Two of those three turn
 * out to be the same decision as choosing a destination, and the third — the
 * template — is what a new note gets when you make it in the file list. In
 * practice the missing note *is* the destination: sorting a day's work means
 * sending things to places that do not exist yet, and leaving the wheel to make
 * one first is exactly the detour the wheel is there to remove.
 */
export function pickNote(
	app: App,
	/** Left out of the list, because carrying into itself does nothing. */
	exclude: string,
): Promise<NoteChoice | null> {
	return new Promise((resolve) => {
		new NotePicker(app, exclude, resolve).open();
	});
}

/** A note that is there, or one the reader asked to have made. */
export type NoteChoice =
	| { kind: "existing"; file: TFile }
	| { kind: "new"; path: string; folders: readonly string[] };

/**
 * A row in the list: a note that exists, or the offer to make one.
 *
 * The offer used to travel as a `TFile` with nothing in it but a path, because
 * `FuzzySuggestModal` is typed in items and a second type looked like it would
 * spread through every method. It spread further than that: constructing that
 * empty stand-in is work Obsidian never expects on a suggestion, and the list
 * went slow or blank *the moment anything was typed* — which is exactly when the
 * offer first appears (owner, 21 aug 2026). A row that says which of the two it
 * is costs one union and cannot be mistaken for a file.
 */
type Row =
	| { kind: "existing"; file: TFile; hit: SearchResult | null }
	| { kind: "new"; path: string; folders: readonly string[] };

/** How many notes to show at once. Beyond this nobody is reading, only scrolling. */
const SHOWN = 50;

/**
 * The rows for what has been typed.
 *
 * Kept out of the modal and handed its scorer, so the ordering it decides can be
 * measured without a workspace: which notes, in what order, and whether the
 * offer to make one is there.
 */
export function noteRows(
	files: readonly TFile[],
	query: string,
	/** Obsidian's fuzzy matcher, already primed with the query. */
	score: (text: string) => SearchResult | null,
	/** Whether the vault already holds something at this path. */
	exists: (path: string) => boolean,
	limit = SHOWN,
): Row[] {
	const rows: Row[] = [];

	if (query.trim().length === 0) {
		// Nothing typed: the ones touched most recently, which is where an active
		// list and a someday list both tend to be.
		for (const file of files.slice(0, limit)) {
			rows.push({ kind: "existing", file, hit: null });
		}
	} else {
		const scored: Array<{ file: TFile; hit: SearchResult }> = [];
		for (const file of files) {
			// The whole path: two notes called *Inbox* in different folders are
			// normal, and the folder is often what is being typed.
			const hit = score(file.path);
			if (hit !== null) scored.push({ file, hit });
		}
		scored.sort((a, b) => b.hit.score - a.hit.score);
		for (const one of scored.slice(0, limit)) {
			rows.push({ kind: "existing", file: one.file, hit: one.hit });
		}
	}

	// Underneath rather than on top: the note you meant usually exists, and an
	// offer to make a second one with almost the same name should never be what
	// the first press lands on. Left out entirely when that path is already
	// there — there is nothing to make then.
	const wanted = newNotePath(query);
	if (wanted !== null && !exists(wanted.path)) {
		rows.push({ kind: "new", path: wanted.path, folders: wanted.folders });
	}

	return rows;
}

/**
 * The note behind a choice, making it first if that is what was chosen.
 *
 * Kept out of the picker on purpose: a modal that is closing is the wrong place
 * to do work that can fail, and the caller already knows how to say that a
 * carry did not happen.
 */
export async function noteFor(
	app: App,
	choice: NoteChoice,
): Promise<TFile | null> {
	if (choice.kind === "existing") return choice.file;

	try {
		for (const folder of choice.folders) {
			// Somebody else may have made it, or it may be a note with that name —
			// which is a different thing and worth saying out loud.
			const at = app.vault.getAbstractFileByPath(folder);
			if (at instanceof TFolder) continue;
			if (at !== null) {
				new Notice(`Task wheel: ${folder} is a note, not a folder.`);
				return null;
			}
			await app.vault.createFolder(folder);
		}

		// Empty. A new note made from here is a destination, not a document: what
		// goes in it is the work being carried, and anything else would be this
		// plugin writing prose nobody asked for.
		return await app.vault.create(choice.path, "");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not make ${choice.path} — ${message}`);
		return null;
	}
}

class NotePicker extends SuggestModal<Row> {
	/** What was picked, handed back only once the modal is really gone. */
	private chosen: NoteChoice | null = null;
	private handed = false;
	/**
	 * The notes to choose from, read once.
	 *
	 * Once, not per keystroke. Asking the vault for every markdown file and
	 * sorting it by modification time ran on each letter typed — over five
	 * thousand notes here — before Obsidian had even started matching. Nothing in
	 * that list changes while the box is open.
	 */
	private readonly files: TFile[];

	constructor(
		app: App,
		exclude: string,
		private readonly done: (choice: NoteChoice | null) => void,
	) {
		super(app);
		this.files = app.vault
			.getMarkdownFiles()
			.filter((file) => file.path !== exclude)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		this.limit = SHOWN;
		this.setPlaceholder("Into which note? Type a path to make a new one");
	}

	getSuggestions(query: string): Row[] {
		const search = prepareFuzzySearch(query);
		return noteRows(
			this.files,
			query,
			(text) => search(text),
			(path) => this.app.vault.getAbstractFileByPath(path) !== null,
		);
	}

	renderSuggestion(row: Row, el: HTMLElement): void {
		if (row.kind === "new") {
			el.addClass("task-wheel-make-note");
			el.createDiv({ text: `Make ${row.path}` });
			if (row.folders.length > 0) {
				el.createDiv({
					cls: "task-wheel-make-note-folders",
					text: `New folder: ${row.folders.join(", ")}`,
				});
			}
			return;
		}

		const line = el.createDiv();
		if (row.hit === null) line.setText(row.file.path);
		else renderResults(line, row.file.path, row.hit);
	}

	/**
	 * Only recorded here — Obsidian closes the modal next, and `onClose` is
	 * where the answer is handed back. See `hand-back.ts`: a second picker
	 * opened from this callback lands on a modal stack that is still unwinding.
	 */
	onChooseSuggestion(row: Row): void {
		this.chosen =
			row.kind === "new"
				? { kind: "new", path: row.path, folders: row.folders }
				: { kind: "existing", file: row.file };
	}

	override onClose(): void {
		super.onClose();
		// Escape and the X come through here too, with nothing chosen — and they
		// have to answer all the same, or the caller waits for ever.
		if (this.handed) return;
		this.handed = true;
		handBack(() => this.done(this.chosen), this.containerEl);
	}
}
