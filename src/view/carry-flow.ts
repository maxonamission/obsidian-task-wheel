import { type App, Notice, TFile } from "obsidian";
import type { LaidOutNode } from "../layout/radial";
import type { AfterWrite, Moved } from "../model/carry";
import type {
	CarryHow,
	CarryPreset,
	NodeKind,
	ParseOptions,
	SourceRef,
} from "../model/types";
import {
	type Extracted,
	extractBlock,
	extractFiltered,
	extractFilteredNote,
	extractFilteredTask,
	type FilteredCarry,
} from "../parse/cross-note";
import { isFiltering } from "../parse/filter";
import { linesOf } from "../parse/lines";
import { headingsOf } from "../parse/outline";
import { splitPath } from "../parse/outline-edit";
import { inRound, narrowsByHeading } from "../parse/round";
import { parseTaskLine } from "../parse/task-line";
import {
	type CarryMode,
	type CarryOutcome,
	type LineRef,
	writeCarry,
} from "../vault/writeback";
import { carryMessage } from "./carry-message";
import { pickDestination } from "./heading-picker";
import { noteFor, pickNote } from "./note-picker";
import { promptForText } from "./prompt";

/**
 * Carrying work to another note.
 *
 * Split out of `wheel-view.ts` under BC_E3_S13. The reason is not the line
 * count: this flow spans two modals and two files, and the one bug it shipped
 * lived in a decision that no test could reach because it was a private method
 * on a view. `whatTravels` below is that decision, and it is now a plain
 * function over lines.
 */

/** What this flow needs from the view. Deliberately no wider than that. */
export interface CarryHost {
	readonly app: App;
	/** How the wheel reads the vault right now — skip rules, filter, today. */
	options(): ParseOptions;
	/** Say where we got to, for the diagnostics panel. */
	trace(line: string): void;
	refresh(): Promise<void>;
	/** Re-read and move this round's marks onto whatever the items became. */
	refreshCarrying(after?: AfterWrite): Promise<void>;
}

/**
 * What actually travels when this node is carried, and what stays behind.
 *
 * A task travels with its whole block. A **branch** travels with only the part
 * of it that is in the round — filter on `done` and carry a heading, and the
 * open work under it has to stay where it is. `held` counts what the round
 * showed here and could not take along, so the reader can be told.
 *
 * "In the round in its own right" is asked of the filter directly rather than
 * read off the tree, because the tree also holds **carriers** — tasks that are
 * only drawn so their kept children can be reached. Carrying a carrier would
 * carry the very work the filter set aside.
 *
 * Returns `null` when the line is no longer what the wheel is showing.
 */
export function whatTravels(
	lines: string[],
	source: SourceRef,
	options: ParseOptions,
	kind: NodeKind,
): FilteredCarry | null {
	// The same question `build-tree` asks, asked the same way. Asking only the
	// filter here let a branch carry finished tasks the wheel was not showing,
	// and checkboxes from under a skipped heading with them.
	// Two things can make the wheel show less than the note holds, and both have
	// to be asked here. The filter was; the blikveld was not, and it is the one
	// that costs nothing to overlook — with no filter on, `shows` was simply
	// true and a note-ring carry on a heading wheel took every task out of the
	// note, headings this wheel is not about included (measured 6 sep 2026: one
	// task shown, two carried).
	const narrowed = isFiltering(options.filter) || narrowsByHeading(options.scope);
	const shows = (line: number, headingPath: readonly string[]): boolean => {
		if (!narrowed) return true;
		const parsed = parseTaskLine(lines[line] ?? "");
		return (
			parsed !== null && inRound(parsed.fields, headingPath, source.path, options)
		);
	};

	// A note is not a block: its first line is whatever the writer put there, so
	// lifting a block from it meant carrying a different thing in every note
	// (measured 18 aug 2026). It is walked whole instead, filter or no filter.
	//
	// Only the note *ring*. A note that is itself a task never gets here: what
	// this walk does is lift the task lines **out** of a note and leave the file
	// behind, which for a task document would empty the very thing the reader
	// asked to move (eigenaar, 4 sep 2026). Carrying is not offered there at
	// all; `isNoteTask` decides that where the menu is built.
	//
	// **What this walk does not check, and why it is written down rather than
	// fixed** (BC_E3_S156). Every other write compares the line it is about to
	// touch with the line the wheel is showing (`source.raw`, a few lines down),
	// and refuses when they differ. A note has no such line: the wedge stands
	// for the file, not for a row in it. So `extractFilteredNote` walks the read
	// it was just handed, and `removeBlocks` then verifies the blocks against
	// that very read — a tautology for this one route.
	//
	// What that costs: a task written into the note between the last scan and
	// this carry travels along, though the wheel never drew it. Nothing is lost
	// and nothing lands anywhere the reader did not name; the note simply
	// arrives more complete than the drawing was. Closing it properly means
	// handing this function the tree to compare against, which is a wider change
	// than the gap deserves — but a reader of `CarryOutcome` should not have to
	// find that out by experiment.
	if (kind === "project") return extractFilteredNote(lines, shows);

	// Is that line still the thing the wheel is showing? `extractBlock` accepts
	// any task or heading at the index, and `removeBlocks` then verifies the
	// blocks against the very read they were lifted from — so without this the
	// whole carry could take the neighbouring task away, faultlessly (audit,
	// 23 aug 2026). `null` on a node that stands for a whole note: there is
	// nothing on one line to hold it to, and the branch above never gets here.
	if (
		source.raw !== null &&
		(lines[source.line] ?? "").trimEnd() !== source.raw.trimEnd()
	) {
		return null;
	}

	const lifted = extractBlock(lines, source.line);
	if (lifted === null) return null;

	if (!narrowed) return { blocks: [lifted], held: 0 };

	// A heading and a task branch get the same treatment. They did not at first,
	// and that gap was the whole bug: a task branch was carried whole whatever
	// the filter said (owner, 18 aug 2026).
	return lifted.kind === "section"
		? extractFiltered(lines, source.line, shows)
		: extractFilteredTask(lines, source.line, shows);
}

/**
 * Say the true thing about a branch that has nothing to give.
 *
 * Two very different empties, and calling both of them "nothing is in this
 * round" was a plain untruth about the second (owner, 17 aug 2026): a card with
 * a finished checklist under an open task holds plenty of the round, it just
 * cannot let any of it leave on its own.
 */
export function nothingToCarry(held: number, kind?: NodeKind): string {
	const where = kind === "project" ? "in that note" : "under that heading";
	if (held === 0) {
		return `Task wheel: nothing ${where} is in this round — the filter leaves it all out.`;
	}
	return `Task wheel: the ${held} item${held === 1 ? "" : "s"} of this round here sit under a task that is staying, so moving them would leave them orphaned. Carry that task instead, or turn the filter off.`;
}

export function carryTo(
	host: CarryHost,
	laid: LaidOutNode,
	mode: CarryMode,
	after: AfterWrite = {},
): void {
	// Nothing here may fail quietly. This flow spans two modals and two files,
	// and when it broke it broke *silently* — the note picker closed and the
	// action gave up without a word, which cost a wrong diagnosis and a second
	// round of testing (owner, 17 aug 2026). Every step now says where it got
	// to in the diagnostics trace, and anything thrown reaches the reader.
	carrying(host, laid, mode, after).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		host.trace(`FAILED carrying: ${message}`);
		new Notice(`Task wheel: carrying failed — ${message}`);
		console.error("Task Wheel: carrying failed", error);
	});
}

/**
 * Carry to a place that already has a name, in one action.
 *
 * The same write as the two-picker flow, with both answers supplied. Sorting a
 * day's work means going to the same four places a hundred times, and two
 * modals per item is what made that a chore (owner, 18 aug 2026).
 */
export function carryToPreset(
	host: CarryHost,
	laid: LaidOutNode,
	preset: CarryPreset,
	after: AfterWrite = {},
): void {
	carrying(host, laid, preset.how, after, preset).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		host.trace(`FAILED preset ${preset.name}: ${message}`);
		new Notice(`Task wheel: ${preset.name} failed — ${message}`);
		console.error("Task Wheel: preset failed", error);
	});
}

/**
 * Which lines travelled, so the round's marks can follow them (BC_E3_S137).
 *
 * Only for a move to another note. A copy leaves the original in place and the
 * mark belongs there; a move within the same note never changed the pair that
 * identifies a node, so neither needs a hint.
 *
 * Lines rather than labels (BC_E3_S144). The first version named what left and
 * matched on the name, which re-keyed a same-named task that stayed behind — it
 * lost a mark for a move it was not part of. The blocks already know exactly
 * which lines they took, so there is nothing to guess and nothing to parse: no
 * heading syntax to re-derive, no task whose description is empty to overlook.
 */
function movedHint(
	mode: CarryMode,
	from: string,
	to: string,
	blocks: readonly Extracted[],
): Moved | undefined {
	if (mode !== "move" || from === to) return undefined;

	const lines = blocks.map((block) => ({
		start: block.start,
		end: block.start + block.length,
	}));

	return lines.length === 0 ? undefined : { from, to, lines };
}

/**
 * Ask the two questions once, and keep the answers.
 *
 * Deliberately the *same* two pickers the ordinary carry uses, in the same
 * order, rather than a settings form: the reader already knows this flow, and a
 * destination that was chosen the normal way cannot be a path that does not
 * exist. The name comes last, when there is something to name.
 */
export async function definePreset(
	app: App,
	how: CarryHow,
): Promise<CarryPreset | null> {
	const target = await pickTarget(app);
	if (target === null) return null;

	const name = await promptForText(
		app,
		`Name for this destination (${target.basename})`,
		{ field: "Name", placeholder: "Do this week" },
	);
	if (name === null || name.trim().length === 0) return null;

	return {
		name: name.trim(),
		notePath: target.notePath,
		headingPath: target.headingPath,
		how,
	};
}

/** Where a destination points: a note, and a place in it. */
export interface PresetTarget {
	notePath: string;
	headingPath: string[] | null;
	/** The note's own name, for a sentence about it. */
	basename: string;
}

/**
 * Ask which note and where in it — the two questions a destination *is*.
 *
 * Split out of `definePreset` so the settings tab can ask them again on a
 * destination that already exists (BC_E3_S135). Changing where one points used
 * to mean deleting it and making a new one, which threw away its name, its
 * move-or-copy and the hotkey bound to it — for a note that had simply been
 * renamed or moved.
 *
 * Still the pickers rather than a text box, and that is the whole reason this is
 * a function instead of two fields in the settings: a path you *type* can point
 * at a note that is not there, and one you *choose* cannot.
 */
export async function pickTarget(app: App): Promise<PresetTarget | null> {
	const chosen = await pickNote(app, "");
	if (chosen === null) return null;

	const target = await noteFor(app, chosen);
	if (target === null) return null;

	const into = linesOf(await app.vault.cachedRead(target));
	const where = await pickDestination(app, headingsOf(into), []);
	if (!where.shown || where.choice === null) return null;

	const choice = where.choice;
	const headingPath =
		choice.kind === "keep"
			? null
			: choice.kind === "existing"
				? choice.heading.path
				: splitPath(choice.title);

	return { notePath: target.path, headingPath, basename: target.basename };
}

async function carrying(
	host: CarryHost,
	laid: LaidOutNode,
	mode: CarryMode,
	after: AfterWrite,
	preset?: CarryPreset,
): Promise<void> {
	const source = laid.node.source;
	if (source === undefined) return;

	const file = host.app.vault.getAbstractFileByPath(source.path);
	if (!(file instanceof TFile)) {
		new Notice(`Task wheel: ${source.path} is gone.`);
		return;
	}

	const lines = linesOf(await host.app.vault.cachedRead(file));
	const travelling = whatTravels(lines, source, host.options(), laid.node.kind);
	if (travelling === null) {
		new Notice("Task wheel: that line has changed since the scan. Rescanned.");
		await host.refresh();
		return;
	}

	const { blocks, held } = travelling;
	if (blocks.length === 0) {
		new Notice(nothingToCarry(held, laid.node.kind));
		return;
	}

	host.trace(`carry: ${blocks.length} block(s)`);

	if (preset !== undefined) {
		const to = host.app.vault.getAbstractFileByPath(preset.notePath);
		// A preset outlives the note it names. Saying so beats writing a new
		// note the reader never asked for, and beats failing in silence.
		if (!(to instanceof TFile)) {
			new Notice(
				`Task wheel: ${preset.name} points at ${preset.notePath}, which is not there any more. Nothing was carried.`,
			);
			return;
		}
		await finish(
			host,
			source,
			lines,
			blocks,
			held,
			to,
			preset.headingPath,
			mode,
			after,
		);
		return;
	}

	const chosen = await pickNote(host.app, source.path);
	if (chosen === null) {
		host.trace("carry: no note chosen");
		return;
	}

	// Made here if it did not exist, which is the one step that can fail before
	// anything is written — and it says so itself when it does.
	const target = await noteFor(host.app, chosen);
	if (target === null) {
		host.trace("carry: the note could not be made");
		return;
	}

	host.trace(`carry: into ${target.path}, asking where`);
	const into = linesOf(await host.app.vault.cachedRead(target));
	const where = await pickDestination(
		host.app,
		headingsOf(into),
		blocks.map((block) => block.path),
	);

	// A picker that never appeared answers the same `null` as backing out
	// does, and telling the two apart is the difference between giving up
	// silently and saying what went wrong.
	if (!where.shown) {
		host.trace("carry: the destination picker never opened");
		new Notice(
			"Task wheel: could not ask where to put it — the second picker did not open. Nothing was carried.",
		);
		return;
	}

	const choice = where.choice;
	if (choice === null) {
		host.trace("carry: no destination chosen");
		return;
	}

	host.trace(`carry: destination ${choice.kind}, writing`);
	const path =
		choice.kind === "keep"
			? null
			: choice.kind === "existing"
				? choice.heading.path
				: splitPath(choice.title);

	await finish(host, source, lines, blocks, held, target, path, mode, after);
}

/**
 * The write itself, once both answers are in.
 *
 * Shared by the two-picker flow and by a preset, so the two can never drift
 * apart in what they write or in what they say afterwards.
 */
async function finish(
	host: CarryHost,
	source: SourceRef,
	lines: string[],
	blocks: readonly Extracted[],
	held: number,
	target: TFile,
	headingPath: readonly string[] | null,
	mode: CarryMode,
	after: AfterWrite,
): Promise<void> {
	const ref: LineRef = {
		path: source.path,
		line: source.line,
		raw: lines[source.line] ?? "",
	};

	let outcome: CarryOutcome;
	try {
		outcome = await writeCarry(
			host.app,
			ref,
			target.path,
			mode,
			headingPath,
			blocks,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not write to ${target.path} — ${message}`);
		return;
	}

	host.trace(`carry: ${outcome.kind}`);
	new Notice(carryMessage(outcome, mode, target.basename, held));

	// A refusal wrote nothing, so there is nothing to redraw — except when the
	// note moved under us, which is exactly what a rescan is for.
	if (outcome.kind === "refused") {
		if (outcome.why !== "nothing") await host.refresh();
		return;
	}

	await host.refreshCarrying({
		...after,
		moved: movedHint(mode, source.path, target.path, blocks),
	});
}
