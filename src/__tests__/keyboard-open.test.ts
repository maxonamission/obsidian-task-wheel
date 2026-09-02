import { describe, expect, it, vi } from "vitest";
import { WheelController, type DomRegistrar } from "../view/wheel-controller";
import type { Detent } from "../layout/detents";
import type { WheelRenderer } from "../view/render-wheel";

/**
 * Enter opens a wheel over the stop you are on (BC_E3_S99).
 *
 * It used to fold, exactly as space does. Two keys doing one thing is a waste
 * on its own, but the real cost was the other end: the move a mouse has —
 * double-click an item, get a wheel over just that — had no key at all, so on
 * a keyboard the wheel was one move poorer than with a mouse (eigenaar,
 * 2 sep 2026).
 *
 * The same harness as `gesture-escape.test.ts`: the controller takes its
 * surface and its registrar as options, so the whole key path is reachable
 * without a browser.
 */

function surface(): {
	el: HTMLElement;
	register: DomRegistrar;
	fire: (type: string, event: unknown) => void;
} {
	const handlers = new Map<string, Array<(event: unknown) => void>>();

	const el = {
		setPointerCapture: () => undefined,
		releasePointerCapture: () => undefined,
		focus: () => undefined,
		ownerDocument: {
			defaultView: {
				matchMedia: () => ({ matches: true }),
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

/**
 * `index` is not decoration here: the controller re-derives which stop it is
 * on from the detent it last reported (`report`), so a fixture that leaves it
 * out puts the controller on stop `undefined` — and then Enter looks broken
 * when only the fixture is.
 */
const DETENTS: Detent[] = [
	{ index: 0, id: "a", rotation: 0, angle: 0, depth: 1, turnStop: true },
	{ index: 1, id: "b", rotation: -30, angle: 30, depth: 1, turnStop: true },
	{ index: 2, id: "c", rotation: -60, angle: 60, depth: 1, turnStop: true },
] as unknown as Detent[];

function press(key: string): Record<string, unknown> {
	return {
		key,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		preventDefault: vi.fn(),
	};
}

function wheel(startAt: string | null = null): {
	host: ReturnType<typeof surface>;
	opened: string[];
	folded: number;
} {
	const host = surface();
	const opened: string[] = [];
	const seen = { folded: 0 };

	const controller = new WheelController({
		surface: host.el,
		register: host.register,
		onFocus: () => undefined,
		onActivate: (id) => opened.push(id),
		onToggle: () => {
			seen.folded += 1;
		},
	});
	controller.adopt(renderer(), DETENTS, startAt);

	return {
		host,
		opened,
		get folded() {
			return seen.folded;
		},
	};
}

describe("enter, on a keyboard", () => {
	it("opens a wheel over the stop you are on", () => {
		const w = wheel();
		const event = press("Enter");
		w.host.fire("keydown", event);

		expect(w.opened).toEqual(["a"]);
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it("names the stop it is on, not the one the round started at", () => {
		// The whole point is "the node I am standing on". A key that always
		// opened the first stop would look right until you turned once.
		const w = wheel("c");
		w.host.fire("keydown", press("Enter"));

		expect(w.opened).toEqual(["c"]);
	});

	it("no longer folds — that is space's job, and space keeps it", () => {
		const w = wheel();

		w.host.fire("keydown", press("Enter"));
		expect(w.folded).toBe(0);

		w.host.fire("keydown", press(" "));
		expect(w.folded).toBe(1);
		expect(w.opened).toEqual(["a"]);
	});

	it("does nothing at all on a wheel with no stops", () => {
		const host = surface();
		const opened: string[] = [];
		const controller = new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: () => undefined,
			onActivate: (id) => opened.push(id),
		});
		controller.adopt(renderer(), [], null);

		const event = press("Enter");
		host.fire("keydown", event);

		expect(opened).toEqual([]);
		// Nothing happened, so the key is not ours to swallow.
		expect(event.preventDefault).not.toHaveBeenCalled();
	});
});
