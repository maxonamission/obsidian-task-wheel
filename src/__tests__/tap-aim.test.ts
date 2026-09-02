import { describe, expect, it } from "vitest";
import { WheelController, type DomRegistrar } from "../view/wheel-controller";
import type { Detent } from "../layout/detents";
import type { Target } from "../layout/aim";
import type { WheelRenderer } from "../view/render-wheel";

/**
 * A tap on a branch's own word does not open the task under it (BC_E3_S117).
 *
 * The unit test next door proves the rule; this one proves the wiring — that a
 * tap asks the drawing what it has drawn and measures it, rather than taking
 * whatever element happened to be under the finger.
 *
 * The shapes below are the owner's phone, off his screenshot: a heading with
 * its word 18 pixels above its dot, and the first task under it 45 pixels out,
 * whose tap disc reaches back over that word.
 */

const DETENTS: Detent[] = [
	{ index: 0, id: "elsewhere", rotation: 0, angle: 0, depth: 1, turnStop: true },
	{ index: 1, id: "heading", rotation: -120, angle: 120, depth: 2, turnStop: true },
	{ index: 2, id: "task", rotation: -160, angle: 160, depth: 3, turnStop: true },
] as unknown as Detent[];

const disc = (x: number, y: number, r = 18) => ({
	left: x - r,
	top: y - r,
	right: x + r,
	bottom: y + r,
});

const TARGETS: Target[] = [
	{ id: "elsewhere", boxes: [disc(300, 300)] },
	{
		id: "heading",
		boxes: [disc(100, 200), { left: 40, top: 170, right: 160, bottom: 188 }],
	},
	{ id: "task", boxes: [disc(100, 155)] },
];

interface Host {
	el: HTMLElement;
	register: DomRegistrar;
	fire: (type: string, event: unknown) => void;
	runFrames: () => void;
}

function surface(): Host {
	const handlers = new Map<string, Array<(event: unknown) => void>>();
	let frames: Array<(time: number) => void> = [];

	const el = {
		setPointerCapture: () => undefined,
		releasePointerCapture: () => undefined,
		focus: () => undefined,
		ownerDocument: {
			// Deliberately the wrong answer: what lies under the finger is the
			// task, and it is what the wheel used to go by.
			elementFromPoint: () => ({
				closest: () => ({ getAttribute: () => "task" }),
			}),
			defaultView: {
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
		runFrames: () => {
			for (let time = 0; time <= 4000 && frames.length > 0; time += 60) {
				const due = frames;
				frames = [];
				for (const frame of due) frame(time);
			}
		},
	};
}

function renderer(targets: Target[]): WheelRenderer {
	return {
		element: { getBoundingClientRect: () => ({ width: 400, height: 400 }) },
		hubOnScreen: () => ({ x: 200, y: 400 }),
		withinRim: () => true,
		targetsOnScreen: () => targets,
		setRotation: () => undefined,
		setZoom: () => undefined,
		setFocus: () => undefined,
		setSweep: () => undefined,
		watchPlacement: () => undefined,
		reportPlacement: () => undefined,
	} as unknown as WheelRenderer;
}

/** A tap: down and up at the same spot, within the slop and the time. */
function tapAt(host: Host, x: number, y: number): void {
	const event = {
		button: 0,
		pointerId: 1,
		pointerType: "touch",
		clientX: x,
		clientY: y,
		timeStamp: 0,
		stopPropagation: () => undefined,
		preventDefault: () => undefined,
	};
	host.fire("pointerdown", event);
	host.fire("pointerup", { ...event, timeStamp: 80 });
}

function wheel(targets: Target[] = TARGETS): { host: Host; landed: string[] } {
	const host = surface();
	const landed: string[] = [];

	const controller = new WheelController({
		surface: host.el,
		register: host.register,
		onFocus: (detent) => landed.push(detent?.id ?? "none"),
	});
	controller.adopt(renderer(targets), DETENTS, null);
	landed.length = 0;

	return { host, landed };
}

describe("a tap on a branch's word", () => {
	it("brings the branch under the wedge, not the task lying over it", () => {
		const w = wheel();
		tapAt(w.host, 100, 179);
		w.host.runFrames();

		expect(w.landed[w.landed.length - 1]).toBe("heading");
	});

	it("still brings the task when the tap was on the task", () => {
		const w = wheel();
		tapAt(w.host, 100, 155);
		w.host.runFrames();

		expect(w.landed[w.landed.length - 1]).toBe("task");
	});

	it("turns nothing at all on a tap in empty space", () => {
		const w = wheel();
		tapAt(w.host, 100, 400);
		w.host.runFrames();

		expect(w.landed).toEqual([]);
	});

	it("falls back to what lies under the finger with nothing drawn", () => {
		// A drawing that has not been laid out measures as nothing, and then the
		// browser's own answer is the only one there is.
		const w = wheel([]);
		tapAt(w.host, 100, 179);
		w.host.runFrames();

		expect(w.landed[w.landed.length - 1]).toBe("task");
	});
});

describe("a tap on the card", () => {
	it("names nothing on the wheel behind it", () => {
		// The card is see-through on purpose, so a drag across it keeps turning
		// the wheel. A tap is not a drag: standing on a heading and tapping the
		// words on the card opened a task inside that branch, because that is
		// what the card was covering (eigenaar, 2 sep 2026).
		const host = surface();
		const landed: string[] = [];

		const controller = new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: (detent) => landed.push(detent?.id ?? "none"),
			// The card lies over the whole of the lower drawing, as it does.
			covered: () => true,
		});
		controller.adopt(renderer(TARGETS), DETENTS, null);
		landed.length = 0;

		// Right on the heading's own word — but through the card.
		tapAt(host, 100, 179);
		host.runFrames();

		expect(landed).toEqual([]);
	});

	it("leaves the wheel itself alone", () => {
		const host = surface();
		const landed: string[] = [];

		const controller = new WheelController({
			surface: host.el,
			register: host.register,
			onFocus: (detent) => landed.push(detent?.id ?? "none"),
			covered: (_x, y) => y > 300,
		});
		controller.adopt(renderer(TARGETS), DETENTS, null);
		landed.length = 0;

		tapAt(host, 100, 179);
		host.runFrames();

		expect(landed[landed.length - 1]).toBe("heading");
	});
});
