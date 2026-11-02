"""Hero goblin, Mago, Chierico, Paladino (rig di Arcana Siege, modelli originali)"""
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from rig import Model, walk
from hd_units import humanoid

RIM = ((1, 0.2, -0.6), 0.8, "#6e9c94")


def hero():
    """Goblin eroe: pelle verde, grandi orecchie, giubbetto di cuoio, clava chiodata, ghigno con zanne"""
    m = Model()
    humanoid(m, hip=8.6, shoulder=5.0, sw=4.6, leg=4.2)
    for s in ("l", "r"):
        m.capsule("leg_" + s, (0, 0, 0), (0, -4.2, 0), 1.7, 1.5, "leaf")
        m.capsule("shin_" + s, (0, 0, 0), (0, -3.8, 0), 1.5, 1.4, "leaf")
        m.box("shin_" + s, (0, -4.4, 0.9), (1.5, 0.7, 2.4), "leather", round_=0.6)
    m.ellipsoid("root", (0, 0.4, 0), (3.6, 2.2, 2.7), "bark")                              # perizoma
    m.ellipsoid("torso", (0, 3.4, 0), (4.4, 3.8, 3.1), "leaf", blend=0.8)                  # pancia
    m.ellipsoid("torso", (0, 4.2, 0.4), (4.6, 3.6, 3.3), "leather", blend=0.5)             # giubbetto
    m.box("torso", (0, 3.6, 3.0), (0.4, 3.0, 0.3), "bone")                                  # laccio
    m.ellipsoid("head", (0, 2.0, 0.2), (3.8, 3.4, 3.5), "leaf")                            # testone
    m.ellipsoid("head", (0, 0.6, 2.4), (2.2, 1.3, 1.4), "moss")                            # muso
    for sx in (-1, 1):
        m.capsule("head", (3.0 * sx, 2.4, -0.2), (7.4 * sx, 3.6, -1.6), 1.3, 0.4, "leaf")  # orecchie a punta
        m.decal("head", (1.4 * sx, 2.6, 3.4), "#f0d048")                                    # occhi gialli
        m.decal("head", (0.8 * sx, -0.1, 3.6), "#ece4cf")                                   # zanne
    m.capsule("head", (0, 5.0, 0), (0, 5.4, -0.2), 0.5, 0.5, "bark")
    for s, sx in (("l", -1), ("r", 1)):
        m.ellipsoid("arm_" + s, (0.3 * sx, 0.2, 0), (2.1, 1.9, 2.1), "leaf")
        m.capsule("arm_" + s, (0, 0, 0), (0, -4.0, 0), 1.3, 1.2, "leaf")
        m.capsule("fore_" + s, (0, 0, 0), (0, -3.6, 0.4), 1.2, 1.4, "leaf")
    m.bone("hand_r", "fore_r", (0, -3.8, 0.4))
    m.capsule("hand_r", (0, -1.0, 0), (0, 7.0, 0), 0.9, 0.6, "wood")                       # manico
    m.ellipsoid("hand_r", (0, 8.4, 0), (2.4, 3.4, 2.4), "wood")                            # testa della clava
    for a, b in (((2.2, 8.4, 0), (3.6, 8.4, 0)), ((-2.2, 8.4, 0), (-3.6, 8.4, 0)), ((0, 8.4, 2.2), (0, 8.4, 3.6)), ((0, 10.6, 0), (0, 11.8, 0))):
        m.capsule("hand_r", a, b, 0.7, 0.2, "steel")                                        # chiodi
    frames = []
    for k in range(8):
        a = k * math.pi / 4
        p = walk(k, 8, stride=14, knee=18, swing=8, bob=1.1)
        p["arm_r"] = (-20 + 8 * math.sin(a), 0, 20)
        p["fore_r"] = (-45, 0, 0)
        p["abs:hand_r"] = (8, 0, -22 + 3 * math.sin(a))
        p["arm_l"] = (p["arm_l"][0] * 0.5, 0, 6)
        frames.append(m.render(p, 32, yaw=-28, ground=3, rim=RIM))
    return frames


def robe(m, mat, trim):
    """tunica lunga: gonna conica al posto delle gambe"""
    for s in ("l", "r"):
        m.capsule("leg_" + s, (0, 0, 0), (0, -5, 0), 1.5, 1.4, "cloth_black")
        m.capsule("shin_" + s, (0, 0, 0), (0, -4.6, 0), 1.4, 1.3, "cloth_black")
        m.box("shin_" + s, (0, -5.2, 0.9), (1.3, 0.7, 2.2), "leather", round_=0.6)
    m.ellipsoid("root", (0, -1.0, 0), (4.4, 5.4, 3.4), mat, blend=0.6)                     # gonna
    m.ellipsoid("root", (0, -5.4, 0), (4.8, 1.0, 3.8), trim)                                # orlo
    m.ellipsoid("torso", (0, 4.0, 0), (4.4, 4.2, 3.0), mat, blend=0.8)
    m.ellipsoid("root", (0, 1.5, 0), (3.8, 0.7, 2.8), trim)                                 # cintura


def mage():
    """Mago spettro: tunica viola notte, collo alto, teschio con occhi di ghiaccio, bastone con sfera di vetro"""
    m = Model()
    humanoid(m, hip=11.0, shoulder=6.0, sw=4.6, leg=5.0)
    robe(m, "membrane", "gold")
    m.ellipsoid("torso", (0, 7.4, -0.6), (4.4, 2.4, 3.2), "cloth_black")                    # collo alto
    m.ellipsoid("head", (0, 1.6, 0), (2.6, 2.9, 2.6), "bone")
    m.ellipsoid("head", (0, 3.4, -1.3), (3.3, 2.6, 3.0), "cloth_black")                     # cappuccio
    m.box("head", (0, 0.2, 2.5), (1.5, 0.5, 0.8), "void", round_=0.2)
    m.box("head", (-0.95, 1.8, 2.5), (0.55, 0.55, 0.7), "void", round_=0.2)
    m.box("head", (0.95, 1.8, 2.5), (0.55, 0.55, 0.7), "void", round_=0.2)
    m.decal("head", (-0.95, 1.8, 3.2), "#9cc8e0")
    m.decal("head", (0.95, 1.8, 3.2), "#9cc8e0")
    for dy in (1.0, 2.2):
        m.capsule("head", (0, 0.2 - dy * 0.3, 2.0), (0, -2.6 - dy, 1.8), 0.5, 0.3, "bone")  # barba rada
    for s, sx in (("l", -1), ("r", 1)):
        m.ellipsoid("arm_" + s, (0.3 * sx, 0.2, 0), (2.0, 1.8, 2.0), "membrane")
        m.capsule("arm_" + s, (0, 0, 0), (0, -4.2, 0), 1.2, 1.1, "membrane")
        m.capsule("fore_" + s, (0, 0, 0), (0, -3.6, 0.4), 1.3, 1.0, "membrane")            # manica ampia
    m.bone("hand_r", "fore_r", (0, -3.8, 0.4))
    m.capsule("hand_r", (0, -5.0, 0), (0, 9.0, 0), 0.5, 0.5, "bark")                       # bastone
    m.ellipsoid("hand_r", (0, 10.6, 0), (1.9, 1.9, 1.9), "glass")                           # sfera
    m.decal("hand_r", (0, 10.8, 1.9), "#e2f4fa")
    for sx in (-1, 1):
        m.capsule("hand_r", (0.6 * sx, 8.4, 0), (1.5 * sx, 10.6, 0), 0.4, 0.3, "gold")
    frames = []
    for k in range(8):
        a = k * math.pi / 4
        p = walk(k, 8, stride=8, knee=10, swing=6, bob=0.8)
        p["arm_r"] = (-10, 0, 20)
        p["fore_r"] = (-30, 0, 0)
        p["abs:hand_r"] = (4, 0, -14 + 3 * math.sin(a))
        p["arm_l"] = (-50 + 8 * math.sin(a), 0, 14)
        p["fore_l"] = (-40, 0, 0)
        p["head"] = (0, 0, 3 * math.sin(a))
        frames.append(m.render(p, 32, yaw=-28, ground=3, rim=RIM))
    return frames


def cleric():
    """Chierico spettro: tunica bianca e oro, aureola dietro il teschio, mazza con fiamma sacra"""
    m = Model()
    humanoid(m, hip=11.0, shoulder=6.0, sw=4.8, leg=5.0)
    robe(m, "porcelain", "gold")
    m.box("torso", (0, 4.2, 3.0), (0.9, 3.6, 0.3), "gold")                                  # stola
    m.ellipsoid("torso", (0, 7.4, 0), (4.2, 1.2, 3.0), "gold")
    m.ellipsoid("head", (0, 1.6, 0), (2.7, 3.0, 2.7), "bone")
    m.box("head", (0, 0.2, 2.5), (1.6, 0.5, 0.8), "void", round_=0.2)
    m.box("head", (-0.95, 1.8, 2.5), (0.55, 0.55, 0.7), "void", round_=0.2)
    m.box("head", (0.95, 1.8, 2.5), (0.55, 0.55, 0.7), "void", round_=0.2)
    m.decal("head", (-0.95, 1.8, 3.2), "#f2dc8a")
    m.decal("head", (0.95, 1.8, 3.2), "#f2dc8a")
    m.ellipsoid("head", (0, 2.4, -2.2), (4.6, 4.6, 0.5), "gold")                            # aureola
    m.ellipsoid("head", (0, 2.4, -1.8), (3.4, 3.4, 0.5), "gold", blend=0.0)
    for s, sx in (("l", -1), ("r", 1)):
        m.ellipsoid("arm_" + s, (0.3 * sx, 0.2, 0), (2.0, 1.8, 2.0), "porcelain")
        m.capsule("arm_" + s, (0, 0, 0), (0, -4.2, 0), 1.2, 1.1, "porcelain")
        m.capsule("fore_" + s, (0, 0, 0), (0, -3.6, 0.4), 1.3, 1.0, "gold" if s == "l" else "porcelain")
    m.bone("hand_r", "fore_r", (0, -3.8, 0.4))
    m.capsule("hand_r", (0, -3.0, 0), (0, 5.0, 0), 0.6, 0.6, "wood")                       # mazza
    m.ellipsoid("hand_r", (0, 6.4, 0), (1.8, 1.8, 1.8), "gold")
    m.ellipsoid("hand_r", (0, 9.0, 0), (1.0, 1.9, 1.0), "ember")                            # fiamma sacra
    m.decal("hand_r", (0, 9.0, 1.0), "#ffd27a")
    frames = []
    for k in range(8):
        a = k * math.pi / 4
        p = walk(k, 8, stride=8, knee=10, swing=6, bob=0.8)
        p["arm_r"] = (-10, 0, 20)
        p["fore_r"] = (-30, 0, 0)
        p["abs:hand_r"] = (4, 0, -14 + 3 * math.sin(a))
        p["arm_l"] = (-45, 0, 12)
        p["fore_l"] = (-55, 0, 0)
        frames.append(m.render(p, 32, yaw=-28, ground=3, rim=RIM))
    return frames


def paladin():
    """Paladino: stessa corporatura del Guerriero ma armatura bianca e oro, scudo torre, elmo con cresta alta"""
    m = Model()
    humanoid(m, hip=11.0, shoulder=6.0, sw=5.2, leg=5.2)
    for s in ("l", "r"):
        m.capsule("leg_" + s, (0, 0, 0), (0, -5, 0), 2.0, 1.7, "porcelain")
        m.ellipsoid("leg_" + s, (0, -5, 0.3), (1.7, 1.3, 1.7), "gold")
        m.capsule("shin_" + s, (0, 0, 0), (0, -4.6, 0), 1.7, 1.6, "porcelain")
        m.box("shin_" + s, (0, -5.4, 0.9), (1.6, 0.8, 2.4), "gold", round_=0.6)
    m.ellipsoid("root", (0, 0.2, 0), (4.1, 2.3, 2.8), "porcelain")
    m.ellipsoid("root", (0, 1.6, 0), (4.3, 0.9, 3.0), "gold")
    m.ellipsoid("torso", (0, 4.2, 0), (5.2, 4.4, 3.5), "porcelain", blend=0.8)
    m.ellipsoid("torso", (0, 4.6, 1.4), (3.4, 3.3, 2.3), "porcelain", blend=0.8)
    m.box("torso", (0, 4.6, 3.3), (0.6, 2.6, 0.3), "gold")                                  # croce
    m.box("torso", (0, 5.4, 3.3), (1.8, 0.6, 0.3), "gold")
    m.ellipsoid("head", (0, 1.8, 0), (3.2, 3.5, 3.3), "porcelain")
    m.box("head", (0, 1.5, 2.7), (2.3, 0.55, 0.9), "void", round_=0.2)
    m.decal("head", (-0.9, 1.5, 3.5), "#f2dc8a")
    m.decal("head", (0.9, 1.5, 3.5), "#f2dc8a")
    m.box("head", (0, 5.6, -0.2), (0.5, 2.0, 2.6), "gold", rot_=(-6, 0, 0))                 # cresta
    for s, sx in (("l", -1), ("r", 1)):
        m.ellipsoid("arm_" + s, (0.4 * sx, 0.3, 0), (3.0, 2.3, 3.0), "gold")
        m.capsule("arm_" + s, (0, 0, 0), (0, -4.2, 0), 1.4, 1.3, "porcelain")
        m.capsule("fore_" + s, (0, 0, 0), (0, -3.6, 0.4), 1.4, 1.7, "porcelain")
    m.bone("hand_r", "fore_r", (0, -3.8, 0.4))
    m.box("hand_r", (0, 0, 0), (0.7, 1.0, 0.7), "leather")
    m.ellipsoid("hand_r", (0, 3.4, 0), (2.2, 2.4, 2.2), "steel")                            # martello
    m.capsule("hand_r", (0, 0, 0), (0, 3.0, 0), 0.6, 0.6, "wood")
    m.box("fore_l", (0.4, -1.8, 3.0), (4.0, 5.6, 0.7), "porcelain", round_=0.4)             # scudo torre
    m.box("fore_l", (0.4, -1.8, 3.6), (3.2, 4.8, 0.4), "gold", round_=0.4)
    m.box("fore_l", (0.4, -1.8, 4.0), (0.5, 3.6, 0.3), "porcelain")
    frames = []
    for k in range(8):
        a = k * math.pi / 4
        p = walk(k, 8, stride=18, knee=24, swing=10, bob=0.6)
        p["arm_r"] = (p["arm_r"][0] * 0.4 - 20, 0, 12)
        p["fore_r"] = (-55, 0, 0)
        p["abs:hand_r"] = (10, 0, -10 + 3 * math.sin(a))
        p["arm_l"] = (p["arm_l"][0] * 0.3 - 15, 0, 10)
        p["fore_l"] = (-20, 0, 0)
        frames.append(m.render(p, 32, yaw=-28, ground=3, rim=RIM))
    return frames
