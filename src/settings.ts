import {
	App,
	Notice,
	PluginSettingTab,
	type SettingDefinitionItem,
	type SettingGroupItem,
} from "obsidian";
import { today } from "./model/dates";
import {
	DATE_FIELD_LABELS,
	DUE_LABELS,
	picksADate,
	STATUS_LABELS,
	windowLabels,
} from "./view/filter-labels";
import {
	DEFAULT_PALETTE,
	type PaletteName,
	paletteSize,
	PRIORITY_LADDER,
} from "./layout/colour";
import {
	type CarryPreset,
	type DateField,
	type DateRule,
	DEFAULT_PARSE_OPTIONS,
	type DomainSource,
	NO_FILTER,
	type Priority,
	type StatusRule,
	type TaskFilter,
	type ParseOptions,
	scopeKey,
	VAULT_SCOPE,
	type WheelScope,
} from "./model/types";
import type TaskWheelPlugin from "./main";
import { pickTarget } from "./view/carry-flow";
import { roundRestartedMessage } from "./view/round";
import { attachPathSuggest } from "./view/path-suggest";
import { LANGUAGE_NAMES } from "./view/help-strings";

/**
 * Plugin-owned state that is not a user preference but must survive a restart
 * (build brief §4). Empty in this phase; the shape is fixed now so the later
 * phases do not need a data.json migration.
 */
export interface WheelState {
	/** Angular budget in degrees per domain. Absent means "share equally". */
	domainBudgets: Record<string, number>;
	/** Ids of branches the user collapsed to a stump. */
	collapsed: string[];
	/** Ids marked as seen in the current sweep. */
	seen: string[];
	/** Start of the current sweep, ISO timestamp, or null when none is running. */
	sweepStartedAt: string | null;
	/** How far the reader has closed in on the reading wedge. One is the whole wheel. */
	zoom: number;
	/**
	 * The item under the reading wedge when the wheel last came to rest.
	 *
	 * So a round survives closing the tab and closing Obsidian: you come back to
	 * the item you were reading rather than to the start of a round you are
	 * halfway through (eigenaar, 23 aug 2026). Kept per blikveld, next to the
	 * round it belongs to, and cleared when a new round is started — a new round
	 * *does* begin at the beginning.
	 *
	 * By id, so it survives a rescan the same way the seen-marks do; an id that
	 * is no longer in the tree is simply ignored, which is what happens to the
	 * task you were reading when you finish it in the editor.
	 */
	reading?: string | null;
	/**
	 * What each domain weighed when the current round began, when the wedges
	 * divide by open tasks (setting `wedgeDivision`). Frozen so the drawing
	 * cannot move under the reader's hands mid-round: ticking work off changes
	 * the vault, not these numbers. Cleared on every round boundary — a new
	 * round, a changed selection, or a changed division setting — and absent
	 * (like `reading`) on a data.json from before the feature.
	 */
	roundWeights?: Record<string, number> | null;
	/**
	 * The wedge order this round was dealt with.
	 *
	 * Holds hue and place for every domain the round began with — including one
	 * whose last task has been ticked off, because an empty wedge is what makes
	 * the place mean something. A domain that turns up mid-round is appended
	 * rather than sorted in, so it can take a width but never somebody else's
	 * colour (BC_E3_S82). Cleared on the same round boundaries as
	 * `roundWeights`, plus whenever the domain *source* changes — a different
	 * source is a different set of wedges, not a re-deal of the same ones.
	 */
	roundDomains?: string[] | null;
	/**
	 * What this wheel's round is about.
	 *
	 * Per blikveld, beside the round it defines. It used to be plugin-wide, so
	 * two wheels open at once took each other's filter over — never decided,
	 * just a consequence of where the fields had landed (owner, 18 aug 2026).
	 * The kaderdocument is clear that a filter is *part of a round* and not
	 * configuration (§4); a part of the round belongs next to the round.
	 *
	 * Absent on a bucket written before that move, which is what the migration
	 * in `loadSettings` reads: those get a copy of the old plugin-wide filter, so
	 * a local wheel comes back after the upgrade looking exactly as it did.
	 * The vault wheel keeps using the flat fields, so `data.json` needs no
	 * rewriting at all.
	 */
	filter?: TaskFilter;
}

/**
 * How much of the vault the wheel draws at once.
 *
 * A ceiling on items, not on tasks: the vault may hold thousands, the drawing
 * does not grow with it (kaderdocument §3 eis 6).
 */
export type WheelDetail = "compact" | "balanced" | "dense";

/*
 * There is no longer a choice of where the wheel opens.
 *
 * It was `home: "main" | "sidebar"`, and it went on 25 aug 2026 with the help
 * panel: the right sidebar is that panel's home now, and "wheel in the sidebar"
 * plus "help in the sidebar" stacks two panels in a strip three hundred pixels
 * wide. Dropping it takes away a broken combination, not a useful one — and a
 * stored `home: "sidebar"` simply stops being read (kaderdocument §5.2).
 */

export const DETAIL_BUDGETS: Readonly<Record<WheelDetail, number>> = {
	compact: 120,
	balanced: 240,
	dense: 400,
};

export interface TaskWheelSettings
	extends Omit<ParseOptions, "today" | "filter"> {
	/**
	 * The filter, flat.
	 *
	 * Flat because the settings tab binds a control to a settings *key*, and a
	 * key is one level deep. Nesting it read better in the code and did not
	 * render at all, which is the wrong trade — `filterOf` puts it back
	 * together for everything downstream.
	 */
	/** Words that must appear in a task's own text. */
	filterText: string;
	filterDue: DateRule;
	filterHorizon: number;
	/** The window the `between` rule looks at, as ISO dates (BC_E3_S126). */
	filterFrom: string;
	filterUntil: string;
	filterDateField: DateField;
	/** The heading work has to stand under, or empty for any (BC_E3_S147). */
	filterHeading: string;
	filterStatus: StatusRule;
	filterMinPriority: Priority | "any";
	filterMaxPriority: Priority | "any";
	filterWithTags: string[];
	filterWithoutTags: string[];
	excludeNoteTypes: string[];
	excludeHeadings: string[];
	/** Front-matter property that marks a note as being one task (BC_E3_S130). */
	taskNoteProperty: string;
	/** Values it may carry, or empty when having the property is enough. */
	taskNoteValues: string[];
	/** Property that carries such a note's status. */
	taskNoteDoneProperty: string;
	/** Extra values of that property that also mean finished. */
	taskNoteDoneValues: string[];
	/** The four words this vault uses for the wheel's four states. */
	taskNoteOpenValue: string;
	taskNoteDoingValue: string;
	taskNoteDoneValue: string;
	taskNoteCancelledValue: string;
	/** Whether the filter panel in the pane stands open. */
	filterPanelOpen: boolean;
	/**
	 * State of the wheels that are not the vault wheel, keyed by scope.
	 *
	 * A local wheel has its own domains, so it needs its own budgets, its own
	 * folds and its own zoom — sharing them would mean folding a branch in one
	 * wheel quietly folded something in another (kaderdocument §4.1).
	 */
	scopes: Record<string, WheelState>;
	/**
	 * Open the vault wheel when Obsidian starts.
	 *
	 * Off by default: deciding what a vault opens on is the reader's, and a
	 * plugin that takes a tab on every start without being asked is a plugin
	 * that gets turned off. On, it is the review that begins the day — the
	 * reason the wheel exists (eigenaarsvraag 21 aug 2026).
	 *
	 * Obsidian restores the layout it was closed with, so a wheel that was open
	 * comes back anyway. This is for the wheel that is *always* there, whatever
	 * the last session looked like.
	 */
	openOnStart: boolean;
	/**
	 * What that startup wheel is about: a folder, a note, or the whole vault.
	 *
	 * Empty is the whole vault. A path is stored rather than a `WheelScope`
	 * because it is one typed field and the vault is what decides whether it
	 * names a folder or a note — see `parse/start-scope.ts`.
	 */
	startPath: string;
	detail: WheelDetail;
	/**
	 * How the circle is divided over the domains.
	 *
	 * "equal" is the original hard requirement: every domain the same slice,
	 * whatever it holds, so spatial memory gets the strongest guarantee.
	 * "tasks" trades a little of that for proportion — busier domains get wider
	 * wedges — but only between rounds: the weights are frozen when a round
	 * begins (kaderdocument §3.1, herzien 26 aug 2026).
	 */
	wedgeDivision: "equal" | "tasks";
	/**
	 * The narrowest a proportional wedge may get, in degrees.
	 *
	 * The owner's condition on the whole feature: a sliver that cannot carry
	 * its own name is a bad pie chart, not a wheel. Quiet domains stop at this
	 * width instead of shrinking away.
	 */
	wedgeMinimum: number;
	/**
	 * Which hues the wedges are handed, in order.
	 *
	 * A named selection of the theme's own hues — never colour values of our
	 * own, which is what keeps a theme in charge of what "blue" looks like
	 * (BC_E3_S72). Plugin-wide rather than per blikveld: the filter and the
	 * round belong to a blikveld because they are about *what you are
	 * reviewing now*, while a palette is about how things look, and that
	 * should not flip when you open a smaller wheel.
	 */
	wedgePalette: PaletteName;
	/**
	 * What tapping your way *into* a wheel does with the tab you were in.
	 *
	 * Only stepping within a wheel — in through an item, out through the way
	 * back. A wheel opened from the file list, the ribbon or a command is one
	 * you asked for and still gets a tab of its own.
	 *
	 * Reusing is the default because the ladder is deep and the tabs added up:
	 * folder to note to section is three taps, and every branch you looked at
	 * left one behind. Twenty of them by the end of a round, on a desktop
	 * (eigenaar, 28 aug 2026). It costs nothing to walk back either — a
	 * blikveld keeps its own round, filter, zoom and folds wherever it is
	 * opened, so the wheel you return to is the wheel you left.
	 */
	stepInto: "same-tab" | "new-tab";
	/**
	 * What one step sideways walks: every task, or the reader's own ring.
	 *
	 * Both are the same order seen through a different filter, so neither can
	 * skip anything the other reaches; the difference is only which items the
	 * step stops on. It shows up deep in a tree (BC_E3_S94):
	 *
	 *  - **`"tasks"`** — the next task, wherever it hangs. No branch is a dead
	 *    end. The default, because that is what a reader walking their work
	 *    wants, and because the alternative traps you: a depth that exists in
	 *    one branch only is a ring of that branch alone, and a long branch
	 *    ending in three tasks then walks round those three for ever (eigenaar,
	 *    1 sep 2026).
	 *  - **`"ring"`** — the next item at the reader's own depth, across
	 *    branches. Keeps the eye at one radius, which is the move for comparing
	 *    the same level of two projects.
	 *
	 * Whichever is not chosen is on **Shift** with the arrows, so both are
	 * always to hand on a keyboard. The two buttons beside the card follow the
	 * setting on a desktop; **on a phone they always walk every task**, because
	 * there the coarse movement is a finger on the disc and there is no Shift to
	 * borrow the other with (eigenaar, 1 sep 2026).
	 */
	arrowStep: "tasks" | "ring";
	/**
	 * What a click on the task's title opens — and, since BC_E3_S115, what
	 * *Add task* and *Add subtask* open too.
	 *
	 * The wheel's own box rewrites the words and nothing else, which is the
	 * right size for a review. The Tasks plugin's window is the whole task —
	 * dates, recurrence, dependencies, your own status set — and it is already
	 * installed for anyone who says "in Tasks" here. Adding a task is the same
	 * question asked about a blank one, so it follows the same answer rather
	 * than getting a setting of its own that could drift from this one.
	 *
	 * Not a button, deliberately: the row on the card is full at eight, and
	 * editing the outline already sits behind one ellipsis rather than four
	 * because of it. This costs no room at all — the gesture exists, and the
	 * setting only says what it opens.
	 *
	 * Without the Tasks modal (not installed, or older than 7.21.0) this has
	 * nothing to switch to and the inline box opens either way — for editing
	 * and for adding alike.
	 */
	editTask: "inline" | "tasks";
	/**
	 * Show what the wheel receives from the device.
	 *
	 * Off by default and not a feature: it exists because the wheel has to work
	 * on devices this code is never run on, and a gesture that does nothing
	 * there cannot be debugged from here.
	 */
	diagnostics: boolean;
	/**
	 * The language of the help surface.
	 *
	 * "auto" follows Obsidian's own language setting (Settings → General →
	 * Language); a code from `HELP_LOCALES` overrides it. Kept as a plain
	 * string so an old data.json with a language we since dropped falls back
	 * to auto-resolution instead of failing to load.
	 */
	language: string;
	/**
	 * Named destinations, in the order the reader put them.
	 *
	 * Plugin-wide rather than per blikveld: where *LaterMaybe* lives is a fact
	 * about the vault, not about which wheel you happen to be looking at.
	 */
	presets: CarryPreset[];
	state: WheelState;
}

export const DEFAULT_STATE: WheelState = {
	domainBudgets: {},
	collapsed: [],
	seen: [],
	sweepStartedAt: null,
	zoom: 1,
	reading: null,
	roundWeights: null,
	roundDomains: null,
};

export const DEFAULT_SETTINGS: TaskWheelSettings = {
	...DEFAULT_PARSE_OPTIONS,
	filterText: NO_FILTER.text,
	filterDue: NO_FILTER.due,
	filterHorizon: NO_FILTER.horizon,
	filterFrom: NO_FILTER.from,
	filterUntil: NO_FILTER.until,
	filterDateField: NO_FILTER.dateField,
	filterHeading: NO_FILTER.heading,
	filterStatus: NO_FILTER.status,
	filterMinPriority: NO_FILTER.minPriority,
	filterMaxPriority: NO_FILTER.maxPriority,
	filterWithTags: [],
	filterWithoutTags: [],
	excludeNoteTypes: [],
	excludeHeadings: [],
	taskNoteProperty: "",
	taskNoteValues: [],
	taskNoteDoneProperty: "status",
	taskNoteDoneValues: [],
	taskNoteOpenValue: "todo",
	taskNoteDoingValue: "doing",
	taskNoteDoneValue: "done",
	taskNoteCancelledValue: "cancelled",
	filterPanelOpen: false,
	openOnStart: false,
	startPath: "",
	detail: "balanced",
	wedgeDivision: "equal",
	wedgePalette: DEFAULT_PALETTE,
	stepInto: "same-tab",
	arrowStep: "tasks",
	editTask: "inline",
	wedgeMinimum: 15,
	diagnostics: false,
	language: "auto",
	presets: [],
	state: { ...DEFAULT_STATE },
	scopes: {},
};

/**
 * The state belonging to one wheel.
 *
 * The vault wheel keeps the original field, so an existing `data.json` needs no
 * migration; every other wheel gets a bucket of its own, made on first use.
 */
export function stateFor(
	settings: TaskWheelSettings,
	scope: WheelScope,
): WheelState {
	if (scope.kind === "vault") return settings.state;

	const key = scopeKey(scope);
	// A blikveld the reader has just opened starts unfiltered: opening one is
	// beginning a round, and a round begins by seeing everything.
	settings.scopes[key] ??= {
		...DEFAULT_STATE,
		domainBudgets: {},
		filter: { ...NO_FILTER },
	};
	return settings.scopes[key];
}

/**
 * A changed angle is a new round on every wheel.
 *
 * The wedge key is part of a node's id, so a different source, tag namespace,
 * property or fallback name does not re-label the same wedges — it replaces
 * them, and every mark of every round is suddenly about ids that no longer
 * exist. They were then swept away by the next `prune` without a word: 180 of
 * 200 seen became 0, and since BC_E3_S148 the angle is one tap away in the ⋯
 * menu, in the middle of a round (found by audit, 6 sep 2026).
 *
 * So it is made a round boundary, deliberately and out loud, exactly as a
 * changed selection is (`setFilter`). Returns how many marks were given up so
 * the caller can say it; a change that alters nothing gives up nothing.
 *
 * Every wheel, not only the one in front: the angle is a plugin-wide setting,
 * so every round it invalidates is invalidated at the same moment.
 */
export function restartRoundsForAngle(settings: TaskWheelSettings): {
	restarted: number;
} {
	let restarted = 0;

	for (const state of everyState(settings)) {
		restarted += state.seen.length;
		state.seen = [];
		state.sweepStartedAt = null;
		// The remembered place carries a wedge key too, so it names nothing now.
		state.reading = null;
		// A new set of wedges is dealt afresh: order and weights both.
		state.roundWeights = null;
		state.roundDomains = null;
	}

	return { restarted };
}

/** Every wheel's state, for the things that apply to all of them at once. */
export function everyState(settings: TaskWheelSettings): WheelState[] {
	return [settings.state, ...Object.values(settings.scopes)];
}

/** The parse-relevant slice, so the parser never sees plugin state. */
export function parseOptionsOf(
	settings: TaskWheelSettings,
	scope: WheelScope = VAULT_SCOPE,
): ParseOptions {
	return {
		scope,
		filter: filterOf(settings, scope),
		today: today(),
		domainSource: settings.domainSource,
		domainTagPrefix: settings.domainTagPrefix,
		domainProperty: settings.domainProperty,
		fallbackDomain: settings.fallbackDomain,
		useHeadingsAsGroups: settings.useHeadingsAsGroups,
		includeCompleted: settings.includeCompleted,
		excludeFolders: settings.excludeFolders,
		includeFolders: settings.includeFolders,
		excludeNoteTypes: settings.excludeNoteTypes,
		excludeHeadings: settings.excludeHeadings,
		taskNoteProperty: settings.taskNoteProperty,
		taskNoteValues: settings.taskNoteValues,
		taskNoteDoneProperty: settings.taskNoteDoneProperty,
		taskNoteDoneValues: settings.taskNoteDoneValues,
		taskNoteOpenValue: settings.taskNoteOpenValue,
		taskNoteDoingValue: settings.taskNoteDoingValue,
		taskNoteDoneValue: settings.taskNoteDoneValue,
		taskNoteCancelledValue: settings.taskNoteCancelledValue,
	};
}

/**
 * The filter one wheel is running, as one object.
 *
 * The vault wheel reads the flat fields it always did, so no stored settings
 * needed rewriting when the filter moved to the blikveld; every other wheel
 * keeps its own beside its round.
 */
export function filterOf(
	settings: TaskWheelSettings,
	scope: WheelScope = VAULT_SCOPE,
): TaskFilter {
	if (scope.kind !== "vault") {
		// A wheel whose filter was stored before a field existed must not read
		// that field as `undefined` — that is neither "any" nor a value.
		return { ...NO_FILTER, ...stateFor(settings, scope).filter };
	}

	return {
		text: settings.filterText,
		due: settings.filterDue,
		horizon: settings.filterHorizon,
		// Stored after the field existed, so a vault from before it reads as
		// `undefined` — which is neither a date nor "open at this end".
		from: settings.filterFrom ?? NO_FILTER.from,
		until: settings.filterUntil ?? NO_FILTER.until,
		dateField: settings.filterDateField ?? NO_FILTER.dateField,
		heading: settings.filterHeading ?? NO_FILTER.heading,
		status: settings.filterStatus,
		minPriority: settings.filterMinPriority,
		maxPriority: settings.filterMaxPriority ?? "any",
		withTags: settings.filterWithTags,
		withoutTags: settings.filterWithoutTags,
	};
}

/**
 * Change what a wheel's round is about — and start that round over.
 *
 * The two halves are one decision, not two (eigenaarsbesluit 18 aug 2026).
 * A round is a round *of that selection* (§4), so a different selection is a
 * different round; and the gezien-vlaggen could not survive the change anyway,
 * because the tree they are pruned against is itself filtered. What was
 * happening instead was the worst of both: the marks quietly disappeared and
 * nothing said so.
 *
 * Returns how many marks were given up, so the caller can say it out loud. A
 * change that alters nothing gives up nothing — flipping a control back to what
 * it already said must not cost you a round.
 */
export function setFilter(
	settings: TaskWheelSettings,
	scope: WheelScope,
	next: TaskFilter,
): { restarted: number } {
	if (sameFilter(filterOf(settings, scope), next)) return { restarted: 0 };

	if (scope.kind === "vault") {
		settings.filterText = next.text;
		settings.filterDue = next.due;
		settings.filterHorizon = next.horizon;
		settings.filterFrom = next.from;
		settings.filterUntil = next.until;
		settings.filterDateField = next.dateField;
		settings.filterHeading = next.heading;
		settings.filterStatus = next.status;
		settings.filterMinPriority = next.minPriority;
		settings.filterMaxPriority = next.maxPriority;
		settings.filterWithTags = [...next.withTags];
		settings.filterWithoutTags = [...next.withoutTags];
	} else {
		stateFor(settings, scope).filter = { ...next };
	}

	const state = stateFor(settings, scope);
	const restarted = state.seen.length;
	state.seen = [];
	state.sweepStartedAt = null;
	// A new selection is a new round, and a new round deals the wedges again
	// when they divide by open tasks — the frozen weights belonged to the old
	// selection's population.
	state.roundWeights = null;
	state.roundDomains = null;
	return { restarted };
}

/** Whether two filters say the same thing. Order within a tag list does not count. */
export function sameFilter(a: TaskFilter, b: TaskFilter): boolean {
	const tags = (one: string[], other: string[]): boolean =>
		one.length === other.length &&
		[...one].sort().join("\u001f") === [...other].sort().join("\u001f");

	return (
		a.text === b.text &&
		a.due === b.due &&
		a.horizon === b.horizon &&
		a.from === b.from &&
		a.until === b.until &&
		a.dateField === b.dateField &&
		a.heading === b.heading &&
		a.status === b.status &&
		a.minPriority === b.minPriority &&
		a.maxPriority === b.maxPriority &&
		tags(a.withTags, b.withTags) &&
		tags(a.withoutTags, b.withoutTags)
	);
}

/** Put every task back in play, for one wheel. */
export function clearFilter(
	settings: TaskWheelSettings,
	scope: WheelScope = VAULT_SCOPE,
): { restarted: number } {
	return setFilter(settings, scope, { ...NO_FILTER });
}

/** How many items the wheel may draw, for the chosen detail level. */
export function visibleBudgetOf(settings: TaskWheelSettings): number {
	return DETAIL_BUDGETS[settings.detail] ?? DETAIL_BUDGETS.balanced;
}


const PRIORITY_OPTIONS: Record<string, string> = {
	any: "Any priority",
	...Object.fromEntries(
		PRIORITY_LADDER.map((priority) => [priority, `${priority} or above`]),
	),
};

/**
 * "Auto" first, then every language under its own name — a reader looking for
 * their language should not need English to find it.
 */
const LANGUAGE_CHOICES: Record<string, string> = {
	auto: "Auto — follow Obsidian",
	...LANGUAGE_NAMES,
};

const DOMAIN_SOURCE_LABELS: Record<DomainSource, string> = {
	folder: "Top-level folder",
	tag: "Tag namespace",
	property: "Front-matter property",
	heading: "The heading it sits under",
};

const HOW_LABELS: Record<CarryPreset["how"], string> = {
	move: "Move — take it out of where it is",
	copy: "Copy — leave it where it is",
};

const DETAIL_LABELS: Record<WheelDetail, string> = {
	compact: "Compact — fewer, larger items",
	balanced: "Balanced",
	dense: "Dense — more items, smaller",
};

/**
 * The palettes, with their size in the label.
 *
 * The count is not decoration: past the end of a palette the hues repeat and
 * position becomes the only difference, so a reader choosing six over eight is
 * trading sooner repetition for better separation. That trade should be
 * visible at the moment of choosing rather than discovered afterwards.
 */
const WEDGE_PALETTE_LABELS: Record<PaletteName, string> = {
	theme: `Theme — every hue your theme offers (${paletteSize("theme")})`,
	"colour-blind": `Colour-blind friendly — no red or green (${paletteSize("colour-blind")})`,
};

const STEP_INTO_LABELS: Record<TaskWheelSettings["stepInto"], string> = {
	"same-tab": "Reuse this tab — stepping in stays where you are",
	"new-tab": "Open a new tab for each step",
};

const ARROW_STEP_LABELS: Record<TaskWheelSettings["arrowStep"], string> = {
	tasks: "Every task — the next one, wherever it hangs",
	ring: "Along the ring — the next item at the same depth",
};

const EDIT_TASK_LABELS: Record<TaskWheelSettings["editTask"], string> = {
	inline: "Here on the card — rewrite the words",
	tasks: "In Tasks — the whole task, in that plugin's own window",
};

const WEDGE_DIVISION_LABELS: Record<TaskWheelSettings["wedgeDivision"], string> =
	{
		equal: "Equal — every domain the same slice",
		tasks: "By open tasks — busier domains get wider wedges",
	};

/**
 * The settings tab, written against the declarative API (Obsidian 1.13+).
 *
 * Values flow through `getControlValue`/`setControlValue`, so every option is
 * indexed for Obsidian's settings search — the same migration Readability
 * Compass made in BC_E1_S27, done right the first time here.
 */
export class TaskWheelSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TaskWheelPlugin,
	) {
		super(app, plugin);
	}

	/**
	 * The pane is closing: make the command list agree with the destinations.
	 *
	 * Here rather than on every keystroke of the name field. A destination's
	 * command is named after it, so reconciling while somebody is still typing
	 * would put a command in the palette for each half-finished name and take
	 * it out again on the next letter. Closing the pane is when the name is
	 * what the reader meant it to be.
	 */
	override hide(): void {
		this.plugin.syncPresetCommands();
		// A language change touches every word of the help panel, and the panel
		// only redraws its live block on its own.
		this.plugin.rebuildHelp();
		super.hide();
	}

	/**
	 * Read a setting — including one row of a list.
	 *
	 * `includeFolders.2` addresses the third row. Without that the rows of a
	 * list would each need a settings field of their own, which is not a shape
	 * a list can have; these hooks exist precisely for storage that does not map
	 * one-to-one onto keys.
	 */
	getControlValue(key: string): unknown {
		if (TEXT_LISTS.has(key)) {
			return this.plugin.settings[key as TextListKey].join(", ");
		}

		const row = indexed(key);
		if (row !== null) return this.plugin.settings[row.key][row.index] ?? "";

		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	/**
	 * A filter change from the tab, put through the round boundary (BC_E3_S177).
	 *
	 * The same call the panel beside the wheel makes, with the same words: a new
	 * selection is a new round, and the reader is told what it cost rather than
	 * finding the count back at zero. Only the vault wheel's filter lives in
	 * these fields; every other wheel keeps its own beside its round, and this
	 * tab does not reach them.
	 */
	private async setVaultFilter(next: TaskFilter): Promise<void> {
		const { restarted } = setFilter(this.plugin.settings, VAULT_SCOPE, next);
		if (restarted > 0) {
			new Notice(roundRestartedMessage(restarted, "a new selection"));
		}
		// Saving rereads the open wheels, so the new selection is on screen
		// without a redraw of our own.
		await this.plugin.saveSettings();
		this.refreshDomState();
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const field = FILTER_FIELDS[key];
		if (field !== undefined) {
			await this.setVaultFilter({
				...filterOf(this.plugin.settings, VAULT_SCOPE),
				[field]: value,
			});
			return;
		}

		// One row of a tag list. The row is written into a copy, so `setFilter`
		// still sees what the filter was and can tell whether anything changed.
		const tagRow = indexed(key);
		if (tagRow !== null && FILTER_LISTS[tagRow.key] !== undefined) {
			const listField = FILTER_LISTS[tagRow.key];
			const current = filterOf(this.plugin.settings, VAULT_SCOPE);
			const rows = [...current[listField]];
			rows[tagRow.index] = typeof value === "string" ? value.trim() : "";
			await this.setVaultFilter({ ...current, [listField]: rows });
			return;
		}

		if (TEXT_LISTS.has(key)) {
			// A text control always hands back a string; anything else is not a
			// value we put there.
			const typed = typeof value === "string" ? value : "";
			this.plugin.settings[key as TextListKey] = typed
				.split(",")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
			await this.plugin.saveSettings();
			this.refreshDomState();
			return;
		}

		const row = indexed(key);
		if (row !== null) {
			// A folder or text control always hands back a string; anything else
			// would be a row we did not put there.
			this.plugin.settings[row.key][row.index] =
				typeof value === "string" ? value.trim() : "";
		} else {
			(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		}

		// A changed division rule is a round boundary of its own: the frozen
		// weights belonged to the old rule, and holding on to them would show
		// the new setting doing nothing until the next round by accident.
		if (key === "wedgeDivision" || key === "wedgeMinimum") {
			for (const state of everyState(this.plugin.settings)) {
				state.roundWeights = null;
			}
		}

		// And a changed domain *source* is a round boundary for the wedges
		// themselves: it does not re-deal the same domains, it replaces them.
		// Holding the old order would keep dealt wedges of a set that no longer
		// exists, and append every real one behind them (BC_E3_S82).
		//
		// `fallbackDomain` belongs in this list for the same reason and was not
		// in it: renaming the wedge that catches everything without a domain
		// renames its key too (found by audit, 6 sep 2026).
		if (
			key === "domainSource" ||
			key === "domainTagPrefix" ||
			key === "domainProperty" ||
			key === "fallbackDomain"
		) {
			const { restarted } = restartRoundsForAngle(this.plugin.settings);
			if (restarted > 0) new Notice(roundRestartedMessage(restarted, "a new angle"));
		}

		await this.plugin.saveSettings();
		if (key === "wedgeDivision" || key === "wedgeMinimum") {
			this.plugin.redrawViews();
		}
		this.refreshDomState();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const { settings } = this.plugin;
		return [
			{
				type: "group",
				heading: "Domain",
				items: [
					{
						name: "Domain comes from",
						desc: "The domain is the wheel's angle, so this decides where a task sits. Folders and properties are per note; a tag namespace lets one note feed several domains. The heading it sits under does both — it splits one note over several wedges, and it collects the same heading from several notes into one. That is the setting for a vault that splits its work by horizon (today, this week, someday) and names the domain in the headings: the wedge becomes 'Home', and the notes it came from sit side by side inside it, so one turn of that wedge walks the same subject across every horizon. Outermost heading only; deeper ones stay rings, and a task under no heading at all falls back. This one holds on a wheel over a folder as well — narrowing to a folder narrows what is drawn, not what the angle means.",
						control: {
							type: "dropdown",
							key: "domainSource",
							options: DOMAIN_SOURCE_LABELS,
						},
					},
					{
						name: "Tag namespace",
						desc: "The namespace scanned for the domain. With 'domein', a task tagged #domein/werk lands in the domain 'werk'.",
						visible: () => settings.domainSource === "tag",
						control: {
							type: "text",
							key: "domainTagPrefix",
							placeholder: DEFAULT_PARSE_OPTIONS.domainTagPrefix,
						},
					},
					{
						name: "Domain property",
						desc: "The front-matter property read as the domain. With 'area', a note with 'area: Work' lands in the domain 'Work'. A list gives its first entry; a note without the property falls back.",
						visible: () => settings.domainSource === "property",
						control: {
							type: "text",
							key: "domainProperty",
							placeholder: DEFAULT_PARSE_OPTIONS.domainProperty,
						},
					},
					{
						name: "Fallback domain",
						desc: "Where tasks land when the chosen source gives no domain. They are never dropped.",
						control: {
							type: "text",
							key: "fallbackDomain",
							placeholder: DEFAULT_PARSE_OPTIONS.fallbackDomain,
						},
					},
				],
			},
			{
				type: "group",
				heading: "What the wheel draws",
				items: [
					// Was the first row of a group called *Structure*, beside
					// *Include finished tasks* (BC_E3_S174). Those are the two axes
					// BC_E3_S152 pulled apart everywhere else: this one is about
					// the drawing, the other about who is in the round. Here it is
					// among its own kind.
					{
						name: "Use headings as a grouping ring",
						desc: "Headings that contain tasks become an extra ring between the note and its tasks. Turn this off to attach tasks straight to their note.",
						control: { type: "toggle", key: "useHeadingsAsGroups" },
					},
					{
						name: "Open the wheel when Obsidian starts",
						desc: "Off by default. On, the wheel over the whole vault is there when you open the vault — the review that begins the day. A wheel that is already open is used rather than a second one opened. Obsidian brings back the tabs you closed with anyway; this is for the wheel that should be there whatever the last session looked like.",
						control: { type: "toggle", key: "openOnStart" },
					},
					this.startPathRow(),
					{
						name: "Detail",
						desc: "How many items the wheel shows at once. The vault may hold thousands of tasks; the drawing does not grow with it. What is left out is counted on the branch it belongs to, and opens when you turn to it.",
						control: {
							type: "dropdown",
							key: "detail",
							options: DETAIL_LABELS,
						},
					},
					{
						name: "Wedge sizes",
						desc: "Equal gives every domain the same slice whatever it holds — the strongest guarantee for spatial memory. By open tasks gives busier domains wider wedges, re-divided only when a round begins: the wheel never changes shape under your hands mid-round. A wedge you pin by hand keeps its width either way.",
						control: {
							type: "dropdown",
							key: "wedgeDivision",
							options: WEDGE_DIVISION_LABELS,
						},
					},
					{
						name: "What the arrows step through",
						desc: "Left and right, and the two buttons beside the card. Every task walks your work: the next task, wherever it hangs, so no branch is a dead end. Along the ring keeps the eye at one radius — the next item at the same depth, across branches — which is the move for comparing the same level of two projects, but a depth that exists in one branch only is a ring of that branch alone. On a keyboard the other one is always on Shift with the arrows. The two buttons beside the card follow this setting on a desktop; on a phone they always walk every task, because the coarse movement there is a finger on the disc and there is no Shift to borrow the other with.",
						control: {
							type: "dropdown",
							key: "arrowStep",
							options: ARROW_STEP_LABELS,
						},
					},
					{
						name: "Clicking a task's title, and adding a task",
						desc: "The wheel's own box rewrites the words and leaves the rest of the line alone, which is the size a review needs. In Tasks hands the whole task to that plugin's own window instead — dates, recurrence, dependencies, your own status set — and writes back what you confirm, without leaving the round. Add task and Add subtask follow the same choice: the same window opens on a blank task instead of the card's own prompt. It needs the Tasks plugin, version 7.21.0 or newer; without it the card's own box opens whatever this says. Either way the ⋯ menu offers the Tasks window when it is there, so this only decides what the quicker gesture reaches.",
						control: {
							type: "dropdown",
							key: "editTask",
							options: EDIT_TASK_LABELS,
						},
					},
					{
						name: "Stepping into a wheel",
						desc: "Tapping an item twice opens a wheel over it, and the way back out returns to the wider one. Reusing the tab keeps that a walk rather than a pile: the ladder runs vault → folder → note → section, with a heading wheel as a rung of its own when the domain comes from headings, so opening a tab per step leaves one behind for every branch you looked at. Nothing is lost either way — each blikveld keeps its own round, filter, zoom and folded branches wherever it is opened. A wheel you open from the file list, the ribbon or a command is one you asked for, and always gets a tab of its own.",
						control: {
							type: "dropdown",
							key: "stepInto",
							options: STEP_INTO_LABELS,
						},
					},
					{
						name: "Wedge colours",
						desc: "Which hues the wedges are handed. A palette selects from the colours your own theme defines, so retuning the theme retunes the wheel and both light and dark keep working from one rule. Colour-blind friendly leaves out red and green — the pair that collapses for the two most common kinds — and leads with blue and orange, which stay apart. Hue says which domain a task belongs to, never how urgent it is; urgency is the lightness. Past the end of a palette the hues start over, so two wedges far apart on the circle can share one; neighbours never do. This chooses the wedge colours and nothing else: the sweep and the reading ring are drawn in your theme's accent colour, whatever that is, and how red or green a hue looks is your theme's answer rather than ours.",
						control: {
							type: "dropdown",
							key: "wedgePalette",
							options: WEDGE_PALETTE_LABELS,
						},
					},
					{
						name: "Narrowest wedge",
						desc: "In degrees. A quiet domain stops shrinking here, so every wedge stays wide enough to carry its own name — proportion is not worth an unreadable sliver. With more domains than the circle can afford at this width, the wedges fall back to an equal split.",
						visible: () => settings.wedgeDivision === "tasks",
						control: {
							type: "number",
							key: "wedgeMinimum",
							min: 4,
							placeholder: String(DEFAULT_SETTINGS.wedgeMinimum),
						},
					},
				],
			},
			{
				type: "group",
				// Named for the one wheel it belongs to since the filter moved to
				// the blikveld (18 aug 2026). Every other wheel filters in its own
				// panel; leaving this called "Filter" would suggest it reaches
				// them all, which is exactly the confusion this move undid. Kept
				// here rather than removed because these are the fields the vault
				// wheel genuinely stores, and taking the controls away would leave
				// them settable from nowhere but the panel.
				heading: "Filter of the vault wheel",
				items: [
					{
						// A description-only row, which is the pattern for a
						// section-wide note (obsidian-settings-patroon). Here
						// because the group's name says which wheel but not what
						// kind of setting this is, and the owner had to ask
						// whether filling something in here was a one-way door
						// (8 sep 2026, BC_E3_S177).
						name: "These are the same fields as the filter panel",
						desc: "Not a second, wider filter: this is the vault wheel's own filter, shown here as well as in the panel beside that wheel. Whatever you set here you can clear there, and the other way round. No other wheel is touched — a wheel over a folder, a note, a section or a heading keeps its own filter beside its own round. And changing anything here is a new round for the vault wheel, exactly as it is in the panel: the marks of what you had already been past are given up, and the plugin says how many.",
					},
					{
						name: "Words in the task",
						desc: "Every word has to appear in the task's own text or its tags, in any order, and a word may be typed slightly wrong. OR (in capitals) offers an alternative; quotes hold a phrase together and are matched exactly. This narrows a round; it is not a vault search — use Obsidian's own for that.",
						control: {
							type: "text",
							key: "filterText",
							placeholder: "invoice OR quote",
						},
					},
					{
						name: "Only tasks that are",
						desc: "A filter answers a different question than the detail level: that one decides how much is drawn, this one decides what the round is about at all. What a filter leaves out is counted and shown under the wheel, never silently dropped. 'Parked for later' means a start or scheduled date that has not arrived yet \u2014 putting something off is a date in Tasks, not a status.",
						control: {
							type: "dropdown",
							key: "filterDue",
							options: DUE_LABELS,
						},
					},
					{
						name: "Only tasks under this heading",
						desc: "Any heading a task stands under, however deep. Exact by default; 'Project*' takes everything that starts with it, as in the skip lists, and the '##' you paste in with a heading is taken off. Empty means any heading, and a task that stands under none is left out while this is set.",
						control: {
							type: "text",
							key: "filterHeading",
							placeholder: "Project",
						},
					},
					{
						name: "Only tasks with this status",
						desc: "Not started, in progress, or finished. Done and cancelled count as finished together, because a round makes no distinction between them — and there is nothing to select from unless finished tasks are being shown at all.",
						control: {
							type: "dropdown",
							key: "filterStatus",
							options: STATUS_LABELS,
						},
					},
					{
						name: "Within how many days",
						desc: "How far ahead 'soon' looks, counted from the date chosen below. Anything already past is always included.",
						visible: () => settings.filterDue === "soon",
						control: {
							type: "number",
							key: "filterHorizon",
							min: 0,
							placeholder: String(NO_FILTER.horizon),
						},
					},
					{
						name: "Which date the rule reads",
						desc: "The deadline (📅), when you meant to pick it up (⏳) or when it may start (🛫) — Tasks carries all three, and \"what did I mean to start this week\" is as ordinary a question as \"what has to be finished this week\". Every rule above reads the one chosen here, except 'parked for later' and 'ready now': those two ask about 🛫 and ⏳ by definition, so there is nothing to point them at.",
						visible: () => picksADate(settings.filterDue),
						control: {
							type: "dropdown",
							key: "filterDateField",
							options: DATE_FIELD_LABELS,
						},
					},
					{
						// Named for the date the window is pointed at, the same as
						// in the panel beside the wheel (BC_E3_S170). It said "Due"
						// flat out, and the window has been able to read ⏳ or 🛫
						// since BC_E3_S126.
						name: windowLabels(settings.filterDateField ?? "due").from,
						desc: "The start of the window, as YYYY-MM-DD. Both ends count as inside it, and leaving this empty means the window is open at the early end. A task without the date the window reads is never in one.",
						visible: () => settings.filterDue === "between",
						control: {
							type: "text",
							key: "filterFrom",
							placeholder: "2026-09-15",
						},
					},
					{
						name: windowLabels(settings.filterDateField ?? "due").until,
						desc: "The end of the window, as YYYY-MM-DD, and it counts as inside it. Empty means open at the late end. An end before the start selects nothing, and the line under the wheel says so.",
						visible: () => settings.filterDue === "between",
						control: {
							type: "text",
							key: "filterUntil",
							placeholder: "2026-09-22",
						},
					},
					{
						name: "Priority at least",
						desc: "Tasks below this stay out of the round. Most tasks carry no priority marker at all, which counts as 'normal'.",
						control: {
							type: "dropdown",
							key: "filterMinPriority",
							options: PRIORITY_OPTIONS,
						},
					},
					{
						// The other half of the band, which lived only in the panel
						// (BC_E3_S170). One bound alone selects "this and up", so a
						// ceiling set beside the wheel was invisible here and could
						// only be undone with *Clear* — the tab showed a filter it
						// was not showing all of.
						name: "Priority at most",
						desc: "Tasks above this stay out of the round. With the row above it this makes a band, which is what sweeping a batch of low-priority work into a someday note asks for.",
						control: {
							type: "dropdown",
							key: "filterMaxPriority",
							options: PRIORITY_OPTIONS,
						},
					},
				],
			},
			this.tagList(
				"Only these tags",
				"Leave empty for every tag. A task needs one of these to be in the round; a namespace covers its children, so #werk catches #werk/klant.",
				"werk",
				"filterWithTags",
			),
			this.tagList(
				"Never these tags",
				"Tasks carrying one of these stay out of the round, even when they match everything else.",
				"someday",
				"filterWithoutTags",
			),
			this.presetList(),
			{
				type: "group",
				heading: "Help",
				items: [
					{
						name: "Language",
						desc: "For the help panel. Auto follows Obsidian's own language setting (Settings → General → Language).",
						control: {
							type: "dropdown",
							key: "language",
							options: LANGUAGE_CHOICES,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Troubleshooting",
				items: [
					{
						name: "Show what the device sends",
						desc: "Adds a panel under the wheel listing the touch and pointer events it receives, and what the drawing did. Also makes the help panel say out loud what it found when it opened. Only useful when something does nothing and we are working out why.",
						control: { type: "toggle", key: "diagnostics" },
					},
				],
			},
			// The first of the two axes BC_E3_S152 named. Its three rows want one
			// heading over them and cannot have one: Obsidian's `SettingGroupItem`
			// takes plain rows and pages, never a list, so the two folder pickers
			// cannot sit inside a group with the text row (BC_E3_S174, measured
			// against `obsidian.d.ts`). What is left is to make the three headings
			// read as three rows of one question rather than as two lists and a
			// new topic — and to say the tie once, in the last of them, instead of
			// explaining the layout in every description.
			this.folderList(
				"Folders to read",
				"Leave empty to read the whole vault. Naming the few folders that hold your tasks is usually easier than excluding the many that do not. Pick a folder or start typing its name; the path is relative to the vault root.",
				"Add folder",
				"Werk",
				"includeFolders",
			),
			this.folderList(
				"Excluded folders",
				"Skipped even when they sit inside a folder above. Keeps templates, archives or an inbox off the wheel. Pick a folder or start typing its name.",
				"Add folder",
				"Archive/2025",
				"excludeFolders",
			),
			{
				type: "group",
				heading: "Note types to skip",
				items: [
					{
						name: "Skip notes of these types",
						desc: "The third row of the same question as the two folder lists above: which notes the wheel reads at all. Comma-separated, matched against the note's own front-matter 'type'. A vault that keeps a document standard already says which notes are stories, templates or review forms — and their checkboxes are the document's own checklist, not work on your plate. Nothing has to be tagged by hand. A '*' stands for the rest of the word: 'review*' covers 'review' and 'review-actie'. None of the three is a wall: point the wheel at a skipped note or folder from its own context menu and you get it, because naming it is asking for it.",
						control: {
							type: "text",
							key: "excludeNoteTypes",
							placeholder: "story, review*",
						},
					},
				],
			},
			{
				type: "group",
				heading: "Not every checkbox is a task",
				items: [
					{
						name: "Skip checkboxes under these headings",
						desc: "Comma-separated. A different question from the three above: those decide which notes the wheel reads, this one decides what counts as a task inside a note it does read. For a note that holds both: checkboxes under a heading named here belong to the document's own checklist, while a real task elsewhere in the same note still counts. Matched on the heading text, ignoring case. A '*' stands for any run of characters, so 'accepta*' covers 'Acceptatiecriteria' and 'Acceptance criteria'; without one, the whole heading has to match.",
						control: {
							type: "text",
							key: "excludeHeadings",
							placeholder: "accepta*, leestip*, Definition of done",
						},
					},
				],
			},
			{
				type: "group",
				heading: "A note that is itself a task",
				items: [
					{
						name: "Property that marks one",
						desc: "Leave empty to leave everything as it is. Some work is too big for a line and gets its own note; naming the front-matter property those notes carry makes each of them one task on the wheel, labelled with its title, with the checkboxes inside it as its subtasks. A property name rather than a fixed one, because there is no fixed one: 'type' is a common choice, and a plugin that writes its own id works just as well.",
						control: {
							type: "text",
							key: "taskNoteProperty",
							placeholder: "type",
						},
					},
					{
						name: "Values it may have",
						desc: "Comma-separated. Leave empty when carrying the property at all is what makes a note a task — which is how an id-style marker works, since its value is different in every note. Fill it in for a document standard, where the same property says what kind of note this is: 'task' next to 'type'. More than one word when more than one kind of note is a piece of work: 'task, project' counts both. Matched on the whole value, ignoring case; a value with dots in it also matches on the part after the last one, so 'task' finds 'Project.Task'.",
						control: {
							type: "text",
							key: "taskNoteValues",
							placeholder: "task, project",
						},
					},
				],
			},
			// Was three groups higher, in one called *Structure*, beside a row about
			// how the wheel is drawn (BC_E3_S174). It is question two of the three
			// a round asks — who is in it — and the words that answer *when is
			// something finished* are in the group below this one. Nine groups
			// used to separate them, so a reader who added 'afgerond' to the extra
			// list and saw nothing change had to find a switch under a heading
			// called *Structure*. They are neighbours now, and each says so.
			{
				type: "group",
				heading: "Finished work",
				items: [
					{
						name: "Include finished tasks",
						desc: "Off by default: the wheel reviews outstanding work. Finished means ticked off ([x]) or cancelled ([-]) — one you did, one you decided not to do, and neither leaves anything to look at. Started work ([/]) is not finished and always counts. A finished task that still has open subtasks stays visible whatever this says. For a note that is itself a task there are no brackets to read, and the words that stand in for them are in the group below.",
						control: { type: "toggle", key: "includeCompleted" },
					},
				],
			},
			{
				type: "group",
				heading: "The status of a task document",
				items: [
					{
						name: "Property that carries it",
						desc: "A checkbox has its brackets; a note has whatever its front matter says. This is the property the wheel reads to tell what state a task document is in — and writes when you tick it off, start it or cancel it from the card.",
						control: {
							type: "text",
							key: "taskNoteDoneProperty",
							placeholder: "status",
						},
					},
					{
						name: "Your word for: open",
						desc: "Written when you take a status back off. Case is ignored, and a word without a dot also matches the part after the last dot, so 'done' covers a status written 'Project.Done' as well.",
						control: {
							type: "text",
							key: "taskNoteOpenValue",
							placeholder: "todo",
						},
					},
					{
						name: "Your word for: in progress",
						desc: "A task document in this state wears the same ring as a started checkbox.",
						control: {
							type: "text",
							key: "taskNoteDoingValue",
							placeholder: "doing",
						},
					},
					{
						name: "Your word for: done",
						desc: "Written when you tick a task document off, and read to keep it out of the next round.",
						control: {
							type: "text",
							key: "taskNoteDoneValue",
							placeholder: "done",
						},
					},
					{
						name: "Your word for: cancelled",
						desc: "The other way off your plate: you decided not to do it.",
						control: {
							type: "text",
							key: "taskNoteCancelledValue",
							placeholder: "cancelled",
						},
					},
					{
						name: "Other values that also mean finished",
						desc: "Comma-separated, and only needed when your documents end in more ways than the two words above — 'archived', say, or 'wontfix'. These are read, never written. A status the wheel does not recognise at all counts as open, so a vault that also knows 'backlog' or 'on hold' keeps seeing that work. Whether finished work is in the round at all is one group up, under *Finished work*: adding a word here changes what counts as finished, not whether the finished are shown.",
						control: {
							type: "text",
							key: "taskNoteDoneValues",
							placeholder: "archived, wontfix",
						},
					},
				],
			},
		];
	}

	/**
	 * A list of folders, each row a folder picker.
	 *
	 * Obsidian's own `folder` control suggests as you type and understands that
	 * a folder is a vault-relative path — which the plain text box did not say
	 * anywhere, so a folder typed by its bare name silently matched nothing.
	 * Rows are addressed by an indexed key (`includeFolders.2`) which
	 * `getControlValue`/`setControlValue` below resolve; that is what those
	 * hooks are for.
	 */
	/**
	 * The destinations the reader has named: rename, repoint, or remove.
	 *
	 * Deliberately not a form to *type* one in. A destination is chosen with the
	 * same two pickers an ordinary carry uses — from the wheel to make one, and
	 * from the button on the row to send an existing one somewhere else
	 * (BC_E3_S135). A path typed here could point at a note that is not there;
	 * one chosen cannot.
	 *
	 * Repointing used to mean deleting and making a new one, which threw away
	 * the name, the move-or-copy and the hotkey bound to it — for a note that had
	 * simply been renamed or moved (eigenaar, 4 sep 2026).
	 */
	private presetList(): SettingDefinitionItem {
		const presets = this.plugin.settings.presets;

		return {
			type: "list",
			heading: "Destinations",
			emptyState:
				"None yet. Add one here, or from a wheel with the command “Add a destination to carry work to”. Either way it asks which note, where in it, and whether it moves or copies — and afterwards it is one entry on the card, and a command you can give a key.",
			addItem: {
				name: "Add destination",
				// The very flow the command runs, called rather than copied. Two
				// spellings of "make a destination" would be two places to fix the
				// day the questions change (BC_E3_S136).
				action: () => {
					void this.plugin.addPreset().then(() => {
						this.rerender();
					});
				},
			},
			items: presets.map((preset, index) => ({
				name: `${preset.notePath}${preset.headingPath === null ? "" : ` › ${preset.headingPath.join(" › ")}`}`,
				searchable: false,
				// Built by hand, because a declared row carries one control and this
				// row wants two: what the destination is called, and whether it
				// moves or copies. That second one used to be answered once, when
				// the destination was made, and could then never be changed
				// (eigenaar, 23 aug 2026) — while it is the answer most likely to
				// turn out wrong, and the cheapest to have meant the other way.
				render: (setting) => {
					setting.addText((text) =>
						text
							.setPlaceholder("Name")
							.setValue(preset.name)
							.onChange((value) => {
								preset.name = value.trim();
								this.keepPresets();
							}),
					);
					setting.addDropdown((drop) =>
						drop
							.addOptions(HOW_LABELS)
							.setValue(preset.how)
							.onChange((value) => {
								preset.how = value as CarryPreset["how"];
								this.keepPresets();
							}),
					);
					// Where it goes. The row's own title says where that is now,
					// and it is the one thing here that could not be changed at
					// all — a note that moved took its destination with it.
					setting.addExtraButton((button) =>
						button
							.setIcon("folder-input")
							.setTooltip("Send this destination somewhere else")
							.onClick(() => {
								void this.repoint(preset);
							}),
					);
					// The order here is the order on the card, and sorting a day's
					// work means reaching for the same one over and over — so the
					// one you use most belongs at the top (BC_E3_S136). Two
					// buttons rather than dragging: this list is read on a phone
					// as often as on a desktop, and a drag handle in a settings
					// row is a poor target for a thumb.
					setting.addExtraButton((button) =>
						button
							.setIcon("arrow-up")
							.setTooltip("Move up")
							.setDisabled(index === 0)
							.onClick(() => {
								this.reorderPreset(index, -1);
							}),
					);
					setting.addExtraButton((button) =>
						button
							.setIcon("arrow-down")
							.setTooltip("Move down")
							.setDisabled(index === presets.length - 1)
							.onClick(() => {
								this.reorderPreset(index, 1);
							}),
					);
				},
			})),
			onDelete: (index: number) => {
				presets.splice(index, 1);
				// Its command goes with it. Leaving it behind meant the palette
				// still offered to carry work to a destination the reader had
				// just thrown away (audit, 23 aug 2026).
				this.plugin.syncPresetCommands();
				void this.plugin.saveSettings().then(() => this.rerender());
			},
		};
	}

	/**
	 * One destination up or down the list (BC_E3_S136).
	 *
	 * `persist` rather than the full save: the order changes what the card offers
	 * first, and nothing about what the vault holds — so re-reading every note
	 * would be a scan for a swap of two array entries. The commands keep their
	 * ids, which are made from the name, so nothing has to be re-registered.
	 */
	private reorderPreset(index: number, step: number): void {
		const presets = this.plugin.settings.presets;
		const to = index + step;
		if (to < 0 || to >= presets.length) return;

		const [moved] = presets.splice(index, 1);
		presets.splice(to, 0, moved);

		this.plugin.persist();
		this.plugin.redrawViews();
		this.rerender();
	}

	/**
	 * Ask again where a destination points, and keep the answer.
	 *
	 * The full save rather than `keepPresets`, because unlike a name or a
	 * move-or-copy this changes *where work lands* — and the row's own title has
	 * to be redrawn to say so, or the settings would go on naming the old note.
	 */
	private async repoint(preset: CarryPreset): Promise<void> {
		const target = await pickTarget(this.app);
		if (target === null) return;

		preset.notePath = target.notePath;
		preset.headingPath = target.headingPath;

		await this.plugin.saveSettings();
		this.plugin.redrawViews();
		this.rerender();
		new Notice(`Task wheel: “${preset.name}” now goes to ${target.basename}.`);
	}

	/**
	 * Keep an edited destination, and let the cards show it.
	 *
	 * `persist` rather than `saveSettings`: renaming a destination or turning it
	 * from a move into a copy changes nothing about what the vault holds, and
	 * routing it through the ordinary save would re-read every note in the vault
	 * — per keystroke, while the reader is still typing the name.
	 */
	private keepPresets(): void {
		this.plugin.persist();
		this.plugin.redrawViews();
	}

	/**
	 * Which folder or note the startup wheel is about, with suggestions.
	 *
	 * Built by hand rather than declared, because the declarative API has a
	 * folder box and a file box and this is one box that takes either
	 * (eigenaarsverzoek 22 aug 2026: *"wil je zorgen dat het vakje keuzes biedt
	 * zodra je gaat typen?"*). The row keeps its name and description, so it is
	 * still found by the settings search.
	 *
	 * Saved with `persist` rather than `saveSettings`: this setting is read once,
	 * when a vault opens. Routing it through the ordinary save would rescan every
	 * open wheel on every keystroke.
	 */
	private startPathRow(): SettingGroupItem {
		return {
			name: "And that wheel is about",
			desc: "Leave empty for the whole vault. Otherwise a folder (Werk/Klanten) or a note (Werk/Plan, with or without .md) — the same wheel the right-click menu opens, ready when you open the vault. Says so if the path is not in the vault, rather than quietly reviewing something else.",
			render: (setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder("empty = the whole vault")
						.setValue(this.plugin.settings.startPath)
						.onChange((value) => {
							this.plugin.settings.startPath = value.trim();
							this.plugin.persist();
						});

					attachPathSuggest(this.app, text.inputEl, (path) => {
						this.plugin.settings.startPath = path;
						this.plugin.persist();
					});
				});
			},
		};
	}

	private folderList(
		heading: string,
		emptyState: string,
		addLabel: string,
		placeholder: string,
		key: FolderListKey,
	): SettingDefinitionItem {
		const folders = this.plugin.settings[key];

		return {
			type: "list",
			heading,
			emptyState,
			addItem: {
				name: addLabel,
				action: () => {
					folders.push("");
					void this.plugin.saveSettings().then(() => this.rerender());
				},
			},
			onDelete: (index: number) => {
				folders.splice(index, 1);
				void this.plugin.saveSettings().then(() => this.rerender());
			},
			items: folders.map((_folder, index) => ({
				name: "",
				searchable: false,
				control: {
					type: "folder" as const,
					key: `${key}.${index}`,
					placeholder,
				},
			})),
		};
	}

	/** The same list, for tags, which have no picker of their own. */
	private tagList(
		heading: string,
		emptyState: string,
		placeholder: string,
		key: TagListKey,
	): SettingDefinitionItem {
		const tags: string[] = this.plugin.settings[key];

		return {
			type: "list",
			heading,
			emptyState,
			addItem: {
				name: "Add tag",
				action: () => {
					tags.push("");
					void this.plugin.saveSettings().then(() => this.rerender());
				},
			},
			// Deleting a row can change the selection, so it goes through the
			// round boundary like every other filter change (BC_E3_S177).
			// Adding one cannot: an empty row selects nothing either way, which
			// is why it still writes straight to the list.
			onDelete: (index: number) => {
				const current = filterOf(this.plugin.settings, VAULT_SCOPE);
				const field = FILTER_LISTS[key];
				const rows = [...current[field]];
				rows.splice(index, 1);
				void this.setVaultFilter({ ...current, [field]: rows }).then(() =>
					this.rerender(),
				);
			},
			items: tags.map((_tag, index) => ({
				name: "",
				searchable: false,
				control: {
					type: "text" as const,
					key: `${key}.${index}`,
					placeholder,
				},
			})),
		};
	}

	/** Re-render the tab after a structural change (folder added or deleted). */
	private rerender(): void {
		this.update();
	}
}

/** Settings fields that hold a list of folders. */
type FolderListKey = "includeFolders" | "excludeFolders";
/** And of tags. */
type TagListKey = "filterWithTags" | "filterWithoutTags";

/**
 * Lists a reader types as one line, commas between.
 *
 * A row-per-entry list is right for folders, where each row carries a picker.
 * For two or three short words it is all ceremony: an add button, a delete
 * button and a description that vanishes the moment the list stops being empty
 * — `emptyState` is shown *instead of* the rows, which is exactly the wrong way
 * round for text that explains what to type.
 */
/**
 * Which filter field each of the tab's controls writes (BC_E3_S177).
 *
 * The tab shows the vault wheel's filter beside its other settings, and wrote
 * straight onto the field. The panel beside the wheel writes those same fields
 * through `setFilter`, which treats a new selection as a new round: it gives up
 * the seen-marks deliberately and says how many. Writing past that left the
 * marks standing on a tree they no longer matched, to be pruned away at the
 * next read without a word — the disappearance BC_E3_S15 closed for the panel
 * and BC_E3_S160 for the angle.
 *
 * A map rather than a "starts with filter" test, because that would also catch
 * `filterPanelOpen`, which is furniture and not a selection.
 */
export const FILTER_FIELDS: Readonly<Record<string, keyof TaskFilter>> = {
	filterText: "text",
	filterDue: "due",
	filterHorizon: "horizon",
	filterFrom: "from",
	filterUntil: "until",
	filterDateField: "dateField",
	filterHeading: "heading",
	filterStatus: "status",
	filterMinPriority: "minPriority",
	filterMaxPriority: "maxPriority",
};

/** The two filter fields that are a list of rows rather than one value. */
export const FILTER_LISTS: Readonly<Record<string, "withTags" | "withoutTags">> = {
	filterWithTags: "withTags",
	filterWithoutTags: "withoutTags",
};

/**
 * The list of values that mark a note as a task, as stored settings hold it.
 *
 * Until BC_E3_S189 this was one word (`taskNoteValue`). Reading a stored file
 * from before that change would otherwise silently drop the reader's setting:
 * the key no longer exists, the new one falls back to its empty default, and
 * "empty" means something entirely different here — every note carrying the
 * property becomes a task. A vault set to `type: task` would suddenly show
 * every `type: meeting` note as work. So the old key is read once and carried
 * over, and the comma split is the same one the settings field does, because a
 * reader who typed a comma into the old single field meant a list even when the
 * code did not offer one.
 *
 * Written back as a list on the first save, after which the old key is gone.
 */
export function taskNoteValuesOf(
	stored: Partial<TaskWheelSettings> | null,
): string[] {
	const current = stored?.taskNoteValues;
	if (Array.isArray(current)) return [...current];

	const legacy = (stored as { taskNoteValue?: unknown } | null)?.taskNoteValue;
	if (typeof legacy !== "string") return [];

	return legacy
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

const TEXT_LISTS: ReadonlySet<string> = new Set([
	"excludeNoteTypes",
	"excludeHeadings",
	"taskNoteValues",
	"taskNoteDoneValues",
]);

type TextListKey =
	| "excludeNoteTypes"
	| "excludeHeadings"
	| "taskNoteValues"
	| "taskNoteDoneValues";

const LIST_KEYS: ReadonlySet<string> = new Set([
	"includeFolders",
	"excludeFolders",
	"filterWithTags",
	"filterWithoutTags",
]);

/** `includeFolders.2` → the third row of that list. */
function indexed(
	key: string,
): { key: FolderListKey | TagListKey; index: number } | null {
	const dot = key.lastIndexOf(".");
	if (dot < 0) return null;

	const head = key.slice(0, dot);
	const index = Number.parseInt(key.slice(dot + 1), 10);
	if (!LIST_KEYS.has(head) || !Number.isInteger(index) || index < 0) return null;

	return { key: head as FolderListKey | TagListKey, index };
}
