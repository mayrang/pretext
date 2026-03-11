## Pretext

Internal notes for contributors and agents. Use `README.md` as the public source of truth for API examples and user-facing limitations. Use `STATUS.md` for the compact current browser-accuracy / benchmark snapshot, `corpora/STATUS.md` for the compact corpus snapshot, and `RESEARCH.md` for the detailed exploration log.

### Commands

- `bun start` — serve pages at http://localhost:3000 (kills stale `:3000` listeners first)
- `bun run check` — typecheck + lint
- `bun test` — lightweight invariant tests against the shipped implementation
- `bun run accuracy-check` / `:safari` / `:firefox` — browser accuracy sweeps
- `bun run benchmark-check` / `:safari` — benchmark snapshot with both the short shared corpus and long-form corpus stress rows
- `bun run corpus-check --id=... --font='20px ...' --lineHeight=32` — corpus spot check with optional font override
- `bun run corpus-sweep --id=... --samples=9 --font='20px ...'` — sampled width sweep; use this before a dense sweep on large corpora
- `bun run corpus-font-matrix --id=... --samples=5` — sampled cross-font check for one checked-in corpus
- `bun run gatsby-check` / `:safari` — Gatsby canary diagnostics
- `bun run gatsby-sweep --start=300 --end=900 --step=10` — fast Gatsby width sweep; add `--diagnose` to rerun mismatching widths through the slow checker
- `bun run probe-check --text='...' --width=320 --font='20px ...' --dir=rtl --lang=ar --method=range|span` — isolate a single snippet in the real browser and choose the browser-line extraction method explicitly
- `bun run corpus-check --id=mixed-app-text --diagnose --method=span|range 710` — compare corpus-line extraction methods directly when a mismatch may be diagnostic-tool sensitive

### Important files

- `src/layout.ts` — core library; keep `layout()` fast and allocation-light
- `src/measure-harfbuzz.ts` — HarfBuzz backend kept for ad hoc measurement probes
- `src/test-data.ts` — shared corpus for browser accuracy pages/checkers and benchmarks
- `src/layout.test.ts` — small durable invariant tests for the exported prepare/layout APIs
- `pages/accuracy.ts` — browser sweep plus per-line diagnostics
- `pages/benchmark.ts` — performance comparisons
- `pages/bubbles.ts` — bubble shrinkwrap demo

### Implementation notes

- `prepare()` / `prepareWithSegments()` do horizontal-only work. `layout()` / `layoutWithLines()` take explicit `lineHeight`.
- `prepare()` should stay the opaque fast-path handle. If a page/script needs segment arrays, that should usually flow through `prepareWithSegments()` instead of re-exposing internals on the main prepared type.
- `prepare()` is internally split into a text-analysis phase and a measurement phase; keep that seam clear, but keep the public API simple unless requirements force a change.
- The internal segment model now distinguishes at least five break kinds: normal text, collapsible spaces, non-breaking glue (`NBSP` / `NNBSP` / `WJ`-like runs), zero-width break opportunities, and soft hyphens. Do not collapse those back into one boolean unless the model gets richer in a better way.
- `layout()` is the resize hot path: no DOM reads, no canvas calls, no string work, and avoid gratuitous allocations.
- Segment metrics cache is `Map<font, Map<segment, metrics>>`; shared across texts and resettable via `clearCache()`. Width is only one cached fact now; grapheme widths and other segment-derived facts can be populated lazily.
- Word and grapheme segmenters are hoisted at module scope. Any locale reset should also clear the word cache.
- Punctuation is merged into preceding word-like segments only, never into spaces.
- Arabic no-space punctuation clusters such as `فيقول:وعليك` and `همزةٌ،ما` are merged during `prepare()`; keep that logic in preprocessing, not `layout()`.
- That Arabic no-space merge set is intentionally narrow right now: colon / period / Arabic comma / Arabic semicolon. Repeated `!` was a counterexample that over-merged.
- If `Intl.Segmenter` emits an Arabic punctuation cluster with trailing combining marks (for example `،ٍ`), still treat the whole cluster as left-sticky punctuation during preprocessing. The browser keeps `بكشء،ٍ` together.
- If `Intl.Segmenter` emits `" " + combining marks` before Arabic text (for example `كل ِّواحدةٍ`), split it into `" "` plus marks-prefix-on-next-word during preprocessing.
- `NBSP`-style glue should survive `prepare()` as visible content and prevent ordinary word-boundary wrapping; `ZWSP` should survive as a zero-width break opportunity.
- Soft hyphens should stay invisible when unbroken, but if the engine chooses that break, the broken line should expose a visible trailing hyphen in `layoutWithLines()`.
- Astral CJK ideographs must still hit the CJK path; do not rely on BMP-only `charCodeAt()` checks there.
- Non-word, non-space segments are break opportunities, same as words.
- CJK grapheme splitting plus kinsoku merging keeps prohibited punctuation attached to adjacent graphemes.
- Emoji correction is auto-detected per font size, constant per emoji grapheme, and effectively font-independent.
- Bidi levels now stay on the rich `prepareWithSegments()` path. The opaque fast `prepare()` handle should not pay for bidi metadata that `layout()` does not consume.
- Supported CSS target is the common app-text configuration: `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`, `line-break: auto`.
- `system-ui` is unsafe for accuracy; canvas and DOM can resolve different fonts on macOS.
- Thai historically mismatched because CSS and `Intl.Segmenter` use different internal dictionaries; keep it in the browser sweep when changing segmentation rules.
- HarfBuzz probes need explicit LTR to avoid wrong direction on isolated Arabic words.
- Accuracy pages and checkers are now expected to be green in all three installed browsers on fresh runs; if a page disagrees, suspect stale tabs/servers before changing the algorithm.
- Keep `src/layout.test.ts` small and durable. For browser-specific or narrow hypothesis work, prefer throwaway probes/scripts and promote only the stable invariants into permanent tests.
- For Gatsby canary work, sweep widths cheaply first and only diagnose the mismatching widths in detail. The slow detailed checker is for narrowing root causes, not for every width by default.
- For Arabic corpus work, trust the RTL `Range`-based diagnostics over the old span-probe path. The remaining misses are currently more about break policy than raw width sums.
- For Arabic probe work, always use normalized corpus slices and the exact corpus font. Raw file offsets or a rough fallback font will mislead you.
- The corpus/probe diagnostic pages now compute our line offsets directly from prepared segments and grapheme fallbacks; do not go back to reconstructing them from `layoutWithLines().line.text.length`.
- The Arabic corpus text has already been cleaned for quote-before-punctuation spacing artifacts like `" ،`, `" .`, and `" ؟`, plus a few obvious `space + punctuation` typos (`هيهات !`, `دجاك ؟!`, `القيان :`). Treat those as corpus hygiene, not engine behavior.
- The repeated Arabic fine-width miss around `قوله:"...` was also a source-text issue; normalizing that one occurrence to `قوله: “...` removed several widths without touching the engine.
- Thai prose can expose ASCII quote behavior like `ทูลว่า "พระองค์...`; treating `"` as contextual quote glue in preprocessing helps there without needing a Thai-specific rule.
- Khmer anthology (`ប្រជុំរឿងព្រេងខ្មែរ/ភាគទី៧`, stories 1-10) is now a checked-in Southeast Asian stress canary. Keep the explicit zero-width separators from source cleanup; flattening them would destroy the useful break-opportunity signal.
- A Lao raw-law corpus was tried and rejected. The source text was stored as wrapped print lines, which made it a dirty `white-space: normal` canary. Do not resurrect that path unless the acquisition method changes.
- Myanmar prose (`စဉ်းလဲသော ဗျိုင်း (ဆရာ)`) is now a clean checked-in Southeast Asian canary, and the current sampled sweep is exact in Chrome.
- The Myanmar keeps are still semantic, not script-specific engine overreach: `၊` / `။` / `၍` / `၌` / `၏` stay attached during preprocessing, and `၏` also acts as medial glue so clusters like `ကျွန်ုပ်၏လက်မ` do not break in the middle.
- Do not assume the sampled Myanmar sweep means the script is solved. The fuller `step=10` field is still imperfect, and two tempting follow-ups were both rejected: broad Myanmar grapheme breaks in normal wrapping, and closing-quote + `ဟု` glue. Both helped Chrome and hurt Safari.
- A second clean Myanmar corpus (`မကောင်းမှုဒဏ် ကိုယ့်ထံပြန် (ဆရာ)`) is now checked in. It is exact at the anchor widths, healthier overall than the first Myanmar text, but it still shows the same broad closing-quote + `ဟု` class in Chrome while Safari disagrees locally. Treat that class as diagnostic signal, not a safe shared-engine heuristic.
- `/corpus`, `corpus-check`, and `corpus-sweep` now accept `font` / `lineHeight` overrides. Use those before inventing a second page or checker when the question is “does this same corpus stay healthy under another font?”
- The sampled Chrome font matrix stayed exact across the current Korean/Thai/Khmer/Hindi/Arabic/Hebrew corpora. Safari font-matrix automation is slower and noisier, so Chrome is the better first pass and Safari should be treated as follow-up smoke coverage.
- Mixed app text is now a first-class canary. Use it to catch product-shaped classes like URL/query-string wrapping, emoji ZWJ runs, and mixed-script punctuation before tuning another book corpus.
- URL-like runs such as `https://...` / `www...` are currently modeled as two breakable preprocessing units when a query exists: the path through the query introducer (`?`), then the query string. This is intentionally narrow and exists to stop obviously bad mid-path URL breaks without forcing the whole query string to fragment character-by-character.
- Mixed app text also pulled in two more keep-worthy preprocessing rules: contextual escaped quote clusters like `\"word\"`, and numeric/time-range runs like `२४×७` / `7:00-9:00`.
- For Southeast Asian scripts or mixed text containing Thai/Lao/Khmer/Myanmar, trust the `Range`-based corpus diagnostics over span-probing; span units can perturb line breaking there.
- That rule now has one explicit caveat: the remaining mixed-app `710px` soft-hyphen miss is extractor-sensitive. Compare `--method=span` and `--method=range` before changing the engine, and do not assume either extractor is the whole truth by itself.
- A second Thai prose corpus (`นิทานเวตาล เรื่องที่ ๗`) is now checked in and exact at Chrome/Safari anchor widths plus a 9-sample Chrome sweep. Treat current Thai support as broader than one lucky story, but still verify new Thai text before declaring the whole script “done.”
- Khmer anchor widths were exact in both Chrome and Safari, and a 9-sample Chrome sweep was exact. The full `step=10` sweep was slow enough to be annoying, so use `--samples=<n>` first unless you specifically need every width.
- The corpus diagnostics should derive our candidate lines from `layoutWithLines()`, not from a second local line-walker. That avoids SHY and future custom-break drift between the hot path and the diagnostic path.
- Current line-fit tolerance is `0.005` for Chromium/Gecko and `1/64` for Safari/WebKit. That bump was justified by the remaining Arabic fine-width field and did not move the solved browser corpus or Gatsby coarse canary.

### Open questions

- Locale switch: expose a way to reinitialize the hoisted segmenters and clear cache for a new locale.
- Decide whether line-fit tolerance should stay as a browser-specific shim or move to runtime calibration alongside emoji correction.
- If a future Arabic corpus still exposes misses after preprocessing and corpus cleanup, decide whether that needs a richer break-policy model or a truly shaping-aware architecture beyond segment-sum layout.
- `layoutWithLines()` now returns line boundary cursors (`start` / `end`) in addition to `{ text, width }`; keep that data model useful for future manual reflow work.
- ASCII fast path could skip some CJK, bidi, and emoji overhead.
- Benchmark methodology still needs review.
- `pages/demo.html` is still a placeholder.
- Additional CSS configs are still untested: `break-all`, `keep-all`, `strict`, `loose`, `anywhere`, `pre-wrap`.

### Related

- `../text-layout/` — Sebastian Markbage's original prototype + our experimental variants.

### TODO
- TweetDeck-style 3 columns of the same text scrolling at the same time
- Resize Old Man and the Sea
- Creative responsive magazine-like layout contouring some shapes
- Revisit whitespace normalization only for the remaining NBSP / hard-space edge cases, not ordinary collapsible whitespace
- Decide whether to add an explicit server canvas backend path now that `src/layout.ts` imports safely in non-DOM runtimes
- Decide whether explicit hard line breaks / paragraph-aware layout belong in scope beyond the current `white-space: normal` collapsing model
- Decide whether automatic hyphenation beyond manual soft-hyphen support is in scope for this repo
- Decide whether intrinsic sizing / logical width APIs are needed beyond fixed-width height prediction
- Decide whether bidi rendering strategy work (selection / copy-paste preserving runs) belongs here or stays out of scope
- Decide whether richer text-engine features like ellipsis, per-character offsets, custom selection, vertical text, or shape wrapping should remain explicitly out of scope
