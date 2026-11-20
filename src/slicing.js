// Splits large inputs into overlapping slices so a scan can yield to the host
// event loop between slices and so per-slice cost (and the per-slice timeout)
// stays bounded. Findings from the overlap are reported twice at identical
// global offsets; the caller's interval merge removes the duplicates.

export const DEFAULT_SLICE_CHARS = 32_768;
// Must exceed the widest context any detection rule reads across a delimiter.
export const DEFAULT_OVERLAP_CHARS = 4_096;

const PEM_BEGIN = "-----BEGIN ";
const PEM_END = "-----END ";
const PEM_DASHES = "-----";
// The private-key rules match bodies of at most 10,000 characters, so a longer
// armored range gains nothing from staying whole and would defeat slicing.
const MAX_PEM_RANGE_CHARS = 16_384;

/** `[start, end)` ranges of every BEGIN..END armored block, found in linear time. */
function pemRanges(text) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const begin = text.indexOf(PEM_BEGIN, from);
    if (begin < 0) break;
    const endMarker = text.indexOf(PEM_END, begin);
    if (endMarker < 0) break;
    const closingDashes = text.indexOf(PEM_DASHES, endMarker + PEM_END.length);
    const stop = closingDashes < 0 ? text.length : closingDashes + PEM_DASHES.length;
    if (stop - begin <= MAX_PEM_RANGE_CHARS) ranges.push([begin, stop]);
    from = stop;
  }
  return ranges;
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f" || char === "\v";
}

/** Last newline, else last whitespace, in `(floor, end]`; `end` when there is none. */
function cutPoint(text, floor, end) {
  let whitespace = -1;
  for (let i = end; i > floor; i -= 1) {
    if (text[i] === "\n") return i;
    if (whitespace < 0 && isWhitespace(text[i])) whitespace = i;
  }
  return whitespace < 0 ? end : whitespace;
}

/**
 * Start of the next slice: the position after the nearest whitespace at or
 * before `target` (looking back no further than `floor`), so the overlap
 * is never shorter than `target` implies; `target` itself when there is none.
 */
function startAtOrBeforeDelimiter(text, target, floor) {
  for (let i = target; i > floor; i -= 1) {
    if (isWhitespace(text[i - 1])) return i;
  }
  return target;
}

/**
 * Plans `[start, end)` slices covering all of `text`. Cuts fall on a newline
 * or whitespace where one exists within the overlap window, never inside an
 * armored (PEM) block of at most MAX_PEM_RANGE_CHARS, and consecutive slices
 * overlap by at least `overlapChars` (an unbroken run is cut hard).
 */
export function planSlices(text, { sliceChars = DEFAULT_SLICE_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS } = {}) {
  if (text.length <= sliceChars) return [{ start: 0, end: text.length }];

  const pem = pemRanges(text);
  const slices = [];
  let start = 0;
  for (;;) {
    let end = Math.min(text.length, start + sliceChars);
    if (end < text.length) {
      end = cutPoint(text, Math.max(start, end - overlapChars), end);
      const enclosing = pem.find(([begin, stop]) => begin < end && end < stop);
      if (enclosing) end = enclosing[1];
    }
    slices.push({ start, end });
    if (end >= text.length) return slices;
    const target = Math.max(start + 1, end - overlapChars);
    start = startAtOrBeforeDelimiter(text, target, Math.max(start + 1, target - overlapChars));
  }
}

/** Resolves on a later timers-phase macrotask, letting due host timers and I/O callbacks run. */
export function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
