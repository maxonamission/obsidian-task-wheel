import { type App, Notice, TFile } from "obsidian";
import type { LaidOutNode } from "../layout/radial";
import type { AfterWrite } from "../model/carry";
import { headingsOf } from "../parse/outline";
import { linesOf } from "../parse/lines";
import {
	type LineRef,
	type SectionEdit,
	writeSection,
	type WriteOutcome,
} from "../vault/writeback";
import { pickHeading } from "./heading-picker";
import { promptForTasks, promptForText } from "./prompt";

/**
 * Editing a heading from the wheel: move it, hang it under another, put a task
 * or a subheading in it.
 *
 * Split out of `wheel-view.ts` under BC_E3_S13. Every one of these is the same
 * shape — read the note again, check the heading is still there, plan an edit,
 * write it — so they share one door (`actOnSection`) rather than four.
 */

/** What these edits need from the view. Deliberately no wider than that. */
export interface SectionHost {
	readonly app: App;
	trace(line: string): void;
	refresh(): Promise<void>;
	/** Re-read and move this round's marks onto whatever the items became. */
	refreshCarrying(after?: AfterWrite): Promise<void>;
}

/**
 * The headings a section may be hung under.
 *
 * Not itself, and not anything inside it: a section cannot become its own
 * child, and offering it would be offering to lose the note.
 */
export function sectionTargets<T extends { line: number }>(
	headings: readonly T[],
	self: { line: number; end: number },
): T[] {
	return headings.filter(
		(heading) => heading.line < self.line || heading.line > self.end,
	);
}

/**
 * Run a heading edit, having first checked the heading is still the one shown.
 *
 * The note is read again and the line taken from it — and, since BC_E3_S44,
 * compared with what the wheel remembers standing there. Reading the line fresh
 * and then handing it to the write as the thing to check made that check a
 * tautology: it asked whether the line was itself, which it always was, and
 * "is there *a* heading on that line" was all that stood between a shifted note
 * and an edit to the wrong section (audit, 23 aug 2026).
 */
export async function actOnSection(
	host: SectionHost,
	laid: LaidOutNode,
	plan: (line: number) => SectionEdit,
): Promise<void> {
	if (await editSection(host, laid, plan)) await host.refreshCarrying();
}

/**
 * The write itself, without the redraw.
 *
 * Split off so that adding several tasks in a row rescans once at the end
 * rather than after every line (BC_E3_S24). Answers whether anything was
 * written, which is exactly what decides whether a redraw is owed.
 */
async function editSection(
	host: SectionHost,
	laid: LaidOutNode,
	plan: (line: number) => SectionEdit,
): Promise<boolean> {
	const source = laid.node.source;
	if (source === undefined) return false;

	const file = host.app.vault.getAbstractFileByPath(source.path);
	if (!(file instanceof TFile)) {
		new Notice(`Task wheel: ${source.path} is gone.`);
		return false;
	}

	const lines = linesOf(await host.app.vault.cachedRead(file));
	const raw = lines[source.line] ?? "";
	const shown = source.raw;
	if (
		!headingsOf(lines).some((heading) => heading.line === source.line) ||
		(shown !== null && raw.trimEnd() !== shown.trimEnd())
	) {
		new Notice("Task wheel: that heading has moved since the scan. Rescanned.");
		await host.refresh();
		return false;
	}

	const ref: LineRef = { path: source.path, line: source.line, raw };
	const edit = plan(source.line);

	let outcome: WriteOutcome;
	try {
		outcome = await writeSection(host.app, ref, edit);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Task wheel: could not write to ${ref.path} — ${message}`);
		return false;
	}

	if (outcome === "unchanged") {
		new Notice("Task wheel: nothing to change there.");
		return false;
	}
	if (outcome === "stale") {
		new Notice("Task wheel: that line has changed since the scan. Rescanned.");
	}

	// Moving a section renames the path of everything under it, so every task
	// in it would lose its mark without this.
	return true;
}

/** Ask which heading this section should hang under, then move it. */
export async function moveSectionUnder(
	host: SectionHost,
	laid: LaidOutNode,
): Promise<void> {
	const source = laid.node.source;
	if (source === undefined) return;

	const file = host.app.vault.getAbstractFileByPath(source.path);
	if (!(file instanceof TFile)) return;

	const lines = linesOf(await host.app.vault.cachedRead(file));
	const headings = headingsOf(lines);
	const self = headings.find((heading) => heading.line === source.line);
	if (self === undefined) return;

	const targets = sectionTargets(headings, self);
	if (targets.length === 0) {
		new Notice("Task wheel: there is no other heading to move it under.");
		return;
	}

	host.trace(`section: asking, ${targets.length} to choose from`);
	const choice = await pickHeading(
		host.app,
		targets,
		() => ({ level: self.level, under: null }),
		false,
	);
	if (choice === null || choice.kind !== "existing") {
		host.trace("section: nothing chosen");
		return;
	}
	host.trace("section: writing");

	await actOnSection(host, laid, (line) => ({
		kind: "under",
		line,
		// The heading as it read in the list that was just shown, so a note that
		// shifts while the picker is open cannot re-level this whole section under
		// whatever moved into that line (BC_E3_S44).
		target: { line: choice.heading.line, raw: lines[choice.heading.line] ?? "" },
	}));
}

/**
 * Ask for the words, then put a task at the end of this section.
 *
 * As many as the reader likes, in one opening of the box. Each one goes in
 * after everything the section already holds, so they land in the order they
 * were typed without the reference having to be walked along — unlike adding
 * beside a task, where it does.
 */
export async function addToSection(
	host: SectionHost,
	laid: LaidOutNode,
): Promise<void> {
	const written = await promptForTasks(
		host.app,
		"New task in this section",
		(text) => editSection(host, laid, (line) => ({ kind: "task", line, text })),
	);

	if (written > 0) await host.refreshCarrying();
}

/** Ask for the name, then hang a new section under this one. */
export async function addSubheadingTo(
	host: SectionHost,
	laid: LaidOutNode,
): Promise<void> {
	const title = await promptForText(host.app, "New heading under this one", {
		field: "Heading",
		placeholder: "This week",
	});
	if (title === null || title.trim().length === 0) return;

	await actOnSection(host, laid, (line) => ({ kind: "sub", line, title }));
}
