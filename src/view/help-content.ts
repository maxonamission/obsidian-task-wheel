/**
 * What the help panel says.
 *
 * Same split as `round-menu.ts`, and for the same reason: what a panel *says*
 * is the part that can be wrong — a round row offering to unfold nothing, a
 * filter line without its two numbers, a percentage of zero items. Worked out
 * here, away from Obsidian, so it can be measured without a workspace.
 *
 * The two standing blocks are data rather than markup for a smaller reason: it
 * keeps the view a renderer, and it makes "does the panel still name every
 * action the card offers" a thing a reader can check in one place.
 *
 * Every word comes out of the `HelpStrings` table (thirteen languages, see
 * `help-strings.ts`); this module decides only which words go where.
 */
import { fmt, type HelpStrings } from "./help-strings";

/** The one thing a row offers to do, if it offers anything. */
export type HelpAction =
	| "open-wheel"
	| "outward"
	| "clear-filter"
	| "skip-report"
	| "unfold";

export interface HelpLink {
	text: string;
	action: HelpAction;
}

export interface RoundRow {
	/** Empty on the rows that are a sentence rather than a field. */
	label: string;
	text: string;
	link?: HelpLink;
}

export interface HelpRoundState {
	/**
	 * Whether this wheel has read the vault yet.
	 *
	 * A wheel that has just opened has no tree, and so no items — which is not
	 * the same as a blikveld with nothing in it. Telling the reader "nothing to
	 * review" for a second while the scan runs is a small lie, and on a vault of
	 * five thousand tasks it is a second long enough to read.
	 */
	read: boolean;
	seen: number;
	total: number;
	/** What this wheel is over, as the reader would name it. */
	scope: string;
	/** Absent when nothing is being filtered out. */
	filter?: { text: string; shown: number; left: number };
	/** Branches folded away in *this* wheel. */
	folded: number;
	/** The wheel one step wider, or `null` on the vault wheel. */
	outward: string | null;
}

/**
 * The head of the round block: a bar, a sentence, or nothing at all.
 *
 * Three cases rather than one nullable number, because they mean different
 * things and a panel that blurs them would report "0 of 0 · 0%" for a wheel
 * that is simply not there.
 */
export type RoundHead =
	| { kind: "none" }
	| { kind: "reading" }
	| { kind: "empty" }
	| { kind: "progress"; seen: number; total: number; percent: number };

export interface RoundBlock {
	head: RoundHead;
	rows: RoundRow[];
}

export function roundBlock(
	state: HelpRoundState | null,
	s: HelpStrings,
): RoundBlock {
	// No wheel is not an error and not an empty panel: the reader opened this,
	// often before opening a wheel at all. One row, and it is the way on.
	if (state === null) {
		return {
			head: { kind: "none" },
			rows: [
				{
					label: "",
					text: s.noWheel,
					link: { text: s.openWheel, action: "open-wheel" },
				},
			],
		};
	}

	const rows: RoundRow[] = [
		{
			label: s.labelScope,
			text: state.scope,
			...(state.outward === null
				? {}
				: {
						link: {
							text: fmt(s.outTo, { name: state.outward }),
							action: "outward" as const,
						},
					}),
		},
	];

	// A filter changes what the wheel is *about*, so it says both numbers or it
	// says that there is no filter. "61 in this round" on its own is the half
	// that flatters.
	rows.push(
		state.filter === undefined
			? { label: s.labelFilter, text: s.noFilter }
			: {
					label: s.labelFilter,
					text: fmt(s.filterCounts, {
						rule: state.filter.text,
						shown: state.filter.shown,
						left: state.filter.left,
					}),
					link: { text: s.clearFilter, action: "clear-filter" },
				},
	);

	// The skip rules are a boundary rather than a filter, so what they take out
	// is counted nowhere — which leaves a rule that matches nothing looking
	// exactly like one that works. This row is the way to see the difference.
	rows.push({
		label: s.labelSkipped,
		text: s.skippedNote,
		link: { text: s.showSkipReport, action: "skip-report" },
	});

	rows.push(
		state.folded === 0
			? { label: s.labelFolded, text: s.nothingFolded }
			: {
					label: s.labelFolded,
					text:
						state.folded === 1
							? s.foldedOne
							: fmt(s.foldedMany, { n: state.folded }),
					link: { text: s.unfoldAll, action: "unfold" },
				},
	);

	// Before the empty check, because "not read yet" and "nothing in it" look
	// identical from here and only one of them is worth saying.
	if (!state.read) return { head: { kind: "reading" }, rows };
	if (state.total === 0) return { head: { kind: "empty" }, rows };

	return {
		head: {
			kind: "progress",
			seen: state.seen,
			total: state.total,
			percent: Math.round((state.seen / state.total) * 100),
		},
		rows,
	};
}

/* -------------------------------------------------------------------------
   Block 1 — keys and actions. Counts heaviest on a phone: there is no palette
   worth opening mid-round there, and the card's buttons are icons.
   ------------------------------------------------------------------------- */

export interface KeyRow {
	/** Drawn as keycaps. A gesture is a key here too: it is how you do it. */
	keys: string[];
	text: string;
}

export interface KeyGroup {
	heading: string;
	rows: readonly KeyRow[];
}

/**
 * The moves this device can actually make, and no others.
 *
 * A phone reads a shorter table than a desktop: PgUp, Home, the arrows,
 * space and alt do not exist there, and a help block naming keys you cannot
 * press is noise exactly where the block weighs heaviest (eigenaar,
 * 25 aug 2026). Built per device rather than filtered, so each table can be
 * read on its own — and the gestures come out of the string table, because
 * "swipe" is a word too.
 */
export function keyGroups(touch: boolean, s: HelpStrings): KeyGroup[] {
	if (touch) {
		return [
			{
				heading: s.groupTurning,
				rows: [{ keys: [s.gestSwipe], text: s.keyTurn }],
			},
			{
				heading: s.groupTree,
				rows: [
					{ keys: ["‹", "›"], text: s.keySidewaysTouch },
					{ keys: [s.gestTap], text: s.keyTap },
					{ keys: [s.gestPinch], text: s.keyZoomTouch },
				],
			},
		];
	}

	return [
		{
			heading: s.groupTurning,
			rows: [
				{ keys: [s.gestDrag, s.gestScroll], text: s.keyTurn },
				{ keys: ["PgUp", "PgDn"], text: s.keyFlat },
				{ keys: ["Home", "End"], text: s.keyEnds },
			],
		},
		{
			heading: s.groupTree,
			rows: [
				{ keys: ["←", "→"], text: s.keySideways },
				{ keys: ["↑"], text: s.keyOut },
				{ keys: ["↓"], text: s.keyIn },
				{ keys: [s.gestTap], text: s.keyTap },
				{ keys: ["enter"], text: s.keyOpen },
				{ keys: ["backspace"], text: s.keyBack },
				{ keys: ["ctrl", "enter"], text: s.keyNote },
				{ keys: ["space"], text: s.keyFold },
				{ keys: ["+", "−", "0"], text: s.keyZoom },
				{ keys: ["alt", "↑ ↓"], text: s.keyMove },
			],
		},
	];
}

export interface ActionRow {
	/** Lucide name, the same one the card draws. */
	icon: string;
	name: string;
}

/** The card's buttons, named — on a phone they are icons without a tooltip. */
export function cardActions(s: HelpStrings): ActionRow[] {
	return [
		{ icon: "check", name: s.actTick },
		{ icon: "play", name: s.actProgress },
		{ icon: "ban", name: s.actCancel },
		{ icon: "calendar-clock", name: s.actDefer },
		{ icon: "chevron-up", name: s.actRaise },
		{ icon: "chevron-down", name: s.actLower },
		{ icon: "file-text", name: s.actOpenNote },
		{ icon: "ellipsis", name: s.actEdit },
		{ icon: "fold-vertical", name: s.actFold },
		{ icon: "chevron-left", name: s.actNudge },
	];
}

/* -------------------------------------------------------------------------
   Block 2 — what the drawing means. The full key, which lives nowhere else:
   the strip in the wheel's own pane has room for the priority ramp and no more.
   ------------------------------------------------------------------------- */

export type GlyphName = "wedge" | "stump" | "ticks" | "gap";

export type LegendRow =
	| { kind: "text"; label: string; text: string }
	/** Filled with the domains of the wheel in front of the reader. */
	| { kind: "hues"; text: string }
	| { kind: "ramp"; text: string }
	| { kind: "glyph"; glyph: GlyphName; text: string };

export function legendRows(s: HelpStrings): LegendRow[] {
	return [
		{ kind: "text", label: s.legAngleLabel, text: s.legAngle },
		{ kind: "hues", text: s.legHues },
		{ kind: "ramp", text: s.legRamp },
		{ kind: "glyph", glyph: "wedge", text: s.legWedge },
		{ kind: "glyph", glyph: "stump", text: s.legStump },
		{ kind: "glyph", glyph: "ticks", text: s.legTicks },
		{ kind: "glyph", glyph: "gap", text: s.legGap },
		{ kind: "text", label: s.legStraightLabel, text: s.legStraight },
	];
}
