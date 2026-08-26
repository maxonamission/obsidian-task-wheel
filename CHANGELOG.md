# Changelog

All notable changes to Task Wheel. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the release workflow
lifts each version's section into the GitHub release notes.

## [0.1.2]

A round can only close honestly if no task is secretly on the wheel twice —
and a wheel can now say how busy each part of your life is.

- **Added**: *Show possible duplicate tasks* — a command (also in the round
  menu) that groups open checkboxes sharing the same words, across the whole
  vault, and links every place straight to its line in the note. Exact
  matches only, compared after stripping dates, priorities and tags — so a
  copy that later gained a due date is still found. The report names
  candidates and changes nothing: whether two identical texts are one task
  twice or two tasks on purpose is your call, in the note.
- **Added**: wedge sizes are now a choice — *Equal* (the default, unchanged:
  every domain the same slice, the strongest guarantee for spatial memory)
  or *By open tasks*, where busier domains get wider wedges. Proportional
  wedges re-divide only when a round begins, never mid-round, so the drawing
  cannot shift under your hands while you review. A configurable narrowest
  wedge (default 15°) keeps every domain wide enough to carry its own name —
  proportion is not worth an unreadable sliver. Hand-pinned wedges keep
  their width in both modes.

## [0.1.1]

Findings from the community-listing review, plus clearer store copy.

- **Fixed**: two CSS lint findings — a dead duplicate `flex` on the card's
  action buttons, and `all: unset` on the help panel's action links (replaced
  by explicit resets, which also restores focus visibility).
- **Changed**: the plugin description now opens with the problem the wheel
  solves instead of explaining its geometry.
- **Changed**: removed leftover placeholder text from the README.

## [0.1.0]

First public release.

- **The wheel**: every open task in your vault as a turnable radial tree —
  angle is the life domain, radius is the depth. A fixed reading wedge at
  twelve o'clock; one click stop per item; a round is complete when the circle
  closes, and the wheel says so.
- **Position stability**: every domain keeps a fixed angular budget, so
  spatial memory works. A fisheye around the reading wedge shows detail where
  you look without redistributing anything.
- **Nothing disappears silently**: folded branches and everything past the
  drawing budget stay visible as stumps with counters; an active filter always
  says what it is leaving out.
- **Scales**: a vault of two hundred tasks and one of twenty thousand produce
  the same amount of drawing.
- **Review actions on the card**: tick off, mark in progress, cancel, push a
  week out, raise or lower priority, open the note — routed through the Tasks
  plugin when it is installed, so recurring tasks roll over correctly.
- **Carrying work**: copy or move a task (with its subtasks) or a whole
  heading into another note, with its category path recreated over there.
  Named destinations become commands you can bind keys to.
- **Local wheels**: a wheel over one folder or one note, from the file list or
  by double-tapping an item; a way back out to the wider wheel.
- **Filters per wheel**: words (with `OR`, quotes, `*` and `file:`), status,
  dates (including "parked for later"), priority and tags. A changed filter
  is a new round, and the wheel says so.
- **Skip rules**: exclude checklists by note type or by heading, with a
  report that shows exactly what they take out.
- **Help surface**: a sidebar panel on desktop, a modal on mobile — keys and
  actions (only the ones your device has), the drawing's legend, and where
  this round stands. Speaks thirteen languages and follows Obsidian's own
  language setting.
- **Theme-true**: all colour comes from your theme's variables; works in
  light and dark, on desktop and mobile.
- **Private by design**: no network calls, no telemetry; release assets carry
  a build-provenance attestation.
