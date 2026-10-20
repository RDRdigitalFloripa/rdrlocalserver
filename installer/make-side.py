"""Gera side.bmp (imagem lateral do instalador) com a versão escrita: make-side.py <versao>"""
import sys
from PIL import Image, ImageDraw, ImageFont
v = 'v' + sys.argv[1]
im = Image.open('side-base.bmp').convert('RGB')
d = ImageDraw.Draw(im)
font = None
for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'):
    try: font = ImageFont.truetype(f, 12); break
    except Exception: pass
font = font or ImageFont.load_default()
w = d.textlength(v, font=font)
d.text(((164 - w) / 2, 248), v, fill=(120, 140, 175), font=font)
im.save('side.bmp')
