/**
 * Just enough of Obsidian for the vault layer to be testable at all.
 *
 * `src/vault/` is the one layer that has to import from `obsidian`, and that
 * import is why none of it had a test — the audit of 17 aug 2026 named that as
 * a gap and it is how two bugs in `writeCarry`'s reporting survived. A stub
 * aliased in `vitest.config.ts` costs nothing and takes the excuse away.
 *
 * Deliberately not a fake Obsidian. Only the handful of values that are used at
 * *module* level or as a runtime check; anything richer would be a second
 * implementation to keep in step with the real one, which is worse than no test.
 */

/** Used with `instanceof`, so it has to be a real class with the real shape. */
export class TFile {
	path = "";
	basename = "";
	extension = "md";
	stat = { mtime: 0, ctime: 0, size: 0 };
}

/** Extended by the settings tab, so it has to be a class even here. */
export class PluginSettingTab {
	app: unknown;
	containerEl: unknown;
	constructor(app: unknown) {
		this.app = app;
	}
	display(): void {
		/* nothing to draw without a real Obsidian */
	}
}

export class Setting {
	constructor(_el: unknown) {
		/* nothing to build without a real Obsidian */
	}
}

export class Modal {
	app: unknown;
	constructor(app: unknown) {
		this.app = app;
	}
}

/** Extended by the two pickers, so it has to be a class at module level. */
export class FuzzySuggestModal<T> {
	app: unknown;
	constructor(app: unknown) {
		this.app = app;
	}
	getItems(): T[] {
		return [];
	}
}

export class SuggestModal<T> {
	app: unknown;
	limit = 0;
	constructor(app: unknown) {
		this.app = app;
	}
	setPlaceholder(_text: string): void {
		/* no input box without a real Obsidian */
	}
	getSuggestions(_query: string): T[] {
		return [];
	}
	onClose(): void {
		/* nothing mounted, nothing to tear down */
	}
}

/**
 * The real matcher scores subsequences; this one only has to say hit or miss,
 * because what the tests are about is which rows come back and in what order —
 * and they hand `noteRows` their own scorer to decide that.
 */
export function prepareFuzzySearch(
	query: string,
): (text: string) => SearchResult | null {
	const needle = query.toLowerCase();
	return (text: string) =>
		text.toLowerCase().includes(needle) ? { score: 0, matches: [] } : null;
}

export function renderResults(
	el: { setText(text: string): void },
	text: string,
	_hit: SearchResult,
): void {
	el.setText(text);
}

/** Extended by the path suggester, so it has to be a class at module level. */
export class AbstractInputSuggest<T> {
	app: unknown;
	limit = 0;
	constructor(app: unknown, _input: unknown) {
		this.app = app;
	}
	getValue(): string {
		return "";
	}
	setValue(_value: string): void {
		/* no input box without a real Obsidian */
	}
	close(): void {
		/* nothing is open */
	}
	getSuggestions(_query: string): T[] {
		return [];
	}
}

export class ItemView {
	constructor(_leaf: unknown) {
		/* nothing to mount without a real Obsidian */
	}
}

export class MarkdownView {}

export class Notice {
	constructor(public message: string) {}
}

export class TAbstractFile {
	path = "";
}

export function debounce<T extends (...args: never[]) => unknown>(
	fn: T,
	_wait?: number,
	_leading?: boolean,
): T {
	return fn;
}

export function setIcon(_el: unknown, _icon: string): void {
	/* no icons without a real Obsidian */
}

export class TFolder {
	path = "";
	children: unknown[] = [];
}

export function parseFrontMatterTags(
	frontmatter: Record<string, unknown> | null,
): string[] | null {
	const tags = frontmatter?.["tags"];
	if (Array.isArray(tags)) {
		return tags.filter((tag): tag is string => typeof tag === "string");
	}
	return typeof tags === "string" ? [tags] : null;
}

/** Types only — they exist so the imports resolve, never to be instantiated. */
export type App = unknown;
export type SettingDefinitionItem = unknown;
export type Vault = unknown;
export type MetadataCache = unknown;
export type EventRef = unknown;
export type WorkspaceLeaf = unknown;
export type ViewStateResult = unknown;
export type FuzzyMatch<T> = { item: T };
export type SearchResult = { score: number; matches: Array<[number, number]> };
export type Menu = unknown;
