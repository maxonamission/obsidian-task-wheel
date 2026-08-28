import { describe, expect, it, vi } from "vitest";
import { WheelController, type DomRegistrar } from "../view/wheel-controller";
import type { Detent } from "../layout/detents";
import type { WheelRenderer } from "../view/render-wheel";

/**
 * A gesture the wheel takes does not travel on (BC_E3_S74).
 *
 * `preventDefault` was there from the start and stops the *browser* scrolling.
 * It says nothing to a listener further up the tree, and on a phone that
 * listener is Obsidian's own: dragging near an edge slid a sidebar in and
 * dragging down pulled the command panel open, while the wheel turned
 * underneath (eigenaar, 28 aug 2026).
 *
 * These tests dispatch at the controller the way a phone does and check what
 * came back — the controller takes its surface and its registrar as options,
 * so the whole gesture path is reachable without a browser.
 */

/** A surface that hands back the handlers instead of a real DOM. */
function surface(): {
	el: HTMLElement;
	register: DomRegistrar;
	fire: (type: string, event: unknown) => void;
} {
	const handlers = new Map<string, Array<(event: unknown) => void>>();

	// Enough of a document for the settle to run: the controller asks the
	// window whether the reader wants motion reduced before it coasts.
	const el = {
		setPointerCapture: () => undefined,
		releasePointerCapture: () => undefined,
		focus: () => undefined,
		ownerDocument: {
			defaultView: {
				matchMedia: () => ({ matches: false }),
				requestAnimationFrame: () => 1,
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
	};
}

/** Just enough drawing for the controller to find a centre and turn. */
function renderer(): WheelRenderer {
	return {
		element: {
			getBoundingClientRect: () => ({ width: 400, height: 400 }),
		},
		hubOnScreen: () => ({ x: 200, y: 200 }),
		// A drawing 150px across, centred on the hub: inside is the wheel,
		// beyond it is the empty corner of the pane.
		withinRim: (x: number, y: number) => Math.hypot(x - 200, y - 200) <= 150,
		setRotation: () => undefined,
		setZoom: () => undefined,
		setFocus: () => undefined,
		setSweep: () => undefined,
		watchPlacement: () => undefined,
		reportPlacement: () => undefined,
	} as unknown as WheelRenderer;
}

const DETENTS: Detent[] = [
	{ id: "a", rotation: 0, angle: 0, depth: 1, turnStop: true },
	{ id: "b", rotation: -30, angle: 30, depth: 1, turnStop: true },
	{ id: "c", rotation: -60, angle: 60, depth: 1, turnStop: true },
] as unknown as Detent[];

/** One finger, as a phone reports it. */
function touch(x: number, y: number, time = 0): Record<string, unknown> {
	const one = { identifier: 1, clientX: x, clientY: y };
	return {
		touches: [one],
		changedTouches: [one],
		timeStamp: time,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
}

function controller(): ReturnType<typeof surface> {
	const host = surface();
	const wheel = new WheelController({
		surface: host.el,
		register: host.register,
		onFocus: () => undefined,
	});
	wheel.adopt(renderer(), DETENTS, null);
	return host;
}

/** A wheel that watches the side panels, and a hand on the panels' state. */
function withPanels(): {
	host: ReturnType<typeof surface>;
	state: { now: string };
	restored: string[];
} {
	const host = surface();
	const state = { now: "shut/shut" };
	const restored: string[] = [];

	const wheel = new WheelController({
		surface: host.el,
		register: host.register,
		onFocus: () => undefined,
		panels: () => state.now,
		restorePanels: (was) => {
			restored.push(was);
			state.now = was;
		},
	});
	wheel.adopt(renderer(), DETENTS, null);
	return { host, state, restored };
}

describe("a drag the wheel takes", () => {
	it("does not travel on to whatever is listening above it", () => {
		const host = controller();

		// Down near the left edge, well off the hub so the drag has an angle —
		// which on a phone is also exactly where the sidebar gesture lives.
		const down = touch(40, 200, 0);
		host.fire("touchstart", down);
		expect(down.preventDefault).toHaveBeenCalled();
		expect(down.stopPropagation).toHaveBeenCalled();

		const move = touch(60, 260, 16);
		host.fire("touchmove", move);
		expect(move.preventDefault).toHaveBeenCalled();
		expect(move.stopPropagation).toHaveBeenCalled();

		const up = touch(60, 260, 32);
		host.fire("touchend", up);
		expect(up.stopPropagation).toHaveBeenCalled();
	});

	it("holds a downward drag too, not only a sideways one", () => {
		// The reader had learned to drag upwards, away from the panels. Zoomed
		// in that habit is unavailable — left and right are the only directions
		// that turn — so the fix cannot be direction-dependent.
		const host = controller();

		host.fire("touchstart", touch(200, 60, 0));
		const down = touch(260, 340, 16);
		host.fire("touchmove", down);
		expect(down.stopPropagation).toHaveBeenCalled();
	});

	it("holds a pinch as well, both ends of it", () => {
		const host = controller();
		const two = {
			touches: [
				{ identifier: 1, clientX: 100, clientY: 200 },
				{ identifier: 2, clientX: 300, clientY: 200 },
			],
			changedTouches: [{ identifier: 1, clientX: 100, clientY: 200 }],
			timeStamp: 0,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
		host.fire("touchstart", two);
		expect(two.stopPropagation).toHaveBeenCalled();

		const wider = { ...two, preventDefault: vi.fn(), stopPropagation: vi.fn() };
		host.fire("touchmove", wider);
		expect(wider.stopPropagation).toHaveBeenCalled();
	});
});

describe("a gesture the wheel does not take", () => {
	it("is left alone, so whatever else wants it still gets it", () => {
		const host = surface();
		const wheel = new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: () => undefined,
		});
		// No `adopt`: nothing to turn to, so this touch is none of our business.
		void wheel;

		const stray = touch(40, 200, 0);
		host.fire("touchstart", stray);
		expect(stray.preventDefault).not.toHaveBeenCalled();
		expect(stray.stopPropagation).not.toHaveBeenCalled();
	});
});

describe("the second door: pointer events from a finger", () => {
	function pointer(
		type: string,
		x: number,
		y: number,
		time = 0,
	): Record<string, unknown> {
		return {
			pointerId: 1,
			pointerType: type,
			button: 0,
			clientX: x,
			clientY: y,
			timeStamp: time,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		};
	}

	it("holds a finger back, because the device chooses the door, not us", () => {
		const host = controller();

		const down = pointer("touch", 40, 200, 0);
		host.fire("pointerdown", down);
		expect(down.stopPropagation).toHaveBeenCalled();

		const move = pointer("touch", 60, 260, 16);
		host.fire("pointermove", move);
		expect(move.stopPropagation).toHaveBeenCalled();
	});

	it("lets a mouse through, which has no sidebar gesture to trigger", () => {
		const host = controller();

		const down = pointer("mouse", 40, 200, 0);
		host.fire("pointerdown", down);
		expect(down.stopPropagation).not.toHaveBeenCalled();

		const move = pointer("mouse", 60, 260, 16);
		host.fire("pointermove", move);
		expect(move.stopPropagation).not.toHaveBeenCalled();
	});
});


/**
 * Putting back a panel that opened under a turning finger (BC_E3_S76).
 *
 * The measurement settled what no amount of reading the code could: on a
 * quick turn the wheel receives the whole gesture — a hundred moves, no
 * cancel — *and* Obsidian's own recogniser opens a side panel from the same
 * touches. Its listener is not downstream of ours, so nothing we do to the
 * event reaches it. `115px in 100ms … panels shut/shut → shut/open` against
 * `0px in 100ms` on the turn that went fine (eigenaarstraces, 28 aug 2026).
 *
 * So the wheel repairs the effect instead of fighting for the event, and
 * these tests hold the boundary that makes that defensible.
 */
describe("a panel that opens under a turning finger", () => {
	it("is put back, and while the finger is still down", () => {
		const { host, state, restored } = withPanels();

		host.fire("touchstart", touch(200, 60, 0));
		// Obsidian's recogniser makes up its mind a few moves in.
		host.fire("touchmove", touch(220, 90, 16));
		state.now = "shut/open";
		host.fire("touchmove", touch(240, 120, 32));

		expect(restored).toEqual(["shut/shut"]);
		expect(state.now).toBe("shut/shut");
	});

	it("is put back when the recogniser only decides on release", () => {
		const { host, state, restored } = withPanels();

		host.fire("touchstart", touch(200, 60, 0));
		host.fire("touchmove", touch(220, 90, 16));
		state.now = "open/shut";
		host.fire("touchend", touch(220, 90, 32));

		expect(restored).toEqual(["shut/shut"]);
	});

	it("leaves a panel the reader already had open alone", () => {
		// Restoring "the state the finger found" and not "shut" is the whole
		// difference between repairing a side effect and imposing a layout.
		const { host, state, restored } = withPanels();
		state.now = "open/shut";

		host.fire("touchstart", touch(200, 60, 0));
		host.fire("touchmove", touch(220, 90, 16));
		host.fire("touchend", touch(220, 90, 32));

		expect(restored).toEqual([]);
		expect(state.now).toBe("open/shut");
	});

	it("does nothing when the wheel is not holding the gesture", () => {
		// No `adopt`, so no drag: a swipe that starts anywhere the wheel does
		// not own still opens whatever it opens.
		const host = surface();
		const state = { now: "shut/shut" };
		const restored: string[] = [];
		new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: () => undefined,
			panels: () => state.now,
			restorePanels: (was) => restored.push(was),
		});

		host.fire("touchstart", touch(200, 60, 0));
		state.now = "shut/open";
		host.fire("touchmove", touch(220, 90, 16));

		expect(restored).toEqual([]);
		expect(state.now).toBe("shut/open");
	});
});


describe("beside the drawing, the panels are Obsidian's", () => {
	it("leaves a panel alone when the finger went down off the wheel", () => {
		// The canvas fills the pane, so "on the wheel" and "on the canvas" are
		// not the same thing. Repairing a panel in the empty corner would take
		// away the only deliberate way left to open one (eigenaar, 28 aug 2026).
		const { host, state, restored } = withPanels();

		// 380,380 is well outside the 150px rim around the hub at 200,200.
		host.fire("touchstart", touch(380, 380, 0));
		state.now = "open/shut";
		host.fire("touchmove", touch(360, 340, 16));
		host.fire("touchend", touch(360, 340, 32));

		expect(restored).toEqual([]);
		expect(state.now).toBe("open/shut");
	});

	it("still turns the wheel from there — the whole canvas is the handle", () => {
		const host = controller();

		const down = touch(380, 380, 0);
		host.fire("touchstart", down);
		expect(down.preventDefault).toHaveBeenCalled();
		expect(down.stopPropagation).toHaveBeenCalled();
	});

	it("puts it back when the finger did go down on the wheel", () => {
		const { host, state, restored } = withPanels();

		host.fire("touchstart", touch(200, 120, 0));
		state.now = "shut/open";
		host.fire("touchmove", touch(240, 140, 16));

		expect(restored).toEqual(["shut/shut"]);
	});
});
