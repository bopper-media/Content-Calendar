# Fonts

`src/app.css` loads these files from this folder:

- `Graphik-Regular.otf` (400)
- `Graphik-Medium.otf` (500, and the uppercase label face)
- `Graphik-Semibold.otf` (600)
- `Graphik-Bold.otf` (700)

Graphik is a commercial typeface from Commercial Type and is **not included**
here. If your licence covers this project, copy the four files in (they're in
the Sous repo under `public/fonts/`). Otherwise the app uses the system font,
or you can switch to another face: change `--font-graphik`, `--font-merchant`
and `--font-body` in the `@theme inline` block of `src/app.css` and remove the
Graphik `@font-face` rules.
