import { App, Modal, Setting } from "obsidian";
import type { CarryHow } from "../model/types";
import { handBack } from "./hand-back";

/**
 * Move or copy — asked once, when a destination is named.
 *
 * Per destination rather than one setting for all of them, because the two are
 * genuinely different intentions (owner, 18 aug 2026): *DoThisWeek* takes the
 * task off the backlog, while a reference you meet while reviewing should be
 * copied — taking it out of the document that explains it breaks that document.
 *
 * Asked here rather than at every use, which is the whole point: a preset is
 * the answers you already gave, kept.
 *
 * Resolves to `null` when the reader backs out.
 */
export function pickCarryHow(app: App): Promise<CarryHow | null> {
	return new Promise((resolve) => {
		new HowPrompt(app, resolve).open();
	});
}

class HowPrompt extends Modal {
	private chosen: CarryHow | null = null;
	private settled = false;

	constructor(
		app: App,
		private readonly done: (how: CarryHow | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle("What should this destination do?");

		new Setting(this.contentEl)
			.setName("Move")
			.setDesc(
				"Take the item out of where it is. For sorting a backlog: the task belongs on the other list now, not on both.",
			)
			.addButton((button) =>
				button
					.setButtonText("Move")
					.setCta()
					.onClick(() => this.settle("move")),
			);

		new Setting(this.contentEl)
			.setName("Copy")
			.setDesc(
				"Leave the item where it is. For work you come across while reviewing: the document it sits in usually explains it, and taking it out breaks that document.",
			)
			.addButton((button) =>
				button.setButtonText("Copy").onClick(() => this.settle("copy")),
			);
	}

	/** Recorded, not answered — `onClose` hands it back, see `hand-back.ts`. */
	private settle(how: CarryHow | null): void {
		this.chosen = how;
		this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
		// Escape and the X come through here too, with nothing chosen — and they
		// have to answer all the same, or the caller waits for ever.
		if (this.settled) return;
		this.settled = true;
		handBack(() => this.done(this.chosen), this.containerEl);
	}
}
