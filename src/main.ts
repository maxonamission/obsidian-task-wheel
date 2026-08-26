import {
	type Menu,
	moment,
	Notice,
	Platform,
	Plugin,
	TFile,
	TFolder,
	type TAbstractFile,
	type WorkspaceLeaf,
} from "obsidian";
import {
	type DateRule,
	scopeKey,
	VAULT_SCOPE,
	type WheelScope,
	type CarryPreset,
} from "./model/types";
import { describe, isFiltering } from "./parse/filter";
import { skipReport } from "./parse/skip-report";
import { startScope } from "./parse/start-scope";
import {
	clearFilter,
	DEFAULT_SETTINGS,
	DEFAULT_STATE,
	everyState,
	filterOf,
	parseOptionsOf,
	TaskWheelSettingTab,
	type TaskWheelSettings,
	setFilter,
} from "./settings";
import { readNotes, ScanCache } from "./vault/scan";
import { SkipReportModal } from "./view/skip-report-modal";
import { TaskWheelView, VIEW_TYPE_TASK_WHEEL } from "./view/wheel-view";
import {
	TaskWheelHelpModal,
	TaskWheelHelpView,
	VIEW_TYPE_TASK_WHEEL_HELP,
} from "./view/help-view";
import { definePreset } from "./view/carry-flow";
import type { CardActions } from "./view/reading-card";
import { pickCarryHow } from "./view/carry-how";
import { deferWrites } from "./model/deferred";
import { presetCommandId, reconcileCommands } from "./model/commands";
import {
	HELP_LOCALES,
	type HelpLanguage,
	type HelpStrings,
	resolveLanguage,
} from "./view/help-strings";

/** What a filter change cost, said only when it cost something. */
function roundGivenUp(restarted: number): string {
	if (restarted === 0) return "";
	return ` A new selection is a new round, so the ${restarted} item${
		restarted === 1 ? "" : "s"
	} you had already passed are no longer marked.`;
}

/** How long a state change waits for the ones behind it. */
const PERSIST_AFTER = 500;

export default class TaskWheelPlugin extends Plugin {
	settings: TaskWheelSettings = { ...DEFAULT_SETTINGS };

	/**
	 * Outlines kept between scans, shared by every wheel that is open.
	 *
	 * Shared on purpose: two wheels over the same vault read the same files, and
	 * the expensive half of reading them does not depend on which wheel is
	 * asking. Owned by the plugin so it goes when the plugin goes.
	 */
	readonly scanCache = new ScanCache();

	/**
	 * The command ids currently in the palette, one per destination.
	 *
	 * Obsidian owns the palette and does not offer to list what a plugin has
	 * put in it, so the plugin has to remember what it registered in order to
	 * take it back again.
	 */
	private presetCommands = new Set<string>();

	/**
	 * State changes on their way to disk, collected.
	 *
	 * Half a second: long enough that a pinch or a run of stops costs one
	 * write, short enough that the wheel is never more than that behind if
	 * Obsidian goes down without unloading.
	 */
	private readonly writes = deferWrites(() => this.saveData(this.settings), {
		wait: PERSIST_AFTER,
		schedule: (run, after) => {
			const timer = window.setTimeout(run, after);
			return () => window.clearTimeout(timer);
		},
	});

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_TASK_WHEEL,
			(leaf: WorkspaceLeaf) => new TaskWheelView(leaf, this),
		);

		this.registerView(
			VIEW_TYPE_TASK_WHEEL_HELP,
			(leaf: WorkspaceLeaf) => new TaskWheelHelpView(leaf, this),
		);

		this.addRibbonIcon("disc-3", "Open task wheel", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-wheel",
			name: "Open the wheel",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "open-help",
			name: "Show the help panel",
			callback: () => {
				void this.openHelp();
			},
		});

		this.addCommand({
			id: "rescan-vault",
			name: "Rescan the vault",
			callback: () => {
				void this.rescan();
			},
		});

		// The two checklist rules are a boundary rather than a filter, so what
		// they take out is not counted anywhere — which leaves a rule that
		// matches nothing looking exactly like one that works. This is how you
		// see the difference.
		this.addCommand({
			id: "skip-report",
			name: "Show what the skip rules take out",
			callback: () => {
				void this.showSkipReport();
			},
		});

		// Folding is the one move that hides part of the vault, and a fold is
		// undone from the branch it hid — which means finding that branch again.
		// This is the way back that does not depend on finding anything.
		this.addCommand({
			id: "unfold-all",
			name: "Unfold every folded branch",
			callback: () => {
				void this.unfoldAll();
			},
		});

		// The filter also has commands of its own, not only a settings group. On a
		// phone the settings are three taps away in the middle of a round, and a
		// lens you switch on and off during reviewing wants to be one.
		this.addCommand({
			id: "filter-overdue",
			name: "Filter: only overdue",
			callback: () => {
				void this.setDueFilter("overdue");
			},
		});

		this.addCommand({
			id: "filter-soon",
			name: "Filter: due soon",
			callback: () => {
				void this.setDueFilter("soon");
			},
		});

		this.addCommand({
			id: "clear-filter",
			name: "Clear the filter",
			callback: () => {
				void this.clearFilter();
			},
		});

		// The round: how far you are, and starting a fresh one. Both are commands
		// rather than buttons — the card is for the item under the wedge, and the
		// round is a property of the whole wheel.
		this.addCommand({
			id: "round-progress",
			name: "How far is this round?",
			callback: () => {
				const view = this.activeWheel();
				if (view === null) {
					new Notice("Task wheel: no wheel is open.");
					return;
				}
				const { seen, total } = view.progress();
				const filter = filterOf(this.settings, view.currentScope());
				const of = isFiltering(filter) ? ` (filter: ${describe(filter)})` : "";
				new Notice(
					`Task wheel: ${seen} of ${total} items seen this round${of}.`,
				);
			},
		});

		this.addCommand({
			id: "start-round",
			name: "Start a new round",
			callback: () => {
				const view = this.activeWheel();
				if (view === null) {
					new Notice("Task wheel: no wheel is open.");
					return;
				}
				view.startRound();
				new Notice("Task wheel: a new round. Nothing seen yet.");
			},
		});

		// Everything the card can do, as a command too — so the reader can hang
		// their own keys on it. Obsidian owns the key map; we only have to make
		// the actions nameable (owner, 18 aug 2026).
		for (const action of FOCUS_COMMANDS) {
			this.addCommand({
				id: action.id,
				name: action.name,
				callback: () => {
					this.onFocus(action.name, action.pick);
				},
			});
		}

		// The way back out. Tapping an item twice takes you in; this is the other
		// direction, and it is a move you make often enough to want a key on it.
		this.addCommand({
			id: "wheel-out",
			name: "Out to the wider wheel",
			callback: () => {
				const view = this.activeWheel();
				if (view === null) {
					new Notice("Task wheel: no wheel is open.");
					return;
				}
				view.goWider();
			},
		});

		this.addCommand({
			id: "add-preset",
			name: "Add a destination to carry work to",
			callback: () => {
				void this.addPreset();
			},
		});

		this.syncPresetCommands();

		// A wheel over one folder or one note, from where the reader is already
		// looking. On a phone the same menu opens on a long press, which is why
		// this is a menu entry rather than a modifier-click (kaderdocument §4.1).
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				this.offerLocalWheel(menu, file);
			}),
		);

		this.addSettingTab(new TaskWheelSettingTab(this.app, this));

		// The wheel as the page the vault opens on (eigenaarsvraag 21 aug 2026).
		// After the layout is ready, not during `onload`: opening a view before
		// the workspace has finished restoring races with the tabs it is putting
		// back, and both `activateView` and `openScoped` reuse a wheel that
		// restoring already brought back — so the two cannot end up with a wheel
		// each.
		if (this.settings.openOnStart) {
			this.app.workspace.onLayoutReady(() => {
				void this.openStartWheel();
			});
		}

		// A help panel that the workspace brought back is asleep until Obsidian
		// says otherwise, and on a phone it may never say so. Once when the
		// layout is up, and again whenever the workspace shifts — which is what
		// swiping a sidebar open amounts to.
		this.app.workspace.onLayoutReady(() => this.wakeHelp());
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.wakeHelp()),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.wakeHelp()),
		);
	}

	/**
	 * On the way out, write what is still owed.
	 *
	 * The collected writes are the price of not writing on every frame; this is
	 * where that price is paid back. Obsidian does not wait for an unload, so
	 * this is started rather than awaited — it is one `saveData` of an object
	 * that is already in memory, and there is nothing better available.
	 */
	onunload(): void {
		void this.flushState();
	}

	/**
	 * Open the wheel the reader wants to find waiting for them.
	 *
	 * Over a folder or a note when they named one — the review that opens a day
	 * is usually over the week's list or the project in hand, not over five
	 * thousand tasks (eigenaar, 22 aug 2026).
	 */
	private async openStartWheel(): Promise<void> {
		const wanted = startScope(this.settings.startPath, (path) => {
			const at = this.app.vault.getAbstractFileByPath(path);
			if (at instanceof TFolder) return "folder";
			return at instanceof TFile && at.extension === "md" ? "note" : null;
		});

		// A path that has been renamed or deleted is worth a sentence. Opening the
		// vault wheel instead without a word would review something other than
		// what was asked for, and look like the setting had been forgotten.
		if ("missing" in wanted) {
			new Notice(
				`Task wheel: ${wanted.missing} is not in the vault, so nothing was opened. Check the startup wheel in the settings.`,
			);
			return;
		}

		if (wanted.scope.kind === "vault") {
			await this.activateView();
			return;
		}
		await this.openScoped(wanted.scope);
	}

	/**
	 * Add "Open task wheel here" to a folder's or note's context menu.
	 *
	 * Only where there is something to review: a wheel over a note without a
	 * single task would be a menu entry that opens an empty circle.
	 */
	private offerLocalWheel(menu: Menu, file: TAbstractFile): void {
		const scope = scopeOf(file);
		if (scope === null) return;

		menu.addItem((item) => {
			item
				.setTitle("Open task wheel here")
				.setIcon("disc-3")
				.onClick(() => {
					void this.openScoped(scope);
				});
		});
	}

	/**
	 * Open a wheel over one folder or note, reusing the tab if it is already up.
	 *
	 * Always a tab in the main area, whatever the sidebar preference says: a
	 * local wheel is opened deliberately, for a round of reviewing, and the
	 * sidebar is for the one wheel that is always there.
	 */
	async openScoped(scope: WheelScope): Promise<void> {
		const { workspace } = this.app;
		const key = scopeKey(scope);

		const existing = workspace
			.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)
			.find(
				(leaf) =>
					leaf.view instanceof TaskWheelView && leaf.view.scopeKey() === key,
			);
		if (existing !== undefined) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_TASK_WHEEL,
			active: true,
			state: { scope },
		});
		await workspace.revealLeaf(leaf);
	}

	/**
	 * Reveal the wheel, opening one where the reader asked for it.
	 *
	 * A wheel that is already open in the right place is reused. One open
	 * somewhere else is left alone rather than moved: two wheels is a thing
	 * someone might want, and dragging a view out from under a reader is not.
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace
			.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)
			.find(
				(leaf) =>
					leaf.view instanceof TaskWheelView &&
					leaf.view.scopeKey() === scopeKey(VAULT_SCOPE),
			);
		if (existing !== undefined) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_TASK_WHEEL, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * Open the help panel, or bring the one that is open to the front.
	 *
	 * The right sidebar, and only there: it is the panel's home now that the
	 * wheel has given it up (kaderdocument §5.2, besluit 4). Never a second one
	 * — one key beside one wheel is the whole idea.
	 */
	async openHelp(): Promise<void> {
		const { workspace } = this.app;

		// On a phone, a modal. Not a preference: the phone's drawer keeps the
		// pane of an unshown sidebar view detached from the document, and six
		// rounds of drawing into it landed nowhere — attached=false, leaf 0×0,
		// measured on the owner's device (25 aug 2026). A modal owns its own
		// surface, so there is nothing to be detached from.
		if (Platform.isMobile) {
			// A help leaf left behind by an earlier session would sit dead in the
			// drawer next to the modal that replaced it.
			workspace.detachLeavesOfType(VIEW_TYPE_TASK_WHEEL_HELP);
			this.sayHelp("opened as a modal");
			new TaskWheelHelpModal(this, this.activeWheel()).open();
			return;
		}

		const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_WHEEL_HELP)[0];
		if (existing !== undefined) {
			await workspace.revealLeaf(existing);
			await existing.loadIfDeferred();
			// Drawn on the way in, not only when the view was built. `onOpen` runs
			// once in a view's life, and everything that happens to a sidebar
			// afterwards leaves the same instance in place — empty, if anything
			// emptied it (eigenaar, 25 aug 2026).
			if (existing.view instanceof TaskWheelHelpView) existing.view.reopen();
			this.reportHelp("reused");
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (leaf === null) return;

		await leaf.setViewState({
			type: VIEW_TYPE_TASK_WHEEL_HELP,
			active: true,
		});
		await workspace.revealLeaf(leaf);
		await leaf.loadIfDeferred();
		this.reportHelp("opened");
	}

	/**
	 * What the plugin actually found when it went looking for the panel.
	 *
	 * Behind the troubleshooting switch. Three rounds went by on a blank panel
	 * that could equally have been a leaf that is not there, a leaf Obsidian
	 * has left asleep, a view of some other kind, or a view of ours that draws
	 * nothing — and from the outside those four look the same (25 aug 2026).
	 */
	private reportHelp(what: string): void {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_TASK_WHEEL_HELP,
		);
		const first = leaves[0];
		const kind =
			first === undefined
				? "none"
				: first.view instanceof TaskWheelHelpView
					? "ours"
					: first.view.getViewType();

		this.sayHelp(
			`${what} — ${leaves.length} leaf, ` +
				`asleep=${first?.isDeferred ?? "n/a"}, view=${kind}`,
		);
	}

	/**
	 * Say something about the help panel, where the reader can still read it.
	 *
	 * Twice over, because neither place is enough on its own. A `Notice` arrives
	 * even when there is no wheel open, and it is gone in eight seconds — which
	 * is exactly the wrong property for something the reader is trying to
	 * photograph. The wheel's own trace window keeps its lines, and it is
	 * already on their screen (eigenaar, 25 aug 2026).
	 */
	sayHelp(line: string): void {
		if (!this.settings.diagnostics) return;

		new Notice(`Task wheel help: ${line}`, 8000);
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_TASK_WHEEL,
		)) {
			if (leaf.view instanceof TaskWheelView) leaf.view.note(`help: ${line}`);
		}
	}

	/**
	 * Wake the help panel if Obsidian has left it asleep.
	 *
	 * Since 1.7 a view in a sidebar is *deferred*: the leaf is there, its tab
	 * carries the right name and icon, but no view is built until Obsidian
	 * decides it has become visible. On the owner's phone that decision never
	 * came. The panel sat there with its title and nothing under it — which is
	 * exactly what a deferred view looks like from outside, and why nothing
	 * reported an error: none of this plugin's code had run yet (eigenaar,
	 * 25 aug 2026, three rounds of looking in the wrong place).
	 *
	 * Woken rather than waited for. Deferring pays off for a view that costs
	 * something to build; this one is three folds of text about the wheel beside
	 * it, and a key that is not there when you look is not a key.
	 */
	private wakeHelp(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_TASK_WHEEL_HELP,
		)) {
			if (leaf.isDeferred) void leaf.loadIfDeferred();
		}
	}

	/**
	 * Which language the help speaks right now.
	 *
	 * "auto" follows Obsidian's own language setting — there is no plugin API
	 * for it, but Obsidian sets the moment locale to match, and that is the
	 * closest thing to asking. An explicit choice in our settings wins.
	 */
	helpLanguage(): HelpLanguage {
		return resolveLanguage(this.settings.language, moment.locale());
	}

	helpStrings(): HelpStrings {
		return HELP_LOCALES[this.helpLanguage()];
	}

	/**
	 * Tell the help panel that a round moved on.
	 *
	 * Hung on the same call that saves state, because that is exactly the set of
	 * changes the panel reports: an item marked seen, a fold, a filter. Costs
	 * nothing when the panel is not open.
	 */
	private refreshHelp(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_TASK_WHEEL_HELP,
		)) {
			if (leaf.view instanceof TaskWheelHelpView) leaf.view.refresh();
		}
	}

	/**
	 * Rebuild the help panel from scratch — all three blocks, not only the
	 * live one. For the settings tab: a language change touches every word.
	 */
	rebuildHelp(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_TASK_WHEEL_HELP,
		)) {
			if (leaf.view instanceof TaskWheelHelpView) leaf.view.redraw();
		}
	}

	/**
	 * The wheel a command should act on: the one in front of the reader.
	 *
	 * With more than one wheel open — the vault in one tab, a project in the
	 * next — "the wheel" is whichever is active, and only then the first one
	 * that happens to be open.
	 */
	/**
	 * Run one card action from the command palette, and say so when it will not.
	 *
	 * Silence is the failure mode a hotkey must not have: a key that does
	 * nothing is indistinguishable from a key that is not bound.
	 */
	private onFocus(
		what: string,
		pick: (actions: CardActions) => (() => void) | undefined,
	): void {
		const view = this.activeWheel();
		if (view === null) {
			new Notice("Task wheel: no wheel is open.");
			return;
		}
		if (!view.runOnFocus(pick)) {
			new Notice(`Task wheel: nothing under the wedge to ${what.toLowerCase()}.`);
		}
	}

	/** Ask the two questions once, keep the answers, and make it a command. */
	async addPreset(): Promise<void> {
		const how = await pickCarryHow(this.app);
		if (how === null) return;

		const preset = await definePreset(this.app, how);
		if (preset === null) return;

		this.settings.presets.push(preset);
		await this.saveSettings();
		this.syncPresetCommands();

		new Notice(
			`Task wheel: “${preset.name}” is on the card now, and in the command list — give it a key under Hotkeys.`,
		);
	}

	/**
	 * Make the command list say exactly what the destinations say.
	 *
	 * Adding a command was easy and taking one back was not, so a deleted
	 * destination left its command behind until Obsidian restarted — still
	 * carrying work to the place the reader had just thrown away — and a renamed
	 * one left the old command standing beside the new (audit, 23 aug 2026).
	 * `Plugin.removeCommand` has existed since API 1.7, which the manifest
	 * already requires.
	 *
	 * Written as a reconciliation rather than an add here and a remove there:
	 * every route into the list — added, renamed, deleted, loaded — ends with
	 * the same question, "which commands should exist now", and there is one
	 * answer to it.
	 */
	syncPresetCommands(): void {
		const wanted = new Map(
			this.settings.presets.map((preset) => [presetCommandId(preset.name), preset]),
		);
		const change = reconcileCommands(this.presetCommands, wanted.keys());

		for (const id of change.remove) this.removeCommand(id);
		for (const id of change.add) {
			const preset = wanted.get(id);
			if (preset !== undefined) this.registerPreset(preset);
		}

		this.presetCommands = new Set(wanted.keys());
	}

	/**
	 * One command per named destination.
	 *
	 * The id is built from the name, so a key you bind stays bound. Renaming a
	 * destination therefore gives it a new command and drops the old key — which
	 * is the honest behaviour: it is a different entry in the list.
	 */
	registerPreset(preset: CarryPreset): void {
		this.presetCommands.add(presetCommandId(preset.name));
		this.addCommand({
			id: presetCommandId(preset.name),
			name: `Carry to ${preset.name}`,
			callback: () => {
				const view = this.activeWheel();
				if (view === null) {
					new Notice("Task wheel: no wheel is open.");
					return;
				}
				if (!view.runPreset(preset)) {
					new Notice("Task wheel: nothing under the wedge to carry.");
				}
			},
		});
	}

	private activeWheel(): TaskWheelView | null {
		const active = this.app.workspace.getActiveViewOfType(TaskWheelView);
		if (active !== null) return active;

		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)[0];
		return leaf?.view instanceof TaskWheelView ? leaf.view : null;
	}

	/**
	 * Read the vault once and say what the skip rules do to it.
	 *
	 * Always over the whole vault, whatever wheel happens to be open: the two
	 * rules are a global setting, and answering "does my pattern work" from
	 * inside a local wheel would answer it for one folder.
	 */
	async showSkipReport(): Promise<void> {
		const options = parseOptionsOf(this.settings, VAULT_SCOPE);
		const notes = await readNotes(this.app, VAULT_SCOPE);
		new SkipReportModal(this.app, skipReport(notes, options)).open();
	}

	/** Rescan the vault in every open wheel. */
	async rescan(): Promise<void> {
		// *Rescan the vault* means it literally: everything read again. It is the
		// command you reach for when the wheel and the vault disagree, so it must
		// not be able to hand back the very outlines that are under suspicion.
		this.scanCache.clear();

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_WHEEL);
		if (leaves.length === 0) {
			await this.activateView();
			return;
		}
		for (const leaf of leaves) {
			if (leaf.view instanceof TaskWheelView) await leaf.view.refreshWithNotice();
		}
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<TaskWheelSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(stored ?? {}),
			state: { ...DEFAULT_STATE, ...(stored?.state ?? {}) },
			// Copied, not shared: `DEFAULT_SETTINGS` is spread shallowly, so
			// keeping the default object here would have every wheel writing its
			// state into the constant.
			scopes: { ...(stored?.scopes ?? {}) },
			// Copied, not shared, for the same reason as the scopes above.
			filterWithTags: [...(stored?.filterWithTags ?? [])],
			filterWithoutTags: [...(stored?.filterWithoutTags ?? [])],
			excludeNoteTypes: [...(stored?.excludeNoteTypes ?? [])],
			excludeHeadings: [...(stored?.excludeHeadings ?? [])],
		};

		// A blikveld written before the filter moved out of the plugin settings
		// has no filter of its own (18 aug 2026). It gets a copy of the one it
		// was running under, so a local wheel comes back after the upgrade
		// looking exactly as it did — rather than suddenly unfiltered, which
		// would be the wheel changing what a round is about without being asked.
		// A bucket made *after* the move always has the field, so this only ever
		// fires once per blikveld.
		const inherited = filterOf(this.settings);
		for (const state of Object.values(this.settings.scopes)) {
			state.filter ??= { ...inherited };
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.refreshOpenViews();
	}

	/**
	 * Say that plugin state has changed, so it gets written before long.
	 *
	 * Two reasons it is not written on the spot. It must not go through
	 * `saveSettings`: folding a branch away changes what the wheel draws, not
	 * what the notes say, and a rescan of the whole vault for that is work the
	 * parser cannot even see the point of. And it must not go through
	 * `saveData` directly either: every stop of a round and every frame of a
	 * pinch asks, and each write serialises all the settings — hundreds of
	 * kilobytes on a full vault (BC_E3_S45). The asks are collected instead;
	 * see `model/deferred.ts`.
	 */
	persist(): void {
		this.writes.soon();
		this.refreshHelp();
	}

	/**
	 * Write what is owed right now.
	 *
	 * For closing down, where "before long" never comes. Costs nothing when
	 * nothing is owed.
	 */
	async flushState(): Promise<void> {
		await this.writes.now();
	}

	/**
	 * Switch a date lens on, or off again when it is already the one running.
	 *
	 * On the wheel you are looking at. Since the filter moved to the blikveld
	 * (18 aug 2026) there is no such thing as "the" filter any more, and a
	 * command that quietly picked the vault wheel's would be the same surprise
	 * that started this.
	 */
	private async setDueFilter(rule: DateRule): Promise<void> {
		const view = this.activeWheel();
		if (view === null) {
			new Notice("Task wheel: no wheel is open.");
			return;
		}

		const scope = view.currentScope();
		const now = filterOf(this.settings, scope);
		const wanted = now.due === rule ? "any" : rule;

		const { restarted } = setFilter(this.settings, scope, { ...now, due: wanted });
		await this.saveSettings();

		const filter = filterOf(this.settings, scope);
		new Notice(
			(isFiltering(filter)
				? `Task wheel: filter — ${describe(filter)}.`
				: "Task wheel: filter cleared.") + roundGivenUp(restarted),
		);
	}

	/**
	 * Put every task back in play.
	 *
	 * A filter is the one setting that changes what "all of it" means, so it
	 * needs a way out that does not involve finding the right dropdown — the
	 * more so because it is the setting most likely to be left on by accident.
	 */
	async clearFilter(): Promise<void> {
		const view = this.activeWheel();
		if (view === null) {
			new Notice("Task wheel: no wheel is open.");
			return;
		}

		const scope = view.currentScope();
		if (!isFiltering(filterOf(this.settings, scope))) {
			new Notice("Task wheel: no filter is on in this wheel.");
			return;
		}

		const { restarted } = clearFilter(this.settings, scope);
		await this.saveSettings();
		new Notice(
			"Task wheel: filter cleared. Every task is back in the round." +
				roundGivenUp(restarted),
		);
	}

	/** Bring every folded branch back, in every wheel, and say how many. */
	async unfoldAll(): Promise<void> {
		const states = everyState(this.settings);
		const folded = states.reduce((sum, state) => sum + state.collapsed.length, 0);
		if (folded === 0) {
			new Notice("Task wheel: nothing is folded away.");
			return;
		}

		for (const state of states) state.collapsed = [];
		this.persist();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)) {
			if (leaf.view instanceof TaskWheelView) leaf.view.redraw();
		}

		new Notice(
			`Task wheel: unfolded ${folded} ${folded === 1 ? "branch" : "branches"}.`,
		);
	}

	/**
	 * Redraw every open wheel without re-reading the vault.
	 *
	 * For a setting that changes the *drawing* and nothing about the notes —
	 * renaming a destination, or turning it from a move into a copy. Rescanning
	 * for that would read every note in the vault to find out that none of them
	 * changed.
	 */
	redrawViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)) {
			if (leaf.view instanceof TaskWheelView) leaf.view.redraw();
		}
	}

	private async refreshOpenViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)) {
			if (leaf.view instanceof TaskWheelView) await leaf.view.refresh();
		}
	}
}

/**
 * What a wheel over this file or folder would be about.
 *
 * Markdown notes and folders only: a wheel over a PDF or an image would be an
 * empty circle, and an entry that always disappoints is worse than no entry.
 */
function scopeOf(file: TAbstractFile): WheelScope | null {
	if (file instanceof TFolder) {
		return file.isRoot() ? VAULT_SCOPE : { kind: "folder", path: file.path };
	}
	if (file instanceof TFile && file.extension === "md") {
		return { kind: "note", path: file.path };
	}
	return null;
}


/**
 * The card's actions, as commands.
 *
 * Each one names the callback it wants out of `CardActions` rather than
 * repeating the logic, so a command and the button beside it can never disagree
 * about what is allowed — the guards live in the view, in one place.
 */
const FOCUS_COMMANDS: readonly {
	id: string;
	name: string;
	pick: (actions: CardActions) => (() => void) | undefined;
}[] = [
	{ id: "focus-done", name: "Tick off", pick: (a) => a.done },
	{ id: "focus-start", name: "Mark as started", pick: (a) => a.start },
	{ id: "focus-cancel", name: "Cancel", pick: (a) => a.cancel },
	{ id: "focus-defer", name: "Push a week out", pick: (a) => a.defer },
	{
		id: "focus-priority-up",
		name: "Raise the priority",
		pick: (a) => (a.priority === undefined ? undefined : () => a.priority?.(1)),
	},
	{
		id: "focus-priority-down",
		name: "Lower the priority",
		pick: (a) => (a.priority === undefined ? undefined : () => a.priority?.(-1)),
	},
	{ id: "focus-open", name: "Open the note here", pick: (a) => a.open },
	{
		id: "focus-copy",
		name: "Copy to another note",
		pick: (a) => a.carry?.copy,
	},
	{
		id: "focus-move",
		name: "Move to another note",
		pick: (a) => a.carry?.move,
	},
];

