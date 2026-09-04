"""Generate the FitClass PWA icon set from public/fitclass-logo-white.webp.

Re-run with: python gen_icons.py  (needs Pillow)

Two artwork crops, deliberately:
  * the full lockup (emblem + FITCLASS + tagline) for the 512s, which are
    large enough to read it;
  * the emblem alone for 192 and apple-touch, where the tagline degrades into
    noise. icon-192 is also the notification icon/badge in sw.js and renders
    as small as 24px there.
"""

from PIL import Image

SRC = r'c:/Girdhar/MSquare/repos/msq-platforms/msq-core/apps/auth-web/public/fitclass-logo-white.webp'
OUT = r'c:/Girdhar/MSquare/repos/msq-platforms/msq-core/apps/auth-web/public/icons'
NAVY = (15, 23, 42)  # #0F172A, matches manifest theme_color

src = Image.open(SRC).convert('RGBA')
alpha = src.getchannel('A')

full = src.crop(alpha.getbbox())
# The emblem is the topmost of three horizontal bands in the source lockup
# (emblem / wordmark / tagline), separated by fully transparent rows.
EMBLEM_ROWS = (94, 1026)
emblem_strip = src.crop((0, EMBLEM_ROWS[0], src.width, EMBLEM_ROWS[1]))
emblem = emblem_strip.crop(emblem_strip.getchannel('A').getbbox())


def render(name, size, art, content_frac):
    """Composite `art` onto navy at native resolution, then downscale.

    Compositing before the resize avoids the dark fringing you get when you
    resample white-on-transparent RGBA directly: transparent pixels carry
    RGB 0, which bleeds into the edges. Output is flat RGB with no alpha —
    required for apple-touch-icon (iOS renders transparency as black) and
    harmless for the rest.
    """
    w, h = art.size
    canvas_native = round(max(w, h) / content_frac)
    canvas = Image.new('RGBA', (canvas_native, canvas_native), NAVY + (255,))
    canvas.alpha_composite(art, ((canvas_native - w) // 2, (canvas_native - h) // 2))
    canvas.convert('RGB').resize((size, size), Image.LANCZOS).save(
        f'{OUT}/{name}', 'PNG', optimize=True
    )
    print(f'{name:26} {size}x{size}  {"emblem" if art is emblem else "lockup"}  {content_frac:.0%}')


render('icon-512.png', 512, full, 0.80)
# Android crops maskable icons to a circle/squircle, so the artwork has to sit
# inside the centred 80% safe zone with margin to spare.
render('icon-512-maskable.png', 512, full, 0.60)
# The emblem is a circle, so it can run wider than a square would at the same
# bounding box without looking crowded.
render('icon-192.png', 192, emblem, 0.86)
render('apple-touch-icon.png', 180, emblem, 0.84)

