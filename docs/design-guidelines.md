# Design guidelines: neo2-flightpath desktop UI

Standing reference for the Electron desktop UI. Read before changing anything under `ui/`; AGENTS.md points here. This file is the source of truth for token names, patterns, states and copy; for exact values the code is authoritative (`ui/app/globals.css` for tokens and styles, `ui/components/`, `ui/icons/`, `ui/lib/`). Update this file in the same pull request as any UI change.

## 1. Purpose, scope and status

- **Scope:** the app UI: landing, player (video, map overlay, control bar), settings and export dialogs, icons, copy and error text. Native OS dialogs in `app/main.mjs` are not styled here; their wording follows section 10.
- **Out of scope:** the frames and map overlay rendered by `src/renderer/` (its palette included) and CLI output.
- **Tokens:** live only in the `:root` block of `ui/app/globals.css`, named by role. Components consume tokens through classes; inline styles are limited to runtime geometry (`pipStyle()`, loop band and progress widths, the map host's `isolation`).
- **Status:** dark theme only.

## 2. Principles and look and feel

### 2.1 Product principles

1. **Calm and precise.** One accent, neutral surfaces, short plain sentences.
2. **One primary action per surface.** The landing and the export form each have one primary button; the player bar has none.
3. **Every state visible.** Busy, waiting, canceling, disabled and failed states each show text (sections 8 and 11).
4. **Say what happened and what to do next.** Failures read as sentences, not codes (section 11).
5. **The footage is the hero.** The video is the main pane and the map a picture-in-picture pane (section 9).
6. **No decoration that competes with the video.** Video and map never animate (section 6); the chrome has no glow, gradient or blur.

### 2.2 Usability heuristics

[Jakob Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) guide every screen: system status, real-world match, user control, consistency, error prevention, recognition over recall, efficiency, minimalist design, error recovery and help.

### 2.3 Look and feel

- **Direction:** dark desktop UI: layered neutral surfaces (`--page` to `--surface-4`), 1 px hairline borders, one cyan accent (`--accent`), a violet loop color (`--loop`), 8 px and 12 px radii with pills, the Segoe UI Variable stack, icon plus label for landing and bar actions, 140 ms motion.
- **Dark only:** `color-scheme: dark` on `html` and `body`. There is no light theme.
- **Avoid:** neon glow, decorative gradients, background textures, skeuomorphic bevels, and highlights that are not states. Inset rings mark only the loop band and invalid fields (section 6).

## 3. Color

Color tokens live in the `:root` block of `ui/app/globals.css` (section 1):

| Token(s) | Role |
|---|---|
| `--page` | Page background |
| `--surface-1` … `--surface-4` | Surface ladder: cards → controls → hover fill → pressed fill |
| `--bar` | Control bar over the footage |
| `--scrim` | Dialog backdrop |
| `--hairline` / `--hairline-strong` / `--hairline-hover` | Decorative separators / control, dialog and PIP borders / hover borders |
| `--text` / `--text-2` / `--text-3` | Primary text / labels, readouts, paths / hints, legends, "Technical details" |
| `--accent` (hover `--accent-hover`, pressed `--accent-press`) | Primary fill, selected speed, checked toggle, played timeline range, progress fill |
| `--accent-ink` | Text and check mark on accent |
| `--focus` | Focus outline |
| `--danger` / `--warning` / `--info` | Invalid fields and danger notices / warning and info notices only |
| `--loop` / `--loop-text` | Loop band and ring / loop readout |

- **Accent** marks the primary action, the selected speed segment, a checked toggle, the played part of the timeline and the progress fills. It never marks loops, warnings or decoration. **Loop** colors mark only the loop band, its ring and the loop readout. **Warning** appears only in notices; **danger** appears in notices and on invalid fields and field messages.
- **Never color alone:** every state also has text — a label, `aria-invalid` with a message, or notice wording.
- **Contrast:** text needs 4.5:1 on its surface; focus, state fills and meaningful icons need 3:1. Disabled controls are exempt.
- `--tone` is a local property set by `.notice-info`, `.notice-warning` and `.notice-danger`. Literal colors outside `:root`: `#000` (video and PIP backgrounds), `#b9c6d6` (select chevron).

## 4. Typography

- **Stacks:** `--font-ui`: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif. `--font-mono`: ui-monospace, "Cascadia Mono", Consolas, monospace. No font file is bundled or loaded.
- **Type scale** (every size and weight in `ui/app/globals.css`): 28/600 landing title, 18/600 dialog titles, 16/600 landing primary button, 14/400 body and controls, 13/400 hints, legends and readouts, 12/400 mono details and paths.
- **Weights:** 400 and 600; 600 also on `h1`, `h2`, `button.primary`, `button.export-primary` and the pressed speed segment. Headings use `letter-spacing: -0.01em`.
- **Line height:** 1 for buttons; 1.5 for notice text, hints, landing copy and mono text.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`): readouts, number fields, the progress label and the preparation's tile count.
- **Case:** sentence case; capitals only for names and acronyms (ALT, SPD, HUD, SRT).
- **Characters:** "…" (U+2026), never three periods, for actions that open a dialog or picker (Open…, Export…) and for work in progress (Preparing…, Warming tiles…, Canceling…); "×" in sizes and speed ("1280×720", "1×"); "–" in ranges; " · " between parts of a summary; straight quotes inside error sentences.

## 5. Spacing

Spacing values are literals on this scale; use nothing else:

| Value | Used for |
|---|---|
| 2px | Speed group gap and padding |
| 4px | Legend padding |
| 8px | Gaps between controls: buttons, bar groups, dialog actions |
| 16px | Paddings and margins: buttons, fields, notices, bar sides, dialog sections |
| 24px | Dialog panel padding; landing primary padding |
| 32px | Landing card padding; room for the select chevron |
| 40px | Minimum height of a settings row |

- **Fixed sizes:** `--control-h` 36px (control height, §8.1); `--bar-h` 64px, 96px at 1440px and below (§9); `--dialog-top` 56px (dialog top offset, §8.5).
- **Other component sizes** (not spacing): 8px progress track and loop band height; 28px dismiss; 30px speed segment; 44px landing primary; 96px settings label and number field width.

## 6. Shape, elevation and motion

- **Radii:** `--radius-control` 8px (buttons, fields, select, notices, dismiss); `--radius-panel` 12px (landing card, dialog panel, PIP); `--radius-pill` 999px (speed group and segments, progress track and fill, loop band). Literals: 4px checkboxes, 50% radios (§8.2).
- **Borders:** 1 px. `--hairline` for decorative separators; `--hairline-strong` for controls, dialogs and the PIP; `--hairline-hover` on hover. Notice borders are the tone at 40%.
- **Shadows:** `--shadow-float` `0 24px 60px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)` (landing card, dialog panel, player notices); `--shadow-pip` `0 12px 32px rgba(0, 0, 0, 0.5)` (PIP). No other drop shadows.
- **Inset rings:** a 1 px inset ring marks two states only: the loop band (`--loop`) and an invalid field (`--danger`).
- **Scrim:** `--scrim` with `backdrop-filter: blur(2px)` on `.settings-overlay`. Blur belongs only behind dialogs; never on the bar or other surfaces.
- **Stacking:** dialog overlay 2000; player notices 3; PIP 2 (`ui/lib/pipstyle.ts`); the map host isolates its internal layers.
- **Motion tokens:** `--motion` 140ms; `--ease` `cubic-bezier(0.2, 0, 0, 1)`.
- **What moves:** buttons, checkboxes, radios, number fields and selects transition `background-color`, `border-color`, `color`, `transform` and `opacity`; the press shift (`translateY(1px)`) moves with its button. The progress fill animates `width` over 250ms.
- **What never moves:** the map (`.scene-host` and children set `animation: none` and `transition: none`), the video, the stage panes and the PIP swap (instant), the control bar, the timeline and loop band, notices, and dialog open and close. A toggle's check mark is a pseudo-element and does not transition.
- **Reduced motion:** `prefers-reduced-motion: reduce` sets `transition: none` on the transitioning controls and the progress fill; the press shift becomes instant.

## 7. Iconography

- **Style:** 24-unit grid (`viewBox="0 0 24 24"`), stroke only (`fill="none"`, `stroke="currentColor"`), stroke width 2, round caps and joins, `aria-hidden="true"`. Tests pin these attributes (`test/ui/lineicons.test.tsx`, `closeicon.test.tsx`, `settingsicon.test.tsx`).
- **Size:** every glyph carries `width="16"`; `button svg` in `ui/app/globals.css` pins the rendered size at 16px.
- **Color:** `currentColor` — the button's text color (`--text`, or `--accent-ink` on the primary and pressed speed segments).
- **Icon plus label** on landing and bar actions. Dialog footer buttons, speed segments ("1×") and the timeline use no glyph. No icon-only controls exist; a future one must carry `aria-label` and `title`.
- **Inventory:** vendored Lucide: `CloseIcon` ("x"), `SettingsIcon` ("settings"). Drawn for this app in the Lucide grid and stroke style: `PlayIcon`, `PauseIcon`, `FolderOpenIcon`, `SwapIcon`, `ExportIcon`, `MarkInIcon`, `MarkOutIcon`.

## 8. Components and states

### 8.1 Buttons

- **Recipe** (`button`): inline-flex; 36px high (`--control-h`); 0 16px padding; 14px text, line height 1; 8px gap; 16px glyph; 1px `--hairline-strong` border; `--surface-2` fill; `--radius-control`.

| Variant | Selector | Difference from the recipe | Used for |
|---|---|---|---|
| Default | `button` | None | Open…, In, Out, Clear, Swap view, Export…, Settings, Cancel, Cancel export, Reveal in folder, Open video, Close, Dismiss |
| Primary, landing | `button.primary` | Accent fill, `--accent-ink` text, 600, transparent border, 44px high, 0 24px padding, 16px text | Open… on the landing |
| Primary, dialog | `button.export-primary` | Accent fill, `--accent-ink` text, 600, transparent border; default size | Start export |
| Speed segment | `.speed-group button.speed` | Transparent fill, no border, 30px high, 0 8px padding, pill | 1×, 2×, 3×, 4× |
| Dismiss | `.notice-dismiss` | 28px high, 0 8px padding | Dismiss in notices |

- **States:** hover lightens (`--surface-3` fill and `--hairline-hover` border; `--accent-hover` fill on primaries; `--surface-3` on speed segments), pressed darkens (`--surface-4` fill, `--accent-press` on primaries) and shifts 1px down (speed segments only shift), `:focus-visible` shows a 2px `--focus` outline at 2px offset, and disabled drops to `--disabled-opacity` 0.45 with the default cursor and no hover or pressed change.

### 8.2 Toggles

- Checkboxes and radios are custom: 16px box, `--surface-2` fill, 1px `--hairline-strong` border; checkbox radius 4px, radio 50%. Checked: `--accent` fill and border with the check mark or dot in `--accent-ink`. Unchecked hover: `--hairline-hover` border. Disabled: 0.45 opacity. Each sits in a `label.settings-row` with its text.
- HUD chips are checkboxes. "Altitude (ALT)" is disabled, with the title "Altitude unavailable in this telemetry", when the recording has no altitude. The export "What" choice uses radios.

### 8.3 Notices

- One component, `Notice` (`ui/components/Notice.tsx`), props `tone` (`info`, `warning`, `danger`), `details`, `onDismiss`. It renders `notice notice-{tone}`: 16px padding, 8px gap, 8px radius, an 11% tone tint over `--surface-1`, and a 40% tone border.
- **Error notices** go through `ErrorNotice` (`ui/components/ErrorNotice.tsx`), props `message`, `lead`, `tail`, `onDismiss`: it runs the message through `describeError()` (section 11) and renders `Notice tone="danger"`, so every failure surface assembles the same pipeline.
- Text 14px, line height 1.5. Details: a "Technical details" disclosure with the original text in 12px mono. Roles: `danger` is `alert`; `info` and `warning` are `status`.

| Tone | Used for |
|---|---|
| `info` | Open preparing; no recording picked; export summary; export canceled |
| `warning` | Settings: no altitude telemetry, so the ALT chip stays off |
| `danger` | Open failed; export could not start; export failed; reveal or open failed; cancel failed |

- **Placement:** landing, below Open… (16px top margin). Player: a centered overlay at the top of the stage (16px from the top, at most 560px wide, z-index 3, `--shadow-float`), showing only Open preparing and Open errors. Dialogs: above the footer on the export form and while running; under the title in the done, canceled and error phases. Settings: inside the HUD chips group.
- **Dismissible:** only when the owner passes `onDismiss`; today only Open errors are. Notices that describe a state clear when the state changes. Export form errors clear on the next form edit or start; action and cancel errors clear on the next attempt or when the job settles (`ui/lib/exportstate.ts`).

### 8.4 Fields

- **Settings row:** label (`label.settings-label`, 96px, `--text-2`), control (36px high, `--surface-2`, 1px `--hairline-strong` border, 8px radius, 0 16px padding, 14px text), and one helper slot holding the hint (`.hint`, 13px, `--text-3`) or the message (`.field-message`, 13px, `--danger`).
- **Number field** (`NumberField`): 96px wide, tabular numerals, `min` and `step` props (step 1; 0.5 for Intro and Outro). A valid value applies at once. A value that is not finite, is below `min`, or fails the owner's check is rejected: the typed text stays, `aria-invalid="true"` is set, the border turns `--danger` with a 1px inset ring, `aria-describedby` points at the message, and the message replaces the hint: "Must be {rule}." Rules in use: "0 or more", "at least 64 px". On blur the typed text is dropped and the last valid value shows.
- **Select** (`SelectField`): a native `select` styled as a field (`appearance: none`, 32px right padding, chevron as background image). Options show plain labels; the raw vocabulary value is what applies.
- **Groups:** `fieldset.settings-group` with a 13px `legend` in `--text-3`: "HUD chips"; "What" and "How" in export.

### 8.5 Dialogs

- **Anatomy:** overlay `.settings-overlay`; panel `.settings-panel` (`role="dialog"`, `aria-label` "Settings" or "Export"); header `.settings-header` (18px title and the header close); body; footer `.dialog-actions` (right-aligned, wrapping, 8px gap, 16px top margin), export only. Settings has no footer and applies changes on change.
- **Position and size:** the top edge sits 56px (`--dialog-top`) below the window top in every phase. The panel is `min(440px, 100%)` wide, padded 24px, at most `100vh − 80px` high, and scrolls inside.
- **Header close** (`DialogClose`): always present, labeled "Close" with a glyph. While closing would interrupt work it is disabled, and its `title` gives the reason: "Export is running. Cancel it to close."
- **Footer by phase** (export):

| Phase | Footer | Notice |
|---|---|---|
| Form | Cancel (closes); Start export (primary) | Danger, for a start or file error |
| Running | Cancel export (disabled while canceling) | Progress above; danger when a cancel fails |
| Done | Reveal in folder; Open video; Close | Info summary; output path above; danger when a reveal or open fails |
| Canceled | Close | Info |
| Error | Close | Danger; ends "The destination file was left untouched." |

- **Escape and backdrop:** Settings closes on Escape, backdrop click or header Close at any time. Export closes on them only when not running; while running they are ignored. One rule drives all three, from the dialog visibility state (`ui/lib/dialogstate.ts`): the export modal reports its job's start and finish there, and the header close and backdrop read the dismissal rule back.
- **Lock while busy:** during an export the header close is disabled, and closing the window asks "An export is in progress" (native prompt, `app/main.mjs`). Cancel export is the only way out.
- **Shortcuts:** while a dialog is open, player shortcuts are off; only Escape reaches the dialog logic (section 13).

### 8.6 Progress

- **Determinate:** one component, `ProgressBar` (`ui/components/ProgressBar.tsx`), carries the pattern: `.progress-track` (8px high, `--surface-2`, pill) holds `.progress-fill` (`--accent`, width = rounded percent). `role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` = the percent; the `aria-label` names the work ("Export progress", "Preparation progress").
- **Export:** the label below (13px, `--text-2`, `.progress-label`) reads "Rendering 83%" from typed capture-progress events (`CaptureProgress` done/total counts, `ui/lib/exportstate.ts`).
- **Loading:** while a recording is prepared, the bar sits above the status notice (`.prepare-status`, 8px gap) on the landing card and in the player's Open overlay. Steps: one per preparation stage (probe → telemetry → view plan) and one per planned tile during the map pre-warm — 3 + tile count steps in all (`PrepareProgress`, `src/run.ts`) — so every fetched tile (downloaded, cached or failed) advances the bar and it fills completely before the player opens. The notice names the running stage: "Probing the recording…" (probe), "Loading telemetry…" (telemetry), "Planning the view…" (view plan), "Warming tiles… 12/48" (tile pre-warm, with the running count; `ui/lib/preparetext.ts`).
- **Unknown amount:** no indeterminate bar exists. The export label reads "Preparing…" and the fill stays at 0%; while canceling it reads "Canceling…".
- **Busy controls:** the landing Open… reads "Preparing…" and is disabled while the recording is prepared; the player's Open… is disabled; Play reads "Warming tiles…" and is disabled until the map is ready.

## 9. Layout and responsiveness

- **Window:** default 1600×950; minimum 1024×600 (`app/main.mjs`).
- **Landing:** card at most 560px wide, 32px padding, 12vh top margin, centered.
- **Player stage:** fills the area above the control bar. The video is the main pane (`object-fit: contain`, black letterbox). By default the map is the picture-in-picture pane: 30% of the stage width in a 16:9 frame; a video in that pane takes its own aspect, and a portrait video takes 45% of the stage height. The pane sits 16px from the right and bottom edges. Swap view exchanges the two.
- **Control bar:** `--bar-h` 64px. Above 1440px it is one row: Open… (left); transport (center: Play, In, Out, Clear, timeline, time readout, loop readout, speed group); Swap view, Export… and Settings (right). Gaps 8px; padding 0 16px.
- **At 1440px and below:** the bar is 96px high in two rows. The left and right groups share the first row; the transport takes the second. Row gap 8px; padding 8px 16px.
- **Timeline:** minimum 120px, `clamp(120px, 28vw, 420px)` wide, growing to fill its row.
- **Dialogs:** `min(440px, 100%)` wide; top offset 56px (§8.5).

## 10. Copy and labels

- **Rules:** verb-first actions ("Open…", "Start export", "Cancel export", "Reveal in folder"); nouns for toggles and destinations ("Settings", "Swap view"); short phrases for status ("Preparing…", "Warming tiles…", "Canceling…"). Sentence case. American English ("canceled", "Canceling…"). No exclamation marks.
- **One name per action:** "Open…" on the landing and the player; "Export…" in the bar opens the dialog titled "Export".
- **Ellipsis:** verb-first actions that open a dialog or picker, and work in progress (section 4). **Shortcuts** go in parentheses in the `title`: "Set loop in (I)".
- **Raw identifiers** belong under "Technical details" or in the CLI, never in main UI text.

| Where | Labels |
|---|---|
| Landing and player bar | Open…, Preparing…, Play / Pause, Warming tiles…, In, Out, Clear (`aria-label` "Set loop in", "Set loop out", "Clear loop"), Swap view, Export…, Settings |
| Preparation status | Probing the recording…, Loading telemetry…, Planning the view…, Warming tiles… 12/48 (running tile count) |
| Export dialog | Start export, Cancel, Cancel export / Canceling…, Reveal in folder, Open video, Close; progress "Rendering N%" / "Preparing…" |
| Export "What" | Full recording (0:34); In–Out segment (0:10–0:12 · 121 frames) — shown only when a loop is set |
| Export "How" | Width, Height; hint "px"; message "Must be at least 64 px." |
| Settings | Map style (Satellite, Topographic), View (Follow, Overview), Zoom, Zoom-out, Intro (s), Outro (s); HUD chips: Heading arrow, Altitude (ALT), Speed (SPD) |
| Notices | Dismiss; "Technical details" |

## 11. Error guidance

- **Flow:** the owning component renders `ErrorNotice` (`ui/components/ErrorNotice.tsx`) with the raw backend or Node message; it runs `describeError()` (`ui/lib/errortext.ts`), which yields `{ text, technical }`, and renders `Notice tone="danger"`: `text` is the main line; `technical` sits under "Technical details". Open errors pass `lead` "Could not open the recording:"; the export error phase passes `tail` "The destination file was left untouched."
- **Mapping:** (1) a message that starts with a Node code (`EEXIST`, `ENOENT`, `EACCES`, `EPERM`, `ENOSPC`, `EBUSY`, `EISDIR`) becomes "{what happened} {what to do}", naming the file when the message ends with a quoted path; (2) one of 13 known app messages becomes its sentence; (3) any other message passes through unchanged as the main line, with no technical text.
- **Sentence pattern:** what happened, in plain words with the cause when known, then what to do next. The original message always sits under "Technical details":

| Message in | Main line shown |
|---|---|
| `not a readable .mp4 file: <path>` (Open) | Could not open the recording: "<name>" is not a readable .mp4 recording. |
| `EEXIST: file already exists, mkdir '<path>'` (export) | A file named "<name>" is in the way. Choose another folder or file name. The destination file was left untouched. |
| `ENOSPC: …` | The disk is full. Free some space or choose another drive. |

- **Tones:** danger when an action failed and the user must act; info for a neutral result or progress; warning when the result stands but something is missing or limited.
- **"Left untouched":** only for export outcomes — true because the export writes a `.partial` file beside the destination and replaces it only after verification (`src/exportjob.ts`). Never use it for Open errors.
- **Never in the main line:** Node codes, stack text, or a path other than a file name — except the kept render, which the user must open.
- **Adding a message:** map it in `ui/lib/errortext.ts`, add a test in `test/ui/errortext.test.ts`, choose a tone, follow the pattern. Field validation is not error text; it uses "Must be {rule}.".

## 12. Numbers and formats

- **Frame rate:** `formatFrameRate` (`ui/lib/framerate.ts`) turns a rational rate into decimal fps rounded to hundredths, with " fps" (60000/1001 → "59.94 fps").
- **Time:** `formatTime` (`ui/lib/framedriver.ts`) gives m:ss from whole seconds, rounded, with no hour field. Readout "0:00 / 0:34"; loop readout "loop 0:10–0:12" ("?" for an unset point); segment "0:10–0:12 · 121 frames" (frames = out − in + 1).
- **Frames and seeks:** time is frame index ÷ fps; a one-second jump is `round(fps)` frames (`framesForSeconds`).
- **Export summary:** "{frames} frames @ {fps} · {seconds} s · {width}×{height}". Seconds are whole; width and height are the even sizes rendered (each rounded down, minimum 64), so they can differ from the typed values. Dimensions are px, minimum 64 (`MIN_DIMENSION`, `src/config.ts`).
- **Percent:** whole percent, rounded ("Rendering 83%"). **Units:** px, s, m, fps; speed uses "×". **Numerals:** tabular for readouts, number fields and the progress label; decimal point "."; " · " between parts; "–" for ranges; "×" for sizes and speed.

## 13. Accessibility

- **Focus:** `:focus-visible` shows a 2px `--focus` (white) outline, offset 2px, on buttons, inputs (including toggles and the timeline), selects and summaries. Mouse clicks do not show it.
- **Contrast:** every text token meets 4.5:1 on each surface where it is used; the accent, focus ring and state fills meet 3:1 (section 3).
- **Names:** icon-plus-label buttons have visible text; Settings and Close also set `aria-label`; loop buttons set `aria-label` and a `title` with the key; the timeline slider has `aria-label` "Playback position"; dialogs have `role="dialog"` and an `aria-label`; the progress bar has `role="progressbar"` and a label; fields use `label` with `htmlFor`; groups use `fieldset` and `legend`; speed segments use `aria-pressed` in a group labeled "Playback speed".
- **Disabled reasons:** the visible label when it states the reason ("Preparing…", "Warming tiles…", "Canceling…") or a `title`: the header close during an export ("Export is running. Cancel it to close."), the altitude toggle, and Clear without a loop ("No loop to clear.").
- **Keyboard** (`ui/lib/hotkeys.ts`, `PlayerChrome.tsx`): Space or K play and pause; 1–4 set speed; Home and End seek; I and O set loop points; S swaps the views; Left and Right step one frame; Shift with Left or Right jumps one second; Ctrl+O opens a recording; Escape closes the open dialog, or clears the loop when none is open, and does nothing while an export runs. Shortcuts are off in text fields, selects and text areas, and while a dialog is open (only Escape gets through). Space is also off over a focused button, link or disclosure, which it activates instead. Only the arrow keys repeat when held.
- **Motion:** reduced motion removes all transitions; video and map never animate (section 6).
- **Announcements:** danger notices are alerts; info and warning notices are status messages. The progress bar exposes `aria-valuenow`.
- **Text size:** the smallest text is 12px (mono details and paths); body text is 13–14px. Sizes are fixed in px and do not follow a system text-size setting.
