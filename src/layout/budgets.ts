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
import { hueIndex, MAX_HUES } from "./colour";
import { FULL_CIRCLE } from "./geometry";

export interface DomainBudget {
	domain: string;
	/**
	 * Position in the wedge order.
	 *
	 * Only the position. It used to be the hue as well, and those two came
	 * apart the moment a palette was shorter than the number of domains: on a
	 * circle the last wedge sits beside the first, so position-as-hue put two of
	 * the same colour side by side (BC_E3_S180). `hue` below answers that half
	 * of the question now, and this one is left saying what it says.
	 */
	index: number;
	/**
	 * Which hue of the palette this wedge is drawn in.
	 *
	 * The same as `index` until the hues run out; see `hueIndex`.
	 */
	hue: number;
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
 * The wedge order for a round, given the order it was dealt with.
 *
 * `assignBudgets` hands out hue and angle by *position*, so the order is not a
 * presentation detail — it is the identity of every wedge on the wheel. And the
 * parser sorts `WheelTree.domains` structurally, which means a domain that
 * turns up mid-round sorts into the **middle**: measured 28 aug 2026 on five
 * domains, adding `Health` moved `Home` from hue 2 to hue 3 and from 180°–270°
 * to 216°–288°, and `Work` likewise. A wedge you had learned as "yellow, at
 * four o'clock" became a different colour somewhere else, halfway through a
 * round (BC_E3_S82).
 *
 * With folders that is a rare event; a top-level folder is not something you
 * make halfway through a review. With the domain in a front-matter property
 * (BC_E3_S81) it is ordinary: typing one property moves a note into a domain
 * that did not exist a second ago.
 *
 * So the round deals the order once and holds it:
 *
 *  - a domain the round was dealt **keeps its place**, and therefore its hue,
 *    even after its last task is ticked off — an empty wedge is not a mistake,
 *    it is what makes the place mean something (harde eis 1);
 *  - a domain that turns up mid-round is **appended**, so it can take a width
 *    but never a position that belonged to something else.
 *
 * What this does not do, because the circle cannot: keep the widths. A new
 * wedge has to come from somewhere, so everything narrows a little and the
 * angles after it shift. Nothing swaps places and nothing changes colour, which
 * is what the reader was actually navigating by. The full re-deal happens at
 * the round boundary, the one moment re-division is allowed to move the drawing.
 */
export function roundOrder(
	dealt: readonly string[] | null | undefined,
	current: readonly string[],
): string[] {
	if (dealt === null || dealt === undefined) return [...current];

	const held = new Set(dealt);
	return [...dealt, ...current.filter((domain) => !held.has(domain))];
}

/**
 * Hand out a wedge to every domain, in the order given.
 *
 * The order is the caller's — `WheelTree.domains` put through `roundOrder`, so
 * the same vault always produces the same wedges and a round holds the order it
 * was dealt.
 */
export function assignBudgets(
	domains: readonly string[],
	overrides: Readonly<Record<string, number>> = {},
	division?: WedgeDivision,
	/**
	 * How many hues the chosen palette holds, so a wedge can be given one that
	 * its neighbours do not have (BC_E3_S180). Defaults to the theme's full set,
	 * which is what every caller that does not choose a palette is drawing with.
	 */
	hues: number = MAX_HUES,
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
			hue: hueIndex(index, unique.length, hues),
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
	// Guarded like every weight below it. The minimum comes straight off a
	// number control, and an unreadable one carried NaN through every
	// comparison here to a wheel whose wedges all had `NaN` degrees — nothing
	// drawn, nothing said (found by audit, 6 sep 2026).
	const wanted = Number.isFinite(division.minimum) ? division.minimum : MIN_BUDGET;
	const floor = Math.min(Math.max(wanted, MIN_BUDGET), equal);

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
