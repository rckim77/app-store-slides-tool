# Single-device iPhone Duo layout

The selected starter composition is one fully open inner display per slide, on
an opaque **2853 × 2007 landscape canvas**. Use the same orientation throughout
its set. The This Day example retains its blue background and two-line heading;
the caption starts at 144 pixels, 48 pixels lower than the first study, without
moving or resizing the device. Edit `caption.top` in `layout.json` to tune it.

Gray panels are labeled placeholders, and outlines are schematic. This example
reads no app screenshots, runs no simulator, and cannot produce final submission
assets. No paired-device layout is included. Earlier comparison exports can be
retained locally without including them in the current preview.

## Render the layout only

Requires macOS (for SF font) and Python with Pillow. From the repository root:

```sh
python3 Examples/iphone-duo-layout/render.py --output /path/to/layout-preview
asc screenshots validate --path /path/to/layout-preview/02-inner.png --device-type IPHONE_DUO --output json
```

`index.html` opens the preview. `manifest.json` records output size and the screen
rectangle. All exports stay outside versioned app inputs. The local prototype
renderer is only for composition studies; production slides use the shared Swift
renderer and `Scripts/add-duo-device.js`, with an editable per-slide Duo caption
offset of 48 pixels for new inner-landscape top captions. Other device layouts
are preserved.

## Research checked October 24, 2026

[Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
accept outer 1398 × 2034 / 2034 × 1398 and inner 2007 × 2853 / 2853 × 2007.
The installed `asc screenshots sizes --all` agrees. Portrait and landscape are
accepted alternatives; Apple does not state a requirement to supply both. PNGs
must have no alpha channel. Size checks alone do not prove submission readiness.

[Tomo TV's October 15 example](https://keiver.dev/lab/iphone-duo-app-store-screenshots)
uses a consistent landscape set with paired views and some inner-only slides.
[AppScreens Calfo, updated October 23](https://appscreens.com/template/app-store-screenshots/iphone-duo-calfo/YXGm5)
shows a portrait alternative. After comparing these options, the selected direction
is exclusively the simpler single-inner-display landscape composition.

[Apple's asset guidance](https://developer.apple.com/app-store/asset-best-practices/)
favors brief copy, a clear focal point, and the real app in use. Replace the
placeholder with a genuine inner-landscape capture and use the matching locally
imported bezel before producing release screenshots. No third-party artwork or
Apple frame assets are bundled in this example.
