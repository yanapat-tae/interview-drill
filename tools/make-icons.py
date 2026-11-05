"""Make the app icons (icons/icon-180.png, -192, -512). Run: python3 tools/make-icons.py
Design: near-black aurora background, teal speech bubble with answer lines that fade out."""
from PIL import Image, ImageDraw, ImageFilter

S = 1024  # draw large, then shrink for smooth edges
img = Image.new("RGB", (S, S), (7, 8, 13))

# Aurora blobs (teal, violet, blue), heavily blurred
glow = Image.new("RGB", (S, S), (7, 8, 13))
g = ImageDraw.Draw(glow)
g.ellipse((-250, -300, 650, 500), fill=(20, 184, 166))
g.ellipse((520, 150, 1300, 950), fill=(124, 58, 237))
g.ellipse((50, 650, 850, 1350), fill=(37, 99, 235))
glow = glow.filter(ImageFilter.GaussianBlur(170))
img = Image.blend(img, glow, 0.45)

d = ImageDraw.Draw(img)
# Speech bubble (inside the central 80% so it also works as a "maskable" icon)
teal = (45, 212, 191)
box = (220, 260, 804, 700)
d.rounded_rectangle(box, radius=120, fill=teal)
d.polygon([(330, 680), (300, 830), (470, 690)], fill=teal)  # tail

# Answer lines inside the bubble, fading out (like the fade-out practice)
ink = (3, 36, 32)
lines = [(300, 360, 724, 1.0), (300, 460, 650, 0.6), (300, 560, 560, 0.3)]
for x1, y, x2, alpha in lines:
    c = tuple(int(teal[i] * (1 - alpha) + ink[i] * alpha) for i in range(3))
    d.rounded_rectangle((x1, y - 26, x2, y + 26), radius=26, fill=c)

for size in (512, 192, 180):
    img.resize((size, size), Image.LANCZOS).save(f"icons/icon-{size}.png", optimize=True)
print("icons written")
