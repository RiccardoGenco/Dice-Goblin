import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from rig import Model, sheet
import hd_units, goblin_units, goblin_units2
from PIL import Image
S = int(os.environ.get("S", "2")); out = os.environ["OUT"]; os.makedirs(out, exist_ok=True)
orig = Model.render
def scaled(self, pose, size, **kw):
    kw["ground"] = kw.get("ground", 2) * S; kw["zoom"] = kw.get("zoom", 1.0) * S
    return orig(self, pose, size * S, **kw)
Model.render = scaled
fns = {"knight": hd_units.knight, "bard": goblin_units.bard, "rogue": goblin_units.rogue,
       "hero": goblin_units2.hero, "hero_attack": goblin_units2.hero_attack, "hero_hurt": goblin_units2.hero_hurt, "mage": goblin_units2.mage, "cleric": goblin_units2.cleric, "paladin": goblin_units2.paladin}
rows = []
for i in sys.argv[1:]:
    t = time.time(); im = sheet(fns[i]()); im.save(f"{out}/{i}.png"); rows.append(im); print(i, im.size, round(time.time()-t), "s", flush=True)
cells = [r.crop((0, 0, r.height, r.height)).resize((r.height*4, r.height*4), Image.NEAREST) for r in rows]
c = Image.new("RGBA", (sum(x.width + 8 for x in cells), cells[0].height), (38, 36, 44, 255)); x = 0
for im in cells: c.alpha_composite(im, (x, 0)); x += im.width + 8
c.save(f"{out}/_contact.png")
