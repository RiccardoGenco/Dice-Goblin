"""Sprite originali per Dice Goblin: Bardo e Ladro (stesso motore rig di Arcana Siege)"""
import math, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from pixel import save_image
from rig import Model, sheet, walk
from hd_units import humanoid

RIM = ((1, 0.2, -0.6), 0.8, "#6e9c94")


def bard():
    """Menestrello scheletrico: cappello a punta con piuma, giubba viola a sghembo, liuto di legno"""
    m = Model()
    humanoid(m, hip=10.8, shoulder=6.0, sw=4.8, leg=5.0)
    for s in ("l", "r"):
        m.capsule("leg_" + s, (0, 0, 0), (0, -5, 0), 1.6, 1.4, "cloth_red" if s == "l" else "gold")   # calzamaglia bipartita
        m.capsule("shin_" + s, (0, 0, 0), (0, -4.6, 0), 1.4, 1.3, "cloth_red" if s == "l" else "gold")
        m.box("shin_" + s, (0, -5.2, 0.9), (1.4, 0.7, 2.4), "leather", round_=0.6)                  # scarpa a punta
    m.ellipsoid("root", (0, 0.4, 0), (3.6, 2.2, 2.6), "cloth_black")
    m.ellipsoid("torso", (0, 4.2, 0), (4.4, 4.2, 3.0), "membrane", blend=0.8)                       # giubba viola
    m.box("torso", (0, 0.4, 2.7), (4.3, 0.7, 0.4), "gold", rot_=(6, 0, 0))                          # bordo
    m.ellipsoid("torso", (0, 7.6, 0), (3.6, 1.2, 3.2), "gold")                                      # colletto a punte
    m.ellipsoid("head", (0, 1.6, 0), (2.7, 3.0, 2.7), "bone")                                       # teschio
    m.box("head", (0, 0.2, 2.2), (1.4, 0.4, 0.6), "void", round_=0.2)                               # sorriso
    m.decal("head", (-0.9, 1.7, 2.6), "#b67be8")
    m.decal("head", (0.9, 1.7, 2.6), "#b67be8")
    m.capsule("head", (0, 3.6, 0), (-3.4, 8.2, -0.6), 2.0, 0.5, "cloth_red")                        # cappello a punta
    m.ellipsoid("head", (0, 3.6, 0), (3.5, 0.8, 3.5), "cloth_red")                                  # tesa
    m.capsule("head", (-3.4, 8.2, -0.6), (-5.2, 7.0, -1.0), 0.5, 0.4, "gold")                       # sonaglio
    m.capsule("head", (1.4, 4.0, -0.2), (3.8, 7.4, -1.2), 0.5, 0.3, "leaf")                         # piuma
    for s, sx in (("l", -1), ("r", 1)):
        m.ellipsoid("arm_" + s, (0.3 * sx, 0.2, 0), (2.0, 1.8, 2.0), "gold")
        m.capsule("arm_" + s, (0, 0, 0), (0, -4.2, 0), 1.1, 1.0, "membrane")
        m.capsule("fore_" + s, (0, 0, 0), (0, -3.6, 0.4), 1.0, 0.9, "bone")
    # liuto tenuto in avanti sulla sinistra
    m.bone("lute", "fore_l", (0.6, -2.6, 2.4))
    m.ellipsoid("lute", (0, 0, 0), (2.8, 3.4, 1.4), "wood")
    m.ellipsoid("lute", (0, 0, 1.2), (1.0, 1.0, 0.5), "void")                                       # rosone
    m.capsule("lute", (0, 3.0, 0), (0.4, 8.0, 0), 0.5, 0.5, "bark")                                 # manico
    m.box("lute", (0.4, 8.4, 0), (0.8, 0.8, 0.5), "gold")
    frames = []
    for k in range(8):
        a = k * math.pi / 4
        p = walk(k, 8, stride=20, knee=26, swing=10, bob=0.9)
        p["arm_l"] = (-30, 0, 12)
        p["fore_l"] = (-50, 0, 0)
        p["arm_r"] = (-45 + 14 * math.sin(2 * a), 0, -10)       # la destra pizzica le corde
        p["fore_r"] = (-70 + 10 * math.sin(2 * a), 0, 0)
        p["abs:lute"] = (0, 0, -24 + 4 * math.sin(a))
        p["head"] = (0, 0, 6 * math.sin(a))                    # dondola a tempo
        frames.append(m.render(p, 32, yaw=-28, ground=3, rim=RIM))
    return frames


def rogue():
    """Ladro d'ombra: cappuccio nero, volto senza viso con due occhi gialli, mantello a brandelli, due pugnali"""
    m = Model()
    humanoid(m, hip=9.6, shoulder=5.8, sw=4.2, leg=4.6)
    for s in ("l", "r"):
        m.capsule("leg_" + s, (0, 0, 0), (0, -4.6, 0), 1.5, 1.3, "cloth_black")
        m.capsule("shin_" + s, (0, 0, 0), (0, -4.2, 0), 1.3, 1.2, "cloth_black")
        m.box("shin_" + s, (0, -4.8, 0.9), (1.3, 0.7, 2.2), "leather", round_=0.6)
    m.ellipsoid("root", (0, 0.3, 0), (3.3, 2.1, 2.4), "cloth_black")
    m.ellipsoid("root", (0, 1.4, 0), (3.5, 0.7, 2.6), "leather")                                    # cintura
    m.ellipsoid("torso", (0, 3.8, 0), (3.9, 3.8, 2.7), "cloth_black", blend=0.8)
    m.box("torso", (0, 4.0, 2.4), (0.5, 3.4, 0.3), "slate", rot_=(0, 0, 25))                        # bandoliera
    m.ellipsoid("head", (0, 1.5, -0.1), (3.0, 3.1, 3.0), "cloth_black")                             # cappuccio
    m.capsule("head", (0, 3.2, -1.0), (0, 4.6, -4.6), 1.6, 0.4, "cloth_black")                      # punta del cappuccio
    m.ellipsoid("head", (0, 1.1, 1.6), (2.0, 2.0, 1.8), "void")                                     # volto vuoto
    m.decal("head", (-0.9, 1.3, 3.1), "#f0d048")
    m.decal("head", (0.9, 1.3, 3.1), "#f0d048")
    m.box("torso", (0, -3.6, -3.0), (3.4, 5.0, 0.4), "slate", rot_=(-14, 0, 0))                     # mantello a brandelli
    for dx in (-2.2, 0, 2.2):
        m.capsule("torso", (dx, -8.0, -3.6), (dx * 1.1, -10.4, -4.4), 0.7, 0.2, "slate")
    for s, sx in (("l", -1), ("r", 1)):
        m.ellipsoid("arm_" + s, (0.3 * sx, 0.2, 0), (1.9, 1.7, 1.9), "cloth_black")
        m.capsule("arm_" + s, (0, 0, 0), (0, -4.0, 0), 1.0, 0.9, "cloth_black")
        m.capsule("fore_" + s, (0, 0, 0), (0, -3.6, 0.4), 1.0, 1.1, "leather")
        m.bone("hand_" + s, "fore_" + s, (0, -3.6, 0.4))
        m.box("hand_" + s, (0, 3.0, 0), (0.45, 3.0, 0.7), "steel", round_=0.2)                      # pugnale
        m.box("hand_" + s, (0, 0.2, 0), (1.3, 0.35, 0.5), "rust")
    frames = []
    for k in range(8):
        a = k * math.pi / 4
        p = walk(k, 8, stride=30, knee=40, swing=26, bob=0.9)  # corsa furtiva piu' ampia
        p["torso"] = (14, 0, 0)                                  # chino in avanti
        p["arm_l"] = (-35 + 16 * math.sin(a), 0, 8)
        p["fore_l"] = (-60, 0, 0)
        p["arm_r"] = (-35 - 16 * math.sin(a), 0, -8)
        p["fore_r"] = (-60, 0, 0)
        p["abs:hand_l"] = (20, 0, 6)
        p["abs:hand_r"] = (20, 0, -6)
        frames.append(m.render(p, 32, yaw=-28, ground=3, rim=RIM))
    return frames


UNITS = {"bard": (bard, 8), "rogue": (rogue, 12)}

if __name__ == "__main__":
    shots = []
    for uid in sys.argv[1:] or UNITS:
        fn, fps = UNITS[uid]
        fr = fn()
        im = sheet(fr)
        save_image("unit." + uid, im, fr[0].shape[1], fps=fps, hd=True)
        shots.append(im)
    w = max(s.width for s in shots); h = sum(s.height + 8 for s in shots)
    out = Image.new("RGBA", (w, h), (38, 36, 44, 255)); y = 0
    for s in shots:
        out.alpha_composite(s, (0, y)); y += s.height + 8
    out.resize((out.width * 5, out.height * 5), Image.NEAREST).save(os.environ.get("CONTACT", "contact.png"))
