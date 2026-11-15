# Blender 4.2 headless: Quaternius "Man" (CC0) -> subdivided, smooth-shaded rigged skier base GLB (keeps rig + original clips)
import bpy, sys
SRC='/workspace/ski-jump-game/raw/man_HMnuH5geEG.glb'
OUT='/workspace/ski-jump-game/models/skier_base.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm=bpy.data.objects['HumanArmature']
for o in list(bpy.data.objects):
    if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
for a in bpy.data.actions: a.use_fake_user=True
mesh=bpy.data.objects['BaseHuman']
bpy.context.view_layer.objects.active=mesh
for o in bpy.data.objects: o.select_set(False)
mesh.select_set(True)
# reset pose so subsurf is evaluated in rest shape
arm.animation_data_clear() if arm.animation_data else None
for pb in arm.pose.bones: pb.rotation_mode='QUATERNION'; pb.rotation_quaternion=(1,0,0,0); pb.location=(0,0,0)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.customdata_custom_splitnormals_clear(); bpy.ops.mesh.remove_doubles(threshold=0.000005); bpy.ops.object.mode_set(mode='OBJECT')

# --- re-assign materials by dominant bone group so suit covers arms/legs, hands=gloves, feet=boots
me=mesh.data
def addmat(n):
    m=bpy.data.materials.new(n); me.materials.append(m); return len(me.materials)-1
slots={m.name:i for i,m in enumerate(me.materials)}
print('slots',slots)
gi={g.index:g.name for g in mesh.vertex_groups}
slots['Gloves']=addmat('Gloves'); slots['Boots']=addmat('Boots')
suitmats={'Skin','Shirt','Pants','Socks'}
import collections
cnt=collections.Counter()
for poly in me.polygons:
    mn=me.materials[poly.material_index].name
    if mn=='Eyes' and True:
        pass
    acc=collections.defaultdict(float)
    for vi in poly.vertices:
        for g in me.vertices[vi].groups: acc[gi[g.group]]+=g.weight
    if not acc: continue
    top=max(acc,key=acc.get)
    if mn=='Eyes':
        if top!='Head': poly.material_index=slots['Boots']; cnt['Boots']+=1
        continue
    if mn=='Socks': poly.material_index=slots['Boots']; cnt['Boots']+=1; continue
    if mn=='Hair' and not top.startswith('Foot'): continue
    if top.startswith(('Palm','MiddleHand','Fingers','Thumb')): t='Gloves'
    elif top.startswith('Foot'): t='Boots'
    elif top.startswith(('UpperArm','LowerArm','Shoulder','Torso','Abdomen')): t='Shirt'
    elif top.startswith(('UpperLeg','LowerLeg','Hips','Body')): t='Pants'
    else: continue
    poly.material_index=slots[t]; cnt[t]+=1
print('reassigned',cnt)
sub=mesh.modifiers.new('sub','SUBSURF'); sub.levels=1; sub.render_levels=1
# move subsurf above armature
while mesh.modifiers[0].name!='sub': bpy.ops.object.modifier_move_up(modifier='sub')
# apply with armature disabled
for m in mesh.modifiers:
    if m.type=='ARMATURE': m.show_viewport=False
bpy.ops.object.modifier_apply(modifier='sub')
for m in mesh.modifiers:
    if m.type=='ARMATURE': m.show_viewport=True
for p in mesh.data.polygons: p.use_smooth=True
bpy.ops.object.shade_smooth_by_angle(angle=1.0)
print('verts',len(mesh.data.vertices),'groups',len(mesh.vertex_groups),'mods',[m.type for m in mesh.modifiers])
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_apply=False)
