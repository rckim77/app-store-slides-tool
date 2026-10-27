# Local frame assets

Apple's bezel PNGs and accompanying licenses are local-only and are not bundled
with this repository. Download the matching resources from
[Apple Design Resources](https://developer.apple.com/design/resources/), accept
the applicable license yourself, and import the mounted or extracted folder:

```sh
node Scripts/import-frames.js --device iphone --source '/path/to/iPhone bezel resource'
node Scripts/import-frames.js --device ipad --source '/path/to/iPad bezel resource'
node Scripts/import-frames.js --device iphone-duo --source '/path/to/iPhone Duo bezel resource'
```

Run these commands from the repository root. Select the complete resource folder
including its license, not just the PNG subfolder. Frame filenames are preserved;
licenses are retained under `Licenses/<device>/` so each device's terms stay with
its imported resources. The existing `Scripts/import-duo-frames.js --source ...`
command remains supported.

Use the model, orientation, and color named in your config's `frame.image`.
If you choose a different frame, update its image path, screen rectangle, corner
radius, and scale to match that asset. The importer does not rewrite configs.

New clones need to import their own resources before rendering. Before updating
an older checkout, copy its tracked frame PNGs outside the checkout and restore
them afterward: Git may remove these files when checking out their removal.
This change removes raw assets from the current tree; older Git commits still
contain the previously tracked iPhone and iPad PNGs.

Everything in this folder except this README is ignored by Git. Do not force-add
Apple's source assets or licenses. Rendered app mock-ups remain subject to their
applicable resource license and Apple's marketing guidelines.
