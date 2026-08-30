import { type App, parseFrontMatterTags, type TFile } from "obsidian";
import {
	type NoteInput,
	type ParseOptions,
	VAULT_SCOPE,
	type WheelScope,
	type WheelTree,
	TASKS_PLUGIN_ID,
} from "../model/types";
import {
	buildTreeFrom,
	outlineNotes,
	type OutlinedNote,
} from "../parse/build-tree";
import { inScope } from "../parse/domain";

/**
 * The Obsidian side of reading the vault.
 *
 * Everything Obsidian-specific about *getting* the text lives here; the moment
 * a note is read it becomes a plain `NoteInput` and the rest of the pipeline
 * is headless (build brief §5).
 */

/**
 * Whether the Tasks plugin is installed and enabled.
 *
 * Worth knowing, but not worth branching the parser on. The Tasks public API
 * (`apiV1`) is edit-oriented — it offers a task-creation modal and a
 * toggle-done helper, not a query over the vault's tasks — so reading always
 * goes through our own parser. Where the API does pay off is writing: phase 6
 * routes the done-toggle through `executeToggleTaskDoneCommand` when present,
 * so recurring tasks roll over exactly as Tasks itself would do it.
 */
export function hasTasksPlugin(app: App): boolean {
	const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } })
		.plugins;
	return plugins?.enabledPlugins?.has(TASKS_PLUGIN_ID) === true;
}

/**
 * Read the markdown notes this wheel is about, into the parser's input shape.
 *
 * The scope is applied here as well as in the parser, and on purpose: the
 * parser has to enforce it because it owns the rule, but a wheel over one note
 * that first read five thousand others would be paying the whole vault's cost
 * for one note's answer.
 */
export async function readNotes(
	app: App,
	scope: WheelScope = VAULT_SCOPE,
): Promise<NoteInput[]> {
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => inScope(file.path, scope));
	const notes: NoteInput[] = [];

	for (const file of files) {
		notes.push({
			path: file.path,
			// `cachedRead` is the right call for read-only bulk work: it serves
			// the file from Obsidian's cache instead of hitting disk per note.
			content: await app.vault.cachedRead(file),
			frontmatterTags: frontmatterTagsOf(app, file),
			frontmatterType: frontmatterTypeOf(app, file),
			frontmatter: frontmatterOf(app, file),
		});
	}

	return notes;
}

/**
 * What a scan keeps between rounds, so the next one costs a fraction.
 *
 * Reading and outlining every note in a five-thousand-note vault takes about a
 * tenth of a second, and a rescan runs on every burst of vault activity — a
 * sync landing, another plugin writing, or the reader saving one line. Doing
 * all of it again because one note changed is the bulk of what the wheel spends
 * (measured 17 aug 2026: ~200 ms a scan, of which ~110 ms is outlining alone).
 *
 * So the outline is kept per note and reused while the file has not changed.
 * That is the only thing worth keeping: outlining depends on nothing but the
 * note's own text, while everything after it — the skip rules, the filter, the
 * grouping — turns on settings that can change between two scans and is
 * therefore always redone.
 *
 * "Has not changed" is `mtime` and `size` together, which is the same pair
 * Obsidian's own caching trusts. A file rewritten within the same millisecond
 * *and* to the same length would slip through; that is a theoretical vault, and
 * the *Rescan the vault* command throws the whole cache away for the cases
 * where something has gone strange anyway.
 */
export class ScanCache {
	private readonly byPath = new Map<string, Entry>();

	/** How many notes the last scan reused rather than read. Diagnostics only. */
	reused = 0;

	/** Throw everything away — what *Rescan the vault* means literally. */
	clear(): void {
		this.byPath.clear();
		this.reused = 0;
	}

	/**
	 * Read the notes in scope, reusing what has not changed.
	 *
	 * Pruning is against the *vault*, not against the scope. Two wheels can be
	 * open at once — the whole vault in one tab, one folder in the next — and
	 * they share this cache; throwing away everything outside the scope of
	 * whichever asked last would make the two evict each other on every refresh
	 * and leave the cache worse than useless (caught by its own test, 17 aug
	 * 2026). What a scope narrows is what a scan *reads*, never what it may keep.
	 *
	 * Entries for files that are gone go here rather than on a delete event: a
	 * scan already knows the whole set, and hanging a listener on every kind of
	 * vault change to keep a map tidy is more moving parts than one pass costs.
	 */
	async read(app: App, scope: WheelScope): Promise<OutlinedNote[]> {
		const all = app.vault.getMarkdownFiles();

		const alive = new Set(all.map((file) => file.path));
		for (const path of [...this.byPath.keys()]) {
			if (!alive.has(path)) this.byPath.delete(path);
		}

		const outlined: OutlinedNote[] = [];
		this.reused = 0;

		for (const file of all) {
			if (!inScope(file.path, scope)) continue;

			const had = this.byPath.get(file.path);
			if (
				had !== undefined &&
				had.mtime === file.stat.mtime &&
				had.size === file.stat.size
			) {
				outlined.push(had.outlined);
				this.reused += 1;
				continue;
			}

			const note: NoteInput = {
				path: file.path,
				content: await app.vault.cachedRead(file),
				frontmatterTags: frontmatterTagsOf(app, file),
				frontmatterType: frontmatterTypeOf(app, file),
				frontmatter: frontmatterOf(app, file),
			};
			const entry: Entry = {
				mtime: file.stat.mtime,
				size: file.stat.size,
				outlined: outlineNotes([note])[0],
			};
			this.byPath.set(file.path, entry);
			outlined.push(entry.outlined);
		}

		return outlined;
	}
}

interface Entry {
	mtime: number;
	size: number;
	outlined: OutlinedNote;
}

/**
 * Scan what the wheel is about and build it in one go.
 *
 * Without a cache this reads and outlines everything, which is what it always
 * did and what the tests still exercise.
 */
export async function scanVault(
	app: App,
	options: ParseOptions,
	cache?: ScanCache,
): Promise<WheelTree> {
	const outlined =
		cache === undefined
			? outlineNotes(await readNotes(app, options.scope))
			: await cache.read(app, options.scope);

	return buildTreeFrom(outlined, options);
}

/**
 * Tags on the note's front matter, without the leading `#`.
 *
 * Deliberately front matter only, not `getAllTags`: an inline tag somewhere in
 * the prose says something about that sentence, not about the note as a whole,
 * and using it as a domain fallback would move tasks around for reasons the
 * user cannot see.
 */
/**
 * The note's own `type`, when it declares one.
 *
 * Vaults that keep a document standard put it there — `type: story`,
 * `type: review` — and that is a far better statement of "this note's
 * checkboxes are its own checklist" than anything the wheel could infer from
 * the text.
 */
function frontmatterTypeOf(app: App, file: TFile): string | undefined {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const type: unknown = frontmatter?.["type"];
	return typeof type === "string" ? type : undefined;
}

/**
 * The note's front matter as Obsidian already has it.
 *
 * A reference, not a copy: `metadataCache` holds this object anyway, so five
 * thousand notes cost five thousand pointers. Handed over whole because the
 * setting decides which key is the domain, and applying a setting here would
 * survive in the outline cache after the setting changed (BC_E3_S81).
 */
function frontmatterOf(
	app: App,
	file: TFile,
): Readonly<Record<string, unknown>> | undefined {
	return app.metadataCache.getFileCache(file)?.frontmatter;
}

function frontmatterTagsOf(app: App, file: TFile): string[] {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (frontmatter === undefined) return [];
	return parseFrontMatterTags(frontmatter)?.map((tag) => tag.replace(/^#/, "")) ?? [];
}
