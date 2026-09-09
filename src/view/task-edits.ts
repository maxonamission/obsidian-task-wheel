import { type App, Menu, Notice, TFile } from "obsidian";
import { aWeekOut, today } from "../model/dates";
import { type AfterWrite } from "../model/carry";
import type { Priority, TaskState, WheelScope } from "../model/types";
import {
	isNoteTask,
	isRefused,
	type NoRename,
	renameRefusal,
	scopeFor,
	wedgeSource,
} from "../model/scope";
import { parseTaskLine, STATUS_CHAR } from "../parse/task-line";
import { attachLinkSuggest } from "./link-suggest";
import {
	actOnSection,
	addSubheadingTo,
	addToSection,
	moveSectionUnder,
	type SectionHost,
} from "./section-edits";
import { linesOf } from "../parse/lines";
import { headingsOf } from "../parse/outline";
import {
	levelForNewSection,
	type MoveDirection,
	removeTaskLine,
	whyNotMoved,
} from "../parse/outline-edit";
import { PRIORITY_LADDER } from "../layout/colour";
import type { LaidOutNode, WheelLayout } from "../layout/radial";
import { type TaskWheelSettings } from "../settings";
import type { CardActions } from "./reading-card";
import { type CarryHost, carryTo, carryToPreset } from "./carry-flow";
import { pickHeading } from "./heading-picker";
import { parentCandidates, pickTask } from "./task-picker";
import { promptForRemoval, promptForTasks } from "./prompt";
import type { CarryMode, LineAnchor, LineRef } from "../vault/writeback";
import {
	createThroughTasks,
	createsThroughTasks,
	editThroughTasks,
	editsThroughTasks,
	writeDone,
	writeLine,
	writeMove,
	writeMoveTo,
	writeMoveToNew,
	writeDeleteLine,
	writeInsertAfter,
	writeInsertLineAfter,
	writeMoveUnder,
	writeNoteStatus as writeNoteStatusTo,
	renameNoteTask as renameNoteTaskTo,
	writePriority,
	writeScheduled,
	writeStatus,
	writeText,
	type WriteOutcome,
} from "../vault/writeback";


/**
 * Move on to the next item along this ring once the write has landed.
 *
 * The actions that carry this are the ones that mean **"I am finished with this
 * one"**: ticked off, cancelled, pushed a week out, carried elsewhere, hung
 * under another task or heading. After those the reader wants the next card, and
 * on a filtered wheel the item is about to vanish anyway.
 *
 * The ones that do *not*: priority up and down (a ladder you step along),
 * marking as started (you note it and keep reading), renaming, adding, and
 * moving up or down among siblings — all of those are "adjust *this* one".
 *
 * **The next task with children before parents** (`taskAfter`, worked out in
 * `refreshCarrying` from the tree as it was): the deepest subtask of the next
 * branch, and the task it hangs under only once its own subtasks are behind you.
 * Not the sideways step the arrows and the card buttons make — that one walks a
 * single ring and steps over everything on the others, 144 tasks of 144 on a
 * measured wheel (20 aug 2026).
 *
 * An action must never carry the reader past work they have not seen, and this
 * walk holds every task exactly once, so it cannot (kaderdocument §5). It is
 * passed *to the write* for the same reason: worked out and stored when the
 * button was pressed, it outlived actions that never wrote — cancel the heading
 * picker, press Alt+↓, and the wheel jumped forward and marked an item seen the
 * reader had never turned to (audit, 23 aug 2026).
 */
export const ADVANCING: AfterWrite = { advance: true };

/**
 * What one review action *is*, and what happens after it.
 *
 * Lifted out of `wheel-view.ts` under BC_E3_S162, and not for the line count.
 * Two of the audit's findings of 6 sep 2026 lived in `act` — a refused write
 * that moved the wheel on anyway, and an aim that outlived the write it
 * belonged to — and neither could have been caught by a test, because the only
 * way in was through an `ItemView`. It is the same argument BC_E3_S13 made
 * about the notice logic of the carry, and the same answer: give the decision
 * a seam and the seam a test.
 *
 * Deliberately narrow. The host is the vault to write to and the one thing to
 * do afterwards; everything about drawing, focus and the round stays on the
 * view.
 */
export interface EditHost {
	readonly app: App;
	readonly settings: TaskWheelSettings;
	/** Which wheel this is, for the sentences that name it. */
	scope: () => WheelScope;
	/**
	 * Re-read and settle up: carry the round's marks across, and land where the
	 * action aimed. `act` never calls this for a write that did not happen —
	 * see the outcome handling below for what that used to cost.
	 */
	refreshCarrying: (after?: AfterWrite) => Promise<void>;
	/** A line in this wheel's trace. */
	trace: (line: string) => void;

	/**
	 * The two neighbouring hosts, handed over rather than rebuilt.
	 *
	 * Carrying and section editing were split out first (BC_E3_S13) and have
	 * their own seams; the card offers all three side by side, so it needs to
	 * be able to reach them. Passing the host along is what keeps this module
	 * from growing a second opinion about either.
	 */
	carryHost: () => CarryHost;
	sectionHost: () => SectionHost;

	/** Where the wheel is standing, for the actions the keyboard aims. */
	focusId: () => string | null;
	layout: () => WheelLayout | null;

	/**
	 * What only the view can do: open things and move the wheel.
	 *
	 * This is the widest part of the seam and it is worth naming why. What the
	 * card *offers* is a decision — which actions a heading has that a task
	 * does not, what a note that is itself a task may do — and that decision is
	 * what BC_E3_S162 came to make testable. Carrying it out is plumbing, and
	 * plumbing stays on the view.
	 */
	openNote: (laid: LaidOutNode) => void;
	openScopeFor: (id: string) => void;
	stepFromCard: (delta: number) => void;
	toggleFold: (id?: string) => void;
}

/**
 * One review action, and everything it needs.
 *
 * A union rather than a name plus five bags of optional parameters. The old
 * shape took `(kind, ref, due?, change?, status?, outline?)` where `outline`
 * held five more optionals, so what a call *meant* could only be read off which
 * positions were `undefined` — and a new action had to be threaded through the
 * signature, the if-ladder and every caller before the compiler had an opinion
 * (audit, 23 aug 2026). Here a `moveTo` without a target does not compile.
 *
 * Writing it down also settled a question: there was an `insert` branch that
 * nothing had called since BC_E3_S24 replaced it with the walking
 * `writeInsertAfter`. Adding a case for it would have been inventing a caller.
 */
export type Act =
	| { kind: "done" }
	| { kind: "status"; char: string }
	/** No date is not an error: a task without one is deferred from today. */
	| { kind: "defer"; scheduled?: string }
	| { kind: "priority"; from: Priority; step: number }
	| { kind: "text"; text: string }
	/** A whole line, finished elsewhere — the Tasks modal hands one back. */
	| { kind: "line"; text: string }
	| { kind: "move"; direction: MoveDirection }
	/** The heading or parent task a picker named, with the text it showed. */
	| { kind: "moveTo"; target: LineAnchor }
	| { kind: "moveUnder"; target: LineAnchor }
	| { kind: "moveToNew"; title: string }
	/**
	 * Take the line out of the note (BC_E3_S91). The guard — nothing may hang
	 * under it — is `removeTaskLine`'s, decided ahead of the confirmation this
	 * always follows; nothing here needs to say so twice.
	 */
	| { kind: "remove" };

/**
 * Say the true thing about a move that did not happen.
 *
 * One sentence used to cover every refusal — "already at the end of its
 * list" — which is wrong when you asked to go up, and wrong again for the
 * only task under a heading, where the real answer is that this is a
 * different operation (owner, 18 aug 2026). The note is read again here
 * because a refusal is a dead end anyway; one cached read is cheaper than
 * carrying the answer along the whole write path for the rare case.
 */
/**
 * Move on to the next item along this ring once the write has landed.
/**
 * A line a picker offered, with the text it was offering.
 *
 * Built from the very read the picker was filled from, so the anchor and the
 * list the reader chose from can never disagree.
 */
export function anchorAt(lines: readonly string[], line: number): LineAnchor {
	return { line, raw: lines[line] ?? "" };
}
/**
 * Where a task's line sits, if this item is a task on a line at all.
 *
 * A task note is a task without a line (BC_E3_S130): it has fields, because its
 * tags and its status are real, but nothing to quote and nothing to write back
 * to. `source.raw === null` is what says so — the same signal a note ring has
 * always carried — and every edit path funnels through here, so testing it once
 * keeps a rewrite off line 0 of somebody's note.
 */
export function lineRefOf(laid: LaidOutNode): LineRef | null {
	const source = laid.node.source;
	const raw = laid.node.fields?.raw;
	if (source === undefined || raw === undefined) return null;
	if (source.raw === null) return null;

	return { path: source.path, line: source.line, raw };
}
/**
 * What a task will be called once these words are written to its line.
 *
 * Not the words themselves: the parser lifts tags out of the description, so
 * "Mailen #werk" becomes "Mailen" on the wheel. Asking the real parser is the
 * only way the rename hint and the rebuilt tree can agree.
 */
function labelAfter(text: string): string {
	const parsed = parseTaskLine(`- [ ] ${text.trim()}`);
	const label = parsed?.fields.description ?? "";
	return label.length > 0 ? label : text.trim();
}
/**
 * The same question, of a finished line rather than of the words for one.
 *
 * `labelAfter` builds the checkbox itself because it is handed a description;
 * what comes back from the Tasks modal is already a whole line, checkbox and
 * fields and all, so building another one around it would ask the parser about
 * the wrong text.
 */
function labelOfLine(line: string): string {
	return parseTaskLine(line.trim())?.fields.description ?? "";
}

export async function explainNotMoved(
app: App,
ref: LineRef,
direction: MoveDirection,
): Promise<string> {
	const file = app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) return "Task wheel: that note is gone.";

	const lines = linesOf(await app.vault.cachedRead(file));
	switch (whyNotMoved(lines, ref.line, direction)) {
		case "alone":
			return "Task wheel: this is the only item in its list. Use “Move to another heading” to take it somewhere else.";
		case "first":
			return "Task wheel: it is already the first in its list.";
		case "last":
			return "Task wheel: it is already the last in its list.";
		case "not-a-task":
			return "Task wheel: that line has changed since the scan.";
	}
}

/**
 * Carry out a review action, and say what came of it.
 *
 * Every write goes through the same door so the aftermath is handled once:
 * a changed note means a rescan, and a stale line means the wheel was
 * showing something the vault no longer says — which is not an error but a
 * reason to look again.
 */
export async function act(
	host: EditHost,
what: Act,
ref: LineRef,
after: AfterWrite = {},
): Promise<void> {
	let outcome: WriteOutcome;

	try {
		switch (what.kind) {
			case "done":
				outcome = await writeDone(host.app, ref);
				break;
			case "status":
				outcome = await writeStatus(host.app, ref, what.char);
				break;
			case "text":
				outcome = await writeText(host.app, ref, what.text);
				break;
			case "line":
				outcome = await writeLine(host.app, ref, what.text);
				break;
			case "move":
				outcome = await writeMove(host.app, ref, what.direction);
				break;
			case "moveTo":
				outcome = await writeMoveTo(host.app, ref, what.target);
				break;
			case "moveUnder":
				outcome = await writeMoveUnder(host.app, ref, what.target);
				break;
			case "moveToNew":
				outcome = await writeMoveToNew(host.app, ref, what.title);
				break;
			case "remove":
				outcome = await writeDeleteLine(host.app, ref);
				break;
			case "defer":
				// A deferral is a decision about attention, not a change to the
				// deadline: it writes ⏳ and leaves 📅 alone, so the "parked for
				// later" lens recognises the wheel's own deferrals and the
				// overdue lens keeps telling the truth (BC_E3_S65).
				outcome = await writeScheduled(
					host.app,
					ref,
					aWeekOut(what.scheduled, today()),
				);
				break;
			case "priority":
				outcome = await writePriority(
					host.app,
					ref,
					shift(what.from, what.step),
				);
				break;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not write to ${ref.path} — ${message}`);
		return;
	}

	if (outcome === "stale") {
		new Notice("Task wheel: that line has changed since the scan. Rescanned.");
	} else if (outcome === "missing") {
		new Notice(`Task wheel: ${ref.path} is gone. Rescanned.`);
	} else if (outcome === "unchanged") {
		// A press that changes nothing has to say so. Silence here is what hid
		// the CRLF defect: every action on a Windows-authored note was dropped
		// without a word, and the button simply appeared to be dead.
		new Notice(
			what.kind === "move"
				? await explainNotMoved(host.app, ref, what.direction)
				: what.kind === "moveUnder"
					? // The picker leaves out the task itself and everything under
						// it, so the only refusal left is the one that changes nothing.
						"Task wheel: it already hangs under that task."
					: what.kind === "remove"
						? // The one race the confirmation cannot close: something was
							// added under the line between asking and writing.
							"Task wheel: this line has something under it now, so it stays."
						: "Task wheel: nothing to change on that line.",
		);
	}

	// Renaming and moving hand back a node the wheel has never met, because a
	// node's id is its place plus its text. Carrying the round's marks — and
	// the reading wedge — across is what keeps an edit from quietly undoing
	// part of a round (kaderdocument §5).
	//
	// Only a write that happened may aim. A refusal rescans and stops there:
	// `after` still held `advance`, so a "stale" outcome moved the wheel on
	// and marked the next item **seen** without anything having been written
	// and without the reader ever turning there — V3 of the audit of 23 aug
	// 2026, through the outcome instead of through a picker (found by audit,
	// 6 sep 2026).
	if (outcome !== "unchanged") {
		await host.refreshCarrying(outcome === "written" ? after : {});
	}
}

/** One step up or down the priority ladder, stopping at the ends. */
function shift(from: Priority, step: number): Priority {
	const order = PRIORITY_LADDER;
	const at = order.indexOf(from);
	const next = Math.min(Math.max(at - step, 0), order.length - 1);
	return order[next];
}
/**
 * What the card may do with this item.
 *
 * Assembled per item rather than fixed, so an action that cannot mean
 * anything here is simply absent — a greyed-out row of five would say the
 * wheel does more than it does.
 */

/**
 * Where "Reveal in navigation" could point for this item, if anywhere
 * (BC_E3_S134).
 *
 * A note ring and a task document are both a whole note; a folder wedge is a
 * folder on disk. All three have a place in the file list to open Obsidian's
 * own menu on. A tag or a property wedge does not — it names nothing on
 * disk — and `scopeFor` already carries that exact answer
 * (`refused: "not-a-folder"`), the same question `renameRefusal` asks of the
 * same wedge. Asking it again here keeps the folder/tag rule written down
 * once.
 */
function revealPath(host: EditHost, laid: LaidOutNode): string | null {
	if (laid.node.kind === "project") return laid.node.source?.path ?? null;

	// Every wedge is a "domain" node one ring out (`scopeFor`'s own
	// assumption); anything deeper here is a heading or a task, neither of
	// which is a file or a folder.
	if (laid.node.kind !== "domain" || laid.depth !== 1) return null;

	const scope = scopeFor(
		{
			kind: laid.node.kind,
			depth: laid.depth,
			label: laid.node.label,
			source: laid.node.source,
		},
		host.scope(),
		host.settings.domainSource,
	);
	return !isRefused(scope) && scope.kind === "folder" ? scope.path : null;
}

export function actionsFor(
	host: EditHost,
	laid: LaidOutNode | null,
): CardActions {
	if (laid === null) return {};

	const ref = lineRefOf(laid);
	const state = laid.node.fields?.state;
	const reveal = revealPath(host, laid);

	const on = ADVANCING;

	// A task document is a task, so it does what a task does — it just does it
	// in front matter rather than between brackets (BC_E3_S132). The three
	// status actions and renaming are handed in here instead of the line
	// versions below; deferring and priority are not, because the wheel reads
	// no date or priority from a note's front matter and writing one would be
	// inventing a convention for vaults that have none.
	if (isNoteTask(laid.node)) return noteTaskActions(host, laid, state, on);

	return {
		done:
			ref === null
				? undefined
				: () => void act(host, { kind: "done" }, ref, on),
		// Pressing the status a task already carries takes it off again,
		// which is the only way back from a mis-tap on a phone.
		start:
			ref === null
				? undefined
				: () =>
						void act(host,
							{
								kind: "status",
								char: STATUS_CHAR[state === "in-progress" ? "open" : "in-progress"],
							},
							ref,
						),
		cancel:
			ref === null
				? undefined
				: () =>
						void act(host,
							{
								kind: "status",
								char: STATUS_CHAR[state === "cancelled" ? "open" : "cancelled"],
							},
							ref,
							on,
						),
		defer:
			ref === null
				? undefined
				: () =>
						void act(host,
							{ kind: "defer", scheduled: laid.node.fields?.scheduled },
							ref,
							on,
						),
		priority:
			ref === null
				? undefined
				: (step) => {
						void act(host,
							{ kind: "priority", from: laid.priority, step },
							ref,
						);
					},
		// The title of a task goes through `outline.rename`; everything else that
		// has a name of its own goes through this one (BC_E3_S119).
		rename: ref !== null ? undefined : titleRename(host, laid),
		// Only where there is genuinely nothing to rewrite. A tap that quietly
		// does nothing is the failure this surface avoids (BC_E3_S118), so what
		// is left of the refusals still speaks.
		onTitleRefused:
			ref !== null || titleRename(host, laid) !== undefined
				? undefined
				: () => explainNoRename(host, laid),
		open: laid.node.source === undefined ? undefined : () => host.openNote(laid),
		follow:
			laid.node.source === undefined
				? undefined
				: (target, external, event) =>
						follow(host, laid, target, external, event),
		fold: (id) => host.toggleFold(id),
		// The same move the arrow keys make: sideways on this ring. A phone
		// has no arrow keys, and turning is a coarse instrument for one step.
		alongRing: (delta) => host.stepFromCard(delta),
		// On every wheel since 26 aug 2026 (kaderdocument §4.2, herzien):
		// each of these writes only into the task's own note — `ref.path`
		// is the boundary, not the wheel's scope — so hanging a task that
		// sits just wrong onto the right heading works mid-review, without
		// the detour through the note's own wheel. What stays note-wheel
		// only is editing *headings* (`section` below): those reshape a
		// document, and doing that is what the document's own wheel is for.
		outline:
			ref === null
				? undefined
				: {
						// Only offered when the Tasks plugin is there *and* carries
						// the modal. Asked per draw rather than remembered: a plugin
						// can be switched on while a wheel stands open.
						editInTasks: editsThroughTasks(host.app)
							? () => void editInTasks(host, ref, laid)
							: undefined,
						titleOpensTasks: host.settings.editTask === "tasks",
						rename: (text) => {
							void act(host, { kind: "text", text }, ref, {
								// The label after the edit is the *parsed* description, not
								// what was typed: tags are lifted out of it. Reusing the
								// real parser is the only way the two agree.
								rename: {
									path: ref.path,
									line: ref.line,
									from: laid.node.label,
									to: labelAfter(text),
								},
							});
						},
						add: (asChild) => {
							void addTask(host, ref, asChild);
						},
						move: (direction) => {
							void act(host, { kind: "move", direction }, ref);
						},
						moveTo: () => void moveToHeading(host, ref),
						moveUnder: () => void moveUnderTask(host, ref),
						remove: () => void removeLine(host, ref),
					},
		// The same offering Obsidian's own editor makes: type `[[` and the
		// notes come to you (BC_E3_S29).
		suggestLinks: (field: HTMLTextAreaElement) =>
			attachLinkSuggest(host.app, field),
		// A heading gets the same four moves, one level up. Only in a note
		// or section wheel — a section wheel is the document wheel one path
		// deeper (BC_E3_S64) — and only when the tree knows which line it
		// stands on. A wedge in those wheels is a heading, so it gets the
		// same menu as the rings inside it. A wedge anywhere else is a folder
		// or a tag and has no line to edit — which is exactly what the missing
		// source says.
		section:
			(host.scope().kind !== "note" &&
				host.scope().kind !== "section") ||
			(laid.node.kind !== "group" && laid.node.kind !== "domain") ||
			laid.node.source === undefined
				? undefined
				: {
						// A heading is a container, and every move here adjusts *it*.
						// Nothing is being finished, so nothing moves on.
						move: (direction) => {
							void actOnSection(host.sectionHost(), laid, (line) => ({
								kind: "move",
								line,
								direction,
							}));
						},
						moveUnder: () => void moveSectionUnder(host.sectionHost(), laid),
						addTask: () => void addToSection(host.sectionHost(), laid),
						addSubheading: () =>
							void addSubheadingTo(host.sectionHost(), laid),
						// The menu twin of the double tap, for whom a double
						// tap is not a discoverable thing (BC_E3_S64).
						openWheel: () => host.openScopeFor(laid.id),
					},
		// Both wheels, unlike the two above. A task you come across while
		// reviewing the whole vault is exactly the one you want to pull onto
		// your list, and where you came across it is the vault wheel.
		// Not on a note that is itself a task (BC_E3_S130). Carrying lifts the
		// task *lines* out of a note and leaves the file behind — on a task
		// document that empties the very thing the reader asked to move,
		// which is the surprise the owner hit on 4 sep 2026. A file is moved
		// in the file list, not by the wheel; the row is absent rather than
		// present-and-refusing, the way every other impossible action here is.
		// Where carrying cannot mean anything, moving the file can. Obsidian's
		// own menu rather than a folder picker of ours (BC_E3_S131).
		// Only on a task document, where there is no other way to move the
		// thing the wheel is pointing at. It was briefly offered on every
		// note ring as well, and the owner's first use of it created a
		// duplicate folder tree: Android's file system is case-sensitive, so
		// a folder typed with the wrong capital is a *new* folder, and
		// Obsidian's dialog said nothing (4 sep 2026).
		//
		// The dialog is Obsidian's and the hazard is the file system's, but
		// the invitation was ours: reviewing is quick and half-attentive,
		// and making folders is not. On a note ring the same menu is one
		// right-click away in the file list, so the convenience was not
		// worth the tap. Here it is the only way, so it stays.
		//
		// **Herzien BC_E3_S134** (eigenaar, 4 sep 2026): worth the tap after all,
		// for a reason the paragraph above never weighed — *Reveal in
		// navigation* is a row in this same menu, and it reads, full stop. The
		// hazard above is still real for *Move file to…*, exactly as it always
		// was on a task document; opening the menu is not itself a move, and
		// the reader still picks the row. `revealPath` decides which items have
		// a place in the file list to reveal at all — a note ring or a folder
		// wedge, never a tag or a property wedge, which is `scopeFor`'s answer
		// and not a second one of ours.
		file:
			reveal === null
				? undefined
				: (event: MouseEvent) => openFileMenu(host, reveal, event),
		carry:
			laid.node.source === undefined ||
			laid.node.kind === "root" ||
			isNoteTask(laid.node)
				? undefined
				: {
						copy: () => carryFrom(host, laid, "copy"),
						move: () => carryFrom(host, laid, "move"),
						presets: host.settings.presets.map((preset) => ({
							name: preset.name,
							how: preset.how,
							run: () => carryToPreset(host.carryHost(), laid, preset, on),
						})),
					},
	};
}

/**
 * What the card may do with a task that is a whole note (BC_E3_S132).
 *
 * The same four gestures as on a line — tick, start, cancel, rename — writing
 * the reader's own words into the reader's own property. Pressing the status
 * a document already carries takes it off again, exactly as it does for a
 * checkbox: on a phone that is the only way back from a mis-tap.
 *
 * What it cannot give back is a status the wheel does not know. A document
 * that read `on hold` and is ticked off becomes `done`, and un-ticking it
 * writes the open word rather than `on hold` — the wheel never saw that word
 * and cannot invent it back. The same loss a checkbox has always had, and the
 * reason the four words are settings: the fewer of your statuses fall outside
 * them, the less there is to lose.
 */
export function noteTaskActions(
	host: EditHost,
	laid: LaidOutNode,
	state: TaskState | undefined,
	on: AfterWrite,
): CardActions {
	const path = laid.node.source?.path ?? "";
	const settings = host.settings;
	const property = settings.taskNoteDoneProperty;

	const set = (value: string, after: AfterWrite = {}): void => {
		void setNoteStatus(host, path, property, value, after);
	};

	return {
		done: () =>
			set(
				state === "done" ? settings.taskNoteOpenValue : settings.taskNoteDoneValue,
				on,
			),
		start: () =>
			set(
				state === "in-progress"
					? settings.taskNoteOpenValue
					: settings.taskNoteDoingValue,
			),
		cancel: () =>
			set(
				state === "cancelled"
					? settings.taskNoteOpenValue
					: settings.taskNoteCancelledValue,
				on,
			),
		rename: (text: string) => {
			void renameNoteTitle(host, path, text);
		},
		suggestLinks: (field) => attachLinkSuggest(host.app, field),
		file: (event: MouseEvent) => {
			openFileMenu(host, path, event);
		},
		open: laid.node.source === undefined ? undefined : () => host.openNote(laid),
		follow: (target, external, event) =>
			follow(host, laid, target, external, event),
		fold: (id) => host.toggleFold(id),
		alongRing: (delta) => host.stepFromCard(delta),
	};
}

/**
 * Whether this node *is* a heading, wheel or no wheel (BC_E3_S119).
 *
 * Deliberately not the same question as the `section` actions ask. Those are
 * offered only on a note or section wheel, because moving a heading, hanging it
 * under another one or giving it a subheading **reshapes a document**, and
 * doing that is what a document's own wheel is for. A rename reshapes nothing:
 * it rewrites one line in place and leaves the level alone, so it belongs with
 * the task-line edits, which write into the item's own note from every wheel
 * (kaderdocument §4.2, herzien 26 aug 2026 — `ref.path` is the boundary, not
 * the wheel's scope). Fixing the typo you just read is the whole point of the
 * card, and it should not depend on which wheel you happened to spot it from.
 *
 * Both shapes a heading arrives in are covered: an ordinary `group`, and the
 * ring-one wedge of a note or section wheel, where the top ring *is* headings —
 * the same branch `scopeFor` and `renameRefusal` take, for the same reason.
 */
function isHeadingNode(laid: LaidOutNode, within: WheelScope): boolean {
	const source = laid.node.source;
	if (source === undefined || source.raw === null) return false;
	if (laid.node.kind === "group") return true;

	return (
		laid.node.kind === "domain" &&
		laid.depth === 1 &&
		(within.kind === "note" || within.kind === "section")
	);
}

/**
 * What clicking the title rewrites, for the things that are not a task line.
 *
 * A task's own words go through `outline.rename`; this is the other three
 * (BC_E3_S119). A note ring and a task document are both a whole file, so both
 * take the same road — `fileManager.renameFile`, which is the entire difference
 * between renaming and breaking every link that pointed there. A heading is one
 * line in a note, so it takes the section road, which re-reads the note and
 * refuses when the heading has moved since the scan.
 *
 * `undefined` for everything else, and that is what leaves `onTitleRefused` to
 * say why: a folder is file management, and a tag or property wedge is a name
 * written down nowhere at all.
 */
function titleRename(
	host: EditHost,
	laid: LaidOutNode,
): ((text: string) => void) | undefined {
	const source = laid.node.source;
	if (source === undefined) return undefined;

	if (laid.node.kind === "project") {
		return (text) => void renameNoteTitle(host, source.path, text);
	}

	if (isHeadingNode(laid, host.scope())) {
		return (title) => {
			void actOnSection(host.sectionHost(), laid, (line) => ({
				kind: "rename",
				line,
				title,
			}));
		};
	}

	return undefined;
}

/** Say why this title cannot be rewritten from here (BC_E3_S118). */
export function explainNoRename(
	host: EditHost,
	laid: LaidOutNode,
): void {
	const refusal = renameRefusal(
		{
			kind: laid.node.kind,
			depth: laid.depth,
			label: laid.node.label,
			source: laid.node.source,
		},
		host.scope(),
		host.settings.domainSource,
	);
	new Notice(`Task wheel: ${noRenameText(refusal)}`);
}

/**
 * Send a task to another heading in this note.
 *
 * The note is read again here rather than taken from the tree: the tree
 * knows a task's heading *path*, not which line each heading sits on, and a
 * move has to name a line. One file, not the vault.
 */
export async function moveToHeading(
	host: EditHost,
	ref: LineRef,
): Promise<void> {
	const file = host.app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) {
		new Notice(`Task wheel: ${ref.path} is gone.`);
		return;
	}

	const lines = linesOf(await host.app.vault.cachedRead(file));

	// A note with no headings is not a dead end any more: the picker offers
	// to make the first one, which is the only way this note ever gets one
	// from here.
	host.trace(`heading: asking, ${headingsOf(lines).length} to choose from`);
	const choice = await pickHeading(host.app, headingsOf(lines), (typed) =>
		levelForNewSection(lines, ref.line, typed),
	);
	if (choice === null) {
		host.trace("heading: nothing chosen");
		return;
	}
	host.trace(`heading: ${choice.kind}, writing`);

	await act(host,
		choice.kind === "existing"
			? { kind: "moveTo", target: anchorAt(lines, choice.heading.line) }
			: { kind: "moveToNew", title: choice.title },
		ref,
		ADVANCING,
	);
}

/**
 * Hang this task under another task in the same note.
 *
 * The note is read again here rather than taken from the tree, for the same
 * reason moving to a heading does: the tree knows a task's *place*, not which
 * line every other task sits on, and this move has to name a line.
 */
export async function moveUnderTask(
	host: EditHost,
	ref: LineRef,
): Promise<void> {
	const file = host.app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) {
		new Notice(`Task wheel: ${ref.path} is gone.`);
		return;
	}

	const lines = linesOf(await host.app.vault.cachedRead(file));
	const candidates = parentCandidates(lines, ref.line);
	if (candidates.length === 0) {
		new Notice(
			"Task wheel: there is no other task in this note to hang it under.",
		);
		return;
	}

	host.trace(`subtask: asking, ${candidates.length} to choose from`);
	const parent = await pickTask(host.app, candidates);
	if (parent === null) {
		host.trace("subtask: nothing chosen");
		return;
	}

	host.trace(`subtask: under line ${parent.line}, writing`);
	await act(host,
		{ kind: "moveUnder", target: anchorAt(lines, parent.line) },
		ref,
		ADVANCING,
	);
}

/**
 * Take a task's line out of the note, once the reader has seen it and said yes
 * (BC_E3_S91).
 *
 * The note is read again here, the same as `moveToHeading` and
 * `moveUnderTask` above: the guard needs the *current* text, not what the
 * wheel drew from a scan that may be minutes old. `removeTaskLine` decides
 * whether there is anything to ask about at all — a line with a subtask or an
 * indented note under it is refused here, before a dialog ever opens, rather
 * than offered and then taken back. Only once that guard has passed does the
 * reader see the line and get to say no; `act` runs the same guard again at
 * the write, for the rare note that changed in between.
 */
export async function removeLine(host: EditHost, ref: LineRef): Promise<void> {
	const file = host.app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) {
		new Notice(`Task wheel: ${ref.path} is gone.`);
		return;
	}

	const lines = linesOf(await host.app.vault.cachedRead(file));
	if (removeTaskLine(lines, ref.line) === null) {
		new Notice(
			"Task wheel: this line has something under it, so it stays — move or remove that first.",
		);
		return;
	}

	host.trace("remove: asking");
	const confirmed = await promptForRemoval(host.app, lines[ref.line] ?? ref.raw);
	if (!confirmed) {
		host.trace("remove: cancelled");
		return;
	}

	host.trace("remove: writing");
	await act(host, { kind: "remove" }, ref, ADVANCING);
}

/**
 * Hand the line to the Tasks plugin's own modal, and write back what returns.
 *
 * The round is not left: no note is opened, no editor gets the cursor. That
 * is the whole reason this goes through the API rather than through Tasks'
 * own command, which works on wherever the cursor happens to be and would
 * therefore mean opening the note first (and losing the wedge you were on).
 *
 * **The indentation is ours, not the modal's.** A subtask is a task with two
 * spaces in front of it, and those spaces are its place in the outline — the
 * modal edits a task, and has no reason to know that this one is a step of
 * something above it. So the line goes over without its indentation and
 * comes back wearing it again. Getting this wrong would not look like a bug:
 * the task would simply have become a sibling of its own parent.
 */
export async function editInTasks(
	host: EditHost,
	ref: LineRef, laid: LaidOutNode,
): Promise<void> {
	const indent = ref.raw.slice(0, ref.raw.length - ref.raw.trimStart().length);

	const edited = await editThroughTasks(host.app, ref.raw.trimStart());
	// Cancelled, or the plugin declined. Either way the note is untouched and
	// there is nothing to say about it.
	if (edited === null) return;

	const lines = edited.split("\n").map((line) => indent + line.trimStart());
	// Opening the modal and pressing OK without changing anything is not an
	// edit. Writing it anyway would be harmless but would claim, in a notice,
	// that something happened.
	if (lines.join("\n") === ref.raw) return;

	await act(host, { kind: "line", text: lines.join("\n") }, ref, {
		// Same reason as the rename above: the wheel's label is the *parsed*
		// description, and the modal may well have moved a date or a tag out
		// of the words. Only the real parser can say what it will be called.
		rename: {
			path: ref.path,
			line: ref.line,
			from: laid.node.label,
			to: labelOfLine(lines[0] ?? ""),
		},
	});
}

/**
 * Add a task beside this one, or a step inside it.
 *
 * Same rule as editing (BC_E3_S115): the setting that decides what a click on
 * the title opens also decides what this opens, so there is one answer to
 * "what opens writing" rather than two that can drift apart. With the Tasks
 * plugin's creation modal both available and asked for, that is where the
 * words come from; otherwise the wheel's own prompt below is exactly what it
 * was before this story.
 *
 * **One task, not a run of them** — and that is the answer to the other half
 * of the question this story came from (*"hoe ga je dan om met het toevoegen
 * van nóg een taak zoals nu wel kan?"*, eigenaar 2 sep 2026). The wheel's own
 * box stays open on purpose: it clears and waits, so a run of tasks is one
 * gesture. The Tasks window closes on confirm, everywhere in Obsidian, and
 * reopening it ourselves would be us deciding the reader wants another one.
 * Pressing `a` again is a keystroke; springing a second modal on someone who
 * is done is not undoable. So the two routes really do differ here, the
 * README says so, and nobody has to find it out by pressing Enter.
 */
export async function addTask(
	host: EditHost,
	ref: LineRef, asChild: boolean,
): Promise<void> {
	if (host.settings.editTask === "tasks" && createsThroughTasks(host.app)) {
		await addTaskInTasks(host, ref, asChild);
		return;
	}

	await addTaskInline(host, ref, asChild);
}

/**
 * Hand a blank task to the Tasks plugin's own creation modal, and place what
 * comes back.
 *
 * **The indentation is ours, not the modal's** — the same reasoning as
 * `editInTasks` above, and the same fix reused rather than written twice:
 * `writeInsertLineAfter` strips whatever indentation the returned line
 * carries and replaces it with the one this task's place in the outline
 * calls for, so a subtask lands under its parent even when the modal hands
 * back a line flush with the margin.
 */
async function addTaskInTasks(
	host: EditHost,
	ref: LineRef,
	asChild: boolean,
): Promise<void> {
	const created = await createThroughTasks(host.app);
	// Cancelled, or the plugin declined. Either way nothing was written, and
	// there is nothing to say about it.
	if (created === null) return;

	let outcome: WriteOutcome;
	let at: LineRef | null;
	try {
		({ outcome, at } = await writeInsertLineAfter(host.app, ref, created, asChild));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not write to ${ref.path} — ${message}`);
		return;
	}

	if (outcome === "stale" || outcome === "missing" || at === null) {
		new Notice(
			outcome === "missing"
				? `Task wheel: ${ref.path} is gone. Rescanned.`
				: "Task wheel: that line has changed since the scan. Rescanned.",
		);
		return;
	}

	await host.refreshCarrying();
}

/**
 * Ask for the words, then write the line.
 *
 * A prompt rather than an empty line to fill in: an empty task written to the
 * note first and named second leaves `- [ ]` behind whenever somebody changes
 * their mind, and the wheel would have drawn it as "(empty task)".
 */
async function addTaskInline(
	host: EditHost,
	ref: LineRef, asChild: boolean,
): Promise<void> {
	// Where the next one goes, and how deep. After the first, "under this
	// task" has been honoured: number two is a sibling of number one, not a
	// subtask of it.
	let at = ref;
	let child = asChild;

	const written = await promptForTasks(
		host.app,
		asChild ? "New subtask" : "New task",
		async (text) => {
			const { outcome, at: landed } = await writeInsertAfter(
				host.app,
				at,
				text,
				child,
			);

			if (outcome === "stale" || outcome === "missing" || landed === null) {
				new Notice(
					outcome === "missing"
						? `Task wheel: ${at.path} is gone. Rescanned.`
						: "Task wheel: that line has changed since the scan. Rescanned.",
				);
				return false;
			}

			at = landed;
			child = false;
			return true;
		},
	).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not write to ${ref.path} — ${message}`);
		return 0;
	});

	// Once, at the end. A rescan between two typed lines would be work
	// nobody is waiting for, and it would redraw the wheel under the box.
	if (written > 0) await host.refreshCarrying();
}

/** Write a task document's status, and say so when nothing happened. */
export async function setNoteStatus(
	host: EditHost,
	path: string,
	property: string,
	value: string,
	after: AfterWrite,
): Promise<void> {
	if (property.trim() === "" || value.trim() === "") {
		new Notice(
			"Task wheel: there is no status word set for that — see the settings.",
		);
		return;
	}

	let outcome: WriteOutcome;
	try {
		outcome = await writeNoteStatusTo(host.app, path, property, value);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not write to ${path} — ${message}`);
		return;
	}

	if (outcome === "missing") {
		new Notice(`Task wheel: ${path} is gone. Rescanned.`);
	} else if (outcome === "unchanged") {
		new Notice("Task wheel: it already says that.");
		return;
	}
	// Same rule as in `act`: a write that did not happen may not aim.
	await host.refreshCarrying(outcome === "written" ? after : {});
}

/** Rename the note a task document is, links and all. */
export async function renameNoteTitle(
	host: EditHost,
	path: string, title: string,
): Promise<void> {
	let outcome: WriteOutcome;
	try {
		outcome = await renameNoteTaskTo(host.app, path, title);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not rename ${path} — ${message}`);
		return;
	}

	if (outcome === "refused") {
		// The characters a file name cannot hold. Said out loud rather than
		// stripped: a title quietly missing its slash is a rename the reader
		// did not ask for.
		new Notice(
			'Task wheel: a note name cannot hold \\ / : * ? " < > | # ^ [ ].',
		);
		return;
	}
	if (outcome === "taken") {
		// Reported, never forced (BC_E3_S119). Overwriting the other note would
		// be the one outcome nobody typing a name is asking for, and merging two
		// notes is not a thing a review card gets to decide.
		new Notice(
			`Task wheel: there is already a note called “${title.trim()}” there, so the name is unchanged.`,
		);
		return;
	}
	if (outcome === "missing") {
		new Notice(`Task wheel: ${path} is gone. Rescanned.`);
	} else if (outcome === "unchanged") {
		return;
	}
	await host.refreshCarrying();
}

/**
 * Obsidian's own menu for the file or folder this item stands for.
 *
 * `file-menu` is the event every part of Obsidian uses to build that menu —
 * the file explorer, a tab header, a link. Triggering it hands us *Move file
 * to…*, *Rename…*, *Reveal in navigation* and the rest as the reader knows
 * them, kept in step with their Obsidian version and whatever their other
 * plugins add. Building a folder picker here would be a second way to do a
 * thing the app already does well, and a worse one (eigenaar, 4 sep 2026).
 *
 * Any `TAbstractFile` — Obsidian types the event's own listener that way
 * (`on(name: "file-menu", callback: (menu, file: TAbstractFile, …) => …)`,
 * obsidian.d.ts) — so a folder passes through the same call a note always
 * has (BC_E3_S134). There is no second, filtered menu for just *Reveal in
 * navigation*: Obsidian's public API hands back the whole menu or nothing.
 */
export function openFileMenu(
	host: EditHost,
	path: string, event: MouseEvent,
): void {
	const file = host.app.vault.getAbstractFileByPath(path);
	if (file === null) {
		new Notice("Task wheel: that item is no longer in the vault.");
		return;
	}

	const menu = new Menu();
	host.app.workspace.trigger("file-menu", menu, file, "task-wheel-card");
	menu.showAtMouseEvent(event);
}

/**
 * Follow a link written inside a task.
 *
 * Through Obsidian's own resolution, from the note the task lives in, so it
 * lands exactly where the same link would from the note itself: same
 * aliases, same headings, same rules for a name that appears in two folders.
 * Rebuilding any of that here would be a second answer to a question the
 * app already answers.
 *
 * A modifier opens it beside rather than in place, the way a link does
 * everywhere else in Obsidian.
 */
export function follow(
	host: EditHost,
	laid: LaidOutNode,
	target: string,
	external: boolean,
	event: MouseEvent,
): void {
	if (external) {
		// Without a target: on desktop it makes no difference, and in the
		// mobile WebView `"_blank"` behaves differently from one platform to
		// the next (audit, 23 aug 2026).
		window.open(target);
		return;
	}

	const from = laid.node.source?.path ?? "";
	const beside = event.ctrlKey || event.metaKey || event.button === 1;
	void host.app.workspace.openLinkText(target, from, beside);
}

/**
 * Alt with an arrow, on whatever is under the wedge.
 *
 * Refuses on anything that is not a task — the same rule the menu follows,
 * so the key and the button can never disagree about what is allowed. On
 * every wheel since 26 aug 2026, like the menu: the move stays inside the
 * task's own note whatever the wheel's scope is.
 */
export function moveFocused(
	host: EditHost,
	direction: MoveDirection,
): void {
	const focus = host.focusId();
	const laid = focus === null ? null : (host.layout()?.byId.get(focus) ?? null);
	if (laid === null) return;

	const ref = lineRefOf(laid);
	if (ref !== null) {
		void act(host, { kind: "move", direction }, ref);
		return;
	}

	// A heading moves too — the card's own menu has offered *Move up* and *Move
	// down* on one all along, and the key claimed the press and then did nothing
	// (BC_E3_S171). The same action object, so the two cannot drift: what the
	// menu item calls is what the key calls.
	const section = actionsFor(host, laid).section;
	if (section !== undefined) {
		section.move(direction);
		return;
	}

	// And where neither exists, a sentence rather than a swallowed press. The
	// controller has already called `preventDefault` by the time this runs, so
	// silence here is not "the key was free for something else" — it is the
	// wheel doing nothing and saying nothing (kaderdocument §3.3).
	new Notice(
		laid.node.kind === "group" || laid.node.kind === "domain"
			? "Task wheel: open the wheel over this note to move its headings."
			: "Task wheel: there is nothing here to move.",
	);
}

/**
 * `a` and `Shift+A`: add a task beside this one, or a step inside it.
 *
 * Answers whether the item under the wedge could take it. Every wheel hands in
 * outline actions — the task carries the note it is written in, so there is
 * always somewhere to add — but the *item* may be a heading or a note, and then
 * there is no line to add beside. The press is only claimed when it can do
 * something: a key that swallows itself to do nothing is worse than one that
 * never took the press (BC_E3_S113).
 *
 * The note here read "only a wheel over one note hands in outline actions"
 * until BC_E3_S164. That stopped being true in 0.1.3, when the task edits moved
 * to every wheel, and the help panel repeated it in thirteen languages.
 */
export function addFromKey(
	host: EditHost,
	asChild: boolean,
): boolean {
	const focus = host.focusId();
	const laid = focus === null ? null : (host.layout()?.byId.get(focus) ?? null);
	const add = actionsFor(host, laid).outline?.add;
	if (add === undefined) return false;

	add(asChild);
	return true;
}

/** Carrying work to another note (see `carry-flow.ts`). */
export function carryFrom(
	host: EditHost,
	laid: LaidOutNode,
	mode: CarryMode,
): void {
	carryTo(host.carryHost(), laid, mode, ADVANCING);
}

/**
 * What to say when a title has no editor behind it (BC_E3_S118).
 *
 * The same division as `refusalText`: the rule is `model/scope.ts`'s, the words
 * are the view's. And the same standard — where the thing *can* be renamed, but
 * not from here, the sentence says where. "Cannot rename" would leave the
 * reader with the same question they tapped with.
 */
function noRenameText(refusal: NoRename): string {
	switch (refusal.refused) {
		case "folder":
			return "a folder is renamed in the file list.";
		case "wedge":
			// The heading keeps its extra half-sentence: it is the one source
			// where there *is* somewhere to do it, so saying only "no" would be
			// a refusal that leaves the reader with nowhere to go.
			return refusal.source === "heading"
				? `this wedge is ${wedgeSource(refusal.source)}, so there is no one name to change. Rename it in a note, and the wheel follows.`
				: `this wedge comes from ${wedgeSource(refusal.source)}, so there is no name written down to change.`;
		case "nameless":
			return "there is nothing here to rename.";
	}
}
