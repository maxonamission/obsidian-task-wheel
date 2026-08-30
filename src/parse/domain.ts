/**
 * Deciding which domain a task belongs to.
 *
 * The domain is the angular coordinate of the wheel, so this decision is the
 * one with the most visual consequence. It is a setting (build brief §4):
 * either the top folder of the note, or a tag namespace such as
 * `#domein/werk`.
 */

import { globMatches, isBlankPattern } from "./glob";
import type { NoteInput, ParseOptions, WheelScope } from "../model/types";

/** Everything that can carry a domain hint for one task line. */
export interface DomainCandidates {
	notePath: string;
	/** Tags on the note's front matter. */
	frontmatterTags: string[];
	/** Tags on the task line itself. */
	taskTags: string[];
	/** The note's front matter, for the property source to read from. */
	frontmatter?: Readonly<Record<string, unknown>>;
}

/**
 * Resolve the domain for one task.
 *
 * Tag mode looks at the task's own tags first and falls back to the note's
 * front matter, so a single note can feed more than one wedge. Folder mode and
 * property mode are strictly per note. Whichever is chosen, an unresolvable
 * task lands in the configured fallback domain rather than disappearing —
 * nothing may vanish (§2.3).
 */
export function resolveDomain(
	candidates: DomainCandidates,
	options: ParseOptions,
): string {
	if (options.domainSource === "property") {
		return domainFromProperty(candidates.frontmatter, options.domainProperty)
			?? options.fallbackDomain;
	}

	if (options.domainSource === "tag") {
		const fromTask = domainFromTags(candidates.taskTags, options.domainTagPrefix);
		if (fromTask !== null) return fromTask;

		const fromNote = domainFromTags(
			candidates.frontmatterTags,
			options.domainTagPrefix,
		);
		if (fromNote !== null) return fromNote;

		return options.fallbackDomain;
	}

	return topFolder(candidates.notePath) ?? options.fallbackDomain;
}

/** One wedge of the circle: what it is called, and what it stands for. */
export interface Wedge {
	/** What is written on it. */
	label: string;
	/** Tells two wedges apart even when they read the same. */
	key: string;
	/** The wedge *is* this note, so there is no note ring under it. */
	note: boolean;
}

/**
 * Which wedge a task lands in.
 *
 * A wheel over one folder asks what is *in* that folder, so its angle comes
 * from the structure below it rather than from the domain setting: tags answer
 * a different question than the one the reader just asked by right-clicking a
 * folder (kaderdocument §4.1).
 *
 * **And a note lying loose in that folder is one of the things the folder
 * holds** (herziening 22 aug 2026, eigenaarsbevinding: *"waarom krijg je geen
 * twee wiggen als je maar twee documenten in die folder hebt staan"*). The old
 * rule read "the wedges are the subfolders", so every loose note fell into the
 * fallback domain together — a folder of two notes drew one wedge, and the
 * angular axis, the wheel's main coding, said nothing at all. The file list
 * shows folders and notes side by side at that level; so does the wheel now.
 *
 * That wedge is the note, not a folder standing in for it: it carries the
 * note's own kind, so carrying it away carries the note, and it has no note
 * ring under it to repeat itself with.
 */
export function resolveWedge(
	candidates: DomainCandidates,
	options: ParseOptions,
): Wedge {
	if (options.scope.kind === "folder") {
		const inside = topFolder(below(candidates.notePath, options.scope.path));
		if (inside !== null) return { label: inside, key: `f:${inside}`, note: false };

		return {
			label: projectLabel(candidates.notePath),
			// By path, not by name: two notes can read the same in one folder only
			// if one of them is in a subfolder, but the key must not depend on that
			// staying true.
			key: `n:${candidates.notePath}`,
			note: true,
		};
	}

	const label = resolveDomain(candidates, options);
	return { label, key: `d:${label}`, note: false };
}

/**
 * The domain named by one front-matter property.
 *
 * The vaults this is for keep their structure in properties rather than in
 * folders — `area: Work`, `project: Launch` — and asking the note what it is
 * about is closer to the truth than asking where it happens to be filed
 * (eigenaarsvraag 28 aug 2026).
 *
 * What a property may hold is up to the reader, so this reads three shapes and
 * refuses the rest:
 *
 *  - **Text** is the ordinary case, trimmed.
 *  - **A number or a boolean** is written out. A property that reads `2026`
 *    names a domain called "2026" — odd, but it is what the note says, and
 *    dropping it would be the wheel deciding it knows better.
 *  - **A list** yields its first usable entry. A note can only sit in one
 *    wedge — the domain is where the note *is*, not everything it touches —
 *    and the first entry is the one the reader wrote first. Tag mode remains
 *    the way to let one note feed several wedges.
 *
 * Anything else, and anything empty, yields null and so lands in the fallback
 * domain. A link or a nested object may well name something, but guessing
 * which part of it is the name is how a wheel starts moving tasks around for
 * reasons its reader cannot see.
 */
export function domainFromProperty(
	frontmatter: Readonly<Record<string, unknown>> | undefined,
	property: string,
): string | null {
	const key = property.trim();
	if (frontmatter === undefined || key.length === 0) return null;

	const value: unknown = frontmatter[key];
	if (Array.isArray(value)) {
		for (const entry of value) {
			const one = asLabel(entry);
			if (one !== null) return one;
		}
		return null;
	}

	return asLabel(value);
}

function asLabel(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length === 0 ? null : trimmed;
	}
	// `Number.isFinite` and not `typeof`: NaN and Infinity are numbers that name
	// nothing, and a wedge called "NaN" is worse than the fallback.
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
	if (typeof value === "boolean") return String(value);
	return null;
}

/**
 * First tag under the configured namespace, as a display label.
 *
 * `#domein/werk` yields `werk`; a deeper `#domein/werk/klant` still yields
 * `werk`, because the domain is the outermost ring and deeper structure
 * belongs to the rings further out.
 */
export function domainFromTags(tags: string[], prefix: string): string | null {
	const normalised = prefix.replace(/^#/, "").replace(/\/+$/, "");
	if (normalised.length === 0) return null;

	const needle = `${normalised.toLowerCase()}/`;
	for (const tag of tags) {
		const bare = tag.replace(/^#/, "");
		if (bare.toLowerCase().startsWith(needle)) {
			const rest = bare.slice(needle.length);
			const first = rest.split("/")[0];
			if (first.length > 0) return first;
		}
	}
	return null;
}

/**
 * The path as seen from inside a scope.
 *
 * `Werk/Klanten/x.md` under scope `Werk` is `Klanten/x.md`, so the ordinary
 * top-folder rule then yields `Klanten` — the re-rooted angular axis, with no
 * second code path for it.
 */
export function below(path: string, folder: string): string {
	const prefix = normalise(folder);
	if (prefix.length === 0) return path;
	return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

/** Whether a note falls inside the wheel's scope at all. */
export function inScope(path: string, scope: WheelScope): boolean {
	if (scope.kind === "vault") return true;
	// A section lives in one note; which *tasks* of that note are in view is
	// decided in `build-tree`, where the heading paths are known.
	if (scope.kind === "note" || scope.kind === "section") {
		return path === scope.path;
	}
	return under(path, scope.path);
}

/** Top-level folder of a vault-relative path, or `null` for a root note. */
export function topFolder(path: string): string | null {
	const separator = path.indexOf("/");
	if (separator <= 0) return null;
	return path.slice(0, separator);
}

/** Note basename without the extension, used as the project label. */
export function projectLabel(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	return base.replace(/\.md$/i, "");
}

/** True when the note sits under one of the excluded folder prefixes. */
export function isExcluded(note: NoteInput, options: ParseOptions): boolean {
	// The scope comes first, and an exclusion still applies inside it: "never
	// review this folder" does not stop being true because you zoomed in on it.
	if (!inScope(note.path, options.scope)) return true;

	// A whole class of document at once. A story file, a review form and a
	// meeting template all hold checkboxes by the hundred, and none of those are
	// work on your plate — they are a document's own checklist. Judged on the
	// front matter the note already carries, so nothing has to be tagged by hand.
	if (isExcludedType(note.frontmatterType, options)) return true;

	return isExcludedFolder(note.path, options);
}

/**
 * Whether the folder lists put this note out of reach.
 *
 * Split out from `isExcluded` because it answers a different question from the
 * two checklist rules, and the skip report has to keep them apart: a note in an
 * excluded folder is not "a document whose checkboxes are its own checklist",
 * it is a note this wheel was never about.
 */
export function isExcludedFolder(path: string, options: ParseOptions): boolean {
	// An include list narrows the vault before anything else is considered.
	// Empty means the whole vault, so the setting costs nothing until it is used.
	const included = options.includeFolders.filter(
		(folder) => normalise(folder).length > 0,
	);
	if (included.length > 0 && !included.some((f) => under(path, f))) {
		return true;
	}

	return options.excludeFolders.some((folder) => under(path, folder));
}

/** Whether the note's front-matter `type` puts it out of scope. */
export function isExcludedType(
	type: string | undefined,
	options: ParseOptions,
): boolean {
	if (type === undefined) return false;

	const wanted = type.trim().toLowerCase();
	if (wanted.length === 0) return false;

	return anyPattern(options.excludeNoteTypes, wanted);
}

/**
 * Whether a heading marks a checklist rather than work.
 *
 * Matched on the heading's own text, case-insensitively, anywhere in the path:
 * a checkbox three levels under "Acceptance criteria" is still part of that
 * checklist.
 */
export function isExcludedHeading(
	headingPath: readonly string[],
	options: ParseOptions,
): boolean {
	return headingPath.some((heading) =>
		anyPattern(options.excludeHeadings, heading.trim().toLowerCase()),
	);
}

/**
 * Whether a name is covered by one entry of a skip list.
 *
 * A bare word is an exact match, because a skip list is a boundary and a
 * boundary that quietly widens is worse than one that makes you type the whole
 * word. A `*` is where the reader says "and everything like it": `leestip*`
 * catches *Leestips* and *Leestip van de week*, `*criteria` catches
 * *Acceptatiecriteria*, `*tip*` catches either.
 *
 * One vault holds a dozen near-identical headings — *Acceptatiecriteria*,
 * *Acceptatie criteria*, *Acceptance criteria* — and listing them one by one is
 * how a skip list stops being maintained.
 */
export function matchesPattern(name: string, pattern: string): boolean {
	const needle = pattern.trim().toLowerCase();
	// A blank entry, or one that is nothing but stars, would skip the whole
	// vault. That is never what an empty-ish box means.
	if (isBlankPattern(needle)) return false;

	return globMatches(name, needle);
}

function anyPattern(patterns: readonly string[], name: string): boolean {
	return patterns.some((pattern) => matchesPattern(name, pattern));
}

/** Whether a note sits at or below a folder prefix. */
function under(path: string, folder: string): boolean {
	const prefix = normalise(folder);
	if (prefix.length === 0) return false;
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * A folder prefix, tidied.
 *
 * Trimmed first: a row holding nothing but a space would otherwise count as a
 * real folder that matches no note, and an include list of one such row hides
 * the entire vault. The settings list hands out an empty row on every "add",
 * so this is a state the user passes through, not an edge case.
 */
function normalise(folder: string): string {
	return folder.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}
