import { addDays, isIsoDate } from "../model/dates";
import { projectLabel } from "./domain";
import { describeQuery, isEmpty, matchesQuery, parseQuery } from "./query";
import {
	isFinished,
	PRIORITY_RANK,
	type StatusRule,
	type TaskFields,
	type TaskFilter,
} from "../model/types";

/**
 * Which tasks a round is about.
 *
 * The visibility budget (BC_E3_S8) answers "there is too much to *draw*"; a
 * filter answers "there is too much to *review*" (kaderdocument §10). They are
 * independent: the budget picks which of the tasks in play get a dot, the
 * filter decides which are in play at all.
 *
 * A filter deliberately leaves work out, which sits uneasily beside the rule
 * that nothing may disappear (§3.3). The two are reconciled by making it loud
 * rather than silent: what a filter removes is counted, the count is shown
 * beside the wheel, and the round is explicitly a round *of that selection*.
 * The rule the wheel may never break is not "everything is drawn" — it is
 * "the wheel never lies about what it is not showing".
 */

/** Whether anything is being left out at all. */
export function isFiltering(filter: TaskFilter): boolean {
	return (
		!isEmpty(parseQuery(filter.text)) ||
		filter.due !== "any" ||
		filter.status !== "any" ||
		filter.minPriority !== "any" ||
		filter.maxPriority !== "any" ||
		clean(filter.withTags).length > 0 ||
		clean(filter.withoutTags).length > 0
	);
}

/** What the filter says, in words, for the line that has to show it. */
export function describe(filter: TaskFilter): string {
	const parts: string[] = [];

	const query = parseQuery(filter.text);
	if (!isEmpty(query)) parts.push(describeQuery(query));

	if (filter.status === "open") parts.push("not started");
	else if (filter.status === "in-progress") parts.push("in progress");
	else if (filter.status === "finished") parts.push("finished");

	if (filter.due === "overdue") parts.push("overdue");
	else if (filter.due === "soon") parts.push(`due within ${filter.horizon} days`);
	else if (filter.due === "dated") parts.push("has a date");
	else if (filter.due === "undated") parts.push("no date");
	else if (filter.due === "parked") parts.push("parked for later");
	else if (filter.due === "ready") parts.push("ready now");

	// One bound reads as a direction, both as a band — and a band is what the
	// reader set out to describe when they used two controls.
	if (filter.minPriority !== "any" && filter.maxPriority !== "any") {
		parts.push(
			filter.minPriority === filter.maxPriority
				? `${filter.minPriority} only`
				: `${filter.maxPriority} down to ${filter.minPriority}`,
		);
	} else if (filter.minPriority !== "any") {
		parts.push(`${filter.minPriority} or above`);
	} else if (filter.maxPriority !== "any") {
		parts.push(`${filter.maxPriority} or below`);
	}

	const with_ = clean(filter.withTags);
	if (with_.length > 0) parts.push(with_.map((tag) => `#${tag}`).join(" or "));

	const without = clean(filter.withoutTags);
	if (without.length > 0) {
		parts.push(`not ${without.map((tag) => `#${tag}`).join(" or ")}`);
	}

	return parts.join(" · ");
}

/**
 * Whether one task is in play.
 *
 * `today` is handed in rather than read from the clock, so a round is judged
 * against one day throughout and the rule is testable without pretending it is
 * a particular Tuesday.
 */
export function matches(
	fields: TaskFields,
	filter: TaskFilter,
	today: string,
	notePath = "",
): boolean {
	if (!matchesText(fields, filter.text, notePath)) return false;
	if (!matchesStatus(fields, filter.status)) return false;
	if (!matchesDue(fields, filter, today)) return false;

	if (filter.minPriority !== "any") {
		if (PRIORITY_RANK[fields.priority] < PRIORITY_RANK[filter.minPriority]) {
			return false;
		}
	}

	if (filter.maxPriority !== "any") {
		if (PRIORITY_RANK[fields.priority] > PRIORITY_RANK[filter.maxPriority]) {
			return false;
		}
	}

	const tags = fields.tags.map(lower);

	const with_ = clean(filter.withTags);
	if (with_.length > 0 && !with_.some((tag) => hasTag(tags, tag))) return false;

	const without = clean(filter.withoutTags);
	if (without.some((tag) => hasTag(tags, tag))) return false;

	return true;
}

/**
 * Whether the search box is happy with this task.
 *
 * The grammar lives in `parse/query`; what belongs here is *what* the two sides
 * of the haystack are.
 *
 * A bare word searches the task: its description as a person wrote it, plus its
 * tags, because someone typing "klant" means it whether the word ended up in
 * the text or in a tag. `file:` searches the *name* of the note the task sits
 * in — half of what a task is about is often only in the title above it, and
 * "call" under *Northwind roadmap* never says Northwind itself.
 *
 * The note's name, not its path. The folders are already the wedges of the
 * wheel and have their own include and exclude lists, so searching them would
 * make one word pull in a whole branch.
 *
 * Deliberately not the note's contents, and not the whole task line. Matching
 * the emoji fields would make "2026" find every task due this year, which the
 * date filter already does better and says out loud; searching note bodies is
 * what Obsidian's own search is for (kaderdocument §10).
 */
function matchesText(
	fields: TaskFields,
	text: string,
	notePath: string,
): boolean {
	return matchesQuery(parseQuery(text), {
		task: `${fields.description} ${fields.tags.join(" ")}`,
		file: notePath.length > 0 ? projectLabel(notePath) : "",
	});
}

/**
 * Whether the status rule keeps this task.
 *
 * "Finished" only has anything to select from when finished work is being shown
 * at all — the tree drops it before the filter ever sees it otherwise. That is
 * not a special case to code around: a rule that selects nothing shows an empty
 * wheel and says how much it left out, which is the honest answer.
 */
function matchesStatus(fields: TaskFields, rule: StatusRule): boolean {
	switch (rule) {
		case "any":
			return true;
		case "open":
			return fields.state === "open";
		case "in-progress":
			return fields.state === "in-progress";
		case "finished":
			return isFinished(fields);
	}
}

/**
 * Whether the date rule keeps this task.
 *
 * `parked` is the one rule that does not look at the due date. Obsidian Tasks
 * has no status character for "deferred": postponing something is a *date* — a
 * start date (🛫) or a scheduled date (⏳) that has not arrived yet — and the
 * due date can sit anywhere relative to it. So "parked" asks the question the
 * dates actually answer: is this yours to look at yet?
 */
function matchesDue(
	fields: TaskFields,
	filter: TaskFilter,
	today: string,
): boolean {
	const due = fields.due;

	switch (filter.due) {
		case "any":
			return true;
		case "dated":
			return isIsoDate(due);
		case "undated":
			return !isIsoDate(due);
		case "overdue":
			// Today counts as due: a task due today is work for this round, not
			// for the next one.
			return isIsoDate(due) && due <= today;
		case "soon":
			return isIsoDate(due) && due <= addDays(today, Math.max(filter.horizon, 0));
		case "parked":
			return isParked(fields, today);
		case "ready":
			return !isParked(fields, today);
	}
}

/** Put off until a date that has not come round yet. */
function isParked(fields: TaskFields, today: string): boolean {
	return [fields.start, fields.scheduled].some(
		(date) => isIsoDate(date) && date > today,
	);
}

/**
 * A tag matches its own children too.
 *
 * `#werk` catches `#werk/klant`, because someone who filters on a namespace
 * means the namespace. Comparison is case-insensitive: Obsidian treats `#Werk`
 * and `#werk` as one tag and so must this.
 */
function hasTag(tags: string[], wanted: string): boolean {
	return tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`));
}

function clean(tags: string[]): string[] {
	return tags
		.map((tag) => lower(tag).replace(/^#/, "").replace(/\/+$/, ""))
		.filter((tag) => tag.length > 0);
}

function lower(tag: string): string {
	return tag.trim().toLowerCase();
}
