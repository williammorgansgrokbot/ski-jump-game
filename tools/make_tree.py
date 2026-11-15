import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/workspace/ski-jump-game/raw/pine_snow.glb')
meshes=[o for o in bpy.data.objects if o.type=='MESH']
for o in bpy.data.objects: o.select_set(False)
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
if len(meshes)>1: bpy.ops.object.join()
o=bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
print('tris before',len(o.data.polygons))
m=o.modifiers.new('d','DECIMATE'); m.ratio=0.42
bpy.ops.object.modifier_apply(modifier='d')
for p in o.data.polygons: p.use_smooth=False
print('tris after',len(o.data.polygons),[m.name for m in o.data.materials])
bpy.ops.export_scene.gltf(filepath='/workspace/ski-jump-game/models/pine.glb',export_format='GLB',export_yup=True)
