import { App, Modal } from "obsidian";
import { NO_HEADING, type SkipReport } from "../parse/skip-report";

/**
 * What the skip rules take out, on the screen.
 *
 * The point of this window is a single sentence per rule: *this line of yours
 * takes out this much*. A rule that takes out nothing says so in as many words,
 * because that is the failure people actually hit — a heading spelled with a
 * different character, a checklist that turns out not to sit under a heading at
 * all — and it is invisible from the wheel, where a rule that does nothing and
 * a rule that works look identical.
 *
 * Then the headings still in play. That is the list you write the next rule
 * from: a heading you expected to have caught, sitting there with a count next
 * to it, tells you more than any error message could.
 */
export class SkipReportModal extends Modal {
	constructor(
		app: App,
		private readonly report: SkipReport,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("task-wheel-skip-report");
		contentEl.createEl("h2", { text: "What the skip rules take out" });

		const { total, skipped } = this.report;
		contentEl.createEl("p", {
			cls: "task-wheel-skip-summary",
			text:
				skipped === 0
					? `${total} open checkboxes, none of them skipped.`
					: `${total} open checkboxes, ${skipped} skipped — ${total - skipped} left on the wheel.`,
		});

		this.rules("Skip notes of these types", this.report.types);
		this.rules("Skip checkboxes under these headings", this.report.headings);

		contentEl.createEl("h3", { text: "Headings still in play" });
		if (this.report.remaining.length === 0) {
			contentEl.createEl("p", { text: "Nothing left." });
		} else {
			contentEl.createEl("p", {
				cls: "task-wheel-skip-note",
				text: "Biggest first. A heading you expected to have caught is a heading spelled differently than you think.",
			});
			const list = contentEl.createEl("ul");
			for (const { heading, tasks } of this.report.remaining) {
				list.createEl("li", { text: `${tasks} — ${heading}` });
			}
		}
	}

	private rules(title: string, hits: SkipReport["types"]): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: title });

		if (hits.length === 0) {
			contentEl.createEl("p", { text: "Nothing typed here." });
			return;
		}

		const list = contentEl.createEl("ul");
		for (const { pattern, tasks, examples } of hits) {
			const line = list.createEl("li");
			line.createEl("code", { text: pattern });

			if (tasks === 0) {
				line.createSpan({
					cls: "task-wheel-skip-nothing",
					text: " — takes out nothing",
				});
				continue;
			}

			const named = examples
				.map((name) => (name === NO_HEADING ? name : `“${name}”`))
				.join(", ");
			line.createSpan({
				text: ` — ${tasks} checkbox${tasks === 1 ? "" : "es"}${named.length > 0 ? `, from ${named}` : ""}`,
			});
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
