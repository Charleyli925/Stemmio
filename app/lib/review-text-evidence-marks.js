/**
 * Frozen character-evidence marks for AI review.
 *
 * These decorations are overlay-only. Marker spans must keep authored color,
 * font size, weight, line-height and existing decorations. Do not restyle the
 * glyphs themselves with color, emphasis, underline or background.
 */

export const REVIEW_TEXT_EVIDENCE_REMOVED_COLOR = "#d92d20";
export const REVIEW_TEXT_EVIDENCE_ADDED_COLOR = "#239b56";

export const REVIEW_TEXT_EVIDENCE_MARKER_CSS = `
  [data-stemmio-review-text="removed"],
  [data-stemmio-review-text="added"] {
    background: transparent !important;
    color: inherit !important;
    font: inherit !important;
    font-size: inherit !important;
    font-weight: inherit !important;
    font-style: inherit !important;
    line-height: inherit !important;
    letter-spacing: inherit !important;
    word-spacing: inherit !important;
    text-decoration: none !important;
    -webkit-text-emphasis: none !important;
    text-emphasis: none !important;
  }
`;

const FORBIDDEN_MARKER_DECLARATIONS = [
  { property: "color", allow: /^inherit$/iu },
  { property: "font-size", allow: /^inherit$/iu },
  { property: "font-weight", allow: /^inherit$/iu },
  { property: "line-height", allow: /^inherit$/iu },
  { property: "background", allow: /^transparent$/iu },
  { property: "text-decoration", allow: /^none$/iu },
  { property: "text-decoration-line", allow: /^(?:none|inherit)$/iu },
  { property: "text-emphasis", allow: /^none$/iu },
  { property: "text-emphasis-style", allow: /^none$/iu },
  { property: "-webkit-text-emphasis", allow: /^none$/iu },
  { property: "-webkit-text-emphasis-style", allow: /^none$/iu },
];

function parseDeclarations(block) {
  return block.split(";").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 0) return null;
    return {
      property: entry.slice(0, separator).trim().toLowerCase(),
      value: entry.slice(separator + 1).replace(/!important/iu, "").trim(),
    };
  }).filter(Boolean);
}

export function reviewTextEvidenceMarkerBlocks(css) {
  const source = String(css || "");
  const blocks = [];
  const pattern = /((?:[^{}]*\[data-stemmio-review-text="(?:added|removed)"\][^{}]*)+)\{([^}]+)\}/gu;
  let match = pattern.exec(source);
  while (match) {
    const tones = [...match[1].matchAll(/\[data-stemmio-review-text="(added|removed)"\]/gu)]
      .map((item) => item[1]);
    const declarations = parseDeclarations(match[2]);
    [...new Set(tones)].forEach((tone) => {
      blocks.push({ tone, declarations });
    });
    match = pattern.exec(source);
  }
  return blocks;
}

export function reviewTextEvidenceStyleViolations(css) {
  const violations = [];
  const blocks = reviewTextEvidenceMarkerBlocks(css);
  if (!blocks.some((block) => block.tone === "added")
    || !blocks.some((block) => block.tone === "removed")) {
    violations.push("missing added or removed character-evidence rule");
  }
  blocks.forEach((block) => {
    FORBIDDEN_MARKER_DECLARATIONS.forEach((rule) => {
      block.declarations
        .filter((declaration) => declaration.property === rule.property)
        .forEach((declaration) => {
          if (!rule.allow.test(declaration.value)) {
            violations.push(
              block.tone + " " + rule.property + " must stay " + String(rule.allow)
                + ", got " + declaration.value,
            );
          }
        });
    });
    const color = block.declarations.find((declaration) => declaration.property === "color");
    if (!color || color.value.toLowerCase() !== "inherit") {
      violations.push(block.tone + " must set color: inherit");
    }
    const emphasis = block.declarations.find((declaration) => (
      declaration.property === "text-emphasis"
      || declaration.property === "text-emphasis-style"
      || declaration.property === "-webkit-text-emphasis"
      || declaration.property === "-webkit-text-emphasis-style"
    ));
    if (!emphasis || emphasis.value.toLowerCase() !== "none") {
      violations.push(block.tone + " must disable text-emphasis");
    }
  });
  return violations;
}

export function reviewTextEvidenceGraphemeEnd(value, start) {
  const source = String(value || "");
  const index = Math.max(0, Math.trunc(Number(start) || 0));
  if (index >= source.length) return source.length;
  const code = source.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
    const extra = source.charCodeAt(index + 1);
    if (extra >= 0xdc00 && extra <= 0xdfff) return index + 2;
  }
  return index + 1;
}

export function reviewTextEvidenceIsWhitespaceCode(code) {
  return code === 0x0009
    || (code >= 0x000a && code <= 0x000d)
    || code === 0x0020
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff;
}

/**
 * Punctuation and standalone symbols carry no green dot.
 *
 * A dot per punctuation mark breaks the rhythm of the row without adding
 * evidence: the reader already sees which words changed. Removal keeps the
 * dotted rule an even sequence under letters, digits and ideographs only. The
 * red strikethrough is unaffected — a strike must stay a continuous line and
 * therefore still crosses punctuation.
 *
 * Ranges are checked by code point instead of a `\p{P}` regex so the predicate
 * stays self-contained for `toString()` injection into the projection iframe.
 */
export function reviewTextEvidenceIsPunctuationCode(code) {
  return (code >= 0x0021 && code <= 0x002f)
    || (code >= 0x003a && code <= 0x0040)
    || (code >= 0x005b && code <= 0x0060)
    || (code >= 0x007b && code <= 0x007e)
    || (code >= 0x00a1 && code <= 0x00a9)
    || code === 0x00ab
    || code === 0x00b7
    || code === 0x00bb
    || code === 0x00bf
    || (code >= 0x2010 && code <= 0x205e)
    || (code >= 0x20a0 && code <= 0x20bf)
    || (code >= 0x2190 && code <= 0x2bff)
    || (code >= 0x3001 && code <= 0x303f)
    || (code >= 0xfe10 && code <= 0xfe6f)
    || (code >= 0xff01 && code <= 0xff0f)
    || (code >= 0xff1a && code <= 0xff20)
    || (code >= 0xff3b && code <= 0xff40)
    || (code >= 0xff5b && code <= 0xff65);
}

export function reviewTextEvidenceUnits(value) {
  const source = String(value || "");
  const units = [];
  let index = 0;
  while (index < source.length) {
    const end = reviewTextEvidenceGraphemeEnd(source, index);
    const code = source.charCodeAt(index);
    if (
      !reviewTextEvidenceIsWhitespaceCode(code)
      && !reviewTextEvidenceIsPunctuationCode(code)
    ) {
      units.push({ start: index, end });
    }
    index = end;
  }
  return units;
}

/**
 * Give every rendered dot row one baseline and one radius.
 *
 * Font fallback resolves a Latin digit and a CJK ideograph inside the same span
 * to different physical fonts, so their client rects differ in top and height
 * and a purely per-character baseline scatters the dots vertically. Grouping the
 * row and taking its lowest baseline turns the sequence back into one even
 * dotted rule without ever covering a glyph.
 *
 * Rows are never merged across glyph sizes: a small caption run beside a large
 * headline number keeps its own natural depth instead of being dragged down to
 * the headline's baseline. Row membership is measured against the seed dot so a
 * row can never chain into the following text line.
 *
 * Self-contained by design — this runs inside the projection iframe through
 * `toString()` injection.
 */
export function alignReviewTextEvidenceDotRows(dots) {
  const rows = [];
  [...dots]
    .sort((left, right) => left.em - right.em || left.y - right.y || left.x - right.x)
    .forEach((dot) => {
      const row = rows.find((candidate) => (
        Math.abs(candidate.em - dot.em) <= Math.max(candidate.em, dot.em) * 0.12
        && Math.abs(candidate.anchorY - dot.y) <= Math.max(1, dot.em * 0.45)
      ));
      if (row) {
        row.y = Math.max(row.y, dot.y);
        row.radius = Math.max(row.radius, dot.radius);
        row.dots.push(dot);
        return;
      }
      rows.push({
        em: dot.em,
        anchorY: dot.y,
        y: dot.y,
        radius: dot.radius,
        dots: [dot],
      });
    });
  const aligned = [];
  const placed = new Set();
  rows.forEach((row) => {
    row.dots.forEach((dot) => {
      const key = Math.round(dot.x * 2) + "|" + Math.round(row.y * 2);
      if (placed.has(key)) return;
      placed.add(key);
      aligned.push({ ...dot, y: row.y, radius: row.radius });
    });
  });
  return aligned.sort((left, right) => left.y - right.y || left.x - right.x);
}

export function reviewTextEvidenceMarkGeometry(rect, fontSize, scale) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const right = Number(rect?.right) || 0;
  const bottom = Number(rect?.bottom) || 0;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const em = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : Math.max(8, height * 0.8);
  const uiScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const extra = Math.max(0, height - em);
  const glyphTop = top + extra / 2;
  const glyphBottom = glyphTop + em;
  const strikeThickness = Math.max(1.2, em * 0.1) * uiScale;
  // A round stroke cap extends each dash by half the stroke thickness at both
  // ends, so it grows every dash by one thickness and eats one thickness out of
  // every gap. Feeding the intended rhythm straight into stroke-dasharray
  // collapsed the gaps and rendered the strike as a solid red line. Convert the
  // intended visible rhythm into cap-compensated dash values instead, and keep
  // the visible gap wider than the visible dash so the line always reads dashed.
  // The rhythm scales with the thicker rule so a heavier stroke does not close
  // the gaps it has to keep.
  const visibleDash = Math.max(2.4, em * 0.18) * uiScale;
  const visibleGap = Math.max(3.2, em * 0.22) * uiScale;
  const inset = Math.min(width * 0.08, Math.max(0.4, em * 0.04));
  const dotRadius = Math.max(1.3, em * 0.08) * uiScale;
  const dotGap = Math.max(0.7, em * 0.04) * uiScale;
  const dotY = glyphBottom + dotGap + dotRadius;
  return {
    centerX: (left + right) / 2,
    glyphTop,
    glyphBottom,
    strikeY: glyphTop + em * 0.52,
    strikeLeft: left + inset,
    strikeRight: Math.max(left + inset, right - inset),
    strikeThickness,
    visibleDash,
    visibleGap,
    dash: Math.max(0.01, visibleDash - strikeThickness),
    gap: visibleGap + strikeThickness,
    dotX: (left + right) / 2,
    dotY,
    dotRadius,
    em,
    addedClearance: Math.max(0, (dotY + dotRadius) - bottom),
  };
}
