import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { buildDetents } from "../layout/detents";
import { sweepSpans } from "../layout/sweep";
import { layoutWheel } from "../layout/radial";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * On a note wheel the drawing is the document's outline (BC_E3_S85).
 *
 * The owner opened a wheel over a CRM note with seven phases and saw four
 * wedges: phases 3, 4 and 5 were not empty on the drawing, they were **absent**
 * (29 aug 2026, screenshots of wheel and note). The wheel only ever met a
 * heading as the ancestor of a task, so a phase with no open work did not exist
 * — and a pipeline drawn without its empty phases looks like a shorter
 * pipeline.
 *
 * The kaderdocument had already settled what a note wheel is, in §4.2: it is
 * not a view *of* an outline, it **is** the outline — "kopjes zijn de wiggen,
 * inspringing is de diepte". This is that sentence made true.
 */

const CRM = `# CRM

## Fase 0 - Target

### Amsterdam
- [ ] Ingang bij Amsterdam zoeken

## Fase 1 - Contact

### CleverFranke/ ADC
- [ ] Vervolgafspraak Wouter

## Fase 2 - Interesse

### Northwind
- [ ] Inrichten Informatiemanagement binnen Northwind

## Fase 3 - Concrete vragen

## Fase 4 - Opdrachten

## Fase 5 - Herhaalopdrachten

### Northwind

## Fase 6 - On Hold

### Sport.Gouda
- [ ] Laatste afspraak opvolgen
`;

const NOTE: NoteInput = { path: "ActionRequired/CRM.md", content: CRM };
const OVER_NOTE = {
	...DEFAULT_PARSE_OPTIONS,
	scope: { kind: "note" as const, path: NOTE.path },
};

function wedgesOf(options = OVER_NOTE) {
	return buildTree([NOTE], options).root.children.map((child) => child.label);
}

describe("the frame comes from the document", () => {
	it("draws every phase, including the three with no work in them", () => {
		// The measurement the story exists for: four wedges became seven.
		expect(wedgesOf()).toEqual([
			"Fase 0 - Target",
			"Fase 1 - Contact",
			"Fase 2 - Interesse",
			"Fase 3 - Concrete vragen",
			"Fase 4 - Opdrachten",
			"Fase 5 - Herhaalopdrachten",
			"Fase 6 - On Hold",
		]);
	});

	it("keeps document order, which is what a pipeline means by order", () => {
		// Alphabetically `Fase 10` would sort before `Fase 2`. The wedges of a
		// note wheel sort by where the heading sits, and now that holds for a
		// heading with no task to date it by.
		const wedges = wedgesOf();
		expect(wedges[3]).toBe("Fase 3 - Concrete vragen");
		expect(wedges[6]).toBe("Fase 6 - On Hold");
	});

	it("draws an empty heading deeper in too, not only a wedge", () => {
		// The owner saw the gap at client level as well: `Northwind` under Fase 5.
		const tree = buildTree([NOTE], OVER_NOTE);
		const fase5 = tree.root.children.find((c) => c.label.startsWith("Fase 5"));
		expect(fase5?.children.map((c) => c.label)).toEqual(["Northwind"]);
	});

	it("leaves the round exactly as it was", () => {
		// No task, no stop: a phase with nothing in it is a place on the map, not
		// something to be walked past. The hub counts what it always counted.
		const tree = buildTree([NOTE], OVER_NOTE);
		expect(tree.root.shownTaskCount).toBe(4);

		const layout = layoutWheel(tree);
		const stops = buildDetents(layout).filter((detent) => detent.turnStop);
		expect(stops).toHaveLength(4);
	});

	it("gives an empty heading a line to be edited at", () => {
		// It is a real heading in a real note, so it can be renamed, moved, and
		// have a task put in it — the same as any other.
		const tree = buildTree([NOTE], OVER_NOTE);
		const fase4 = tree.root.children.find((c) => c.label.startsWith("Fase 4"));
		expect(fase4?.source?.path).toBe(NOTE.path);
		expect(fase4?.source?.raw).toBe("## Fase 4 - Opdrachten");
	});

	it("holds a heading's identity when its first task arrives", () => {
		// The same containers build both, so a phase that gains work keeps the
		// node it already had — and with it its seen flag and folded state.
		const empty = buildTree([NOTE], OVER_NOTE);
		const filled = buildTree(
			[{ ...NOTE, content: CRM.replace("## Fase 4 - Opdrachten\n", "## Fase 4 - Opdrachten\n- [ ] iets\n") }],
			OVER_NOTE,
		);

		const before = empty.root.children.find((c) => c.label.startsWith("Fase 4"));
		const after = filled.root.children.find((c) => c.label.startsWith("Fase 4"));
		expect(after?.id).toBe(before?.id);
		expect(after?.shownTaskCount).toBe(1);
	});
});

describe("where the frame does not reach", () => {
	it("changes nothing on a vault wheel", () => {
		// A wedge there is a folder, a tag or a property value — not a written
		// frame. The empty folders of a whole vault would be noise.
		const vault = buildTree([NOTE], DEFAULT_PARSE_OPTIONS);
		expect(vault.root.children.map((c) => c.label)).toEqual(["ActionRequired"]);
	});

	it("leaves out what a skip rule already took out", () => {
		// The reader has said that heading is not work. A rule means the same on
		// every wheel, so it does not come back as an empty wedge instead
		// (eigenaarsbesluit 29 aug 2026).
		const withChecklist: NoteInput = {
			path: NOTE.path,
			content: `## Fase 0 - Target\n- [ ] a\n\n## Acceptatiecriteria\n- [ ] niet mijn werk\n`,
		};
		const tree = buildTree([withChecklist], {
			...OVER_NOTE,
			excludeHeadings: ["accepta*"],
		});
		expect(tree.root.children.map((c) => c.label)).toEqual(["Fase 0 - Target"]);
	});

	it("draws the frame of a note that has no tasks at all", () => {
		// The case that would have slipped through: a note whose every heading is
		// empty used to leave the tree before the outline was ever read.
		const bare: NoteInput = {
			path: NOTE.path,
			content: "## Fase 0 - Target\n\n## Fase 1 - Contact\n",
		};
		const tree = buildTree([bare], OVER_NOTE);
		expect(tree.root.children.map((c) => c.label)).toEqual([
			"Fase 0 - Target",
			"Fase 1 - Contact",
		]);
		expect(tree.root.shownTaskCount).toBe(0);
	});

	it("keeps a section wheel to its own subtree", () => {
		const tree = buildTree([NOTE], {
			...DEFAULT_PARSE_OPTIONS,
			scope: {
				kind: "section" as const,
				path: NOTE.path,
				heading: ["Fase 5 - Herhaalopdrachten"],
			},
		});
		expect(tree.root.children.map((c) => c.label)).toEqual(["Northwind"]);
	});
});

describe("a document with far more frame than work", () => {
	/** Forty headings, three tasks — the shape that tests the drawing budget. */
	const WIDE: NoteInput = {
		path: "N.md",
		content: Array.from({ length: 40 }, (_, i) =>
			i < 3 ? `## H${i}\n- [ ] task ${i}` : `## H${i}`,
		).join("\n\n"),
	};
	const OVER_WIDE = {
		...DEFAULT_PARSE_OPTIONS,
		scope: { kind: "note" as const, path: WIDE.path },
	};

	it("draws all forty wedges, because the wedge ring is the map", () => {
		// `selectVisible` exempts the wedge ring from the budget by design —
		// "the domain ring is the map, and a map with a fold in it is no map".
		// So this is the existing regime, not a new one.
		const tree = buildTree([WIDE], OVER_WIDE);
		expect(tree.root.children).toHaveLength(40);

		const layout = layoutWheel(tree, { visibleBudget: 12 });
		expect(layout.budgets).toHaveLength(40);
	});

	it("still walks only the three tasks", () => {
		const layout = layoutWheel(buildTree([WIDE], OVER_WIDE), {
			visibleBudget: 12,
		});
		expect(buildDetents(layout).filter((d) => d.turnStop)).toHaveLength(3);
	});

	it("never marks an empty heading as been-round", () => {
		// A container counts as covered when everything of the round below it is
		// — which for a container holding nothing would be vacuously true, and
		// would paint an untouched phase as reviewed. `covered` already refuses
		// that on `shownTaskCount === 0`; this holds it there.
		const layout = layoutWheel(buildTree([WIDE], OVER_WIDE));
		const empty = layout.nodes.find(
			(laid) => laid.depth === 1 && laid.node.shownTaskCount === 0,
		);
		expect(empty).toBeDefined();
		expect(sweepSpans(layout, new Set<string>())).toHaveLength(0);
	});
});
