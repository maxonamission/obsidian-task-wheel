/**
 * Angular budgets per domain — the first hard design requirement.
 *
 * A domain's wedge is a **fixed** slice of the circle. It does not grow when
 * the domain collects tasks and it does not shrink when they are ticked off:
 * this function never sees a task count, which is the cheapest possible way to
 * guarantee that (kaderdocument §3.1). Empty space inside a wedge is a feature
 * — it is what makes spatial memory work, and half the value of the concept
 * rests on it.
 *
 * The budget a domain gets is either pinned by the user (persisted in
 * `WheelState.domainBudgets`, in degrees) or an equal share of whatever the
 * pinned wedges leave over.
 */

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
 * Hand out a wedge to every domain, in the order given.
 *
 * The order is the caller's — `WheelTree.domains`, which the parser sorts
 * structurally — so the same vault always produces the same wedges.
 */
export function assignBudgets(
	domains: readonly string[],
	overrides: Readonly<Record<string, number>> = {},
): DomainBudget[] {
	const unique = [...new Set(domains)];
	if (unique.length === 0) return [];

	const pinned = pinnedBudgets(unique, overrides);
	const freeCount = unique.length - pinned.size;
	const pinnedTotal = fit(pinned, freeCount);
	const freeShare =
		freeCount === 0 ? 0 : (FULL_CIRCLE - pinnedTotal) / freeCount;

	const budgets: DomainBudget[] = [];
	let cursor = 0;

	unique.forEach((domain, index) => {
		const width = pinned.get(domain) ?? freeShare;
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
