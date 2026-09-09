"""Generate the FitClass PWA icon set from the brand emblem.

Re-run with: python scripts/generate-pwa-icons.py   (needs Pillow)

SOURCE OF TRUTH is assets/brand/fitclass-emblem.png — the circular emblem
(navy ring + feather) on transparency. Do not regenerate these from
public/fitclass-logo-white.webp: that asset is the full LOCKUP (emblem +
FITCLASS wordmark + tagline), which is the right artwork for the navbar and
the login panel but turns to noise at icon sizes. icon-192 is also the
notification icon in sw.js and renders as small as 24px there, and the
favicon is read at 16px. The emblem alone is the only crop that survives.

Every icon is composited onto WHITE, matching how the emblem is drawn: the
navy ring supplies the edge, so the icon still reads as a defined shape on
both light and dark home screens.
"""

import shutil

from PIL import Image

SRC = 'assets/brand/fitclass-emblem.png'
OUT = 'msq-core/apps/auth-web/public/icons'
WHITE = (255, 255, 255)

# Next's app/icon.png file convention. `pwa/metadata.ts` declares `icons`,
# which SUPPRESSES this convention, so these are not what the browser loads —
# but they are still served at `<basePath>/icon.png` and would otherwise sit
# there as stale branding forever. Kept byte-identical to favicon.png.
APP_ICONS = [
    'msq-core/apps/auth-web/app/icon.png',
    'msq-core/apps/lookup-admin/app/icon.png',
    'msq-hrms/apps/hr-web/app/icon.png',
    'msq-lms/apps/lms-web/app/icon.png',
    'msq-todo/apps/todo-web/app/icon.png',
]

# In-page uses (navbar, login/no-access/offline/select-branch) each keep their
# own copy of the emblem in their own public/ dir, same convention as
# fitclass-logo-white.webp — see msq-core/packages/ui/src/shell/AppNavbar.tsx.
UI_EMBLEM_DESTS = [
    'msq-core/apps/admin-web/public/fitclass-emblem.png',
    'msq-core/apps/auth-web/public/fitclass-emblem.png',
    'msq-core/apps/lookup-admin/public/fitclass-emblem.png',
    'msq-hrms/apps/hr-web/public/fitclass-emblem.png',
    'msq-lms/apps/lms-web/public/fitclass-emblem.png',
    'msq-todo/apps/todo-web/public/fitclass-emblem.png',
]

src = Image.open(SRC).convert('RGBA')

# Trim to the ring at an alpha THRESHOLD rather than getbbox(). The source
# carries a band of near-invisible artefacts below the emblem (alpha <= 34,
# left over from the lockup's wordmark); a plain getbbox() includes them and
# pushes the emblem off-centre by ~40px.
mask = src.getchannel('A').point(lambda v: 255 if v > 40 else 0)
emblem = src.crop(mask.getbbox())


def render(name, size, content_frac):
    """Composite the emblem onto white at native resolution, then downscale.

    Compositing BEFORE the resize avoids the dark fringing you get when you
    resample a transparent RGBA directly: fully transparent pixels still carry
    RGB 0, which bleeds into the antialiased edges. Output is flat RGB with no
    alpha — required for apple-touch-icon (iOS does not composite
    transparency and renders an alpha PNG as a black square) and harmless for
    the rest.
    """
    w, h = emblem.size
    native = round(max(w, h) / content_frac)
    canvas = Image.new('RGBA', (native, native), WHITE + (255,))
    canvas.alpha_composite(emblem, ((native - w) // 2, (native - h) // 2))
    canvas.convert('RGB').resize((size, size), Image.LANCZOS).save(
        f'{OUT}/{name}', 'PNG', optimize=True
    )
    print(f'{name:26} {size}x{size}  emblem at {content_frac:.0%}')


# Standard icons run the ring close to full bleed — the emblem is a circle, so
# it can fill more of the square than a lockup could without looking crowded,
# and every pixel counts at 16px (favicon) and 24px (notification badge).
render('favicon.png', 256, 0.94)
render('icon-192.png', 192, 0.92)
render('icon-512.png', 512, 0.92)
render('apple-touch-icon.png', 180, 0.90)

# Android crops maskable icons to a circle/squircle, keeping only the centred
# 80%-diameter safe zone. The emblem is itself a circle, so it can use almost
# all of that (a square lockup could only use 80%/sqrt(2) = 57%); 76% leaves a
# little margin for the more aggressive OEM masks.
render('icon-512-maskable.png', 512, 0.76)

for dest in APP_ICONS:
    shutil.copyfile(f'{OUT}/favicon.png', dest)
    print(f'{dest:46} <- favicon.png')

# UI emblem: transparent surround kept (unlike the icons above), so it can sit
# on either the white navbar or the navy login/offline/no-access/select-branch
# cards without a visible square edge. 320px is 2x the largest current on-page
# use (h-11 = 44px) for a sharp render on retina displays.
UI_EMBLEM_SIZE = 320
ui_emblem = emblem.resize((UI_EMBLEM_SIZE, UI_EMBLEM_SIZE), Image.LANCZOS)
for dest in UI_EMBLEM_DESTS:
    ui_emblem.save(dest, 'PNG', optimize=True)
    print(f'{dest:46} {UI_EMBLEM_SIZE}x{UI_EMBLEM_SIZE}  emblem, transparent')
