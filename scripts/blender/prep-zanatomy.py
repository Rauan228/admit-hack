# Подготовка анатомического атлета из Z-Anatomy (CC BY-SA 4.0; модели на основе BodyParts3D, CC BY-SA 2.1 JP)
# для веба. Запуск (Blender 4.x/5.x):
#
#   blender --background Z-Anatomy/Startup.blend --python scripts/blender/prep-zanatomy.py -- <out_dir> [detail] [name]
#   (полная: detail 1 → athlete.glb; для телефона: detail 0.35 → athlete-lite.glb)
#
# Что делает:
# 1) оставляет мышцы и кости (остальные системы органов удаляет);
# 2) упрощает сетку (Decimate) до уровня, который тянет телефон;
# 3) собирает мышечные группы, которые подсвечиваем в упражнениях, в отдельные объекты по сторонам
#    (quads.l, glutes.r, ...), всё остальное — в body (мышцы) и bones (видимые кости);
# 4) считает координаты суставов по костям (головка бедра, мыщелки, таранная кость, головка плечевой...)
#    и пишет их в joints.json — по ним в браузере строятся кости и веса вершин;
# 5) экспортирует athlete.glb (+Y вверх, метры).

import bpy
import json
import os
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_dir = args[0] if args else os.getcwd()
# Второй аргумент — множитель детализации (0.4 → лёгкая версия для телефона), третий — имя файла.
DETAIL = float(args[1]) if len(args) > 1 else 1.0
OUT_NAME = args[2] if len(args) > 2 else 'athlete.glb'
os.makedirs(out_dir, exist_ok=True)

MUSC = '4: Muscular system'
SKEL = '1: Skeletal system'

GROUPS = {
    'quads': ['rectus femoris', 'vastus lateralis', 'vastus medialis', 'vastus intermedius'],
    'hamstrings': ['biceps femoris', 'semitendinosus', 'semimembranosus'],
    'glutes': ['gluteus maximus'],
    'abductors': ['gluteus medius', 'gluteus minimus', 'tensor fasciae latae'],
    'adductors': ['adductor longus', 'adductor brevis', 'adductor magnus', 'adductor minimus', 'gracilis', 'pectineus'],
    'calves': ['gastrocnemius', 'soleus'],
    'delts': ['deltoid'],
    'traps': ['trapezius'],
    'pecs': ['pectoralis major'],
}
# Фасции, апоневрозы, тракты и перегородки лежат ПОВЕРХ мышц и закрывают их — убираем; сухожилия и связки
# после упрощения превращаются в острые «осколки» — тоже.
SKIP = ['bursa', 'sheath', 'retinaculum', 'fascia', 'aponeurosis', 'tract', 'septum', 'ligament', 'tendon',
        'membrane', 'raphe', 'band', 'arch', 'expansion', 'hood', 'capsule', 'fibrous', 'lacertus']
# Кости, которые видны у «экорше»: голова, кисти, стопы, коленная чашечка, ключицы, рёбра спереди.
BONE_KEEP = ['skull', 'cranium', 'frontal bone', 'parietal', 'occipital', 'temporal bone', 'mandible', 'maxilla',
             'zygomatic', 'nasal bone', 'sphenoid', 'patella', 'clavicle', 'carpal', 'metacarpal', 'phalan',
             'tarsal', 'metatarsal', 'calcaneus', 'talus', 'navicular', 'cuboid', 'cuneiform', 'rib', 'sternum',
             'tibia', 'ulna', 'radius', 'scaphoid', 'lunate', 'triquetrum', 'pisiform', 'trapezium', 'trapezoid',
             'capitate', 'hamate']


def all_objs(col):
    out = list(col.objects)
    for c in col.children:
        out += all_objs(c)
    return out


def world_verts(o):
    mw = o.matrix_world
    return [mw @ v.co for v in o.data.vertices]


# ——— 1. Суставы по костям (до любых изменений сетки) ———
def obj(name):
    return bpy.data.objects.get(name)


def avg(vs):
    n = len(vs) or 1
    return Vector((sum(v.x for v in vs) / n, sum(v.y for v in vs) / n, sum(v.z for v in vs) / n))


def joints_for(side):
    s = side  # 'l' | 'r'
    femur = world_verts(obj(f'Femur.{s}'))
    zmax = max(v.z for v in femur)
    zmin = min(v.z for v in femur)
    top = [v for v in femur if v.z > zmax - 0.05]
    med = sorted(top, key=lambda v: abs(v.x))[: max(1, len(top) // 2)]  # головка бедра — медиальнее вертела
    hip = avg(med)
    knee = avg([v for v in femur if v.z < zmin + 0.035])
    talus = world_verts(obj(f'Talus.{s}'))
    ankle = avg(talus)
    calc = world_verts(obj(f'Calcaneus.{s}'))
    heel = max(calc, key=lambda v: v.y)  # человек смотрит в −Y: пятка — максимальный y
    heel = Vector((heel.x, heel.y, min(v.z for v in calc)))
    # Носок: самая передняя точка костей стопы этой стороны.
    foot = []
    for o in all_objs(bpy.data.collections[SKEL]):
        if o.type == 'MESH' and o.name.endswith('.' + s):
            c = avg([o.matrix_world @ Vector(b) for b in o.bound_box])
            if c.z < 0.06:
                foot += world_verts(o)
    toe = min(foot, key=lambda v: v.y) if foot else ankle + Vector((0, -0.18, -0.06))
    hum = world_verts(obj(f'Humerus.{s}'))
    hz1 = max(v.z for v in hum)
    hz0 = min(v.z for v in hum)
    shoulder = avg([v for v in hum if v.z > hz1 - 0.04])
    elbow = avg([v for v in hum if v.z < hz0 + 0.03])
    rad = world_verts(obj(f'Radius.{s}')) + world_verts(obj(f'Ulna.{s}'))
    rz0 = min(v.z for v in rad)
    wrist = avg([v for v in rad if v.z < rz0 + 0.03])
    hand = []
    for o in all_objs(bpy.data.collections[SKEL]):
        if o.type == 'MESH' and o.name.endswith('.' + s):
            c = avg([o.matrix_world @ Vector(b) for b in o.bound_box])
            if c.z < wrist.z and c.z > 0.5 and abs(c.x) > 0.15:
                hand += world_verts(o)
    tip = min(hand, key=lambda v: v.z) if hand else wrist + Vector((0, 0, -0.18))
    return dict(hip=hip, knee=knee, ankle=ankle, heel=heel, toe=toe, shoulder=shoulder, elbow=elbow,
                wrist=wrist, hand=tip)


J = {'l': joints_for('l'), 'r': joints_for('r')}
occ = obj('Occipital bone')
mand = obj('Mandible')
head = (avg([occ.matrix_world @ Vector(b) for b in occ.bound_box]) +
        avg([mand.matrix_world @ Vector(b) for b in mand.bound_box])) / 2
head.z += 0.03
c7 = obj('Vertebra C7')
neck = avg([c7.matrix_world @ Vector(b) for b in c7.bound_box]) if c7 else (J['l']['shoulder'] + J['r']['shoulder']) / 2

# Blender (Z вверх, лицом к −Y) → glTF / three (Y вверх, лицом к +Z): (x, y, z) → (x, z, −y).
def to_gl(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


joints = {f'{k}.{s}': to_gl(v) for s in 'lr' for k, v in J[s].items()}
joints['head'] = to_gl(head)
joints['neck'] = to_gl(neck)
with open(os.path.join(out_dir, 'joints.json'), 'w') as f:
    json.dump(joints, f, indent=1)
print('JOINTS', json.dumps(joints))

# ——— 2. Оставляем мышцы и нужные кости ———
# Z-Anatomy держит системы в исключённых / скрытых коллекциях: такие объекты не выделяются, и join/convert
# молча их пропускают. Включаем всё.
def unhide(lc):
    lc.exclude = False
    lc.hide_viewport = False
    lc.collection.hide_viewport = False
    lc.collection.hide_select = False
    for c in lc.children:
        unhide(c)


unhide(bpy.context.view_layer.layer_collection)
for o in bpy.data.objects:
    o.hide_viewport = False
    o.hide_select = False
    o.hide_set(False)

musc = [o for o in all_objs(bpy.data.collections[MUSC]) if o.type == 'MESH']
bones = [o for o in all_objs(bpy.data.collections[SKEL]) if o.type == 'MESH'
         and any(k in o.name.lower() for k in BONE_KEEP) and o.name[-2:] in ('.l', '.r', '.j')]
keep = set(musc + bones)
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
print('KEPT', len(musc), 'muscles', len(bones), 'bones')


def group_of(o):
    n = o.name.lower()
    if any(k in n for k in SKIP):
        return None
    if o in bones:
        return 'bones'
    side = n[-1] if n[-2:] in ('.l', '.r') else None
    for g, keys in GROUPS.items():
        if side and any(k in n for k in keys):
            return f'{g}_{side}'  # подчёркивание: three.js вырезает точки из имён узлов glTF
    return 'body'


# ——— 3. Упрощение и сборка групп ———
def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


RATIO = {'bones': 0.05, 'body': 0.075}
TARGET_RATIO = 0.14  # подсвечиваемые мышцы детальнее: на них смотрят
groups = {}
for o in keep:
    g = group_of(o)
    if g is None:
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    # Своя копия данных — многие объекты делят один меш.
    o.data = o.data.copy()
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    t = tris(o)
    ratio = RATIO.get(g, TARGET_RATIO) * DETAIL
    if t > 60:
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.ratio = max(ratio, 40 / t)
    groups.setdefault(g, []).append(o)

bpy.ops.object.select_all(action='DESELECT')
for g, objs in groups.items():
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sel = len(bpy.context.selected_objects)
    if sel != len(objs):
        print('WARN', g, 'selected', sel, 'of', len(objs))
    bpy.ops.object.convert(target='MESH')  # применяет Decimate
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = g
    joined.data.name = g
    bpy.ops.object.select_all(action='DESELECT')
    joined.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    joined.data.materials.clear()
    joined.select_set(False)
    print('GROUP', g, len(objs), 'objs', tris(joined), 'tris')

total = sum(tris(o) for o in bpy.data.objects if o.type == 'MESH')
print('TOTAL TRIS', total)

bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, OUT_NAME),
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_normals=True,
    export_texcoords=False,
    export_materials='NONE',
    export_animations=False,
    export_skins=False,
    export_morph=False,
    use_selection=False,
)
print('EXPORTED', os.path.join(out_dir, OUT_NAME))
