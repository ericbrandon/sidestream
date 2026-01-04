#!/bin/bash

# Generate all platform icons from the high-res source
# Usage: ./generate_all_icons.sh
#
# Source: sidestream_logo.png (1024x1024)
#
# Outputs:
#   macOS:   icon.icns (squircle shape with shadow, transparent corners)
#   Windows: icon.ico, Square*.png (full-bleed square)
#   Linux:   icon.png, 32x32.png, 128x128.png, 128x128@2x.png (full-bleed square)

set -e
cd "$(dirname "$0")"

SOURCE="../../sidestream_logo.png"
SIZE=1024

if [ ! -f "$SOURCE" ]; then
    echo "Error: Source file not found: $SOURCE"
    exit 1
fi

echo "========================================"
echo "Generating icons from: $SOURCE"
echo "========================================"

# ===========================================
# PART 1: macOS Icon (squircle with shadow)
# ===========================================
echo ""
echo "=== macOS Icon (squircle shape) ==="

# Step 1: Extract S with transparent background
echo "  Extracting S with transparent background..."
magick "$SOURCE" \
    -alpha set \
    -channel RGBA \
    -fuzz 5% -fill none -draw "color 0,0 floodfill" \
    -trim +repage \
    temp_s_transparent.png

# Step 2: Create background gradient
echo "  Creating background gradient..."
magick -size ${SIZE}x${SIZE} \
    -define gradient:direction=south \
    gradient:'#f8f9fa-#e9ecef' \
    temp_background.png

# Step 3: Scale up the S
echo "  Scaling S to fill icon area..."
magick temp_s_transparent.png \
    -trim +repage \
    -resize $((SIZE * 75 / 100))x$((SIZE * 75 / 100)) \
    -gravity center \
    -background none \
    -extent ${SIZE}x${SIZE} \
    temp_s_scaled.png

# Step 4: Composite S onto background
echo "  Compositing S onto background..."
magick temp_background.png temp_s_scaled.png \
    -gravity center -composite \
    temp_icon_flat.png

# Step 5: Create squircle mask (~22% corner radius)
echo "  Creating squircle mask..."
CORNER_RADIUS=$((SIZE * 22 / 100))
magick -size ${SIZE}x${SIZE} xc:none \
    -fill white \
    -draw "roundrectangle 0,0 $((SIZE-1)),$((SIZE-1)) ${CORNER_RADIUS},${CORNER_RADIUS}" \
    temp_mask.png

# Step 6: Apply mask
echo "  Applying squircle mask..."
magick temp_icon_flat.png temp_mask.png \
    -alpha off -compose CopyOpacity -composite \
    temp_final_1024.png

# Step 7: Add shadow
echo "  Adding subtle shadow..."
magick temp_final_1024.png \
    \( +clone -background black -shadow 60x4+0+4 \) \
    +swap -background none -layers merge +repage \
    macos_icon_1024.png

# Step 8: Generate .icns
echo "  Generating icon.icns..."
mkdir -p icon.iconset
magick macos_icon_1024.png -resize 16x16     icon.iconset/icon_16x16.png
magick macos_icon_1024.png -resize 32x32     icon.iconset/icon_16x16@2x.png
magick macos_icon_1024.png -resize 32x32     icon.iconset/icon_32x32.png
magick macos_icon_1024.png -resize 64x64     icon.iconset/icon_32x32@2x.png
magick macos_icon_1024.png -resize 128x128   icon.iconset/icon_128x128.png
magick macos_icon_1024.png -resize 256x256   icon.iconset/icon_128x128@2x.png
magick macos_icon_1024.png -resize 256x256   icon.iconset/icon_256x256.png
magick macos_icon_1024.png -resize 512x512   icon.iconset/icon_256x256@2x.png
magick macos_icon_1024.png -resize 512x512   icon.iconset/icon_512x512.png
magick macos_icon_1024.png -resize 1024x1024 icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
echo "  ✓ icon.icns created"

# ===========================================
# PART 2: Windows & Linux Icons (full-bleed square)
# ===========================================
echo ""
echo "=== Windows & Linux Icons (full-bleed square) ==="

# Use the source directly (it's already 1024x1024 with the S centered)
# Just ensure it has the right background

echo "  Creating base icon..."
magick "$SOURCE" -resize 1024x1024 temp_base_1024.png

# Generate Windows .ico (multiple sizes embedded)
echo "  Generating icon.ico..."
magick temp_base_1024.png \
    \( -clone 0 -resize 16x16 \) \
    \( -clone 0 -resize 32x32 \) \
    \( -clone 0 -resize 48x48 \) \
    \( -clone 0 -resize 64x64 \) \
    \( -clone 0 -resize 128x128 \) \
    \( -clone 0 -resize 256x256 \) \
    -delete 0 icon.ico
echo "  ✓ icon.ico created"

# Generate Linux/generic PNG icons (Tauri requirements)
echo "  Generating PNG icons for Linux/Tauri..."
magick temp_base_1024.png -resize 512x512   icon.png
magick temp_base_1024.png -resize 32x32     32x32.png
magick temp_base_1024.png -resize 128x128   128x128.png
magick temp_base_1024.png -resize 256x256   128x128@2x.png
echo "  ✓ icon.png, 32x32.png, 128x128.png, 128x128@2x.png created"

# Generate Windows Store icons
echo "  Generating Windows Store icons..."
magick temp_base_1024.png -resize 30x30     Square30x30Logo.png
magick temp_base_1024.png -resize 44x44     Square44x44Logo.png
magick temp_base_1024.png -resize 71x71     Square71x71Logo.png
magick temp_base_1024.png -resize 89x89     Square89x89Logo.png
magick temp_base_1024.png -resize 107x107   Square107x107Logo.png
magick temp_base_1024.png -resize 142x142   Square142x142Logo.png
magick temp_base_1024.png -resize 150x150   Square150x150Logo.png
magick temp_base_1024.png -resize 284x284   Square284x284Logo.png
magick temp_base_1024.png -resize 310x310   Square310x310Logo.png
magick temp_base_1024.png -resize 50x50     StoreLogo.png
echo "  ✓ Windows Store icons created"

# ===========================================
# Cleanup
# ===========================================
echo ""
echo "Cleaning up temporary files..."
rm -f temp_*.png

echo ""
echo "========================================"
echo "All icons generated successfully!"
echo "========================================"
echo ""
echo "Files created:"
echo "  macOS:"
echo "    - icon.icns (squircle with shadow)"
echo "    - macos_icon_1024.png (preview)"
echo ""
echo "  Windows:"
echo "    - icon.ico"
echo "    - Square*.png (Store tiles)"
echo "    - StoreLogo.png"
echo ""
echo "  Linux/Generic:"
echo "    - icon.png (512x512)"
echo "    - 32x32.png"
echo "    - 128x128.png"
echo "    - 128x128@2x.png (256x256)"
echo ""
