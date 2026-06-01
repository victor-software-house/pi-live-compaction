# VSH brand mark

Canonical Victor Software House wordmark.

## Files
- `vsh-mark.svg` — white VSH + coral dot. **Primary**, for dark backgrounds.
- `vsh-mark-dark.svg` — dark VSH + coral dot, for light backgrounds.
- `vsh-mark-gradient.svg` — gradient VSH + coral dot.
- `preview-*.png` — rendered previews.

## Spec
- **Letterform:** `VSH` set in **Bodoni 72 Book** (macOS system, `/System/Library/Fonts/Supplemental/Bodoni 72.ttc`, face index 0).
- **Outline source:** exact glyph contours extracted with **HarfBuzz** (`hb-view --font-size=upem`, shaped+kerned). No redraw, no smoothing.
- **Accent dot:** circle `cx=1912 cy=600 r=58`, coral `#f7768e`, raised to mid-height after the H (the "live / streaming" tick).
- **Gradient:** `#7aa2f7 → #bb9af7 → #f7768e` (blue → purple → coral), diagonal.
- **viewBox:** `-44 183 2074 843`.

## Reproduce
```sh
hb-view --font-file "/System/Library/Fonts/Supplemental/Bodoni 72.ttc" \
  --face-index=0 --output-format=svg --font-size=upem \
  --output-file=vsh.svg "VSH"
# then recolor glyph fill, add the coral dot circle, crop viewBox
```
Generator: `/tmp/vsh_final.py` (kept in session). Dot is the only non-typographic element — everything else is the exact Bodoni 72 outline.
