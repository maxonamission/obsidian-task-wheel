import type { DateRule, DomainSource } from "../model/types";

/**
 * The round's own actions, as a menu.
 *
 * Everything on the card is about the item under the wedge. The round is about
 * the whole wheel — how far it has got, what it is filtered to, what is folded
 * away — and those had nowhere to live but the command palette. On a phone
 * there is no palette worth the name, so on a phone they had nowhere at all
 * (staand aanbod sinds 18 aug 2026, opgepakt 21 aug 2026).
 *
 * The rows are worked out here, away from Obsidian's `Menu`, because what the
 * menu *says* is the part that can be wrong: a filter row that does not show it
 * is on, an unfold row that offers to unfold nothing, a count that disagrees
 * with the sweep. Which of them is enabled and what each one reads is decided
 * from one description of the wheel's state and can be measured without a
 * workspace.
 */

/** What a row does when it is picked. `null` is a separator. */
export type RoundAction =
	| "outward"
	| "new-round"
	| "overdue"
	| "soon"
	| "clear-filter"
	| "unfold"
	| "rescan"
	| "skip-report"
	| "duplicate-report"
	| "add-preset"
	| "angle-folder"
	| "angle-tag"
	| "angle-property"
	| "angle-heading";

/** The four angles, in the order the settings tab offers them. */
const ANGLES: readonly [RoundAction, DomainSource, string][] = [
	["angle-folder", "folder", "Angle: top folder"],
	["angle-tag", "tag", "Angle: tag namespace"],
	["angle-property", "property", "Angle: note property"],
	["angle-heading", "heading", "Angle: the heading it sits under"],
];

export interface MenuRow {
	/** `null` for a separator, and for the line that only reports. */
	action: RoundAction | null;
	title: string;
	/** Lucide name. Absent on separators. */
	icon?: string;
	/** Shown, greyed: there is nothing for it to do right now. */
	disabled?: boolean;
	/** A lens that is on. Picking it again turns it off. */
	checked?: boolean;
	/** True for the separators, so the caller need not compare titles. */
	separator?: boolean;
}

export interface RoundMenuState {
	/** Items passed this round, and how many there are in total. */
	seen: number;
	total: number;
	/** Whether anything is being filtered out, and how that reads. */
	filtering: boolean;
	filterText: string;
	/** Which date lens is on, so its row can be ticked. */
	due: DateRule;
	/** What the angle is made of right now, so its row can be ticked. */
	angle: DomainSource;
	/** How many branches are folded away in this wheel. */
	folded: number;
	/** The vault changed under this wheel since it last read it. */
	stale: boolean;
	/**
	 * What the wheel one step wider is called, or `null` on the vault wheel.
	 *
	 * Named rather than a flag, because "out" is only useful if you can see
	 * where it goes.
	 */
	outward: string | null;
}

const line = (): MenuRow => ({ action: null, title: "", separator: true });

/**
 * The rows for a wheel in this state.
 *
 * Order is deliberate: where you are, then the round, then what the round is
 * about, then the two that touch the vault. The reporting line comes first
 * because it is the answer to the question that opens this menu most often.
 */
export function roundMenu(state: RoundMenuState): MenuRow[] {
	const rows: MenuRow[] = [];

	// Reports rather than acts. It is disabled for that reason and not because
	// something is missing — a row that did nothing when clicked *and* looked
	// clickable would be the misleading one.
	rows.push({
		action: null,
		title: `Seen ${state.seen} of ${state.total} this round`,
		icon: "gauge",
		disabled: true,
	});

	if (state.filtering) {
		rows.push({
			action: null,
			title: `Filtered to: ${state.filterText}`,
			icon: "filter",
			disabled: true,
		});
	}

	// Where you are, and the way out of it: tapping twice takes you in, and
	// until now nothing took you back (eigenaar, 22 aug 2026). Left out entirely
	// on the vault wheel — there is nothing wider, and a greyed row would only
	// invite the question of what it would have done.
	if (state.outward !== null) {
		rows.push({
			action: "outward",
			title: `Out to ${state.outward}`,
			icon: "zoom-out",
		});
	}

	rows.push(line());

	rows.push({
		action: "new-round",
		title: "Start a new round",
		icon: "rotate-ccw",
		// Nothing seen yet is already a new round; saying so beats a row that
		// silently does nothing.
		disabled: state.seen === 0,
	});

	rows.push(line());

	// The two date lenses, ticked when they are the one that is on. Picking a
	// ticked one turns it off, which is what the tick promises.
	rows.push({
		action: "overdue",
		title: "Only overdue",
		icon: "alarm-clock",
		checked: state.due === "overdue",
	});
	rows.push({
		action: "soon",
		title: "Due soon",
		icon: "calendar-clock",
		checked: state.due === "soon",
	});
	rows.push({
		action: "clear-filter",
		title: "Clear the filter",
		icon: "filter-x",
		disabled: !state.filtering,
	});

	rows.push(line());

	// What the angle is made of, switchable from here (BC_E3_S148). It is a
	// setting, and it stays one — but it is the setting a reader changes *while
	// looking at the wheel*, to ask the same work a different question, and
	// three taps into a settings tab is not where that belongs. The date lenses
	// above are ticked the same way and for the same reason.
	//
	// Picking the one that is already on does nothing rather than turning it
	// off: unlike a lens, the wheel cannot be drawn without an angle.
	for (const [action, source, title] of ANGLES) {
		rows.push({
			action,
			title,
			icon: "compass",
			checked: state.angle === source,
		});
	}

	rows.push(line());

	rows.push({
		action: "unfold",
		title:
			state.folded === 0
				? "Nothing is folded away"
				: `Unfold ${state.folded} folded ${state.folded === 1 ? "branch" : "branches"}`,
		icon: "unfold-vertical",
		disabled: state.folded === 0,
	});

	rows.push(line());

	rows.push({
		action: "rescan",
		// The wheel says elsewhere that it is out of date; here it says so on the
		// row that fixes it, because this is where you are already looking.
		title: state.stale ? "Rescan the vault — it changed" : "Rescan the vault",
		icon: "refresh-cw",
	});
	rows.push({
		action: "skip-report",
		title: "Show what the skip rules take out",
		icon: "eye-off",
	});
	rows.push({
		action: "duplicate-report",
		title: "Show possible duplicate tasks",
		icon: "copy",
	});
	rows.push({
		action: "add-preset",
		title: "Add a destination to carry work to",
		icon: "folder-plus",
	});

	return rows;
}
