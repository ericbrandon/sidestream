# Linux Font Semi-Bold Problem

## Problem Statement
On Linux, text elements using Tailwind's `font-medium` (weight 500) and `font-semibold` (weight 600) classes appear as regular weight (400) instead of their intended weights. This affects:
- Discovery chip titles (collapsed one-liner text)
- Saved chat session names in the sidebar

On macOS, these same elements display correctly with visible weight differences.

## What We've Tried

### 1. Platform Detection + CSS Override
Added JavaScript platform detection in `App.tsx` that adds a class to `<html>`:
```typescript
if (platform.includes('linux') || userAgent.includes('linux')) {
  document.documentElement.classList.add('platform-linux');
}
```

Then in CSS, we override the font-family for Linux to prioritize bundled Noto Sans:
```css
html.platform-linux body {
  font-family: 'Noto Sans', 'DejaVu Sans', Roboto, Oxygen, Ubuntu, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### 2. Bundled Noto Sans Font Files
We bundle Noto Sans TTF files in `public/fonts/`:
- NotoSans-Regular.ttf (400)
- NotoSans-Medium.ttf (500) - **newly added**
- NotoSans-SemiBold.ttf (600) - **newly added**
- NotoSans-Bold.ttf (700)
- NotoSans-Italic.ttf
- NotoSans-BoldItalic.ttf

**Important**: The initial Medium and SemiBold downloads were corrupted (HTML error pages instead of font files). We re-downloaded them from `https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/` and verified they are actual TrueType font files (~550KB each).

### 3. @font-face Declarations
In `index.css`:
```css
@font-face {
  font-family: 'Noto Sans';
  src: url('/fonts/NotoSans-Medium.ttf') format('truetype');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Noto Sans';
  src: url('/fonts/NotoSans-SemiBold.ttf') format('truetype');
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}
```

### 4. Debug Logging
Added comprehensive logging to `App.tsx` that writes to `~/.local/share/com.sidestream.app/logs/debug.log`:
- `navigator.platform` and `navigator.userAgent` values
- Which platform class was added to HTML
- Computed `font-family` on body
- All loaded fonts via `document.fonts` API
- Whether each Noto Sans weight (400, 500, 600, 700) passes `document.fonts.check()`
- Computed styles on a `.font-medium` element

## Current Hypothesis

The problem could be one of several things:

1. **Platform detection not working**: The `platform-linux` class may not be getting added to `<html>`, so the Linux-specific CSS rule isn't applying and the base font-family (which lists system fonts before Noto Sans) is being used.

2. **Font files not loading**: The bundled Noto Sans Medium/SemiBold fonts may not be loading correctly. Possible causes:
   - Path issues (fonts not found at `/fonts/...`)
   - Format issues (truetype format not supported in WebKitGTK)
   - @font-face declarations not being processed

3. **System font taking precedence**: Even with the Linux override, if a system font named "Noto Sans" exists on the Linux system, it might be used instead of the bundled web fonts. System Noto Sans may not have medium/semibold weights.

4. **CSS specificity/cascade issues**: The `html.platform-linux body` rule might not be overriding correctly due to Tailwind's layer system or other CSS specificity issues.

5. **WebKitGTK font handling**: Tauri uses WebKitGTK on Linux, which may have different font handling behavior than WebKit on macOS.

## Files Involved

- `src/App.tsx` - Platform detection and debug logging
- `src/index.css` - @font-face declarations and platform-specific CSS rules
- `src/lib/logger.ts` - logDebug() function
- `src-tauri/src/commands.rs` - log_debug Tauri command
- `public/fonts/` - Bundled font files

## Next Steps

1. **Check the debug log** on Linux after running the app to see:
   - Is `platform-linux` being detected and added?
   - What font-family is computed on body?
   - Are the Noto Sans fonts (400, 500, 600, 700) showing as loaded/available?
   - What font-weight is computed on `.font-medium` elements?

2. **If platform detection fails**: Check what `navigator.platform` and `navigator.userAgent` actually return in WebKitGTK on Linux. May need alternative detection method.

3. **If fonts aren't loading**:
   - Check browser network tab equivalent (if possible) to see if font files are being requested
   - Try different font formats (woff2 instead of truetype)
   - Check if paths need adjustment for Tauri bundling

4. **If system font is overriding**: Consider renaming the bundled font to something unique like "Noto Sans Bundled" to avoid conflicts with system-installed Noto Sans.

5. **Nuclear option**: If all else fails, change the Tailwind classes from `font-medium` to `font-bold` on affected elements, accepting that they'll be bolder but at least visible.

## CSS Architecture

The font stack is:
- **Base (all platforms)**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'DejaVu Sans', Oxygen, Ubuntu, sans-serif`
- **macOS override**: Same fonts, but with `text-rendering: auto` (fixes fuzzy text)
- **Linux override**: `'Noto Sans', 'DejaVu Sans', Roboto, Oxygen, Ubuntu, sans-serif` (bundled Noto Sans first)

The idea is that on macOS, system fonts (San Francisco via -apple-system) are used and have all weights. On Linux, we force the bundled Noto Sans which we control and know has all weights.
