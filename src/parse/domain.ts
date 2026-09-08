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
	/**
	 * The headings above this task, outermost first, for the heading source.
	 *
	 * Absent for a note that has no task line to stand on — a note that is
	 * itself a task, or one being drawn as an empty frame. Nothing is above
	 * those, so in heading mode they land in the fallback.
	 */
	headingPath?: readonly string[];
}

/**
 * Resolve the domain for one task.
 *
 * Tag mode looks at the task's own tags first and falls back to the note's
 * front matter, so a single note can feed more than one wedge. Heading mode
 * reads the outermost heading above the task, which lets one note feed several
 * wedges too — and lets one wedge span several notes. Folder mode and property
 * mode are strictly per note. Whichever is chosen, an unresolvable task lands in
 * the configured fallback domain rather than disappearing — nothing may vanish
 * (§2.3).
 */
export function resolveDomain(
	candidates: DomainCandidates,
	options: ParseOptions,
): string {
	// The outermost heading a task sits under, whatever note that is in
	// (BC_E3_S143). For a vault that splits its work by horizon — one note for
	// today, one for this week, one for someday — the folder says nothing about
	// what a task is *about*, and the heading says everything. It collects the
	// "Thuis" of three notes into one wedge, with the three notes side by side
	// inside it — so one turn of that wedge walks the same subject across every
	// horizon.
	if (options.domainSource === "heading") {
		const outermost = candidates.headingPath?.[0];
		return outermost !== undefined && outermost.trim().length > 0
			? outermost
			: options.fallbackDomain;
	}

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
	/**
	 * How many steps of the heading path this wedge used up (BC_E3_S144).
	 *
	 * The heading rings start here, so a heading that became the wedge is not
	 * drawn again as the ring right under itself. Carried on the wedge rather
	 * than worked out a second time where the rings are made: those two used to
	 * derive it apart, and on a folder wheel in heading mode they disagreed —
	 * the wedge came from the folder while the rings still skipped a step, so
	 * the outermost heading was drawn nowhere and two different sections with
	 * the same subheading merged into one node.
	 */
	headingSteps: number;
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
	// Inside a wheel over one heading, that heading is spent — it is what this
	// wheel is *about* — so the notes it lives in become the angle (BC_E3_S146).
	// The same move the note wheel makes when the folder runs out: whatever is
	// left that can carry meaning takes over the axis (kaderdocument §4.1).
	if (options.scope.kind === "heading") {
		return {
			label: projectLabel(candidates.notePath),
			key: `n:${candidates.notePath}`,
			note: true,
			// The scope ate the outermost heading, so the rings start below it.
			headingSteps: 1,
		};
	}

	// Heading mode holds on a folder wheel too (BC_E3_S145). The rule above —
	// scope beats setting — was written when the alternatives were tags and
	// properties, and there it is right: those answer *a different question*
	// than the one the reader just asked by right-clicking a folder. The heading
	// is not a different question. It is the reader having said what a domain
	// *is* in this vault, and narrowing to a folder narrows the scope, not the
	// meaning of the angle. Measured on the owner's vault: a folder of
	// horizon-notes drew wedges called "Nu" and "Ooit", which is the axis he had
	// just set the wheel up to stop using.
	//
	// A note or section wheel still wins, because there the heading already *is*
	// the axis and nothing changes.
	if (options.domainSource === "heading" && options.scope.kind === "folder") {
		return headingsWedge(candidates, options);
	}

	if (options.scope.kind === "folder") {
		const inside = topFolder(below(candidates.notePath, options.scope.path));
		if (inside !== null) {
			return { label: inside, key: `f:${inside}`, note: false, headingSteps: 0 };
		}

		return {
			label: projectLabel(candidates.notePath),
			// By path, not by name: two notes can read the same in one folder only
			// if one of them is in a subfolder, but the key must not depend on that
			// staying true.
			key: `n:${candidates.notePath}`,
			note: true,
			headingSteps: 0,
		};
	}

	if (options.domainSource === "heading") return headingsWedge(candidates, options);

	const label = resolveDomain(candidates, options);
	return { label, key: `d:${label}`, note: false, headingSteps: 0 };
}

/**
 * The wedge a task's outermost heading names.
 *
 * `headingSteps` says how much of the path it ate, and only when the heading is
 * what actually named it: a task under no heading falls back, and a fallback
 * wedge has eaten no heading — so its own (empty) path still starts at the
 * beginning.
 */
function headingsWedge(candidates: DomainCandidates, options: ParseOptions): Wedge {
	const label = resolveDomain(candidates, options);
	const named = (candidates.headingPath?.[0]?.trim().length ?? 0) > 0;

	return { label, key: `d:${label}`, note: false, headingSteps: named ? 1 : 0 };
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
	// A heading wheel keeps to the folder it was opened from — which notes hold
	// that heading is decided in `build-tree`, where the paths are known. An
	// empty path is the whole vault.
	if (scope.kind === "heading") {
		return scope.path.length === 0 || under(path, scope.path);
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
	if (!inScope(note.path, options.scope)) return true;

	// **What you pointed the wheel at is what you get** (BC_E3_S151). A skip
	// rule is a default for the wheels you did not ask for, not a wall around a
	// note you named out loud.
	//
	// The old rule was the opposite — "never review this folder does not stop
	// being true because you zoomed in on it" — and read on its own that is
	// sound. It only ever bites in one place, though, and measuring that place
	// settles it: a skipped note is drawn nowhere, so there is no wedge to zoom
	// into and no ring to tap. The single way to a wheel over it is the file
	// menu or the command, which is a reader naming it. Under the old rule that
	// act answered with an empty circle and not a word (eigenaar, 6 sep 2026).
	//
	// The exemption covers **the subject you named and nothing else**: open a
	// checklist and you get that checklist; open a skipped folder and you get
	// its notes — but a checklist inside it stays out, because you asked for the
	// folder and not for that note.
	if (!isTheSubject(note.path, options.scope)) {
		// A whole class of document at once. A story file, a review form and a
		// meeting template all hold checkboxes by the hundred, and none of those
		// are work on your plate — they are a document's own checklist. Judged on
		// the front matter the note already carries, so nothing has to be tagged
		// by hand.
		if (isExcludedType(note.frontmatterType, options)) return true;
	}

	return isExcludedFolder(note.path, options, options.scope);
}

/** Whether this note is the very thing the wheel was pointed at. */
function isTheSubject(path: string, scope: WheelScope): boolean {
	return (
		(scope.kind === "note" || scope.kind === "section") && path === scope.path
	);
}

/**
 * Whether the folder lists put this note out of reach.
 *
 * Split out from `isExcluded` because it answers a different question from the
 * two checklist rules, and the skip report has to keep them apart: a note in an
 * excluded folder is not "a document whose checkboxes are its own checklist",
 * it is a note this wheel was never about.
 */
export function isExcludedFolder(
	path: string,
	options: ParseOptions,
	/**
	 * The wheel this is for, so a folder it was pointed at is exempt.
	 *
	 * Required, and that is the whole change (BC_E3_S172). It was optional and
	 * two callers left it out — the skip report and the duplicate report — which
	 * costs nothing today, because both always run over the whole vault. But the
	 * reports answer *"what do my rules take out"*, and the day one of them is
	 * given the wheel's own blikveld they would quietly answer it about a
	 * different one. A parameter that must be named makes that day impossible
	 * rather than unlikely; `VAULT_SCOPE` is a perfectly good answer, and now it
	 * is one somebody wrote down.
	 */
	scope: WheelScope,
): boolean {
	// An include list narrows the vault before anything else is considered.
	// Empty means the whole vault, so the setting costs nothing until it is used.
	const included = options.includeFolders.filter(
		(folder) => normalise(folder).length > 0,
	);
	if (included.length > 0 && !included.some((f) => under(path, f))) {
		return true;
	}

	return options.excludeFolders.some(
		(folder) => under(path, folder) && !named(folder, scope),
	);
}

/**
 * Whether this skip entry is the folder the wheel was pointed at.
 *
 * Only the entry that covers the scope itself steps aside; a folder skipped
 * *inside* the one you opened stays skipped, because that one you did not name
 * (BC_E3_S151).
 */
function named(folder: string, scope: WheelScope | undefined): boolean {
	const path = namedPath(scope);
	return path !== null && under(path, folder);
}

/**
 * The path the reader pointed at when this wheel was opened, if any.
 *
 * Asked of the scope as a whole rather than of three of its five kinds. A
 * folder names its own path, a note and a section the note's, and a heading
 * the folder it stays inside (BC_E3_S146) — that last rung was the one the
 * first version of `named` left out, so the exemption vanished on a heading
 * wheel and came back on the note wheel below it. Measured over the whole
 * ladder: folder exempt, heading not, note exempt again, which is a shape no
 * rule produces (found by audit, 6 sep 2026).
 *
 * The vault names nothing, and neither does a heading wheel opened from the
 * vault: its path is empty, and a reader who never said a folder out loud is
 * not asking for the ones the skip list holds back.
 */
function namedPath(scope: WheelScope | undefined): string | null {
	if (scope === undefined || scope.kind === "vault") return null;
	return scope.path === "" ? null : scope.path;
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
