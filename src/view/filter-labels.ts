import type { DateField, DateRule, StatusRule } from "../model/types";
import { HEADING_MATCH, TAG_MATCH } from "../parse/filter";
import type { Looseness } from "../parse/glob";

/**
 * What the filter's choices are called, in one place.
 *
 * The panel and the settings tab both offer the same filter, and each used to
 * keep its own copy of these names — two places deciding one thing, which is
 * the shape three of the bugs in this repo have had. They drifted, too: the
 * panel said "Has a date" where the settings said "Dated".
 */

/**
 * The date rules.
 *
 * Named for the **shape of the question**, not for one of the three dates
 * (BC_E3_S140). Which date a rule reads is the reader's to choose, right below
 * this one, so a name like "Due soon" would be a lie the moment they pointed it
 * at 🛫. The two that carry an emoji are the two that ask their own question and
 * take no field — there the emoji *is* the rule.
 */
export const DUE_LABELS: Record<DateRule, string> = {
	any: "Anything",
	overdue: "Today or earlier",
	soon: "Soon, or already past",
	dated: "Has a date",
	undated: "Has no date",
	between: "Between two dates",
	parked: "Parked for later (🛫 or ⏳ ahead)",
	ready: "Ready now (nothing parking it)",
};

/** Which of a task's three dates a rule reads. */
export const DATE_FIELD_LABELS: Record<DateField, string> = {
	due: "Due date (📅)",
	scheduled: "Scheduled date (⏳)",
	start: "Start date (🛫)",
};

/**
 * The statuses, as a round sees them.
 *
 * Done and cancelled sit together under "finished": the only distinction a
 * review makes is whether there is anything left to look at. There is no
 * "deferred" — Tasks has no status character for it. Putting something off is a
 * date (🛫 or ⏳), which is why it sits in the list above as *parked*.
 */
export const STATUS_LABELS: Record<StatusRule, string> = {
	any: "Any status",
	open: "Not started",
	"in-progress": "In progress",
	finished: "Finished",
};

/**
 * Whether this rule reads a date the reader may choose.
 *
 * `any` reads none. `parked` and `ready` read 🛫 and ⏳ *by definition* — see
 * `matchesDue` — so offering them a field would be offering to make them
 * meaningless. Everything else is a fair question about any of the three.
 */
export function picksADate(rule: DateRule): boolean {
	return rule !== "any" && rule !== "parked" && rule !== "ready";
}

/**
 * What the two ends of a date window are called (BC_E3_S170).
 *
 * They name the date the window is pointed at, because that is what they read.
 * The settings tab said "Due from" and "Due up to" flat out, and the window has
 * been able to read ⏳ or 🛫 since BC_E3_S126 — the same lie BC_E3_S140 took out
 * of the rule names, still standing in the two rows below them. The panel said
 * "From" and "Up to", which is not untrue but says nothing.
 *
 * One helper rather than two names in two files, for the reason at the top of
 * this module.
 */
export function windowLabels(field: DateField): { from: string; until: string } {
	const what = field === "due" ? "Due" : field === "scheduled" ? "Scheduled" : "Start";
	return { from: `${what} from`, until: `${what} up to` };
}

/**
 * What a bare word does in each box, in one sentence (BC_E3_S181).
 *
 * Built from the rules rather than written beside them. The panel has to say
 * what its boxes accept — a reader typed `may`, watched `#maybe` not be found,
 * and concluded the filter was broken (eigenaarsmelding 8 sep 2026) — and a
 * sentence typed out by hand next to a rule kept in code is exactly the two
 * places deciding one thing that this story is taking out. Change
 * `HEADING_MATCH` or `TAG_MATCH` and the sentence follows.
 */
export function matchHint(): string {
	const how = (rule: Looseness): string =>
		rule === "anywhere" ? "part of a name" : "from its start";

	return [
		`Words and headings match ${how(HEADING_MATCH)};`,
		`a tag matches ${how(TAG_MATCH)}.`,
		"* stands for any run of characters.",
	].join(" ");
}
