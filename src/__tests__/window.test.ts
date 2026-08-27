import { describe, expect, it } from "vitest";
import { layoutWheel } from "../layout/radial";
import {
	BAND_GAP,
	EDGE_PAD,
	LABEL_CHARS,
	LABEL_GAP,
	READING_GAP,
	TITLE_GAP,
	widthOf,
} from "../layout/window";
import { plainText } from "../parse/links";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * The drawing's window must not move while you turn (BC_E3_S70).
 *
 * The owner's differential pair made the mechanism visible: a note whose extra
 * branch carries long-labelled tasks (VRG-013) made the thick outer band lurch
 * on scroll, while its neighbour without one (VRG-012) did not. The branch
 * unfolds only while the focus stands in it — and a window computed over what
 * is *drawn* therefore changed size exactly when the turn crossed that branch,
 * rescaling the whole drawing. The wheel's items barely moved; the band, being
 * outermost and thickest, visibly did.
 */

function note(path: string, lines: string[]): NoteInput {
	return { path, content: lines.join("\n") };
}

// The quiet neighbour: four short tasks under one heading, nothing deep.
const CALM = note("RFI/VRG-012 Rapportages.md", [
	"## Status beantwoording",
	"- [ ] Concept opgesteld",
	"- [ ] Intern afgestemd",
	"- [ ] Definitief vastgesteld",
	"- [ ] Verzonden",
]);

// The trigger: a second heading whose tasks carry long labels and run deep —
// past the ring cap, so the tail is drawn only while the focus stands in it.
const DEEP = note("RFI/VRG-013 MDS.md", [
	"## Status beantwoording",
	"- [ ] Concept opgesteld",
	"- [ ] Intern afgestemd",
	"## Antwoord",
	"- [ ] INTERN TE VALIDEREN: Beschikbare connectiemogelijkheden (API, database-export, directe connectie)",
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
	idOf("INTERN TE VALIDEREN"),
	idOf("derde verdieping"),
];

/** The reach formula of the window, applied to one drawn layout. */
function drawnReach(layout: ReturnType<typeof layoutAt>): number {
	let needed = 0;
	for (const laid of layout.nodes) {
		if (laid.depth === 0) continue;
		const words = plainText(laid.node.label);
		const reach =
			laid.depth === 1
				? layout.radius + BAND_GAP + TITLE_GAP + widthOf(words, LABEL_CHARS.domain, true)
				: laid.radius +
					Math.max(
						READING_GAP + widthOf(words, LABEL_CHARS.reading, false) / 2,
						LABEL_GAP + widthOf(words, LABEL_CHARS.leaf, false),
					);
		needed = Math.max(needed, Math.ceil(reach + EDGE_PAD));
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
		expect(new Set(layouts.map(drawnReach)).size).toBeGreaterThan(1);
	});

	it("always covers what any focus puts on the drawing", () => {
		for (const layout of layouts) {
			expect(drawnReach(layout)).toBeLessThanOrEqual(layout.window);
		}
	});
});
