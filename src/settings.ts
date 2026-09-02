import {
	App,
	PluginSettingTab,
	type SettingDefinitionItem,
	type SettingGroupItem,
} from "obsidian";
import { today } from "./model/dates";
import {
	DEFAULT_PALETTE,
	type PaletteName,
	paletteSize,
	PRIORITY_LADDER,
} from "./layout/colour";
import {
	type CarryPreset,
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
	filterStatus: StatusRule;
	filterMinPriority: Priority | "any";
	filterMaxPriority: Priority | "any";
	filterWithTags: string[];
	filterWithoutTags: string[];
	excludeNoteTypes: string[];
	excludeHeadings: string[];
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
	filterStatus: NO_FILTER.status,
	filterMinPriority: NO_FILTER.minPriority,
	filterMaxPriority: NO_FILTER.maxPriority,
	filterWithTags: [],
	filterWithoutTags: [],
	excludeNoteTypes: [],
	excludeHeadings: [],
	filterPanelOpen: false,
	openOnStart: false,
	startPath: "",
	detail: "balanced",
	wedgeDivision: "equal",
	wedgePalette: DEFAULT_PALETTE,
	stepInto: "same-tab",
	arrowStep: "tasks",
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

const DUE_LABELS: Record<DateRule, string> = {
	any: "Anything",
	overdue: "Overdue, or due today",
	soon: "Due soon",
	dated: "Dated",
	undated: "Undated",
	parked: "Parked for later (🛫 or ⏳ ahead)",
	ready: "Ready now (nothing parking it)",
};

/**
 * The statuses, as a round sees them.
 *
 * Done and cancelled sit together under "finished": the only distinction a
 * review makes is whether there is anything left to look at. There is no
 * "deferred" — Tasks has no status character for it. Putting something off is a
 * date (🛫 or ⏳), which is why it sits in the list above as *parked*.
 */
const STATUS_LABELS: Record<StatusRule, string> = {
	any: "Any status",
	open: "Not started",
	"in-progress": "In progress",
	finished: "Finished",
};

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

	async setControlValue(key: string, value: unknown): Promise<void> {
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
		if (key === "domainSource" || key === "domainTagPrefix" || key === "domainProperty") {
			for (const state of everyState(this.plugin.settings)) {
				state.roundWeights = null;
				state.roundDomains = null;
			}
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
						desc: "The domain is the wheel's angle, so this decides where a task sits. Folders and properties are per note; a tag namespace lets one note feed several domains.",
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
				heading: "Structure",
				items: [
					{
						name: "Use headings as a grouping ring",
						desc: "Headings that contain tasks become an extra ring between the note and its tasks. Turn this off to attach tasks straight to their note.",
						control: { type: "toggle", key: "useHeadingsAsGroups" },
					},
					{
						name: "Include finished tasks",
						desc: "Off by default: the wheel reviews outstanding work. Finished means ticked off ([x]) or cancelled ([-]) — one you did, one you decided not to do, and neither leaves anything to look at. Started work ([/]) is not finished and always counts. A finished task that still has open subtasks stays visible whatever this says.",
						control: { type: "toggle", key: "includeCompleted" },
					},
				],
			},
			{
				type: "group",
				heading: "What the wheel draws",
				items: [
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
						name: "Stepping into a wheel",
						desc: "Tapping an item twice opens a wheel over it, and the way back out returns to the wider one. Reusing the tab keeps that a walk rather than a pile: the ladder runs vault → folder → note → section, so opening a tab per step leaves one behind for every branch you looked at. Nothing is lost either way — each blikveld keeps its own round, filter, zoom and folded branches wherever it is opened. A wheel you open from the file list, the ribbon or a command is one you asked for, and always gets a tab of its own.",
						control: {
							type: "dropdown",
							key: "stepInto",
							options: STEP_INTO_LABELS,
						},
					},
					{
						name: "Wedge colours",
						desc: "Which hues the wedges are handed. A palette selects from the colours your own theme defines, so retuning the theme retunes the wheel and both light and dark keep working from one rule. Colour-blind friendly leaves out red and green — the pair that collapses for the two most common kinds — and leads with blue and orange, which stay apart. Hue says which domain a task belongs to, never how urgent it is; urgency is the lightness. Past the end of a palette the hues start over and the wedge position tells those apart, as it always has past eight.",
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
						desc: "How far ahead 'due soon' looks. Overdue tasks are always included.",
						visible: () => settings.filterDue === "soon",
						control: {
							type: "number",
							key: "filterHorizon",
							min: 0,
							placeholder: String(NO_FILTER.horizon),
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
			this.folderList(
				"Folders to read",
				"Leave empty to read the whole vault. Naming the few folders that hold your tasks is usually easier than excluding the many that do not. Pick a folder or start typing its name; the path is relative to the vault root.",
				"Add folder",
				"Werk",
				"includeFolders",
			),
			{
				type: "group",
				heading: "Not every checkbox is a task",
				items: [
					{
						name: "Skip notes of these types",
						desc: "Comma-separated, matched against the note's own front-matter 'type'. A vault that keeps a document standard already says which notes are stories, templates or review forms — and their checkboxes are the document's own checklist, not work on your plate. Nothing has to be tagged by hand. A '*' stands for the rest of the word: 'review*' covers 'review' and 'review-actie'.",
						control: {
							type: "text",
							key: "excludeNoteTypes",
							placeholder: "story, review*",
						},
					},
					{
						name: "Skip checkboxes under these headings",
						desc: "Comma-separated. For a note that holds both: checkboxes under a heading named here belong to the document's own checklist, while a real task elsewhere in the same note still counts. Matched on the heading text, ignoring case. A '*' stands for any run of characters, so 'accepta*' covers 'Acceptatiecriteria' and 'Acceptance criteria'; without one, the whole heading has to match.",
						control: {
							type: "text",
							key: "excludeHeadings",
							placeholder: "accepta*, leestip*, Definition of done",
						},
					},
				],
			},
			this.folderList(
				"Excluded folders",
				"Skipped even when they sit inside a folder above. Keeps templates, archives or an inbox off the wheel. Pick a folder or start typing its name.",
				"Add folder",
				"Archive/2025",
				"excludeFolders",
			),
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
	 * The destinations the reader has named, to rename or remove.
	 *
	 * Deliberately not a form to *make* one in: a destination is made from the
	 * wheel, with the same two pickers an ordinary carry uses (command "Add a
	 * destination to carry work to"). A path typed here could point at a note
	 * that does not exist; one chosen there cannot.
	 */
	private presetList(): SettingDefinitionItem {
		const presets = this.plugin.settings.presets;

		return {
			type: "list",
			heading: "Destinations",
			emptyState:
				"None yet. Open a wheel and run the command “Add a destination to carry work to”: it asks which note, where in it, and whether it moves or copies. After that it is one entry on the card — and a command you can give a key.",
			items: presets.map((preset) => ({
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
			onDelete: (index: number) => {
				tags.splice(index, 1);
				void this.plugin.saveSettings().then(() => this.rerender());
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
const TEXT_LISTS: ReadonlySet<string> = new Set([
	"excludeNoteTypes",
	"excludeHeadings",
]);

type TextListKey = "excludeNoteTypes" | "excludeHeadings";

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
