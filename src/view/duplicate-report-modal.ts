import { App, MarkdownView, Modal, Notice, TFile } from "obsidian";
import type { DuplicateReport } from "../parse/duplicate-report";

/**
 * Possible duplicate tasks, on the screen.
 *
 * The report names candidates and stops there: the judgement — same task
 * twice, or two tasks that happen to share their words — is the reader's, and
 * so is the fix, in the note. Every occurrence is a link that opens the note
 * on that line, because "which of these is the copy" is answered by looking
 * at the context, never by the words alone.
 *
 * The list is capped for the screen, and says so in numbers when it is — a
 * cap the report kept quiet about would be the wheel hiding work again.
 */

/** How many groups the window lists before summing up the rest. */
const GROUPS = 50;

/** How many places one group names before summing up the rest. */
const PLACES = 12;

export class DuplicateReportModal extends Modal {
	constructor(
		app: App,
		private readonly report: DuplicateReport,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("task-wheel-skip-report");
		contentEl.createEl("h2", { text: "Possible duplicate tasks" });

		const { total, blank, groups } = this.report;
		const doubled = groups.reduce(
			(sum, group) => sum + group.occurrences.length,
			0,
		);
		contentEl.createEl("p", {
			cls: "task-wheel-skip-summary",
			text:
				groups.length === 0
					? `${total} open checkboxes on the wheel's terms — no two of them share their words.`
					: `${total} open checkboxes on the wheel's terms; ${doubled} of them share their words, in ${groups.length} group${groups.length === 1 ? "" : "s"}.`,
		});
		if (blank > 0) {
			contentEl.createEl("p", {
				cls: "task-wheel-skip-note",
				text: `${blank} checkbox${blank === 1 ? " has" : "es have"} no words of their own (only fields or tags) and sat this comparison out.`,
			});
		}

		if (groups.length === 0) return;

		contentEl.createEl("p", {
			cls: "task-wheel-skip-note",
			text: "Candidates, not verdicts: two tasks may share their words on purpose. Open the places and judge in the note — the wheel never merges or hides anything itself.",
		});

		const list = contentEl.createEl("ul");
		for (const group of groups.slice(0, GROUPS)) {
			const item = list.createEl("li");
			item.createEl("strong", { text: group.description });
			item.createSpan({ text: ` — ${group.occurrences.length}×` });

			const places = item.createEl("ul");
			for (const at of group.occurrences.slice(0, PLACES)) {
				const place = places.createEl("li");
				const link = place.createEl("a", {
					// Editor lines are 1-based on screen; `at.line` stays 0-based
					// for the jump below.
					text: `${at.path} · line ${at.line + 1}`,
					cls: "task-wheel-dup-link",
				});
				if (at.heading !== null) {
					place.createSpan({
						cls: "task-wheel-skip-note",
						text: ` — under “${at.heading}”`,
					});
				}
				link.addEventListener("click", (event) => {
					event.preventDefault();
					this.close();
					this.openAt(at.path, at.line);
				});
			}
			const rest = group.occurrences.length - PLACES;
			if (rest > 0) {
				places.createEl("li", {
					cls: "task-wheel-skip-note",
					text: `…and ${rest} more`,
				});
			}
		}
		const more = groups.length - GROUPS;
		if (more > 0) {
			contentEl.createEl("p", {
				cls: "task-wheel-skip-note",
				text: `…and ${more} more group${more === 1 ? "" : "s"} not shown.`,
			});
		}
	}

	/** Open the note on that line, reusing a tab that already shows it. */
	private openAt(path: string, line: number): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`Task wheel: ${path} is gone.`);
			return;
		}

		// Same manners as opening a note from the wheel (wheel-view): a tab of
		// its own only the first time, so working through one group does not
		// leave a wall of tabs of the same note behind.
		const open = this.app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => (leaf.view as MarkdownView).file?.path === path);

		if (open !== undefined) {
			void this.app.workspace.revealLeaf(open);
			open.view.setEphemeralState({ line });
			return;
		}

		void this.app.workspace.getLeaf("tab").openFile(file, { eState: { line } });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
