# dmgbuild settings for Sidestream's macOS disk image.
#
# Why this exists: Tauri's bundled create-dmg (bundle_dmg.sh) styles the DMG via
# Finder/AppleScript, which fails (-1728 "Can't get disk") when the build runs
# from a non-GUI/background process — Finder never sees the freshly-mounted
# volume. dmgbuild writes the .DS_Store layout directly (no Finder), so it works
# headless. The layout below mirrors Tauri's defaults.
#
# Invoked by scripts/make-dmg.sh, which passes APP_PATH, VOL_ICON, and
# DMG_BACKGROUND via env.

import os

app_path = os.environ["APP_PATH"]            # .../bundle/macos/Sidestream.app
vol_icon = os.environ.get("VOL_ICON", "")    # .icns for the volume icon (optional)
bg_image = os.environ.get("DMG_BACKGROUND", "")  # HiDPI .tiff w/ "drag" arrow (optional)
app_name = os.path.basename(app_path)        # "Sidestream.app"

# --- Contents -------------------------------------------------------------
files = [app_path]
symlinks = {"Applications": "/Applications"}
if vol_icon:
    icon = vol_icon                          # whole-volume icon
if bg_image:
    background = bg_image                     # window background (drag-here arrow)

# --- Window / icon layout (matches Tauri: window 660x400, icons at 128px) --
format = "UDZO"                              # compressed, read-only
default_view = "icon-view"
window_rect = ((200, 120), (660, 400))       # ((x, y), (w, h))
icon_size = 128
text_size = 16
icon_locations = {
    app_name: (180, 170),                    # Tauri --icon ... 180 170
    "Applications": (480, 170),              # Tauri --app-drop-link 480 170
}
hide_extension = [app_name]                  # Tauri --hide-extension
