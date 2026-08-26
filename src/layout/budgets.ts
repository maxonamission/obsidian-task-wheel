/**
 * Angular budgets per domain — the first hard design requirement.
 *
 * A domain's wedge is a **fixed** slice of the circle. In the default division
 * it does not grow when the domain collects tasks and it does not shrink when
 * they are ticked off; empty space inside a wedge is a feature — it is what
 * makes spatial memory work, and half the value of the concept rests on it.
 *
 * The budget a domain gets is either pinned by the user (persisted in
 * `WheelState.domainBudgets`, in degrees) or a share of whatever the pinned
 * wedges leave over: an equal share by default, or — since the revision of
 * 26 aug 2026 (kaderdocument §3.1) — a share proportional to a set of weights
 * the caller passes in. The weights this function sees are **frozen at the
 * start of a round** by the caller, never live counts: within a round the
 * drawing must not move under the reader's hands, so re-division happens only
 * on the round boundary. The `minimum` is the readability floor the owner
 * asked for — no wedge may become a sliver that cannot carry its own name.
 */

import type { WheelTree } from "../model/types";
import { FULL_CIRCLE } from "./geometry";

export interface DomainBudget {
	domain: string;
	/** Position in the wedge order. Also the index of the domain's hue. */
	index: number;
	/** Width of the wedge in degrees. */
	degrees: number;
	/** Wedge start, degrees clockwise from twelve o'clock. */
	startAngle: number;
	/** Wedge end. The last wedge always ends exactly at 360. */
	endAngle: number;
	/** True when the width came from a user override rather than the split. */
	pinned: boolean;
}

/** No wedge is ever narrower than this, so a domain can never vanish. */
export const MIN_BUDGET = 4;

/**
 * A proportional division, frozen for one round.
 *
 * `weights` is what each domain weighed when the round began — open tasks,
 * counted once and persisted, so ticking work off cannot move the wheel until
 * the next round deals again. `minimum` is the readability floor in degrees.
 */
export interface WedgeDivision {
	weights: Readonly<Record<string, number>>;
	minimum: number;
}

/**
 * Hand out a wedge to every domain, in the order given.
 *
 * The order is the caller's — `WheelTree.domains`, which the parser sorts
 * structurally — so the same vault always produces the same wedges.
 */
export function assignBudgets(
	domains: readonly string[],
	overrides: Readonly<Record<string, number>> = {},
	division?: WedgeDivision,
): DomainBudget[] {
	const unique = [...new Set(domains)];
	if (unique.length === 0) return [];

	const pinned = pinnedBudgets(unique, overrides);
	const freeCount = unique.length - pinned.size;
	const pinnedTotal = fit(pinned, freeCount);
	const free = FULL_CIRCLE - pinnedTotal;
	const freeShare = freeCount === 0 ? 0 : free / freeCount;
	const weighted =
		division === undefined
			? null
			: weightedShares(
					unique.filter((domain) => !pinned.has(domain)),
					free,
					division,
				);

	const budgets: DomainBudget[] = [];
	let cursor = 0;

	unique.forEach((domain, index) => {
		const width = pinned.get(domain) ?? weighted?.get(domain) ?? freeShare;
		const startAngle = cursor;
		// The last wedge is closed on 360 rather than on an accumulated sum, so
		// floating-point drift can never leave a hairline gap at twelve o'clock.
		const endAngle =
			index === unique.length - 1 ? FULL_CIRCLE : startAngle + width;
		cursor = endAngle;

		budgets.push({
			domain,
			index,
			degrees: endAngle - startAngle,
			startAngle,
			endAngle,
			pinned: pinned.has(domain),
		});
	});

	return budgets;
}

/**
 * Divide the free part of the circle by weight, under a floor.
 *
 * Every domain first gets the floor — a wedge that cannot carry its own name
 * is a bad pie chart, not a wheel (eigenaarseis 26 aug 2026) — and what that
 * costs is taken from the heavy domains, proportionally. The waterfall is the
 * standard one: clamp whoever falls below the floor, re-divide the rest by
 * weight, repeat until nobody new falls through. When the circle cannot afford
 * the floor for everyone, the floor gives way to the equal share — with that
 * many domains, equal is the least-bad reading of "readable".
 *
 * All-zero weights divide equally: a round with no counts to speak of has
 * nothing to be proportional to, and a circle of nothing but floors would
 * leave unowned degrees.
 */
function weightedShares(
	domains: readonly string[],
	free: number,
	division: WedgeDivision,
): Map<string, number> {
	const shares = new Map<string, number>();
	if (domains.length === 0 || free <= 0) return shares;

	const equal = free / domains.length;
	const floor = Math.min(Math.max(division.minimum, MIN_BUDGET), equal);

	const weightOf = (domain: string): number => {
		const value = division.weights[domain];
		return typeof value === "number" && Number.isFinite(value) && value > 0
			? value
			: 0;
	};

	let open = domains.filter((domain) => weightOf(domain) > 0);
	const floored = new Set(domains.filter((domain) => weightOf(domain) === 0));

	if (open.length === 0) {
		for (const domain of domains) shares.set(domain, equal);
		return shares;
	}

	for (;;) {
		const spare = free - floor * floored.size;
		const total = open.reduce((sum, domain) => sum + weightOf(domain), 0);
		const fell = open.filter(
			(domain) => (spare * weightOf(domain)) / total < floor,
		);
		if (fell.length === 0) {
			for (const domain of floored) shares.set(domain, floor);
			for (const domain of open) {
				shares.set(domain, (spare * weightOf(domain)) / total);
			}
			return shares;
		}
		for (const domain of fell) floored.add(domain);
		open = open.filter((domain) => !floored.has(domain));
		if (open.length === 0) {
			// Everyone is at the floor; the floor was capped at the equal share,
			// so this is the equal split wearing another name.
			for (const domain of domains) shares.set(domain, free / domains.length);
			return shares;
		}
	}
}

/**
 * What each domain weighs: its open work, counted once at the round boundary.
 *
 * The caller persists the result for the round (`WheelState.roundWeights`), so
 * this is deliberately the only place a task count comes anywhere near the
 * budgets — and it runs only when a proportional round begins.
 */
export function domainWeights(tree: WheelTree): Record<string, number> {
	const weights: Record<string, number> = {};
	for (const domain of tree.domains) weights[domain] = 0;
	// `shownTaskCount` rather than a count of our own: it is what every number
	// the reader sees is already drawn from, so the wedges weigh exactly the
	// round — filter included — and cannot disagree with the hub.
	for (const child of tree.root.children) {
		if (child.kind === "domain") weights[child.domain] = child.shownTaskCount;
	}
	return weights;
}

/** Look a wedge up by domain. */
export function budgetsByDomain(
	budgets: readonly DomainBudget[],
): Map<string, DomainBudget> {
	return new Map(budgets.map((budget) => [budget.domain, budget]));
}

/** Overrides that name a real domain, clamped to something drawable. */
function pinnedBudgets(
	domains: readonly string[],
	overrides: Readonly<Record<string, number>>,
): Map<string, number> {
	const pinned = new Map<string, number>();
	for (const domain of domains) {
		const value = overrides[domain];
		if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
			continue;
		}
		pinned.set(domain, Math.min(FULL_CIRCLE, Math.max(MIN_BUDGET, value)));
	}
	return pinned;
}

/**
 * Scale the pinned wedges so the circle still adds up.
 *
 * Two cases need it: the pinned wedges together claim more than the circle can
 * spare once every free domain has its minimum, or every domain is pinned and
 * the total is simply not 360. Scaling proportionally keeps the user's
 * relative intent intact. Returns the pinned total after scaling.
 */
function fit(pinned: Map<string, number>, freeCount: number): number {
	let total = 0;
	for (const degrees of pinned.values()) total += degrees;
	if (pinned.size === 0) return 0;

	const ceiling = FULL_CIRCLE - MIN_BUDGET * freeCount;
	const target =
		freeCount === 0 ? FULL_CIRCLE : total > ceiling ? ceiling : total;
	if (target === total) return total;

	const factor = target / total;
	for (const [domain, degrees] of pinned) pinned.set(domain, degrees * factor);
	return target;
}
