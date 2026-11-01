# App icon artwork

Source artwork and derived platform formats for the desktop app icon.

## Files

- `icon-master.png` — 512x512 master (opaque RGB PNG). Replace this file to
  rebrand, then re-derive the formats below.
- `icons/<n>x<n>.png` — 16 to 512 resizes of the master; the Linux icon set
  (`linux.icon` in `electron-builder.yml`).
- `icon.ico` — Windows application icon (`win.icon`), sizes 16 to 256. The
  256x256 entry is not for display: electron-builder's icon converter rejects
  an ICO without one.
- `icon.ico` and `icons/256x256.png` are also read at runtime as the window
  icon (`app/main.mjs`); `electron-builder.yml` lists them in `files` because
  build resources are not packed into the app by default.

## Provenance

`icon-master.png` is an **AI-generated stand-in** created for this project (no
third-party assets); it will be replaced by commissioned artist artwork. The
derived formats inherit the master's provenance and the project license (MIT).

## Deriving the platform formats

One-off steps, re-run when the master changes; no tool is added to the project.

Resized on Windows with PowerShell and System.Drawing (any decent resampler
works, e.g. ImageMagick `magick icon-master.png -resize 256 256x256.png`):

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("$PWD\build\icon-master.png")
foreach ($s in 16, 24, 32, 48, 64, 128, 256, 512) {
  $bmp = [System.Drawing.Bitmap]::new($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($src, 0, 0, $s, $s)
  $bmp.Save("$PWD\build\icons\${s}x${s}.png", [System.Drawing.Imaging.ImageFormat]::Png)
}
```

Packed with [`png-to-ico`](https://www.npmjs.com/package/png-to-ico) (MIT),
installed temporarily under the git-ignored `.scratch/` and driven through its
array API (its CLI packs one input file into fixed 16/32/48/256 sizes):

```js
import fs from 'node:fs';
import pngToIco from 'png-to-ico';

const buf = await pngToIco([
  'build/icons/16x16.png', 'build/icons/24x24.png', 'build/icons/32x32.png',
  'build/icons/48x48.png', 'build/icons/64x64.png', 'build/icons/128x128.png',
  'build/icons/256x256.png',
]);
fs.writeFileSync('build/icon.ico', buf);
```
