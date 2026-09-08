import { describe, expect, it } from "vitest";
import { layoutWheel } from "../layout/radial";
import {
	BAND_GAP,
	EDGE_PAD,
	LABEL_CHARS,
	LABEL_GAP,
	READING_GAP,
	TITLE_GAP,
} from "../layout/window";
import { anchorFor, charWidth } from "../layout/labels";
import { normaliseAngle, toRadians } from "../layout/geometry";
import { plainText } from "../parse/links";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * The drawing's window must not move while you turn (BC_E3_S70).
 *
 * The owner's differential pair made the mechanism visible: a note whose extra
 * branch carries long-labelled tasks (Plan.md) made the thick outer band lurch
 * on scroll, while its neighbour without one (Notulen.md) did not. The branch
 * unfolds only while the focus stands in it — and a window computed over what
 * is *drawn* therefore changed size exactly when the turn crossed that branch,
 * rescaling the whole drawing. The wheel's items barely moved; the band, being
 * outermost and thickest, visibly did.
 */

function note(path: string, lines: string[]): NoteInput {
	return { path, content: lines.join("\n") };
}

// The quiet neighbour: four short tasks under one heading, nothing deep.
const CALM = note("Werk/Notulen.md", [
	"## Voortgang",
	"- [ ] Concept opgesteld",
	"- [ ] Intern afgestemd",
	"- [ ] Definitief vastgesteld",
	"- [ ] Verzonden",
]);

// The trigger: a second heading whose tasks carry long labels and run deep —
// past the ring cap, so the tail is drawn only while the focus stands in it.
const DEEP = note("Werk/Plan.md", [
	"## Voortgang",
	"- [ ] Concept opgesteld",
	"- [ ] Intern afgestemd",
	"## Antwoord",
	"- [ ] TE VALIDEREN: beschikbare koppelvormen (interface, bestandsexport, directe verbinding, handmatig)",
	"    - [ ] eerste verdieping van de validatie met een ruime naam",
	"        - [ ] tweede verdieping van de validatie met een ruime naam",
	"            - [ ] derde verdieping die alleen bij focus wordt getekend",
]);

const TREE = buildTree([CALM, DEEP], { ...DEFAULT_PARSE_OPTIONS });

function idOf(label: string): string {
	for (const [id, node] of TREE.byId) {
		if (node.label.startsWith(label)) return id;
	}
	throw new Error(`no node labelled ${label}`);
}

/** A tight budget, so what is drawn genuinely follows the focus. */
function layoutAt(focusId: string | null) {
	return layoutWheel(TREE, { focusId, visibleBudget: 12 });
}

const FOCUSES = [
	null,
	idOf("Concept opgesteld"),
	idOf("Verzonden"),
	idOf("TE VALIDEREN"),
	idOf("derde verdieping"),
];

function truncate(text: string, limit: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= limit) return trimmed;
	return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * How far the drawing actually reaches, over a whole revolution.
 *
 * Not the window's own formula applied a second time — that would only prove
 * the formula equals itself. This walks every label the layout puts up, at every
 * whole degree of turn, through the same `anchorFor` the renderer uses, and asks
 * where the text lands. It is the instrument the reach formula is answerable to
 * (BC_E3_S79), and it is what caught that the formula was charging for a long
 * label at three o'clock, which `anchorFor` never produces.
 */
function drawnReach(
	layout: ReturnType<typeof layoutAt>,
	limits: { title: number; reading: number } = LABEL_CHARS,
): number {
	let needed = 0;
	for (const laid of layout.nodes) {
		if (laid.depth === 0) continue;
		const words = plainText(laid.node.label);
		const onRim = laid.depth === 1;
		const centred = laid.onPath && !onRim;

		const long = truncate(words, onRim ? limits.title : limits.reading);
		const short = truncate(words, onRim ? LABEL_CHARS.domain : LABEL_CHARS.leaf);
		const radius = onRim
			? layout.radius + BAND_GAP + TITLE_GAP
			: laid.radius + (laid.onPath ? READING_GAP : LABEL_GAP);

		for (let turn = 0; turn < 360; turn++) {
			const shown = normaliseAngle(laid.drawAngle + turn);
			const side = anchorFor(shown, onRim, centred);
			const text = side === "middle" ? long : short;
			const width = text.length * charWidth(onRim);
			const x = radius * Math.sin(toRadians(shown));

			// Where the two ends of the text land, whichever is further out.
			const [from, to] =
				side === "middle"
					? [x - width / 2, x + width / 2]
					: side === "start"
						? [x, x + width]
						: [x - width, x];
			const reach = Math.max(Math.abs(from), Math.abs(to));
			needed = Math.max(needed, Math.ceil(reach + EDGE_PAD));
		}
	}
	return needed;
}

describe("the drawing's window while turning", () => {
	const layouts = FOCUSES.map(layoutAt);

	it("is the same number at every focus", () => {
		expect(new Set(layouts.map((layout) => layout.window)).size).toBe(1);
	});

	it("stands on a rim that does not move either", () => {
		expect(new Set(layouts.map((layout) => layout.radius)).size).toBe(1);
	});

	it("cannot come from what is drawn — that does move with the focus", () => {
		// The artefact itself, kept as a measurement: the drawn selection's own
		// worst reach differs between stops, which is exactly why the window is
		// taken from the tree instead (see `layout/window.ts`).
		expect(
			new Set(layouts.map((layout) => drawnReach(layout))).size,
		).toBeGreaterThan(1);
	});

	it("always covers what any focus puts on the drawing", () => {
		for (const layout of layouts) {
			expect(drawnReach(layout)).toBeLessThanOrEqual(layout.window);
		}
	});

	/**
	 * Why the long labels of BC_E3_S79 cost nothing.
	 *
	 * A label is written out only while it stands centred near the top or bottom
	 * of the wheel, and there it straddles a dot that is barely off the middle
	 * line. What sets how wide the drawing has to be is a *short* label hanging
	 * off the side at three o'clock — which none of these limits touch. So the
	 * wheel is exactly as large with a 34-character wedge title as it was with an
	 * eleven-character one.
	 *
	 * Free, but not free without bound — which is why the numbers are what they
	 * are rather than as large as they could be written. A centred label near the
	 * top is still a little off the middle line, so past some length it does
	 * start to cost, and on a shallow ring that happens sooner. The second
	 * assertion holds that ceiling in view: at sixty characters the drawing would
	 * have to grow, and the shipped limits sit below it deliberately.
	 */
	it("does not grow when the written-out labels are allowed to", () => {
		for (const layout of layouts) {
			expect(drawnReach(layout, { title: 11, reading: 30 })).toBe(
				drawnReach(layout),
			);
		}

		const stretched = layouts.map((layout) =>
			drawnReach(layout, { title: 60, reading: 60 }),
		);
		expect(stretched.some((reach, at) => reach > drawnReach(layouts[at]))).toBe(
			true,
		);
	});
});
