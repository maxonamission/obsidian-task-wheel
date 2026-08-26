import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { layoutWheel } from "../layout/radial";
import { buildDetents } from "../layout/detents";
import { prune, sweepProgress, sweepSpans } from "../layout/sweep";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

const NOTES: NoteInput[] = [
	{ path: "Werk/Plan.md", content: "- [ ] Een\n- [ ] Twee\n- [ ] Drie\n" },
	{ path: "Gezin/Weekend.md", content: "- [ ] Vier\n- [ ] Vijf\n" },
	{ path: "Huis/Klussen.md", content: "- [ ] Zes\n" },
];

const tree = buildTree(NOTES, DEFAULT_PARSE_OPTIONS);
const layout = layoutWheel(tree);
const stops = layout.nodes.filter((laid) => laid.depth > 0);

describe("sweepProgress", () => {
	it("starts at nothing", () => {
		const progress = sweepProgress(tree, new Set());
		expect(progress.seen).toBe(0);
		expect(progress.total).toBe(stops.length);
		expect(progress.complete).toBe(false);
	});

	it("counts what has been under the wedge", () => {
		const seen = new Set([stops[0].id, stops[1].id]);
		expect(sweepProgress(tree, seen).seen).toBe(2);
	});

	it("does not count the hub, which is not a stop", () => {
		const seen = new Set([layout.nodes[0].id]);
		expect(sweepProgress(tree, seen).seen).toBe(0);
	});

	it("is complete only when every stop has been passed", () => {
		const almost = new Set(stops.slice(1).map((laid) => laid.id));
		expect(sweepProgress(tree, almost).complete).toBe(false);

		const all = new Set(stops.map((laid) => laid.id));
		expect(sweepProgress(tree, all).complete).toBe(true);
	});

	it("agrees with the number of stops the wheel offers", () => {
		// Everything in the tree, not everything currently drawn: the round is
		// about the vault, and turning towards a stump opens it.
		expect(sweepProgress(tree, new Set()).total).toBe(tree.byId.size - 1);
	});
});

describe("sweepSpans", () => {
	it("draws nothing before the round begins", () => {
		expect(sweepSpans(layout, new Set())).toEqual([]);
	});

	it("draws one arc per item passed", () => {
		const spans = sweepSpans(layout, new Set([stops[0].id]));
		expect(spans).toHaveLength(1);
		expect(spans[0].end - spans[0].start).toBeCloseTo(stops[0].span, 6);
	});

	it("merges neighbours into one band rather than a row of ticks", () => {
		const domain = layout.nodes.find((laid) => laid.depth === 1);
		const family = layout.nodes.filter(
			(laid) => laid.depth > 0 && laid.domainIndex === domain?.domainIndex,
		);

		const spans = sweepSpans(layout, new Set(family.map((laid) => laid.id)));
		expect(spans.length).toBeLessThan(family.length);
	});

	it("never claims more of the circle than the items cover", () => {
		const all = new Set(stops.map((laid) => laid.id));
		const covered = sweepSpans(layout, all).reduce(
			(sum, span) => sum + (span.end - span.start),
			0,
		);
		expect(covered).toBeLessThanOrEqual(360.001);
	});

	it("closes the seam at twelve o'clock into one arc", () => {
		const all = new Set(stops.map((laid) => laid.id));
		const spans = sweepSpans(layout, all);

		// Whatever else is true, a full round may not read as two arcs meeting at
		// the top — that is the one join a circle does not have.
		const touchesStart = spans.some((span) => span.start <= 0.01);
		const touchesEnd = spans.some((span) => span.end >= 359.99);
		expect(touchesStart && touchesEnd).toBe(false);
	});

	it("keeps the arcs in order and apart", () => {
		const some = new Set([stops[0].id, stops[stops.length - 1].id]);
		const spans = sweepSpans(layout, some);

		for (let i = 1; i < spans.length; i++) {
			expect(spans[i].start).toBeGreaterThan(spans[i - 1].end);
		}
	});
});

describe("prune", () => {
	it("forgets an item the vault no longer holds", () => {
		const kept = prune(tree, [stops[0].id, "een-taak-die-is-afgevinkt"]);
		expect([...kept]).toEqual([stops[0].id]);
	});

	it("lets a round complete after the last item was ticked off", () => {
		// The round is otherwise finished, and a ghost id would keep it open for
		// ever — which is the bug this exists to prevent.
		const withGhost = [...stops.map((laid) => laid.id), "weg"];
		expect(sweepProgress(tree, prune(tree, withGhost)).complete).toBe(true);
	});

	it("keeps the mark on an item that is folded away rather than gone", () => {
		// The two are wildly different sets: a vault of twenty thousand nodes is
		// drawn as a couple of hundred and the rest sit behind stumps. Trimming
		// to what is *drawn* made a round forget behind itself as it turned, so
		// the circle could never be closed (measured 18 aug 2026).
		const many: NoteInput[] = [];
		for (let i = 0; i < 200; i++) {
			many.push({
				path: `Domein${i % 6}/Map${i % 20}/Notitie ${i}.md`,
				content: Array.from({ length: 4 }, (_, t) => `- [ ] Taak ${i}-${t}`).join("\n"),
			});
		}
		const big = buildTree(many, DEFAULT_PARSE_OPTIONS);
		const drawn = layoutWheel(big);

		const folded = [...big.byId.keys()].filter(
			(id) => !drawn.byId.has(id) && id !== big.root.id,
		);
		expect(folded.length).toBeGreaterThan(0);

		expect(prune(big, folded).size).toBe(folded.length);
	});
});

describe("een hele ronde op een wiel dat groter is dan de tekening", () => {
	// Dit is de belofte van het instrument, en hij was kapot: de vlaggen werden
	// gesnoeid tegen wat er op dat moment getekend werd, dus een ronde vergat
	// achter zich terwijl je draaide. Alle stops langsgaan eindigde met een deel
	// gemarkeerd en de cirkel kwam nooit rond (gemeten 18 aug 2026).
	const many: NoteInput[] = [];
	for (let i = 0; i < 200; i++) {
		many.push({
			path: `Domein${i % 6}/Map${i % 20}/Notitie ${i}.md`,
			content: Array.from({ length: 4 }, (_, t) => `- [ ] Taak ${i}-${t}`).join("\n"),
		});
	}
	const big = buildTree(many, DEFAULT_PARSE_OPTIONS);

	it("tekent veel minder dan de boom houdt", () => {
		// Anders bewijst de test hieronder niets.
		expect(layoutWheel(big).nodes.length).toBeLessThan(big.byId.size / 2);
	});

	it("houdt elke vlag vast terwijl je draait", () => {
		let seen = new Set<string>();

		for (const stop of buildDetents(layoutWheel(big))) {
			// Wat de view doet bij elke stop: opnieuw uitleggen rond de nieuwe
			// focus, de vlag zetten, en de verzameling snoeien.
			layoutWheel(big, { focusId: stop.id });
			seen.add(stop.id);
			seen = prune(big, [...seen]);
		}

		const stops = buildDetents(layoutWheel(big));
		expect(seen.size).toBe(stops.length);
	});

	it("en een vlag op iets dat achter een stronk zit blijft staan", () => {
		const drawn = layoutWheel(big);
		const folded = [...big.byId.keys()].filter(
			(id) => !drawn.byId.has(id) && id !== big.root.id,
		);

		expect(folded.length).toBeGreaterThan(0);
		expect(prune(big, folded).size).toBe(folded.length);
	});
});
