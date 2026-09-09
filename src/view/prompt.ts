import { App, Modal, Setting } from "obsidian";
import { handBack } from "./hand-back";
import { attachLinkSuggest, type LinkSuggest } from "./link-suggest";

/** What the field is called and what it shows when it is empty. */
export interface AskingFor {
	field: string;
	placeholder: string;
}

/** The task box, which is what this started as and still mostly is. */
const A_TASK: AskingFor = {
	field: "Task",
	placeholder: "Call the plumber 📅 2026-08-20 ⏫",
};

/**
 * Ask for one line of text.
 *
 * Started life as the box for adding a task and is now also how a new heading
 * and a destination's name are asked for — so what the field is called comes
 * from the caller. It said "Task" over all three, with a task for a
 * placeholder, which is the box telling the reader to type the wrong thing
 * (audit, 23 aug 2026).
 *
 * Resolves to `null` when the reader backs out, which is not the same as an
 * empty string: one means "never mind", the other means "I typed nothing".
 */
export function promptForText(
	app: App,
	title: string,
	asking: AskingFor = A_TASK,
): Promise<string | null> {
	return new Promise((resolve) => {
		new TextPrompt(app, title, asking, resolve).open();
	});
}

/**
 * Ask for one task after another, until the reader is done.
 *
 * Filling a heading means typing five tasks, and doing that through five
 * openings of the same box is what made it a chore (owner, 19 aug 2026). So
 * the box can stay open: "Add another" writes what is in the field and hands
 * back an empty one.
 *
 * `write` is called for each line **as it is confirmed**, not once at the end.
 * Backing out of the fourth task may never take the first three with it — and
 * it is also what keeps the order right, because each write says where the
 * next one goes. It answers `false` when the write failed, which closes the
 * box rather than inviting the reader to type into a note that is not taking
 * anything.
 *
 * Resolves with how many were written, so the caller can redraw once at the
 * end instead of after every line.
 */
export function promptForTasks(
	app: App,
	title: string,
	write: (text: string) => Promise<boolean>,
): Promise<number> {
	return new Promise((resolve) => {
		new TaskPrompt(app, title, write, resolve).open();
	});
}

/**
 * What a press on one of the two Add buttons means.
 *
 * A plain function over what is in the field, because it is the only part of
 * the box that can be wrong and a modal cannot be opened in a test. `last` is
 * true for the press that finishes — Enter and the CTA — and false for "add
 * another".
 *
 * An empty field is never an instruction to write an empty task. On the
 * finishing press it means "I am done here"; on the other one it is a slip,
 * and a slip should leave the box open with what was typed still in it.
 */
export function pressMeans(
	text: string,
	last: boolean,
): "write and close" | "write and clear" | "close" | "nothing" {
	if (text.trim().length === 0) return last ? "close" : "nothing";
	return last ? "write and close" : "write and clear";
}

/**
 * Ask before a task line leaves the note for good (BC_E3_S91).
 *
 * The one confirmation this narrow action gets, and the only place the line
 * is shown before it disappears — the reader has typed nothing here, so
 * there is no field to look at instead. Resolves `false` on anything but the
 * warning button: Escape, the X, and Cancel all mean the same thing, which is
 * that nothing was written.
 */
export function promptForRemoval(app: App, line: string): Promise<boolean> {
	return new Promise((resolve) => {
		new RemoveLinePrompt(app, line, resolve).open();
	});
}

class RemoveLinePrompt extends Modal {
	private confirmed = false;
	private settled = false;

	constructor(
		app: App,
		private readonly line: string,
		private readonly done: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle("Remove this line from the note");

		this.contentEl.createEl("p", {
			text:
				"This takes the line below out of the note. There is no undo from " +
				"the wheel — for real work, cancelling stays the better path, " +
				"because it keeps the decision on record.",
		});
		this.contentEl.createEl("pre", {
			cls: "task-wheel-remove-line",
			text: this.line.trim(),
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText("Remove line")
					.setDestructive()
					.setCta()
					.onClick(() => {
						this.confirmed = true;
						this.close();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		if (this.settled) return;
		this.settled = true;
		handBack(() => this.done(this.confirmed), this.containerEl);
	}
}

class TaskPrompt extends Modal {
	private value = "";
	private written = 0;
	private settled = false;
	/** A write is in flight; a second Enter must not start another. */
	private busy = false;
	private input: HTMLInputElement | null = null;
	private suggest: LinkSuggest | null = null;

	constructor(
		app: App,
		private readonly title: string,
		private readonly write: (text: string) => Promise<boolean>,
		private readonly done: (written: number) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.title);

		new Setting(this.contentEl).setName("Task").addText((text) => {
			text.setPlaceholder("Call the plumber 📅 2026-08-20 ⏫");
			text.onChange((value) => {
				this.value = value;
			});
			// Before the Enter handler below: while the note list is up, Enter
			// picks a note instead of finishing the task (BC_E3_S29).
			this.suggest = attachLinkSuggest(this.app, text.inputEl);

			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				// Enter still means "that is the one", as it always has. Adding
				// several in a row is the button's job, so the quick single add
				// does not change under the hands of someone used to it.
				void this.add(true);
			});
			this.input = text.inputEl;
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText("Add")
					.setCta()
					.onClick(() => void this.add(true)),
			)
			.addButton((button) =>
				button.setButtonText("Add another").onClick(() => void this.add(false)),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	/** Write what is in the field, and either close or clear it. */
	private async add(last: boolean): Promise<void> {
		if (this.busy) return;

		const plan = pressMeans(this.value, last);
		if (plan === "nothing") return;
		if (plan === "close") {
			this.close();
			return;
		}

		this.busy = true;
		let ok = false;
		try {
			ok = await this.write(this.value.trim());
		} finally {
			this.busy = false;
		}
		if (ok) this.written++;

		// A failed write closes the box whatever the press meant. Handing back an
		// empty field would invite the reader to keep typing into a note that is
		// not taking anything.
		if (!ok || plan === "write and close") {
			this.close();
			return;
		}

		this.value = "";
		if (this.input !== null) {
			this.input.value = "";
			this.input.focus();
		}
	}

	override onClose(): void {
		this.suggest?.detach();
		this.suggest = null;
		this.contentEl.empty();
		if (this.settled) return;
		this.settled = true;
		handBack(() => this.done(this.written), this.containerEl);
	}
}

class TextPrompt extends Modal {
	private value = "";
	/** What was typed and confirmed; `null` until it is. */
	private chosen: string | null = null;
	private settled = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly asking: AskingFor,
		private readonly done: (value: string | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.title);

		new Setting(this.contentEl).setName(this.asking.field).addText((text) => {
			text.setPlaceholder(this.asking.placeholder);
			text.onChange((value) => {
				this.value = value;
			});
			// Enter is how a one-field form is submitted; on a phone it is the
			// keyboard's own go key and there is nothing else to press.
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				this.settle(this.value);
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText("Add")
					.setCta()
					.onClick(() => this.settle(this.value)),
			)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.settle(null)),
			);
	}

	/** Recorded, not answered — `onClose` hands it back, see `hand-back.ts`. */
	private settle(value: string | null): void {
		this.value = value ?? "";
		this.chosen = value;
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
