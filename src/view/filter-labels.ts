import type { DateField, DateRule, StatusRule } from "../model/types";

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
