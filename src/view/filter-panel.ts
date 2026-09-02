import { putIcon } from "./icon";
import { describe, isFiltering } from "../parse/filter";
import { PRIORITY_LADDER } from "../layout/colour";
import {
	NO_FILTER,
	type DateRule,
	type Priority,
	type StatusRule,
	type TaskFilter,
} from "../model/types";
import type { TaskWheelSettings } from "../settings";

/**
 * The filter, in the pane rather than in the settings.
 *
 * A filter is not configuration; it is part of doing a round. Sending the
 * reader to the settings tab in the middle of one — three taps away on a phone
 * — makes a lens that should be switched on and off feel like a decision. The
 * graph view puts its controls in its own pane for the same reason, and this
 * follows it.
 *
 * Collapsed by default, and it says on the outside whether anything is on: a
 * closed panel that hides an active filter would be the quiet hiding the wheel
 * is not allowed to do (kaderdocument §3.3).
 */

const DUE_LABELS: Record<DateRule, string> = {
	any: "Anything",
	overdue: "Overdue or due today",
	soon: "Due soon",
	dated: "Has a date",
	undated: "Has no date",
	parked: "Parked for later (🛫 or ⏳ ahead)",
	ready: "Ready now (nothing parking it)",
};

/**
 * The statuses, as a round sees them.
 *
 * Done and cancelled sit together under "finished" because that is the only
 * distinction a review makes: is there anything left to look at. And there is
 * no "deferred" here — Tasks has no status character for it. Putting something
 * off is a date (🛫 or ⏳), which is why it lives in the list above as *parked*.
 */
const STATUS_LABELS: Record<StatusRule, string> = {
	any: "Any status",
	open: "Not started",
	"in-progress": "In progress",
	finished: "Finished",
};

export interface FilterPanelOptions {
	/**
	 * The reader changed the filter to this.
	 *
	 * Handed over whole rather than written into the settings here. The panel
	 * used to mutate the plugin-wide fields directly, which is how two wheels
	 * came to share one filter without anybody deciding it — and it left no
	 * single place to hang the rule that a new selection is a new round
	 * (owner, 18 aug 2026).
	 */
	onChange: (next: TaskFilter) => void;
	/** Open or close the panel. Kept by the caller so it survives a redraw. */
	onToggleOpen: (open: boolean) => void;
	open: boolean;
	/** How many tasks the filter is leaving out right now. */
	left: number;
}

export function renderFilterPanel(
	parent: HTMLElement,
	settings: TaskWheelSettings,
	/** What this wheel is filtering on — its own, not the plugin's. */
	filter: TaskFilter,
	options: FilterPanelOptions,
): void {
	parent.empty();
	parent.addClass("task-wheel-controls");
	parent.toggleClass("is-open", options.open);

	const on = isFiltering(filter);
	const change = (part: Partial<TaskFilter>): void => {
		options.onChange({ ...filter, ...part });
	};

	const header = parent.createEl("button", {
		cls: "task-wheel-controls-head",
		attr: {
			"aria-expanded": String(options.open),
			"aria-label": on
				? `Filter: ${describe(filter)}. ${options.left} tasks left out.`
				: "Filter. Nothing is filtered out.",
		},
	});
	putIcon(header, "filter", "task-wheel-controls-icon");
	header.createSpan({ cls: "task-wheel-controls-title", text: "Filter" });

	// The closed panel still has to say that a filter is running, and how much
	// it is keeping out of the round.
	if (on) {
		header.createSpan({
			cls: "task-wheel-controls-badge",
			text: `${options.left} out`,
		});
	}

	header.addEventListener("click", (event) => {
		event.preventDefault();
		options.onToggleOpen(!options.open);
	});

	if (!options.open) return;

	const body = parent.createDiv({ cls: "task-wheel-controls-body" });

	// First, because it is the one people reach for: type two words and the
	// round is about those. Applied on change rather than on every keystroke —
	// a rescan of the vault per letter would be a poor trade.
	search(body, "Words", filter.text, (value) => change({ text: value }));

	dropdown(body, "Status", STATUS_LABELS, filter.status, (value) => {
		change({ status: value as StatusRule });
	});

	dropdown(body, "Show", DUE_LABELS, filter.due, (value) => {
		change({ due: value as DateRule });
	});

	if (filter.due === "soon") {
		number(body, "Within days", filter.horizon, (value) => {
			change({ horizon: value });
		});
	}

	dropdown(
		body,
		"Priority from",
		{
			any: "Any",
			...Object.fromEntries(
				PRIORITY_LADDER.map((priority) => [priority, `${priority} or above`]),
			),
		},
		filter.minPriority,
		(value) => {
			change({ minPriority: value as Priority | "any" });
		},
	);

	// The other half of the band. One bound alone only ever selects "this and
	// up", and the move that wanted the other half is a real one: sweeping a
	// batch of low-priority work into a someday note (owner, 18 aug 2026).
	dropdown(
		body,
		"Priority to",
		{
			any: "Any",
			...Object.fromEntries(
				PRIORITY_LADDER.map((priority) => [priority, `${priority} or below`]),
			),
		},
		filter.maxPriority,
		(value) => {
			change({ maxPriority: value as Priority | "any" });
		},
	);

	// Tags as one comma-separated field rather than a list of rows: a floating
	// panel has no room for add-and-delete affordances, and typing two tags is
	// faster than adding two rows anyway.
	tags(body, "With tags", filter.withTags, (value) => {
		change({ withTags: value });
	});
	tags(body, "Without tags", filter.withoutTags, (value) => {
		change({ withoutTags: value });
	});

	if (on) {
		const clear = body.createEl("button", {
			cls: "task-wheel-controls-clear",
			text: "Clear the filter",
		});
		clear.addEventListener("click", (event) => {
			event.preventDefault();
			options.onChange({ ...NO_FILTER });
		});
	}
}

/** Counts the search boxes built, to keep their description ids apart. */
let searches = 0;

function row(parent: HTMLElement, label: string): HTMLElement {
	const line = parent.createDiv({ cls: "task-wheel-controls-row" });
	line.createSpan({ cls: "task-wheel-controls-label", text: label });
	return line;
}

function dropdown(
	parent: HTMLElement,
	label: string,
	options: Record<string, string>,
	value: string,
	onPick: (value: string) => void,
): void {
	const select = row(parent, label).createEl("select", {
		cls: "dropdown",
		attr: { "aria-label": label },
	});

	for (const [key, text] of Object.entries(options)) {
		const option = select.createEl("option", { text, attr: { value: key } });
		if (key === value) option.selected = true;
	}

	select.addEventListener("change", () => onPick(select.value));
}

function number(
	parent: HTMLElement,
	label: string,
	value: number,
	onSet: (value: number) => void,
): void {
	const input = row(parent, label).createEl("input", {
		attr: { type: "number", min: "0", value: String(value), "aria-label": label },
	});

	input.addEventListener("change", () => {
		const days = Number.parseInt(input.value, 10);
		onSet(Number.isFinite(days) ? Math.max(days, 0) : 0);
	});
}

function search(
	parent: HTMLElement,
	label: string,
	value: string,
	onSet: (value: string) => void,
): void {
	const line = row(parent, label);

	// The syntax, for someone who cannot see the panel — and only for them.
	// It used to be the input's `aria-label`, which Obsidian renders as a hover
	// tooltip: five clauses about search syntax, every time the mouse passed the
	// box. The same mistake as the one on the canvas, found in the same sweep
	// (BC_E3_S89). The label stays a name; the explanation moves behind
	// `aria-describedby`, which no tooltip is made from.
	searches += 1;
	const described = line.createSpan({
		cls: "task-wheel-sr-only",
		text: "Words are combined; OR offers an alternative; quotes hold a phrase together; a star stands for any run of characters; file: searches the name of the note instead.",
		attr: { id: `task-wheel-search-syntax-${searches}` },
	});

	const input = line.createEl("input", {
		attr: {
			type: "search",
			placeholder: "invoice OR quote, file:roadmap",
			value,
			"aria-label": "Words in the task and its tags",
			"aria-describedby": described.id,
		},
	});

	input.addEventListener("change", () => onSet(input.value.trim()));
}

function tags(
	parent: HTMLElement,
	label: string,
	value: string[],
	onSet: (value: string[]) => void,
): void {
	const input = row(parent, label).createEl("input", {
		attr: {
			type: "text",
			placeholder: "werk, thuis",
			value: value.join(", "),
			"aria-label": label,
		},
	});

	input.addEventListener("change", () => {
		onSet(
			input.value
				.split(",")
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0),
		);
	});
}
