import { describe, expect, it, vi } from "vitest";
import { WheelController, type DomRegistrar } from "../view/wheel-controller";
import type { Detent } from "../layout/detents";
import type { WheelRenderer } from "../view/render-wheel";

/**
 * A step with the keys lands once (BC_E3_S104), and Backspace steps out
 * (BC_E3_S103).
 *
 * The turn itself is not in question — the wheel should still *turn* to where
 * you sent it. What was wrong is what it said on the way: every frame reported
 * the nearest stop, so the focus ring walked across every branch between here
 * and there, and then moved once more when the fisheye re-opened at the end.
 * Two of those three positions were never asked for.
 *
 * A frame clock is the whole trick here: the harness holds the animation
 * callbacks and hands out timestamps, so a tween can be driven from beginning
 * to end without a browser and without waiting.
 */

interface Host {
	el: HTMLElement;
	register: DomRegistrar;
	fire: (type: string, event: unknown) => void;
	/** Run the animation to its end. */
	runFrames: (until?: number) => void;
}

function surface(): Host {
	const handlers = new Map<string, Array<(event: unknown) => void>>();
	let frames: Array<(time: number) => void> = [];

	const el = {
		setPointerCapture: () => undefined,
		releasePointerCapture: () => undefined,
		focus: () => undefined,
		ownerDocument: {
			defaultView: {
				// Not reduced: with motion reduced the wheel snaps instantly and
				// there is no tween to have an opinion about.
				matchMedia: () => ({ matches: false }),
				requestAnimationFrame: (fn: (time: number) => void) => {
					frames.push(fn);
					return frames.length;
				},
				cancelAnimationFrame: () => undefined,
			},
		},
	} as unknown as HTMLElement;

	const register = ((_el, type, handler) => {
		const list = handlers.get(type) ?? [];
		list.push(handler as (event: unknown) => void);
		handlers.set(type, list);
	}) as DomRegistrar;

	return {
		el,
		register,
		fire: (type, event) => {
			for (const handler of handlers.get(type) ?? []) handler(event);
		},
		runFrames: (until = 4000) => {
			// Timestamps far enough apart that the tween is over within a few
			// frames, but not in one: the middle is the part under test.
			for (let time = 0; time <= until && frames.length > 0; time += 60) {
				const due = frames;
				frames = [];
				for (const frame of due) frame(time);
			}
		},
	};
}

function renderer(): WheelRenderer {
	return {
		element: { getBoundingClientRect: () => ({ width: 400, height: 400 }) },
		hubOnScreen: () => ({ x: 200, y: 200 }),
		withinRim: () => true,
		setRotation: () => undefined,
		setZoom: () => undefined,
		setFocus: () => undefined,
		setSweep: () => undefined,
		watchPlacement: () => undefined,
		reportPlacement: () => undefined,
	} as unknown as WheelRenderer;
}

/** Eight stops spread round the circle, so a jump has plenty to pass. */
const DETENTS: Detent[] = Array.from({ length: 8 }, (_, at) => ({
	index: at,
	id: "abcdefgh"[at],
	rotation: -45 * at,
	angle: 45 * at,
	depth: 1,
	turnStop: true,
})) as unknown as Detent[];

function press(key: string, mod = false): Record<string, unknown> {
	return {
		key,
		shiftKey: false,
		altKey: false,
		ctrlKey: mod,
		metaKey: false,
		preventDefault: vi.fn(),
	};
}

function wheel(
	options: { onOut?: () => boolean; onOpenNote?: () => boolean } = {},
): {
	host: Host;
	controller: WheelController;
	focused: string[];
	settled: string[];
	order: string[];
	opened: string[];
} {
	const host = surface();
	const focused: string[] = [];
	const settled: string[] = [];
	const order: string[] = [];
	const opened: string[] = [];

	const controller = new WheelController({
		surface: host.el,
		register: host.register,
		onFocus: (detent) => {
			focused.push(detent?.id ?? "none");
			order.push(`focus:${detent?.id ?? "none"}`);
		},
		onSettle: (detent) => {
			settled.push(detent?.id ?? "none");
			order.push(`settle:${detent?.id ?? "none"}`);
		},
		onActivate: (id) => opened.push(id),
		...options,
	});
	controller.adopt(renderer(), DETENTS, null);

	// The adopt above reports where the round starts; the tests below are about
	// what happens next.
	focused.length = 0;
	order.length = 0;

	return { host, controller, focused, settled, order, opened };
}

describe("a step to a named stop", () => {
	it("names that stop and nothing it passed on the way", () => {
		const w = wheel();

		// Five stops round the circle: plenty of scenery in between.
		expect(w.controller.goTo("f")).toBe(true);
		w.host.runFrames();

		expect(w.focused).toEqual(["f"]);
	});

	it("lays out where it landed before marking it", () => {
		// The order is the fix. Re-opening the fisheye is what moves the item
		// into its real place; marking it first put the ring on the item as the
		// *old* fisheye drew it, and moved it a frame later.
		const w = wheel();

		w.controller.goTo("d");
		w.host.runFrames();

		expect(w.order).toEqual(["settle:d", "focus:d"]);
	});

	it("still reports the way round when the turn was not a jump", () => {
		// A drag settles through the same tween, and there the card *should*
		// follow what passes under the wedge. `step` without the quiet flag is
		// that path.
		const w = wheel();

		w.controller.step(4);
		w.host.runFrames();

		expect(w.focused.length).toBeGreaterThan(1);
		expect(w.focused[w.focused.length - 1]).toBe("e");
	});

	it("keeps every arrow and jump key quiet", () => {
		for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
			const w = wheel();
			w.host.fire("keydown", press(key));
			w.host.runFrames();

			// At most the one stop it aimed at — never a trail.
			expect(w.focused.length, `${key} reported ${w.focused.join(", ")}`).toBeLessThan(2);
		}
	});
});

describe("backspace", () => {
	it("steps out, and takes the key when it does", () => {
		const out = vi.fn(() => true);
		const w = wheel({ onOut: out });

		const event = press("Backspace");
		w.host.fire("keydown", event);

		expect(out).toHaveBeenCalled();
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it("leaves the key alone when there is nowhere wider", () => {
		// The vault wheel. A key that swallows itself to do nothing is worse
		// than one that never claimed the press: Obsidian's own Backspace still
		// belongs to whoever else wants it.
		const w = wheel({ onOut: () => false });

		const event = press("Backspace");
		w.host.fire("keydown", event);

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it("does nothing at all on a wheel that was handed no way out", () => {
		const w = wheel();

		const event = press("Backspace");
		w.host.fire("keydown", event);

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it("still works on a wheel with nothing on it", () => {
		// The trap: a heading with no tasks under it is the easiest wheel to
		// open by accident, and a wheel with nothing to draw clears its stops.
		// Every other key rightly gives up at that point — this one must not,
		// because it is the way off (eigenaar, 2 sep 2026).
		const out = vi.fn(() => true);
		const host = surface();
		const controller = new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: () => undefined,
			onOut: out,
		});
		controller.adopt(renderer(), [], null);

		const event = press("Backspace");
		host.fire("keydown", event);

		expect(out).toHaveBeenCalled();
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it("leaves every other key alone on an empty wheel", () => {
		// The guard is still right for everything that needs a stop to act on.
		const opened: string[] = [];
		const host = surface();
		const controller = new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: () => undefined,
			onActivate: (id) => opened.push(id),
			onToggle: () => opened.push("fold"),
		});
		controller.adopt(renderer(), [], null);

		for (const key of ["Enter", " ", "ArrowLeft", "ArrowRight", "Home", "End"]) {
			const event = press(key);
			host.fire("keydown", event);
			expect(event.preventDefault, key).not.toHaveBeenCalled();
		}
		expect(opened).toEqual([]);
	});
});

describe("control with enter", () => {
	it("opens the note the item lives in, and takes the key", () => {
		// The pair: plain Enter opens what the item *is*, the modifier opens
		// where it *lives*. Both were reachable by mouse; only one had a key.
		const note = vi.fn(() => true);
		const w = wheel({ onOpenNote: note });

		const event = press("Enter", true);
		w.host.fire("keydown", event);

		expect(note).toHaveBeenCalled();
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it("does not also activate the item", () => {
		const w = wheel({ onOpenNote: () => true });
		w.host.fire("keydown", press("Enter", true));

		expect(w.opened).toEqual([]);
	});

	it("leaves the key alone on an item that lives nowhere", () => {
		// A folder wedge is not written down in any note. A key that swallows
		// itself to do nothing is worse than one that never took the press.
		const w = wheel({ onOpenNote: () => false });

		const event = press("Enter", true);
		w.host.fire("keydown", event);

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it("still activates on plain enter", () => {
		const w = wheel({ onOpenNote: () => true });
		w.host.fire("keydown", press("Enter"));

		expect(w.opened).toEqual(["a"]);
	});
});
