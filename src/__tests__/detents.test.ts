import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { layoutWheel } from "../layout/radial";
import {
	acrossRings,
	alongRing,
	approach,
	buildDetents,
	detentAt,
	indexOfId,
	stepIndex,
	stepTurnStop,
	turnStops,
} from "../layout/detents";
import { normaliseAngle } from "../layout/geometry";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";
import { VAULT } from "./fixtures/vault";

const OPTIONS: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeFolders: ["Archief"],
};

function detentsOf(notes: NoteInput[] = VAULT) {
	const layout = layoutWheel(buildTree(notes, OPTIONS));
	return { layout, detents: buildDetents(layout) };
}

describe("buildDetents — one stop per item", () => {
	const { layout, detents } = detentsOf();

	it("gives every visible item exactly one detent", () => {
		const visible = layout.nodes.filter((laid) => laid.depth > 0);
		expect(detents.length).toBe(visible.length);
		expect(new Set(detents.map((d) => d.id)).size).toBe(detents.length);
	});

	it("leaves nothing unreachable", () => {
		const visible = layout.nodes
			.filter((laid) => laid.depth > 0)
			.map((laid) => laid.id);
		const reachable = new Set(detents.map((d) => d.id));
		for (const id of visible) expect(reachable.has(id)).toBe(true);
	});

	it("does not offer a stop for the hub", () => {
		const hub = layout.nodes[0];
		expect(indexOfId(detents, hub.id)).toBe(-1);
	});

	it("numbers its stops from zero, in turn order", () => {
		detents.forEach((detent, index) => expect(detent.index).toBe(index));
	});
});

describe("buildDetents — the rotation each stop asks for", () => {
	const { detents } = detentsOf();

	it("brings its item under the reading wedge", () => {
		for (const detent of detents) {
			const shown = normaliseAngle(detent.angle + detent.rotation);
			// Zero or a whisker under a full turn: both are twelve o'clock.
			const off = Math.min(shown, 360 - shown);
			expect(off).toBeLessThan(1e-6);
		}
	});

	it("stays inside a single turn", () => {
		for (const detent of detents) {
			expect(detent.rotation).toBeGreaterThanOrEqual(0);
			expect(detent.rotation).toBeLessThan(360);
		}
	});

	it("runs in angle order, not in tree order", () => {
		for (let i = 1; i < detents.length; i++) {
			expect(detents[i].angle).toBeGreaterThanOrEqual(detents[i - 1].angle);
		}
	});
});

describe("stepIndex — the ring of stops", () => {
	const { detents } = detentsOf();

	it("wraps at both ends", () => {
		expect(stepIndex(detents, detents.length - 1, 1)).toBe(0);
		expect(stepIndex(detents, 0, -1)).toBe(detents.length - 1);
	});

	it("visits every stop exactly once in a full turn", () => {
		const seen = new Set<number>();
		let index = 0;
		for (let step = 0; step < detents.length; step++) {
			expect(seen.has(index)).toBe(false);
			seen.add(index);
			index = stepIndex(detents, index, 1);
		}
		expect(seen.size).toBe(detents.length);
		expect(index).toBe(0);
	});

	it("survives a step bigger than the ring", () => {
		expect(stepIndex(detents, 0, detents.length + 3)).toBe(3);
		expect(stepIndex(detents, 0, -(detents.length + 3))).toBe(
			detents.length - 3,
		);
	});

	it("has somewhere to go even with no stops at all", () => {
		expect(stepIndex([], 0, 1)).toBe(0);
	});
});

describe("detentAt — where a free turn comes to rest", () => {
	const { detents } = detentsOf();

	it("lands on the stop it is sitting on", () => {
		for (const detent of detents) {
			const hit = detentAt(detents, detent.rotation);
			expect(hit).not.toBeNull();
			// Items that share an angle share a rotation; either answers.
			expect(hit?.rotation).toBeCloseTo(detent.rotation, 9);
		}
	});

	it("never comes to rest between two stops", () => {
		for (let rotation = 0; rotation < 360; rotation += 3.7) {
			const hit = detentAt(detents, rotation);
			expect(hit).not.toBeNull();
			if (hit === null) continue;
			for (const other of detents) {
				const near = Math.abs(angle(rotation, hit.rotation));
				const far = Math.abs(angle(rotation, other.rotation));
				expect(near).toBeLessThanOrEqual(far + 1e-9);
			}
		}
	});

	it("has nothing to land on when the wheel is empty", () => {
		expect(detentAt([], 0)).toBeNull();
	});
});

describe("approach — taking the short way round", () => {
	it("crosses twelve o'clock rather than going all the way back", () => {
		expect(approach(359, 1)).toBeCloseTo(361, 9);
		expect(approach(1, 359)).toBeCloseTo(-1, 9);
	});

	it("stands still when it is already there", () => {
		expect(approach(120, 120)).toBeCloseTo(120, 9);
	});
});

function angle(from: number, to: number): number {
	const raw = normaliseAngle(to - from);
	return raw > 180 ? raw - 360 : raw;
}

describe("walking the tree with the arrow keys", () => {
	const NOTES: NoteInput[] = [
		{ path: "Werk/Plan.md", content: "- [ ] Een\n    - [ ] Een-a\n- [ ] Twee\n" },
		{ path: "Gezin/Weekend.md", content: "- [ ] Drie\n" },
		{ path: "Huis/Klussen.md", content: "- [ ] Vier\n" },
	];
	const layout = layoutWheel(buildTree(NOTES, DEFAULT_PARSE_OPTIONS));
	const detents = buildDetents(layout);

	const at = (id: string): number => indexOfId(detents, id);
	const domains = detents.filter((detent) => detent.depth === 1);

	it("moves sideways within one ring", () => {
		const from = at(domains[0].id);
		const to = alongRing(detents, from, 1);
		expect(detents[to].depth).toBe(1);
		expect(detents[to].id).toBe(domains[1].id);
	});

	it("wraps round the circle rather than stopping at the seam", () => {
		const last = at(domains[domains.length - 1].id);
		expect(detents[alongRing(detents, last, 1)].id).toBe(domains[0].id);

		const first = at(domains[0].id);
		expect(detents[alongRing(detents, first, -1)].id).toBe(
			domains[domains.length - 1].id,
		);
	});

	it("crosses the whole ring, not just one parent's children", () => {
		// Left and right on the first ring is a walk of the domains, which is the
		// move a reader reaches for most.
		const seen = new Set<string>();
		let index = at(domains[0].id);
		for (let i = 0; i < domains.length; i++) {
			seen.add(detents[index].id);
			index = alongRing(detents, index, 1);
		}
		expect(seen.size).toBe(domains.length);
	});

	it("goes out to a child and back in to the parent", () => {
		const domain = at(domains[0].id);
		const child = acrossRings(detents, domain, true);

		expect(detents[child].depth).toBe(2);
		expect(detents[child].parentId).toBe(detents[domain].id);
		expect(acrossRings(detents, child, false)).toBe(domain);
	});

	it("refuses quietly when there is nowhere to go", () => {
		// The first ring hangs off the hub, which is not a stop.
		const domain = at(domains[0].id);
		expect(acrossRings(detents, domain, false)).toBe(domain);

		const leaf = detents.findIndex(
			(detent) => !detents.some((other) => other.parentId === detent.id),
		);
		expect(acrossRings(detents, leaf, true)).toBe(leaf);
	});

	it("leaves the flat turn order alone: it is what a full round is made of", () => {
		// Turning still visits every stop once, in angle order. That is the
		// guarantee the arrows deliberately do not carry.
		const seen = new Set<string>();
		let index = 0;
		for (let i = 0; i < detents.length; i++) {
			seen.add(detents[index].id);
			index = stepIndex(detents, index, 1);
		}
		expect(seen.size).toBe(detents.length);
	});
});

describe("turn stops — waar draaien op landt (BC_E3_S67)", () => {
	const { layout, detents } = detentsOf();

	it("laat draaien nooit op een kop, notitie of map uitkomen", () => {
		// Dit is de klacht die het besluit droeg: bij draaien sprong de focus
		// ook op containers, "waar niets te doen is" (meettabel §5).
		const containers = turnStops(detents).filter(
			(stop) => stop.kind !== "task",
		);
		for (const stop of containers) {
			const laid = layout.byId.get(stop.id);
			// De enige container die stop blijft is een stomp: díe houdt werk
			// vast dat nog niemand heeft gezien.
			expect(laid?.collapsed === true || (laid?.hiddenCount ?? 0) > 0).toBe(true);
		}
	});

	it("laat elke taak van de ronde stop blijven", () => {
		const items = layout.nodes.filter(
			(laid) => laid.depth > 0 && laid.node.kind === "task",
		);
		const stops = new Set(turnStops(detents).map((stop) => stop.id));
		for (const laid of items) expect(stops.has(laid.id)).toBe(true);
	});

	it("bezoekt in één volle draai elke stop precies één keer", () => {
		const stops = turnStops(detents);
		const seen = new Set<string>();
		let index = stops[0].index;

		for (let step = 0; step < stops.length; step++) {
			const here = detents[index];
			expect(seen.has(here.id)).toBe(false);
			seen.add(here.id);
			index = stepTurnStop(detents, index, 1);
		}

		expect(seen.size).toBe(stops.length);
		expect(index).toBe(stops[0].index);
	});

	it("slaat niets over: elke taak komt in die draai langs", () => {
		// De hele belofte van het instrument. De vlakke volgorde deed dit ook,
		// maar zette je onderweg op koppen; deze doet het zonder.
		const stops = turnStops(detents);
		const walked = new Set<string>();
		let index = stops[0].index;
		for (let step = 0; step < stops.length; step++) {
			walked.add(detents[index].id);
			index = stepTurnStop(detents, index, 1);
		}

		const items = layout.nodes.filter(
			(laid) => laid.depth > 0 && laid.node.kind === "task",
		);
		for (const laid of items) expect(walked.has(laid.id)).toBe(true);
	});

	it("vindt vanaf een container de weg terug in de draaivolgorde", () => {
		// De pijltjes mogen op een kop staan; draaien moet daarna gewoon verder
		// kunnen zonder de lezer vast te zetten.
		const container = detents.find((stop) => !stop.turnStop);
		expect(container).toBeDefined();

		const next = stepTurnStop(detents, container?.index ?? 0, 1);
		expect(detents[next].turnStop).toBe(true);
	});

	it("houdt terugdraaien de spiegel van vooruit", () => {
		const stops = turnStops(detents);
		const start = stops[3].index;
		const forward = stepTurnStop(detents, start, 1);
		expect(stepTurnStop(detents, forward, -1)).toBe(start);
	});

	it("laat een wiel zonder enkele taak toch draaien", () => {
		// Liever een wiel dat op een kop stopt dan een wiel dat vastzit.
		const empty = detentsOf([
			{ path: "Werk/Leeg.md", content: "# Kop\n\ngeen taken hier" },
		]);
		const stops = turnStops(empty.detents);
		expect(stops.length).toBe(empty.detents.length);
	});
});
