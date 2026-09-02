import {
	acrossRings,
	alongRing,
	approach,
	type Detent,
	indexOfId,
	nearestTurnStop,
	stepTurnStop,
	turnStops,
} from "../layout/detents";
import { normaliseAngle } from "../layout/geometry";
import {
	coastFrom,
	snapDuration,
	tweenAt,
	type TravelSample,
} from "../layout/momentum";
import { aimedAt } from "../layout/aim";
import { pixelsOf, scrollTurn } from "../layout/scroll";
import { clampZoom, ZOOM_STEP } from "../layout/zoom";
import type { WheelRenderer } from "./render-wheel";

/**
 * Turning the wheel.
 *
 * The rule the design sets is that the wheel **always comes to rest on a
 * detent** (kaderdocument §5). Momentum is allowed, free spinning is not: a
 * flick coasts, but the coast is only used to pick which stop to land on. That
 * is what makes "I have been all the way round" a fact rather than a feeling.
 *
 * All four inputs — drag, wheel, arrow keys, swipe — end in the same two
 * calls: `step` for a discrete move and `settle` for the end of a gesture.
 * Pointer events cover mouse, pen and touch in one path, so swipe on mobile is
 * the same code as drag on desktop.
 */

/** How far a contact may wander and still count as a tap, in pixels. */
const TAP_SLOP = 12;

/** And how long it may rest. Longer than this is a hold, not a tap. */
const TAP_TIME = 600;

/** Two taps closer together than this, on the same item, are one gesture. */
const DOUBLE_TAP = 400;

/**
 * Take this gesture for the wheel — and take it from everyone else too.
 *
 * `preventDefault` tells the *browser* not to scroll. It says nothing to
 * another listener further up the tree, and on a phone that other listener is
 * Obsidian's own: a drag that starts near the left or right edge slides a
 * sidebar in, and a drag downwards pulls the command panel down — both while
 * the wheel is turning underneath them (eigenaar, 28 aug 2026).
 *
 * Zoomed in is where it bites hardest, and for a reason worth writing down:
 * the drawing then fills the pane, so every drag starts near an edge, and
 * left and right are the only directions that still turn the wheel. The
 * habit the reader had built up while zoomed out — drag upwards, away from
 * the panels — is not available there. A workaround that only works in one
 * of the two states is not a workaround.
 *
 * So the wheel stops the event travelling as well. Only once it has actually
 * taken the gesture: a touch the wheel does not use still reaches whatever
 * else wants it.
 */
function own(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

/** How many samples of pointer travel a velocity estimate looks back over. */
const SAMPLE_WINDOW = 5;

/** How long a gesture's opening counts as its opening, in milliseconds. */
const EARLY_WINDOW = 100;

/** Obsidian's `registerDomEvent`, narrowed to what this module needs. */
export type DomRegistrar = <K extends keyof HTMLElementEventMap>(
	el: HTMLElement,
	type: K,
	handler: (event: HTMLElementEventMap[K]) => void,
	options?: AddEventListenerOptions,
) => void;

export interface WheelControllerOptions {
	/** The element that takes focus and receives the gestures. */
	surface: HTMLElement;
	register: DomRegistrar;
	/** Called whenever the item under the reading wedge changes. */
	onFocus: (detent: Detent | null) => void;
	/**
	 * Called when the wheel has come to rest.
	 *
	 * Separate from `onFocus` because they cost different amounts. The focus
	 * changes continuously while a gesture is under way and only redraws a
	 * card; coming to rest is what re-opens the fisheye, which re-lays out the
	 * whole wheel. Doing that on every intermediate frame would be madness.
	 */
	onSettle?: (detent: Detent | null) => void;
	/** Space on the focused item: fold its branch away, or unfold it. */
	onToggle?: () => void;
	/**
	 * One step sideways, answered from the tree rather than from the drawing.
	 *
	 * The controller knows the stops, which are the items that happen to be
	 * drawn; sideways is a move along a **ring**, and a ring is a fact about the
	 * tree. Where the two disagree — on the extra rings the fisheye gives the
	 * branch being read — only the tree can answer, and the answer may be an
	 * item that has to be drawn first. So the view takes the question when it
	 * can, and this falls back to the drawing when it cannot (BC_E3_S93).
	 *
	 * Answers whether it handled the step.
	 */
	onSideways?: (delta: number, other: boolean) => boolean;
	/**
	 * A second tap on the item already under the wedge.
	 *
	 * One tap goes there; a second says "and now show me *this*". Both a
	 * double-click and a double-tap arrive here, because a mouse sends the same
	 * two press-release pairs a finger does — and so does Enter, which is the
	 * same move made from the keyboard on the stop you are already on.
	 */
	onActivate?: (id: string) => void;
	/**
	 * Step out to the wider wheel — the way back from `onActivate`.
	 *
	 * Stepping in had a key and stepping out had only the button in the corner,
	 * which meant reaching for the mouse halfway through a keyboard round
	 * (eigenaar, 2 sep 2026). Deliberately not a setting: a pair you can
	 * configure apart is not a pair any more, and the way out is already a
	 * command, so Obsidian's own key bindings are the place to move it.
	 *
	 * Answers whether there *was* anywhere wider. A wheel over the whole vault
	 * has nowhere to go, and then the key is not ours to take.
	 */
	onOut?: () => boolean;
	/**
	 * Open the note the focused item is written in, at its own line.
	 *
	 * The modifier on `onActivate`: plain Enter opens what the item *is*,
	 * Ctrl/Cmd with it opens where it *lives*. The pair follows the same idiom
	 * Obsidian uses everywhere else — the modifier means "and take me there".
	 *
	 * Answers whether there was a note to open; a wedge has none.
	 */
	onOpenNote?: () => boolean;
	/** The reader closed in on the wheel, or pulled back out. */
	onZoom?: (zoom: number) => void;
	/**
	 * A line for the diagnostics panel, when the reader has it switched on.
	 *
	 * The wheel has to work on a device this code never runs on. When a gesture
	 * does nothing there, the only way to find out why is to have the device
	 * say what it received.
	 */
	onTrace?: (line: string) => void;
	/**
	 * Move the focused task up or down among its siblings.
	 *
	 * Only a wheel over one note hands this in; without it Alt with an arrow
	 * does nothing at all, which is right — there is no outline to reorder.
	 */
	onMove?: (direction: "up" | "down") => void;
	/**
	 * Whether Obsidian's own side panels stand open, in a word.
	 *
	 * The one thing the trace could not say: *did the panel open while we had
	 * the gesture?* The reader had to remember and correlate by hand, and two
	 * rounds of traces came back showing turns that had gone fine. Read once
	 * when a drag begins and again when it ends, the answer arrives in the same
	 * trace as the gesture that caused it (BC_E3_S76).
	 */
	/**
	 * Whether one of the wheel's own panels lies over this point.
	 *
	 * Only taps ask. A drag that begins on the card still turns the wheel — the
	 * card covers a good part of the drawing, and taking that away would cost a
	 * phone half its handle (see the note on `.task-wheel-card` in the
	 * stylesheet). What a tap on it may not do is name something behind it.
	 */
	covered?: (x: number, y: number) => boolean;
	panels?: () => string;
	/**
	 * Put the side panels back the way `panels()` said they were.
	 *
	 * Measured first, then built (BC_E3_S76). A quick turn is read by
	 * Obsidian's own recogniser as a swipe and opens a side panel, and the
	 * trace showed exactly why nothing we do to the event can stop it: we
	 * receive the whole gesture — a hundred moves, no cancel — so its
	 * listener is not downstream of ours but alongside it, seeing the same
	 * touches before our `stopPropagation` can reach it. From below there is
	 * no winning that.
	 *
	 * So the wheel stops fighting for the event and repairs the effect
	 * instead. The boundary is what makes that honest: only for a gesture
	 * the wheel is *holding* — a finger that is turning the wheel is not
	 * asking for a panel — and only back to the state that finger found. A
	 * swipe that starts anywhere else still opens whatever it opens.
	 */
	restorePanels?: (was: string) => void;
}

interface Tween {
	from: number;
	to: number;
	/** Timestamp of the first frame, or null until it arrives. */
	start: number | null;
	duration: number;
	/** The stop being aimed at, so the landing is exact. */
	index: number;
	/**
	 * Whether the stops passed on the way are reported.
	 *
	 * A drag is a turn: the reader watches the wheel move and the card follows
	 * what would come to rest under the wedge. A keystroke is a *jump* to an
	 * item chosen by name — nothing between here and there was asked for, and
	 * reporting it walks the focus ring across every branch in between
	 * (eigenaar, 2 sep 2026).
	 */
	quiet: boolean;
}

/** Which kind of event started the gesture that is running. */
type Source = "pointer" | "touch";

/** A finger or pointer that went down, before it is known what it meant. */
interface Contact {
	source: Source;
	id: number;
	x: number;
	y: number;
	time: number;
}

interface Drag {
	source: Source;
	/** Pointer id, or touch identifier. */
	pointerId: number;
	/**
	 * Where the middle of the wheel was when the grab started.
	 *
	 * Frozen for the whole gesture rather than measured per move: the card
	 * above the wheel re-renders as the focus changes, and anything that
	 * changes its height moves the canvas. Re-measuring mid-drag would read
	 * that movement as the hand having moved.
	 */
	centre: { x: number; y: number };
	/** Pointer angle at the previous sample. */
	last: number;
	/** Rotation when the grab started. */
	rotation: number;
	/** Total angle travelled since the grab, unwrapped so it can pass 180. */
	travel: number;
	samples: TravelSample[];
	moved: boolean;
	/**
	 * What the gesture looked like as it arrived, for the diagnostics.
	 *
	 * The owner can turn the wheel by pressing, pausing and then dragging, but
	 * a *quick* turn is read as a swipe and pulls Obsidian's panels out
	 * instead (28 aug 2026). Speed being the variable means the competing
	 * recogniser decides on speed, and it sits above us — so before guessing
	 * at which one, the wheel says what it actually received: when the first
	 * move arrived, how far it had already gone by then, how many moves came
	 * in, and whether the gesture was taken away mid-turn.
	 */
	began: number;
	from: { x: number; y: number };
	moves: number;
	firstMove: number | null;
	/** How the side panels stood when the finger went down. */
	panels: string;
	/** How often they had to be put back during this one gesture. */
	restored: number;
	/**
	 * Whether the finger went down on the drawing, rather than beside it.
	 *
	 * Turning works from anywhere on the canvas and stays that way — the whole
	 * of it is the handle. This is only about what the wheel takes away from
	 * Obsidian: outside the rim, a swipe is as likely to be someone reaching
	 * for a side panel, and the wheel has no business putting that back.
	 */
	onWheel: boolean;
	/** How far the finger got in the first tenth of a second. */
	early: number;
}

export class WheelController {
	private renderer: WheelRenderer | null = null;
	private detents: readonly Detent[] = [];

	private rotation = 0;
	private index = 0;
	private reported: string | null = null;

	private tween: Tween | null = null;
	private frame: number | null = null;

	/**
	 * Where a contact went down, whether or not it became a turn.
	 *
	 * A tap near the middle of the wheel has no angle to grab by, so no drag
	 * starts — but it is still a tap on an item, and the domains sit on the
	 * innermost ring where exactly that happens.
	 */
	private contact: Contact | null = null;

	/** The last item tapped, and when, for spotting the second tap. */
	private lastTap: { id: string; time: number } | null = null;
	private drag: Drag | null = null;
	/** Accumulated wheel-event travel that has not yet added up to a step. */
	private scrolled = 0;

	private zoomLevel = 1;
	/** A two-finger gesture in progress. Turning stands down while it runs. */
	private pinch: { distance: number; zoom: number } | null = null;

	constructor(private options: WheelControllerOptions) {
		this.listen();
	}

	/**
	 * Point the controller at a freshly drawn wheel.
	 *
	 * `keepId` is what makes a rescan survivable: when the item that was under
	 * the reading wedge still exists, the wheel goes straight back to it rather
	 * than to whatever now happens to sit at the old angle. Editing a note
	 * therefore does not lose your place in the round.
	 *
	 * With no id to keep — the first draw — the wheel starts at the first stop
	 * rather than wherever twelve o'clock happens to fall. A round starts at the
	 * beginning. When the kept id is gone, the nearest stop to where the wheel
	 * already is wins instead: the item was deleted, but the place was not.
	 */
	adopt(renderer: WheelRenderer, detents: readonly Detent[], keepId: string | null): void {
		this.cancelFrame();
		this.tween = null;
		this.drag = null;

		this.renderer = renderer;
		this.detents = detents;
		this.reported = null;

		if (detents.length === 0) {
			this.rotation = 0;
			renderer.setZoom(this.zoomLevel);
			renderer.setRotation(0);
			this.report(null);
			return;
		}

		// A round starts at the beginning, and the beginning is the first stop
		// turning would rest on — not the first detent, which is a folder.
		const kept = indexOfId(detents, keepId);
		this.index =
			kept >= 0
				? kept
				: keepId === null
					? (turnStops(detents)[0]?.index ?? 0)
					: this.nearestIndex(this.rotation);
		this.rotation = detents[this.index].rotation;
		renderer.setZoom(this.zoomLevel);
		renderer.setRotation(this.rotation);
		this.report(detents[this.index]);
	}

	/** Let go of any running animation. The DOM listeners outlive the view. */
	stop(): void {
		this.cancelFrame();
		this.tween = null;
		this.drag = null;
		this.renderer = null;
		this.detents = [];
	}

	/**
	 * Close in, or pull back out.
	 *
	 * Zoom is only a window onto the drawing, so it touches nothing else: not
	 * the layout, not the stops, not the focus. That is why it can be handled
	 * mid-gesture without disturbing a turn.
	 */
	setZoom(zoom: number): void {
		const next = clampZoom(zoom);
		if (next === this.zoomLevel) return;

		this.zoomLevel = next;
		this.renderer?.setZoom(next);
		this.options.onZoom?.(next);
	}

	/**
	 * Move a whole number of stops, in the flat order.
	 *
	 * Over the **turn stops** only: the round's items and the stumps. A heading
	 * is somewhere the reader can stand — with the arrows, or by tapping — but
	 * not somewhere turning puts them, because there is nothing to do there
	 * (BC_E3_S67).
	 */
	step(delta: number, quiet = false): void {
		if (this.detents.length === 0) return;
		this.snapTo(stepTurnStop(this.detents, this.index, delta), quiet);
	}

	/**
	 * One stop sideways on the same ring — what the left and right arrow keys do.
	 *
	 * The flat order would be the walk that skips nothing, but as a *button* it
	 * reads as chaos: it jumps a ring in and out with every press, so the eye
	 * loses the place it was reading (owner, 18 aug 2026). Staying on the ring
	 * is the movement the drawing suggests, and the round's guarantee lives in
	 * turning, not here.
	 */
	walkRing(delta: number, other = false): void {
		if (this.options.onSideways?.(delta, other) === true) return;
		if (this.detents.length === 0) return;
		this.snapTo(alongRing(this.detents, this.index, delta));
	}

	/** Come to rest on a named stop, if it is one of the ones drawn. */
	goTo(id: string): boolean {
		const at = indexOfId(this.detents, id);
		if (at < 0) return false;

		// Quiet: the caller named where it wants to be, so the stops in between
		// are scenery and not stops it asked about.
		this.snapTo(at, true);
		return true;
	}

	/** Go to a stop by its position in the turn order. */
	snapTo(index: number, quiet = false): void {
		const detent = this.detents[index];
		if (detent === undefined) return;

		this.index = index;
		const to = approach(this.rotation, detent.rotation);

		if (this.reducedMotion()) {
			this.tween = null;
			this.cancelFrame();
			this.apply(to);
			this.report(detent);
			this.options.onSettle?.(detent);
			return;
		}

		this.tween = {
			from: this.rotation,
			to,
			start: null,
			duration: snapDuration(to - this.rotation),
			index,
			quiet,
		};
		this.requestFrame();
	}

	/**
	 * Two ways in, on purpose.
	 *
	 * Pointer events are the modern API and cover mouse, pen and touch in one
	 * path — on a desktop browser. Obsidian on a phone is a WebView, and the
	 * first owner test found the wheel deaf to touch there even with
	 * `touch-action` declared on the element that owns the gesture. Rather than
	 * guess again, touch events run alongside as a second path: whichever
	 * arrives first owns the gesture and the other stands down.
	 */
	private listen(): void {
		const { surface, register } = this.options;

		register(surface, "pointerdown", (event) => this.onPointerDown(event));
		register(surface, "pointermove", (event) => this.onPointerMove(event));
		register(surface, "pointerup", (event) => this.onPointerUp(event));
		register(surface, "pointercancel", (event) => {
			// A cancel is not an ordinary end: it is the platform saying it has
			// given the gesture to someone else. If a quick turn ends here, the
			// wheel never lost the gesture — it had it taken away, and that
			// names the layer to go and look at.
			this.trace("pointercancel — the gesture was taken away");
			this.onPointerUp(event);
		});

		// Not passive: without preventDefault the pane behind the wheel takes
		// the gesture as a scroll.
		register(surface, "touchstart", (event) => this.onTouchStart(event), {
			passive: false,
		});
		register(surface, "touchmove", (event) => this.onTouchMove(event), {
			passive: false,
		});
		register(surface, "touchend", (event) => this.onTouchEnd(event));
		register(surface, "touchcancel", (event) => {
			this.trace("touchcancel — the gesture was taken away");
			this.onTouchEnd(event);
		});

		register(surface, "keydown", (event) => this.onKeyDown(event));
		register(surface, "wheel", (event) => this.onWheel(event), {
			passive: false,
		});
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button > 0 || this.pinch !== null) return;
		this.trace(`pointerdown id=${event.pointerId} type=${event.pointerType}`);
		this.mark("pointer", event.pointerId, event, event.timeStamp);
		if (this.begin("pointer", event.pointerId, event, event.timeStamp)) {
			this.capture(event.pointerId, event.pointerType);
			this.holdFinger(event);
		}
	}

	private onPointerMove(event: PointerEvent): void {
		if (this.drag?.source !== "pointer") return;
		this.holdFinger(event);
		this.extend(event.pointerId, event, event.timeStamp);
	}

	private onPointerUp(event: PointerEvent): void {
		const mine =
			this.drag?.source === "pointer" || this.contact?.source === "pointer";
		if (!mine) return;

		this.trace(`pointerup id=${event.pointerId}`);
		this.holdFinger(event);
		this.release(event.pointerId);
		this.finish(event.pointerId, event, event.timeStamp);
	}

	/**
	 * A finger's pointer event stops here too, for the same reason a touch does.
	 *
	 * Both doors are open at once (see `listen`), and which one a device sends
	 * a gesture through is not ours to know — the phone that could not be made
	 * to work with `touch-action` alone is why the second door exists. So a
	 * pointer that *is* a finger gets held back exactly like the touch event
	 * would have been.
	 *
	 * Only a finger. A mouse or a pen has no sidebar gesture to trigger, and
	 * quietly swallowing those on the desktop would take events from Obsidian
	 * that it is entitled to.
	 */
	private holdFinger(event: PointerEvent): void {
		if (event.pointerType === "touch") event.stopPropagation();
	}

	private onTouchStart(event: TouchEvent): void {
		const touch = event.changedTouches[0];
		if (touch === undefined) return;

		this.trace(`touchstart touches=${event.touches.length}`);

		// A second finger means zoom, not turn. The turn in progress is dropped
		// where it stands rather than snapped: the hand has moved on.
		if (event.touches.length >= 2) {
			const distance = spread(event.touches);
			if (distance !== null) {
				this.drag = null;
				this.pinch = { distance, zoom: this.zoomLevel };
				this.trace(`pinch begins at ${distance.toFixed(0)}px`);
				own(event);
			}
			return;
		}
		this.mark("touch", touch.identifier, touch, event.timeStamp);
		if (this.begin("touch", touch.identifier, touch, event.timeStamp)) {
			own(event);
		}
	}

	private onTouchMove(event: TouchEvent): void {
		const pinch = this.pinch;
		if (pinch !== null) {
			const distance = spread(event.touches);
			if (distance === null || pinch.distance <= 0) return;
			own(event);
			this.setZoom((pinch.zoom * distance) / pinch.distance);
			return;
		}

		if (this.drag?.source !== "touch") return;

		const touch = this.find(event.changedTouches, this.drag.pointerId);
		if (touch === undefined) return;

		own(event);
		this.extend(touch.identifier, touch, event.timeStamp);
	}

	private onTouchEnd(event: TouchEvent): void {
		if (this.pinch !== null) {
			if (event.touches.length < 2) {
				this.pinch = null;
				this.contact = null;
				this.trace(`pinch ends at ${this.zoomLevel.toFixed(2)}×`);
			}
			return;
		}

		const id = this.drag?.pointerId ?? this.contact?.id;
		if (id === undefined) return;

		const touch = this.find(event.changedTouches, id);
		if (touch === undefined) return;

		this.trace("touchend");
		event.stopPropagation();
		this.finish(touch.identifier, touch, event.timeStamp);
	}

	private find(touches: TouchList, id: number): Touch | undefined {
		for (let i = 0; i < touches.length; i++) {
			if (touches[i].identifier === id) return touches[i];
		}
		return undefined;
	}

	/**
	 * Remember where a contact went down — from one door only.
	 *
	 * A phone sends both: `pointerdown` first, then `touchstart` for the same
	 * finger, with a different id. Letting the second overwrite the first left
	 * the drag holding the pointer id and the contact holding the touch id, and
	 * at `pointerup` the two no longer matched, so every tap was thrown away as
	 * "not mine". Whichever door the gesture came in through keeps it, exactly
	 * as `begin` already does for the turn.
	 */
	private mark(source: Source, id: number, at: Spot, time: number): void {
		if (this.drag !== null && this.drag.source !== source) return;
		if (this.contact !== null && this.contact.source !== source) return;

		this.contact = { source, id, x: at.clientX, y: at.clientY, time };
	}

	/* ---------------------------------------------------------------- */
	/* one gesture, whichever door it came in through                    */
	/* ---------------------------------------------------------------- */

	private begin(
		source: Source,
		id: number,
		at: Spot,
		time: number,
	): boolean {
		// A gesture already running through the other door owns the wheel.
		if (this.drag !== null && this.drag.source !== source) return false;
		if (this.detents.length === 0) {
			this.trace("begin: no stops to turn to");
			return false;
		}

		const centre = this.centre();
		if (centre === null) {
			this.trace("begin: the canvas has no measurable size");
			return false;
		}

		const angle = angleFrom(centre, at);
		if (angle === null) {
			this.trace("begin: too close to the middle to have an angle");
			return false;
		}

		this.tween = null;
		this.cancelFrame();

		if (this.renderer?.withinRim(at.clientX, at.clientY) === false) {
			this.trace("begin: beside the drawing — panels left alone");
		}

		this.drag = {
			source,
			pointerId: id,
			centre,
			began: time,
			from: { x: at.clientX, y: at.clientY },
			moves: 0,
			firstMove: null,
			panels: this.options.panels?.() ?? "",
			restored: 0,
			onWheel: this.renderer?.withinRim(at.clientX, at.clientY) ?? true,
			early: 0,
			last: angle,
			rotation: this.rotation,
			travel: 0,
			samples: [{ time, angle: 0 }],
			moved: false,
		};

		this.trace(`begin ${source} at ${angle.toFixed(0)}°`);
		return true;
	}

	private extend(id: number, at: Spot, time: number): void {
		const drag = this.drag;
		if (drag === null || id !== drag.pointerId) return;

		const angle = angleFrom(drag.centre, at);
		if (angle === null) return;

		// Travel accumulates step by step rather than being measured against the
		// grab point: the short way between two consecutive samples is always
		// the way the hand went, which lets a single gesture wind the wheel past
		// half a turn without it snapping back the other way.
		drag.travel += unwrap(drag.last, angle);
		drag.last = angle;

		drag.moves += 1;
		this.keepPanels(drag);

		// How far the finger got in the first tenth of a second — the number
		// that says "this was a flick" rather than "this was a drag", and so
		// the one to line up against whether a panel opened.
		if (time - drag.began <= EARLY_WINDOW) {
			drag.early = Math.max(
				drag.early,
				Math.hypot(at.clientX - drag.from.x, at.clientY - drag.from.y),
			);
		}

		if (drag.firstMove === null) {
			drag.firstMove = time - drag.began;
			const away = Math.hypot(at.clientX - drag.from.x, at.clientY - drag.from.y);
			// The gap between touching down and the first move is what tells a
			// press-then-drag from a flick, and the distance says how much of
			// the gesture happened before we heard about any of it.
			this.trace(
				`first move after ${Math.round(drag.firstMove)}ms, ${Math.round(away)}px`,
			);
		}

		drag.samples.push({ time, angle: drag.travel });
		if (drag.samples.length > SAMPLE_WINDOW) drag.samples.shift();
		if (Math.abs(drag.travel) > 0.5) drag.moved = true;

		this.apply(drag.rotation + drag.travel);
		// What the card shows mid-drag is where the wheel *would* settle, so it
		// reads the turn stops too: a heading flashing past under the wedge is
		// exactly the wandering focus this rule ends.
		this.report(nearestTurnStop(this.detents, this.rotation));
	}

	private finish(id: number, at?: Spot, time?: number): void {
		const drag = this.drag !== null && this.drag.pointerId === id ? this.drag : null;
		const contact = this.contact !== null && this.contact.id === id ? this.contact : null;
		if (drag === null && contact === null) return;

		this.drag = null;
		this.contact = null;
		if (drag !== null) {
			// Once more on release: a recogniser is free to make up its mind
			// when the finger leaves, and by then there are no more moves to
			// catch it on.
			this.keepPanels(drag);
			this.traceGesture(drag, "end");
		}

		if (at !== undefined && contact !== null && this.tapped(contact, at, time)) {
			return;
		}
		if (drag === null) return;
		this.settle(drag.moved ? this.coast(drag) : 0);
	}

	/**
	 * A tap on an item, rather than a turn.
	 *
	 * Turning is how the wheel is meant to be worked, but the eye finds a thing
	 * before the hand can wind to it — and once the fisheye has opened a branch,
	 * everything in it is right there, visible and out of reach. So a tap brings
	 * what was touched under the reading wedge, which is the same landing a turn
	 * would have produced, only reached in one move.
	 *
	 * It is deliberately the *only* thing a tap does. Tapping to fold, or to
	 * open a note, would make the same gesture mean different things depending
	 * on what it hit; here it always means "go there".
	 */
	private tapped(contact: Contact, at: Spot, time?: number): boolean {
		const travelled = Math.hypot(at.clientX - contact.x, at.clientY - contact.y);
		if (travelled > TAP_SLOP) return false;
		if (time !== undefined && time - contact.time > TAP_TIME) return false;

		// A panel of ours lies here. The card is see-through so that a drag
		// across it still turns the wheel, and that let a *tap* on it name
		// whatever was drawn behind it — which is how tapping the words on the
		// card opened a task under the heading you were reading (BC_E3_S118).
		if (this.options.covered?.(at.clientX, at.clientY) === true) {
			this.trace("tap on the card, not on the wheel");
			return false;
		}

		const id = this.itemAt(at);
		if (id === null) return false;

		const index = indexOfId(this.detents, id);
		if (index < 0) return false;

		const now = time ?? contact.time;
		const again =
			this.lastTap !== null &&
			this.lastTap.id === id &&
			now - this.lastTap.time <= DOUBLE_TAP;

		this.lastTap = again ? null : { id, time: now };

		if (again) {
			this.trace(`second tap on ${id}`);
			this.options.onActivate?.(id);
			return true;
		}

		this.trace(`tap on ${id}`);
		this.snapTo(index);
		return true;
	}

	/**
	 * What a tap at this point named (BC_E3_S117).
	 *
	 * Not what lies *under* the finger. A node is drawn as a dot and, beside it,
	 * the word — and the word hangs a tap-disc's width outward, so it begins
	 * exactly where its own node stops taking taps and points at the ring where
	 * the children are. Tapping the heading you are reading therefore landed on
	 * a task under it (eigenaar, 2 sep 2026, measured off his own screenshot:
	 * the two discs are 45 units apart and 18 across, so they never even
	 * touched — it was never the discs).
	 *
	 * So both shapes count, and the nearest of them wins. The browser's own
	 * answer is kept only where there is nothing to measure — a stand-in, or a
	 * drawing that has not been laid out yet.
	 */
	private itemAt(at: Spot): string | null {
		const targets = this.renderer?.targetsOnScreen() ?? [];
		if (targets.length > 0) {
			const aimed = aimedAt({ x: at.clientX, y: at.clientY }, targets);
			this.trace(`aim: ${aimed ?? "nothing"} of ${targets.length} drawn`);
			return aimed;
		}

		const target = this.doc().elementFromPoint(at.clientX, at.clientY);
		return target?.closest("[data-tw-id]")?.getAttribute("data-tw-id") ?? null;
	}

	/**
	 * Capture, defensively.
	 *
	 * `setPointerCapture` throws when the id is not an active pointer, which
	 * happens in more WebViews than the specification suggests. Losing capture
	 * costs nothing here — the listeners sit on the surface and the moves bubble
	 * up to it anyway — but an exception would take the rest of the handler with
	 * it.
	 */
	private capture(id: number, pointerType: string): void {
		try {
			this.options.surface.setPointerCapture(id);
		} catch (error) {
			this.trace(`capture refused: ${String(error)}`);
		}

		// Taking focus is for the keyboard. A finger has no keyboard, and the
		// focus ring it leaves behind sits around the wheel for the rest of the
		// session — the first Android test showed exactly that.
		if (pointerType !== "touch") {
			this.options.surface.focus({ preventScroll: true });
		}
	}

	private release(id: number): void {
		try {
			if (this.options.surface.hasPointerCapture(id)) {
				this.options.surface.releasePointerCapture(id);
			}
		} catch {
			// Already gone. Nothing to do and nothing worth saying.
		}
	}

	private trace(line: string): void {
		this.options.onTrace?.(line);
	}

	/**
	 * Where a flick would have carried the wheel, in degrees.
	 *
	 * The arithmetic lives in `layout/momentum.ts`, where it can be tested
	 * without a hand and a screen. Momentum is off entirely when the reader has
	 * asked for less motion — the stops stay exactly the same, they are just
	 * reached without being thrown at.
	 */
	private coast(drag: Drag): number {
		return this.reducedMotion() ? 0 : coastFrom(drag.samples);
	}

	/** End of a gesture: land on the nearest stop to where it was heading. */
	/**
	 * Put back a side panel that opened under a finger that was turning.
	 *
	 * Asked on every move rather than at the end: reading two booleans costs
	 * nothing, and the difference between the two moments is the difference
	 * between a flicker and a panel standing open across the whole turn —
	 * with the wheel's own middle pushed sideways under it.
	 */
	private keepPanels(drag: Drag): void {
		if (!drag.onWheel) return;

		const restore = this.options.restorePanels;
		const read = this.options.panels;
		if (restore === undefined || read === undefined) return;
		if (read() === drag.panels) return;

		restore(drag.panels);
		drag.restored += 1;
	}

	/** How the gesture that just ended looked, for the diagnostics. */
	private traceGesture(drag: Drag, how: string): void {
		const now = this.options.panels?.() ?? "";
		// Only when it changed. A line that says the panels are as they were,
		// every single gesture, is a line nobody reads.
		const panels =
			now !== drag.panels ? `, panels ${drag.panels} → ${now}` : "";

		this.trace(
			`${how}: ${drag.moves} moves, first after ` +
				`${drag.firstMove === null ? "—" : `${Math.round(drag.firstMove)}ms`}, ` +
				`${Math.round(drag.early)}px in ${EARLY_WINDOW}ms, ` +
				`${drag.travel.toFixed(0)}° turned${panels}` +
				(drag.restored > 0 ? `, put back ${drag.restored}×` : ""),
		);
	}

	private settle(coast: number): void {
		if (this.detents.length === 0) return;
		this.snapTo(this.nearestIndex(this.rotation + coast));
	}

	private onWheel(event: WheelEvent): void {
		// The graph view zooms on a plain scroll; here a plain scroll turns the
		// wheel, which is the more common thing to want. Zoom takes the modifier,
		// the same way a browser does it.
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			const raw = event.deltaY !== 0 ? event.deltaY : event.deltaX;
			this.setZoom(this.zoomLevel * (raw < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
			return;
		}

		if (this.detents.length === 0) return;
		event.preventDefault();

		const raw = event.deltaY !== 0 ? event.deltaY : event.deltaX;
		const turn = scrollTurn(this.scrolled, pixelsOf(raw, event.deltaMode));
		this.scrolled = turn.travel;
		if (turn.steps !== 0) this.step(turn.steps);
	}

	private onKeyDown(event: KeyboardEvent): void {
		// Before the empty check, deliberately. The way out is the one move that
		// needs no stop to act on, and an empty wheel is exactly where a reader
		// wants it — a heading with no tasks under it is the easiest wheel to
		// open by accident. A wheel with nothing to draw calls `stop()`, which
		// clears the detents, so guarding on them first left the keyboard with
		// no way off while the button in the corner still worked (eigenaar,
		// 2 sep 2026).
		if (event.key === "Backspace") {
			if (this.options.onOut?.() !== true) return;
			event.preventDefault();
			return;
		}

		if (this.detents.length === 0) return;

		// The arrows walk the tree, not the flat turn order (kaderdocument §5):
		// sideways stays on the ring, up goes a ring outwards to a child, down a
		// ring inwards to the parent. Outwards is up because the item you are
		// reading sits at the top of the wheel, where further from the hub is
		// literally higher on screen.
		// Alt with an arrow is Obsidian's own "move this line" idiom, and it is
		// the same move here — except that the wheel moves the task with
		// everything under it. Only a wheel over one note offers it; elsewhere
		// `onMove` is absent and the arrows do what they always did.
		if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
			const move = this.options.onMove;
			if (move === undefined) return;
			event.preventDefault();
			move(event.key === "ArrowUp" ? "up" : "down");
			return;
		}

		switch (event.key) {
			// Shift walks the other of the two rings the reader chose between
			// (BC_E3_S94), so both are always to hand without visiting the
			// settings — the one a phone cannot offer, which is why the card's
			// buttons follow the setting instead.
			case "ArrowRight":
				this.walkRing(1, event.shiftKey);
				break;
			case "ArrowLeft":
				this.walkRing(-1, event.shiftKey);
				break;
			// Every one of these names where it wants to be, so all of them turn
			// quietly: what lies between here and there was not asked about.
			case "ArrowUp":
				this.snapTo(acrossRings(this.detents, this.index, true), true);
				break;
			case "ArrowDown":
				this.snapTo(acrossRings(this.detents, this.index, false), true);
				break;
			// The flat order is what a full round is made of, so it keeps a key of
			// its own: this is the walk that cannot skip anything.
			case "PageDown":
				this.step(1, true);
				break;
			case "PageUp":
				this.step(-1, true);
				break;
			// The ends of the *turn* order, so they agree with what turning does.
			case "Home":
				this.snapTo(turnStops(this.detents)[0]?.index ?? 0, true);
				break;
			case "End": {
				const stops = turnStops(this.detents);
				this.snapTo(stops[stops.length - 1]?.index ?? 0, true);
				break;
			}
			case " ":
				this.options.onToggle?.();
				break;
			// Enter is the keyboard's double-click, not a second name for space.
			// It used to fold, which made two keys do one thing and left the
			// move a mouse has — "open a wheel over just this" — with no key at
			// all (eigenaar, 2 sep 2026). The id comes from the stop we are on,
			// where the pointer path takes it from what was under the finger:
			// same move, two ways of saying which item.
			case "Enter": {
				// Ctrl or Cmd turns "open this" into "open where this lives". The
				// action already existed as a button and a command; what it did
				// not have was a key next to the one it belongs beside.
				if (event.ctrlKey || event.metaKey) {
					if (this.options.onOpenNote?.() !== true) return;
					break;
				}

				const here = this.detents[this.index];
				if (here === undefined) return;
				this.options.onActivate?.(here.id);
				break;
			}
			case "+":
			case "=":
				this.setZoom(this.zoomLevel * ZOOM_STEP);
				break;
			case "-":
			case "_":
				this.setZoom(this.zoomLevel / ZOOM_STEP);
				break;
			case "0":
				this.setZoom(1);
				break;
			default:
				return;
		}

		event.preventDefault();
	}

	/**
	 * The document and window this wheel actually lives in.
	 *
	 * Obsidian lets a tab be torn off into its own window, and there the plugin's
	 * bare `document` and `window` are still the *main* one. Hit-testing a tap
	 * against the wrong document finds nothing, so double-tapping a node in a
	 * pop-out did nothing at all; and driving the turn animation off the main
	 * window's frames means it stalls whenever that window is occluded (owner,
	 * 18 aug 2026). Asked of the surface rather than assumed, so it is right in
	 * both places and needs no branch.
	 */
	private doc(): Document {
		return this.options.surface.ownerDocument;
	}

	private win(): Window {
		return this.doc().defaultView ?? window;
	}

	private requestFrame(): void {
		if (this.frame !== null) return;
		this.frame = this.win().requestAnimationFrame((time) => this.tick(time));
	}

	private cancelFrame(): void {
		if (this.frame === null) return;
		this.win().cancelAnimationFrame(this.frame);
		this.frame = null;
	}

	private tick(time: number): void {
		this.frame = null;

		const tween = this.tween;
		if (tween === null) return;

		tween.start ??= time;
		const progress = (time - tween.start) / tween.duration;
		this.apply(tweenAt(tween.from, tween.to, progress));

		if (progress < 1) {
			if (!tween.quiet) this.report(nearestTurnStop(this.detents, this.rotation));
			this.requestFrame();
			return;
		}

		// Landing is reported from the stop that was aimed at, not from whatever
		// is nearest: two items can share an angle exactly, and stepping onto
		// the second of them has to be able to say so.
		this.tween = null;
		const landed = this.detents[tween.index] ?? null;

		// Settle first, report second — the one order in which the focus ring is
		// only ever drawn once. Settling re-opens the fisheye around where we
		// landed, and until that has happened the destination is still drawn as
		// the *old* fisheye saw it: squeezed onto the silhouette at the end of a
		// neighbouring branch. Marking it there and moving it a frame later is
		// the restlessness the owner reported (2 sep 2026). Reporting after the
		// re-layout costs nothing when nothing moved, because `report` is a
		// no-op for a stop that is already the one reported.
		this.options.onSettle?.(landed);
		this.report(landed);
	}

	private apply(rotation: number): void {
		this.rotation = rotation;
		this.renderer?.setRotation(rotation);
	}

	private report(detent: Detent | null): void {
		const id = detent?.id ?? null;
		if (id === this.reported) return;

		this.reported = id;
		if (detent !== null) this.index = detent.index;
		this.renderer?.setFocus(id);
		this.options.onFocus(detent);
	}

	/**
	 * Where a gesture settles: the nearest stop turning may rest on.
	 *
	 * Drag and momentum land through here, so they obey the same rule as the
	 * scroll wheel and PageUp/PageDown — one rule for "turning", whichever
	 * hand it was done with.
	 */
	private nearestIndex(rotation: number): number {
		return nearestTurnStop(this.detents, rotation)?.index ?? 0;
	}

	/**
	 * The middle of the wheel, in client coordinates.
	 *
	 * Measured when a gesture starts rather than cached when the view opens:
	 * the pane can be resized or the view moved, and a measurement taken while
	 * something is still settling is the mobile bug this repo keeps a pattern
	 * note about. A gesture is a moment when nothing else is moving.
	 */
	/**
	 * The point a drag turns about: the hub, as it currently sits on screen.
	 *
	 * Not the middle of the canvas. Those two are the same thing only at zoom
	 * one; closing in anchors the window on the reading wedge, which slides the
	 * hub down and eventually off the pane. Turning about the wrong pivot does
	 * not merely feel loose — below the assumed middle the sign of the angle
	 * flips, so the wheel turns against the hand.
	 */
	private centre(): { x: number; y: number } | null {
		const renderer = this.renderer;
		if (renderer === null) return null;

		const rect = renderer.element.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return null;

		const hub = renderer.hubOnScreen() ?? {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};

		this.trace(
			`canvas ${Math.round(rect.width)}×${Math.round(rect.height)}, hub at ${Math.round(hub.x)},${Math.round(hub.y)}`,
		);
		return hub;
	}

	private reducedMotion(): boolean {
		const view = this.win();
		if (typeof view.matchMedia !== "function") return false;
		return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
}

/** How far apart the first two contacts are, in pixels. */
function spread(touches: TouchList): number | null {
	if (touches.length < 2) return null;
	const [a, b] = [touches[0], touches[1]];
	return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

/** Anything that says where on the screen it is: a pointer event, or a touch. */
interface Spot {
	clientX: number;
	clientY: number;
}

/** Where a contact sits, as an angle on a wheel with this centre. */
function angleFrom(
	centre: { x: number; y: number },
	at: Spot,
): number | null {
	const dx = at.clientX - centre.x;
	const dy = at.clientY - centre.y;
	// Too close to the middle to have an angle worth trusting.
	if (Math.hypot(dx, dy) < 1) return null;
	return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** The short way from one angle to another, as a signed number of degrees. */
function unwrap(from: number, to: number): number {
	const raw = normaliseAngle(to - from);
	return raw > 180 ? raw - 360 : raw;
}

