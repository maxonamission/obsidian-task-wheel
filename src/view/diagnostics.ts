import { apiVersion, Notice, Platform } from "obsidian";
import type { TaskWheelSettings } from "../settings";
import { putIcon } from "./icon";
import type { DomRegistrar } from "./wheel-controller";

/**
 * The window onto a device the developer cannot reach.
 *
 * A trace the reader can copy, an error box that says which step failed, and a
 * reading of the pane whenever the keyboard moves it. None of it is about the
 * wheel: it is about the machine the wheel is running on, which is why it can
 * be lifted out of the view whole (BC_E3_S162).
 *
 * Lifting it out is not tidying. Two of the audit's findings of 6 sep 2026 sat
 * in code that was only reachable from inside `wheel-view.ts`, so no test could
 * have caught either — the same argument BC_E3_S13 made, and the same answer.
 * What is left here still needs a browser and still cannot be tested; what
 * *can* be is `line`, `safely` and the cap on the buffer, and those now have a
 * seam to be asked through.
 */

/**
 * How many lines the trace keeps.
 *
 * The first version kept twenty, and the owner lost the capture that mattered
 * to the one that came after it (28 aug 2026). Now that the panel is bounded,
 * scrolls on its own and is copied by a button rather than by hand, keeping
 * more costs nothing anyone can feel: two hundred lines is some twenty
 * gestures, which is a session of trying to reproduce something rather than a
 * single lucky attempt.
 */
export const TRACE_LINES = 200;

/**
 * When this bundle was built, stamped in by esbuild.
 *
 * The version cannot tell two test builds apart — a dozen of them carry the
 * same one between releases — and a round was spent reading a trace for a fix
 * that build did not contain (28 aug 2026). Declared with a fallback so the
 * tests, which never go through esbuild, do not have to know about it.
 */
declare const __TASK_WHEEL_BUILD__: string | undefined;
const BUILD =
	typeof __TASK_WHEEL_BUILD__ === "string" ? __TASK_WHEEL_BUILD__ : "dev";

/** What the diagnostics need from the view, and no more. */
export interface DiagnosticsHost {
	readonly settings: TaskWheelSettings;
	/** Plugin version, for the header the reader pastes into an issue. */
	readonly version: string;
	/** Which wheel this is, for the same header. */
	scope: () => string;
	/** The pane every viewport reading is about. */
	readonly contentEl: HTMLElement;
	/**
	 * Obsidian's own registrars, kept on the view where they belong.
	 *
	 * `own` takes a plain cleanup, for the listeners that are not on an element
	 * — `visualViewport` is the one, and it is exactly the one that matters on
	 * a phone.
	 */
	own: (cleanup: () => void) => void;
	onDom: DomRegistrar;
	onWindow: (type: "resize", handler: () => void) => void;
}

export class Diagnostics {
	private readonly host: DiagnosticsHost;

	/** The lines themselves. Kept whether or not the panel is on — see `line`. */
	private readonly trace: string[] = [];

	private traceEl: HTMLElement | null = null;
	private traceTextEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;

	/** The last viewport reading, so a burst of resizes prints once. */
	private lastViewport = "";

	constructor(host: DiagnosticsHost) {
		this.host = host;
	}

	/** The two boxes the view drew for this to write into. */
	attach(traceEl: HTMLElement, errorEl: HTMLElement): void {
		this.traceEl = traceEl;
		this.errorEl = errorEl;
	}

	/**
	 * Show or hide the panel, following the setting.
	 *
	 * The lines go when the switch goes; the toolbar stays, so turning
	 * diagnostics back on does not rebuild the panel.
	 */
	show(on: boolean): void {
		const el = this.traceEl;
		if (el === null) return;

		el.toggleClass("is-on", on);
		if (on) return;

		this.trace.length = 0;
		this.traceTextEl?.setText("");
	}

	/** Let go of the elements when the pane closes. */
	detach(): void {
		this.traceEl = null;
		this.traceTextEl = null;
		this.errorEl = null;
	}

	/**
	 * What the device sent, when the reader asked to see it.
	 *
	 * Kept deliberately dumb: a list of lines, newest last, capped. It is a
	 * window onto a machine we cannot reach, not a logging framework.
	 *
	 * **Recorded whether or not the panel is on.** The buffer keeps the lines
	 * and the panel merely shows them, so switching diagnostics on *after* the
	 * thing you were trying to catch still gives you the trace that contains
	 * it.
	 */
	line(text: string): void {
		this.trace.push(text);
		while (this.trace.length > TRACE_LINES) this.trace.shift();
		if (!this.host.settings.diagnostics) return;

		const el = this.traceTextEl;
		if (el === null) return;
		el.setText(this.trace.join("\n"));

		// The newest line is the one being read, and the panel is short enough
		// now that the rest scrolls out of sight above it.
		const panel = this.traceEl;
		if (panel !== null) panel.scrollTop = panel.scrollHeight;
	}

	/** The lines as they stand, for a test or a copy. */
	lines(): readonly string[] {
		return this.trace;
	}

	/**
	 * Run one step of the drawing without letting it take the others with it.
	 *
	 * A view that half-renders and says nothing is the worst possible outcome
	 * on a device the developer cannot reach: the reader sees something, so it
	 * looks deliberate. Every step reports its own failure, on screen, whether
	 * or not the diagnostics panel is switched on.
	 */
	safely(step: string, run: () => void): void {
		try {
			run();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.line(`FAILED ${step}: ${message}`);
			this.showError(`${step} failed: ${message}`);
			console.error(`Task Wheel: ${step} failed`, error);
		}
	}

	showError(message: string): void {
		const el = this.errorEl;
		if (el === null) return;
		el.empty();
		el.addClass("is-on");
		el.createEl("p", { text: message });
	}

	clearError(): void {
		this.errorEl?.empty();
		this.errorEl?.removeClass("is-on");
	}

	/**
	 * The diagnostics panel: a way to take the lines with you, then the lines.
	 *
	 * The panel was built to be *photographed* — a `Notice` is gone in eight
	 * seconds, which is the wrong property for something you are trying to
	 * capture. Photographing turned out to be the wrong verb: what the reader
	 * actually wants is the text, and on a phone selecting it out of a scrolling
	 * pane is a fight (eigenaar, 28 aug 2026: *"ik kan de diagnostics niet copy
	 * pasten"*).
	 *
	 * So there is a button. What it copies carries a short header — plugin
	 * version, Obsidian's API version, desktop or mobile — because a trace
	 * without those needs a second round of questions before it can be read.
	 */
	drawPanel(): void {
		const el = this.traceEl;
		if (el === null) return;

		el.empty();
		const bar = el.createDiv({ cls: "task-wheel-trace-bar" });
		bar.createSpan({
			cls: "task-wheel-trace-title",
			text: "Diagnostics",
		});

		const copy = bar.createEl("button", {
			cls: "task-wheel-trace-copy",
			attr: { type: "button", "aria-label": "Copy the diagnostics" },
		});
		putIcon(copy, "copy", "task-wheel-trace-icon");
		copy.createSpan({ text: "Copy" });
		copy.addEventListener("click", () => void this.copy());

		const clear = bar.createEl("button", {
			cls: "task-wheel-trace-copy",
			attr: { type: "button", "aria-label": "Clear the diagnostics" },
		});
		putIcon(clear, "eraser", "task-wheel-trace-icon");
		clear.createSpan({ text: "Clear" });
		clear.addEventListener("click", () => {
			this.trace.length = 0;
			this.traceTextEl?.setText("");
			// So the next reading is printed rather than dropped as a repeat of
			// one the reader just wiped (BC_E3_S96).
			this.lastViewport = "";
		});

		this.traceTextEl = el.createEl("pre", { text: this.trace.join("\n") });
	}

	/** Put the trace on the clipboard, header and all. */
	private async copy(): Promise<void> {
		const header = [
			`Task Wheel ${this.host.version} (build ${BUILD})`,
			`Obsidian API ${apiVersion}`,
			Platform.isMobile ? "mobile" : "desktop",
			this.host.scope(),
		].join(" · ");

		try {
			await navigator.clipboard.writeText(`${header}\n${this.trace.join("\n")}`);
			new Notice("Task wheel: diagnostics copied.");
		} catch {
			// Some surfaces refuse the clipboard outright. Saying so beats a
			// button that looks like it worked.
			new Notice("Task wheel: this device would not let the plugin copy.");
		}
	}

	/**
	 * Watch what the keyboard does to the pane, on a device that has one.
	 *
	 * Every listener goes through the view's own registrars, so closing the
	 * pane takes them with it.
	 */
	watchViewport(view: Window): void {
		const visual = view.visualViewport;
		if (visual !== null) {
			const onResize = (): void => this.reportViewport("visual", true);
			visual.addEventListener("resize", onResize);
			this.host.own(() => visual.removeEventListener("resize", onResize));
		}

		this.host.onWindow("resize", () => this.reportViewport("window", true));

		// Focus moving into the pane is the keyboard arriving, on a device that
		// has one. The second reading is the one that matters: the owner's gap
		// appears *after* what looks like a first step, which is the keyboard
		// finishing its animation.
		this.host.onDom(this.host.contentEl, "focusin", () => {
			this.markTyping();
			this.reportViewport("focus");
			view.setTimeout(() => this.reportViewport("focus+500"), 500);
		});

		// After the move, not during it: `focusout` fires before the next
		// element has focus, so asking then would say "nothing" on every step
		// from one field to the next.
		this.host.onDom(this.host.contentEl, "focusout", () => {
			view.setTimeout(() => {
				this.markTyping();
				this.reportViewport("blur");
			}, 0);
		});
	}

	/**
	 * Whether a text field in this pane has the keyboard (BC_E3_S96).
	 *
	 * The room the pane holds back at the bottom is for Obsidian's own mobile
	 * bar. While you are typing there is no bar to duck — the keyboard is
	 * standing where it would be — so the reservation is not merely too big
	 * then, it is unwanted. Which field it is does not matter.
	 */
	markTyping(): void {
		const pane = this.host.contentEl;
		const active = pane.ownerDocument.activeElement;
		const typing =
			active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;

		pane.toggleClass("is-typing", typing && pane.contains(active));
	}

	/**
	 * One reading of the pane, into the trace.
	 *
	 * `quiet` drops a reading identical to the last one, and is for the resize
	 * events, which can fire in bursts. The deliberate moments — a draw, a focus
	 * — always print. They did not, in an early attempt, and the result was an
	 * instrument that says nothing precisely when the answer is *"nothing
	 * changed"*: the owner cleared the panel, worked the keyboard, and got back
	 * a trace with no reading in it at all. A measurement of "the same as
	 * before" is a measurement.
	 */
	reportViewport(why: string, quiet = false): void {
		const pane = this.host.contentEl;
		const view = pane.ownerDocument.defaultView;
		if (view === null) return;

		const style = view.getComputedStyle(pane);
		const box = pane.getBoundingClientRect();
		const visual = view.visualViewport;
		const safe = style.getPropertyValue("--safe-area-inset-bottom").trim();

		// What has the keyboard, if anything. The first capture came back with
		// `focus` lines that turned out to be the canvas taking focus on a tap —
		// no keyboard involved — which looked like a reading of the moment we
		// were after and was not (BC_E3_S96).
		const active = pane.ownerDocument.activeElement;
		const focused =
			active === null
				? "none"
				: `${active.tagName.toLowerCase()}${
						active.className.length > 0 ? `.${active.className.split(" ")[0]}` : ""
					}`;

		const line = readingOf({
			innerHeight: view.innerHeight,
			visual:
				visual === null
					? null
					: { height: visual.height, offsetTop: visual.offsetTop },
			box: { top: box.top, height: box.height },
			scroll: { top: pane.scrollTop, height: pane.scrollHeight },
			padBottom: style.paddingBottom,
			safe,
			bottomBar: style.getPropertyValue("--tw-bottom-bar").trim(),
			focused,
		});

		if (quiet && line === this.lastViewport) return;
		this.lastViewport = line;
		this.line(`viewport ${why}: ${line}`);
	}
}

/** One reading, as a line — the shape of it, without a browser to ask. */
export interface ViewportReading {
	innerHeight: number;
	visual: { height: number; offsetTop: number } | null;
	box: { top: number; height: number };
	scroll: { top: number; height: number };
	padBottom: string;
	safe: string;
	bottomBar: string;
	focused: string;
}

/**
 * The reading as one line of text.
 *
 * Split out of the measuring so the *format* can be asked without a browser:
 * everything above it is `getBoundingClientRect` and `getComputedStyle`, and
 * everything here is arithmetic and string-joining. The line itself is
 * unchanged to the character — a trace the owner has learned to read is not
 * something a refactor gets to reword (BC_E3_S162).
 */
export function readingOf(reading: ViewportReading): string {
	const { innerHeight, visual, box, scroll, padBottom, safe, bottomBar, focused } =
		reading;

	return (
		`window ${innerHeight}` +
		(visual === null
			? ""
			: ` · visual ${Math.round(visual.height)}@${Math.round(visual.offsetTop)}`) +
		` · pane ${Math.round(box.top)}+${Math.round(box.height)}` +
		` · scroll ${Math.round(scroll.top)}/${Math.round(scroll.height)}` +
		` · pad-bottom ${padBottom}` +
		` · safe-area ${safe.length > 0 ? safe : "unset"}` +
		` · bottom-bar ${bottomBar.length > 0 ? bottomBar : "unset"}` +
		` · focus ${focused}`
	);
}
