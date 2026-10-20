#!/bin/bash
# Rebuild the raster exports from the editable SVG masters. macOS + librsvg required.
set -euo pipefail
asset_dir="$(cd "$(dirname "$0")" && pwd)"
command -v rsvg-convert >/dev/null
command -v iconutil >/dev/null
mkdir -p "$asset_dir/SI Assist.iconset" "$asset_dir/AppIcon.appiconset"
rsvg-convert -w 1024 -h 1024 "$asset_dir/si-assist-mark.svg" -o "$asset_dir/si-assist-mark-1024.png"
rsvg-convert -w 1024 -h 1024 "$asset_dir/si-assist-app-icon.svg" -o "$asset_dir/si-assist-app-icon-1024.png"
for point_size in 16 32 128 256 512; do
  for density in 1 2; do
    suffix=""
    if [ "$density" = 2 ]; then suffix="@2x"; fi
    pixel_size=$((point_size * density))
    filename="icon_${point_size}x${point_size}${suffix}.png"
    rsvg-convert -w "$pixel_size" -h "$pixel_size" "$asset_dir/si-assist-app-icon.svg" -o "$asset_dir/SI Assist.iconset/$filename"
    cp "$asset_dir/SI Assist.iconset/$filename" "$asset_dir/AppIcon.appiconset/$filename"
  done
done
cat > "$asset_dir/AppIcon.appiconset/Contents.json" <<'JSON'
{
  "images": [
    {
      "size": "16x16",
      "idiom": "mac",
      "filename": "icon_16x16.png",
      "scale": "1x"
    },
    {
      "size": "16x16",
      "idiom": "mac",
      "filename": "icon_16x16@2x.png",
      "scale": "2x"
    },
    {
      "size": "32x32",
      "idiom": "mac",
      "filename": "icon_32x32.png",
      "scale": "1x"
    },
    {
      "size": "32x32",
      "idiom": "mac",
      "filename": "icon_32x32@2x.png",
      "scale": "2x"
    },
    {
      "size": "128x128",
      "idiom": "mac",
      "filename": "icon_128x128.png",
      "scale": "1x"
    },
    {
      "size": "128x128",
      "idiom": "mac",
      "filename": "icon_128x128@2x.png",
      "scale": "2x"
    },
    {
      "size": "256x256",
      "idiom": "mac",
      "filename": "icon_256x256.png",
      "scale": "1x"
    },
    {
      "size": "256x256",
      "idiom": "mac",
      "filename": "icon_256x256@2x.png",
      "scale": "2x"
    },
    {
      "size": "512x512",
      "idiom": "mac",
      "filename": "icon_512x512.png",
      "scale": "1x"
    },
    {
      "size": "512x512",
      "idiom": "mac",
      "filename": "icon_512x512@2x.png",
      "scale": "2x"
    }
  ],
  "info": {
    "version": 1,
    "author": "xcode"
  }
}
JSON
iconutil -c icns "$asset_dir/SI Assist.iconset" -o "$asset_dir/SI Assist.icns"
echo 'Exported SVG-derived PNGs, iconset, appiconset PNGs and ICNS.'
