/**
 * The shared vocabulary of Task Wheel.
 *
 * This module is deliberately dependency-free — no Obsidian, no d3, no
 * runtime imports at all. Everything downstream (parse/, layout/, view/)
 * speaks these types, which is what keeps the layout headless-testable.
 */

/** What a node represents. The kind implies its ring, not the other way round. */
export type NodeKind = "root" | "domain" | "project" | "group" | "task";

/**
 * Priority as expressed by the Obsidian Tasks emoji set. `normal` is the
 * absence of a priority marker, not a marker of its own.
 */
export type Priority = "highest" | "high" | "medium" | "normal" | "low" | "lowest";

/** Numeric rank for sorting and for the colour ramp; higher is more urgent. */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = {
	highest: 5,
	high: 4,
	medium: 3,
	normal: 2,
	low: 1,
	lowest: 0,
};

/**
 * Where a node came from in the vault.
 *
 * `line` is intentionally *not* part of a node's identity: it changes every
 * time a line is inserted above the task. It exists so a review action can
 * find the line again and write back to it. Identity lives in `WheelNode.id`.
 */
export interface SourceRef {
	/** Vault-relative path of the note, including the `.md` extension. */
	path: string;
	/** Zero-based line index of the task line at the time of the last scan. */
	line: number;
	/** Leading whitespace width in columns, with tabs expanded. */
	indent: number;
	/** Headings above the line, outermost first. Empty when the note has none. */
	headingPath: string[];
	/**
	 * The line as it read at the scan, or `null` for a node that stands for a
	 * whole note rather than one line.
	 *
	 * The wheel is drawn from a scan that may be minutes old, and until BC_E3_S44
	 * it remembered only *which line* a heading or a task sat on. Anything that
	 * shifted the lines in between — a sync, a split pane — could put a different
	 * heading or a neighbouring task at that index, and the edit would be carried
	 * out faultlessly on the wrong thing (audit, 23 aug 2026).
	 */
	raw: string | null;
}

/**
 * What a checkbox says about itself.
 *
 * The four statuses Obsidian Tasks defines: ` ` open, `/` in progress, `x`
 * done, `-` cancelled. Anything else is somebody's own custom status, and it
 * counts as **open** — an unknown character is not a reason to drop work from a
 * round, and the wheel's whole promise is that nothing goes quiet.
 */
export type TaskState = "open" | "in-progress" | "done" | "cancelled";

/**
 * Whether this is off your plate.
 *
 * Done and cancelled are different things to a person — one you did, one you
 * decided not to do — but to a review round they are the same: there is nothing
 * left to look at. In progress is the opposite: it is the work most obviously
 * still yours.
 */
export function isFinished(fields: TaskFields | undefined): boolean {
	return fields?.state === "done" || fields?.state === "cancelled";
}

/**
 * Obsidian Tasks fields, parsed but never re-serialised from scratch.
 *
 * `raw` holds the untouched line so a review action can rewrite one field and
 * leave the rest of the line — including syntax we do not model — exactly as
 * the user wrote it (build brief §4).
 */
export interface TaskFields {
	/** The character between the brackets: " " for open, "x" for done, etc. */
	statusChar: string;
	/** True when the status character marks completion (`x` or `X`). */
	done: boolean;
	/** What that character means. See `TaskState`. */
	state: TaskState;
	/** Due date, ISO `YYYY-MM-DD`, from 📅. */
	due?: string;
	/** Scheduled date from ⏳ (or its variation-selector-free twin). */
	scheduled?: string;
	/** Start date from 🛫. */
	start?: string;
	/** Creation date from ➕. */
	created?: string;
	/** Completion date from ✅. */
	completed?: string;
	/** Cancellation date from ❌. */
	cancelled?: string;
	/** Recurrence rule text from 🔁, kept verbatim — we never interpret it. */
	recurrence?: string;
	/** Task id from 🆔, when present. */
	taskId?: string;
	/** Ids this task depends on, from ⛔. */
	dependsOn: string[];
	priority: Priority;
	/** Tags found in the description, without the leading `#`. */
	tags: string[];
	/** The description with all recognised fields and tags stripped out. */
	description: string;
	/** The original line, unmodified. */
	raw: string;
}

/**
 * One node of the wheel.
 *
 * `depth` is the ring: 0 is the root, 1 a domain, 2 a project, 3 and beyond
 * the headings, tasks and subtasks (build brief §1).
 */
export interface WheelNode {
	/**
	 * Stable identity, derived from content and location rather than from the
	 * line number. A task that shifts three lines down keeps its id, and
	 * therefore keeps its seen-flag, its pinned position and its collapsed
	 * state across a rescan.
	 */
	id: string;
	kind: NodeKind;
	/** Display label. For tasks this is the description with fields stripped. */
	label: string;
	/** Ring index. */
	depth: number;
	/** Domain key this node belongs to, inherited from the domain ancestor. */
	domain: string;
	/**
	 * Deterministic ordering key within the parent. Structural on purpose:
	 * ordering by due date would reshuffle the wheel every night and destroy
	 * the spatial memory the whole concept rests on. Urgency rides the colour
	 * channel instead (build brief §2.1 and §2.4).
	 */
	sortKey: string;
	children: WheelNode[];
	/**
	 * Items of this round in this subtree, itself included.
	 *
	 * Not "not ticked off": with finished work in play a finished task is one of
	 * the round's items, and outside it a finished task only survives on the tree
	 * as a carrier for open work below it and is not one. Every count the reader
	 * sees is drawn from this — the hub, a stump, the remainder, and whether
	 * there is anything to review at all — so the name says *shown* rather than
	 * *open*, and the compiler makes every reader say which one it meant.
	 */
	shownTaskCount: number;
	/** Tasks in this subtree, done or not. */
	totalTaskCount: number;
	source?: SourceRef;
	/** Present exactly when `kind === "task"`. */
	fields?: TaskFields;
}

/**
 * Id the Obsidian Tasks plugin registers itself under.
 *
 * One copy: the scan asks whether it is installed and the write path asks it
 * for its toggle, and two spellings of the same id would fail apart silently —
 * the wheel would tick a box itself while believing Tasks was doing it.
 */
export const TASKS_PLUGIN_ID = "obsidian-tasks-plugin";

/** Taking work somewhere: a copy stays behind, a move does not. */
export type CarryHow = "move" | "copy";

/**
 * A destination worth naming, so getting there is one action.
 *
 * Sorting a day's work means carrying a hundred items to the same four places
 * (owner, 18 aug 2026: "GTD Action, DoThisWeek, LaterMaybe, WaitingFor"), and
 * every one of those cost two pickers. A preset is those two answers, kept.
 *
 * `how` is per preset rather than one setting for all of them, because the
 * two are genuinely different intentions: *DoThisWeek* takes the task off the
 * backlog, while a reference you meet while reviewing should be copied — taking
 * it out of the document that explains it would break that document.
 */
export interface CarryPreset {
	/** What the reader calls it. Shown on the menu, and in the command list. */
	name: string;
	/** Vault-relative path of the note it lands in. */
	notePath: string;
	/**
	 * Heading path in that note, outermost first — or `null` to keep the
	 * heading path the item already had, making it there if needed.
	 */
	headingPath: string[] | null;
	how: CarryHow;
}

/** A parsed vault: the tree plus the lookups the view needs. */
export interface WheelTree {
	root: WheelNode;
	/**
	 * Open tasks the filter left out.
	 *
	 * Carried so the wheel can say what it is not showing. A filter that hid
	 * work silently would break the one promise the wheel makes (§3.3).
	 */
	filteredOut: number;
	/**
	 * Whether finished work is deliberately part of this round.
	 *
	 * Either the setting says so or the filter asked for it. Every count on the
	 * wheel turns on this: with finished work in play a finished task *is* an
	 * item of the round, and outside it a finished task only survives as a
	 * carrier for open work below it and must not be counted as work itself.
	 */
	showsFinished: boolean;
	/** Domain keys in wedge order — the order the layout hands out budgets in. */
	domains: string[];
	byId: ReadonlyMap<string, WheelNode>;
	/** Notes that produced no tasks at all, useful for diagnostics. */
	emptyNotes: string[];
	/**
	 * On a section wheel: the note no longer holds this heading path at all —
	 * renamed or removed. Distinct from a section that is merely empty, and
	 * the view says so out loud rather than showing a circle about nothing
	 * (BC_E3_S64). Absent on every other scope.
	 */
	sectionMissing?: boolean;
}

/** A note as handed to the parser. Deliberately not an Obsidian `TFile`. */
export interface NoteInput {
	/** Vault-relative path including the extension. */
	path: string;
	/** Full note text. */
	content: string;
	/** Tags from the note's front matter, without the leading `#`. */
	frontmatterTags?: string[];
	/** The note's front-matter `type`, when it has one. */
	frontmatterType?: string;
}

/** Where the domain of a task comes from. */
export type DomainSource = "folder" | "tag";

/** Everything the parser needs to know about user preferences. */
/**
 * How much of the vault one wheel draws.
 *
 * Not a filter: the scope also decides what the **angle** means. A wheel over
 * one folder would otherwise be a single 360° wedge, and the angular channel —
 * half the wheel's grammar — would say nothing at all (kaderdocument §4.1).
 */
export type WheelScope =
	| { kind: "vault" }
	| { kind: "folder"; path: string }
	| { kind: "note"; path: string }
	/**
	 * One section of one note — the fourth rung of the ladder (BC_E3_S64).
	 *
	 * `heading` is the full path of titles from the note's top down to the
	 * section's own heading, because a bare title is not an identity: two
	 * sections may share a name under different parents. Two sections that
	 * share the *whole* path already merge into one node on the note wheel,
	 * so this scope inherits exactly the tree's own identity semantics —
	 * no new ambiguity is introduced here.
	 */
	| { kind: "section"; path: string; heading: string[] };

export const VAULT_SCOPE: WheelScope = { kind: "vault" };

/** A stable key for a scope, for keeping state per wheel. */
export function scopeKey(scope: WheelScope): string {
	if (scope.kind === "vault") return "vault";
	if (scope.kind === "section") {
		return `section:${scope.path}#${scope.heading.join("#")}`;
	}
	return `${scope.kind}:${scope.path}`;
}

/** What the tab is called, and what the wheel is a wheel of. */
export function scopeLabel(scope: WheelScope): string {
	if (scope.kind === "vault") return "Task wheel";
	if (scope.kind === "section") {
		return scope.heading[scope.heading.length - 1] ?? scope.path;
	}

	const base = scope.path.slice(scope.path.lastIndexOf("/") + 1);
	return scope.kind === "note" ? base.replace(/\.md$/i, "") : base;
}

/**
 * The blikveld one step wider than this one.
 *
 * Tapping an item twice opens a wheel over it, which is the way *in*; there was
 * no way out (eigenaar, 22 aug 2026). A note goes out to the folder it is in, a
 * folder to the folder above it, and anything directly in the root to the whole
 * vault. The vault has nothing above it, which is what `null` says.
 *
 * The path is walked here rather than asked of the vault on purpose: going out
 * has to work while a note is being renamed or a folder is briefly missing, and
 * "everything up to the last slash" is true whatever the vault is doing.
 */
export function outward(scope: WheelScope): WheelScope | null {
	if (scope.kind === "vault") return null;

	// A section goes out to its note — one rung, not straight to the folder:
	// the ladder is climbed the way it was descended.
	if (scope.kind === "section") return { kind: "note", path: scope.path };

	const cut = scope.path.lastIndexOf("/");
	if (cut <= 0) return VAULT_SCOPE;
	return { kind: "folder", path: scope.path.slice(0, cut) };
}

/** How a due date is weighed by a filter. */
export type DateRule =
	| "any"
	| "overdue"
	| "soon"
	| "dated"
	| "undated"
	/** Parked: a start (🛫) or scheduled (⏳) date that has not arrived yet. */
	| "parked"
	/** The other side of it: everything that is not parked. */
	| "ready";

/**
 * Which statuses a round is about.
 *
 * Deliberately not one option per status character. "Finished" covers done and
 * cancelled together, because that is how a round sees them, and it only has
 * anything to select from when finished work is being shown at all.
 */
export type StatusRule = "any" | "open" | "in-progress" | "finished";

/**
 * Which tasks a round is about.
 *
 * The shape lives here with the other types; the rules that read it live in
 * `parse/filter`, which is where the thinking is and where the tests are.
 */
export interface TaskFilter {
	/** Words that must all appear in the task's own text. */
	text: string;
	due: DateRule;
	/** How many days "soon" reaches. */
	horizon: number;
	/** Which statuses count. */
	status: StatusRule;
	/** Lowest priority that still counts, or `any`. */
	minPriority: Priority | "any";
	/**
	 * Highest priority that still counts, or `any`.
	 *
	 * The pair makes a band. One bound alone only ever selects "this and up",
	 * and the move that wanted the other half is a real one: sweeping a batch of
	 * low-priority work into a someday note (owner, 18 aug 2026).
	 */
	maxPriority: Priority | "any";
	/** Tasks must carry at least one of these, when the list is not empty. */
	withTags: string[];
	/** Tasks carrying any of these are left out. */
	withoutTags: string[];
}

export const NO_FILTER: TaskFilter = {
	text: "",
	due: "any",
	horizon: 14,
	status: "any",
	minPriority: "any",
	maxPriority: "any",
	withTags: [],
	withoutTags: [],
};

export interface ParseOptions {
	domainSource: DomainSource;
	/** Tag namespace scanned for the domain, e.g. `domein` for `#domein/werk`. */
	domainTagPrefix: string;
	/** Domain used when neither folder nor tag yields one. */
	fallbackDomain: string;
	/** Treat headings as an extra grouping ring between project and tasks. */
	useHeadingsAsGroups: boolean;
	/** Include completed tasks. Off by default: the wheel reviews open work. */
	includeCompleted: boolean;
	/** Vault-relative folder prefixes to skip entirely. */
	excludeFolders: string[];
	/**
	 * Vault-relative folder prefixes to read, to the exclusion of everything
	 * else. Empty means the whole vault.
	 *
	 * The mirror of `excludeFolders`, and in a large vault the practical one:
	 * naming the four folders that hold your tasks beats naming the ninety that
	 * do not. Excluding still applies on top, so a subfolder of an included
	 * folder can be left out.
	 */
	includeFolders: string[];
	/**
	 * Notes whose front-matter `type` is one of these are skipped entirely.
	 *
	 * A whole class of document at once: story files, meeting templates, review
	 * forms. They hold checkboxes by the hundred, and none of them are work to be
	 * reviewed on the wheel.
	 */
	excludeNoteTypes: string[];
	/**
	 * Headings whose checkboxes are not tasks.
	 *
	 * The surgical one. An acceptance-criteria list is a checklist that belongs
	 * to a document, not work on your plate — but a real task two headings up in
	 * the same note still is, so this leaves the rest of the note alone.
	 */
	excludeHeadings: string[];
	/**
	 * The part of the vault this wheel is about.
	 *
	 * Whole vault by default, so nothing about the ordinary wheel changes.
	 */
	scope: WheelScope;
	/** Which tasks a round is about. See `parse/filter`. */
	filter: TaskFilter;
	/** The day the filter is judged against, ISO. Handed in, never read here. */
	today: string;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
	domainSource: "folder",
	domainTagPrefix: "domein",
	fallbackDomain: "Overig",
	useHeadingsAsGroups: true,
	includeCompleted: false,
	excludeFolders: [],
	includeFolders: [],
	excludeNoteTypes: [],
	excludeHeadings: [],
	scope: VAULT_SCOPE,
	filter: NO_FILTER,
	today: "1970-01-01",
};
