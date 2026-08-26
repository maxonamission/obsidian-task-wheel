import {
	AbstractInputSuggest,
	type App,
	prepareFuzzySearch,
	renderResults,
	type SearchResult,
	setIcon,
	TFolder,
} from "obsidian";

/**
 * Suggestions under the box that says what a wheel is about.
 *
 * The box took a typed path and said nothing until you got it right (eigenaar,
 * 22 aug 2026, from a phone — where typing `Time and Energy/Go Do This Week` is
 * exactly the kind of thing nobody should have to do). It offers now, the way
 * every other path box in Obsidian does.
 *
 * Obsidian has a picker for folders and one for files, each with its own
 * suggester, and this box wants both in one list: a wheel is about a folder *or*
 * a note. So the suggester is ours, hung on the input with `AbstractInputSuggest`
 * — the same class Obsidian's own two are built on.
 */

/** One thing a wheel can be about. */
export interface PathRow {
	kind: "folder" | "note";
	/** Vault-relative, extension and all. */
	path: string;
}

/** How many rows to offer. Beyond this nobody is reading, only scrolling. */
const SHOWN = 30;

/**
 * The rows worth offering for what has been typed.
 *
 * Handed its scorer so the ordering it decides can be measured without a vault.
 * With nothing typed yet the folders come first: a folder is the broader answer
 * and there are far fewer of them, so a list of folders is a list you can read,
 * where a list of every note is a list you scroll.
 */
export function pathRows(
	entries: readonly PathRow[],
	query: string,
	score: (text: string) => SearchResult | null,
	limit = SHOWN,
): PathRow[] {
	if (query.trim().length === 0) {
		const folders = entries.filter((entry) => entry.kind === "folder");
		const notes = entries.filter((entry) => entry.kind === "note");
		return [...folders, ...notes].slice(0, limit);
	}

	const scored: Array<{ entry: PathRow; hit: SearchResult }> = [];
	for (const entry of entries) {
		const hit = score(entry.path);
		if (hit !== null) scored.push({ entry, hit });
	}

	return scored
		.sort(
			(a, b) =>
				b.hit.score - a.hit.score ||
				// A tie goes to the folder: it is the wider choice, and a reader who
				// meant the note can type one letter more.
				rank(a.entry) - rank(b.entry),
		)
		.slice(0, limit)
		.map((one) => one.entry);
}

function rank(row: PathRow): number {
	return row.kind === "folder" ? 0 : 1;
}

class PathSuggest extends AbstractInputSuggest<PathRow> {
	/**
	 * Everything the vault holds, read once when the box is built.
	 *
	 * Not per keystroke: that mistake cost the carry picker its speed on a vault
	 * of five thousand notes (BC_E3_S31, regressie 21 aug 2026), and the same
	 * list is the same list all the while a settings pane is open.
	 */
	private readonly entries: PathRow[];

	constructor(
		app: App,
		input: HTMLInputElement,
		private readonly onPick: (path: string) => void,
	) {
		super(app, input);
		this.limit = SHOWN;

		const folders = app.vault
			.getAllFolders(false)
			.map((folder: TFolder): PathRow => ({ kind: "folder", path: folder.path }))
			.sort((a, b) => (a.path < b.path ? -1 : 1));
		const notes = app.vault
			.getMarkdownFiles()
			.map((file): PathRow => ({ kind: "note", path: file.path }))
			.sort((a, b) => (a.path < b.path ? -1 : 1));

		this.entries = [...folders, ...notes];
	}

	protected getSuggestions(query: string): PathRow[] {
		const search = prepareFuzzySearch(query);
		return pathRows(this.entries, query, (text) => search(text));
	}

	renderSuggestion(row: PathRow, el: HTMLElement): void {
		el.addClass("task-wheel-path-row");
		setIcon(
			el.createSpan({ cls: "task-wheel-path-icon" }),
			row.kind === "folder" ? "folder" : "file-text",
		);

		const line = el.createSpan();
		const search = prepareFuzzySearch(this.getValue());
		const hit = search(row.path);
		if (hit === null) line.setText(row.path);
		else renderResults(line, row.path, hit);
	}

	selectSuggestion(row: PathRow): void {
		this.setValue(row.path);
		this.onPick(row.path);
		this.close();
	}
}

/**
 * Offer folders and notes under a text box.
 *
 * `onPick` fires only when a row is chosen; what is typed by hand travels the
 * ordinary way, through the box's own change event. Both end up in the same
 * setting, and a path that names nothing is still allowed to be typed — the
 * wheel says so when it opens rather than refusing the keystroke.
 */
export function attachPathSuggest(
	app: App,
	input: HTMLInputElement,
	onPick: (path: string) => void,
): void {
	new PathSuggest(app, input, onPick);
}
