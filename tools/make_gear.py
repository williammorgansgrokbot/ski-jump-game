# Blender 4.2 headless: ski gear (helmet, goggles, jump skis) authored as real meshes -> models/gear_*.glb
# Coordinates written in glTF space (x right, y up, z forward) then mapped to Blender (bx=x, by=-z, bz=y).
import bpy, bmesh, math
from mathutils import Vector
def B(x,y,z): return Vector((x,-z,y))
def mat(name,col,rough=0.5,metal=0.0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    b=m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value=col; b.inputs['Roughness'].default_value=rough; b.inputs['Metallic'].default_value=metal
    return m
def orient_out(bm,center=Vector((0,0,0)),flat_axis=None):
    for f in bm.faces:
        c=f.calc_center_median()-center
        if flat_axis is not None: c=Vector((c.x,c.y,0)) if flat_axis=='z' else c
        if f.normal.dot(c)<0: f.normal_flip()
    bm.normal_update()
def obj_from(name,bm,mats,smooth=True):
    me=bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    o=bpy.data.objects.new(name,me); bpy.context.scene.collection.objects.link(o)
    if smooth:
        for p in me.polygons: p.use_smooth=True
    return o
def export(path,objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
def subsurf(o,l=2):
    m=o.modifiers.new('s','SUBSURF'); m.levels=l; m.render_levels=l
def bevel(o,w=0.01,seg=2):
    m=o.modifiers.new('b','BEVEL'); m.width=w; m.segments=seg; m.limit_method='ANGLE'

# ---------------- helmet: unit head-sized dome (radius 1 ~ head half-width), origin at head centre
clear()
M_h=mat('Helmet',(1,1,1,1),0.35); M_s=mat('HelmetStripe',(1,1,1,1),0.4); M_in=mat('HelmetTrim',(0.1,0.1,0.12,1),0.8)
bm=bmesh.new()
bmesh.ops.create_uvsphere(bm,u_segments=28,v_segments=18,radius=1.0)
# squash into a head-shaped shell, delete lower front (face opening), keep chin-less helmet
for v in bm.verts:
    v.co=Vector((v.co.x*1.0, v.co.y*1.0, v.co.z*1.0))  # sphere: blender z up here
bm.verts.ensure_lookup_table()
# remove bottom cap below z<-0.15 (open) and a face-window at front (-y in blender == +z glTF)
kill=[f for f in bm.faces if f.calc_center_median().z< -0.12]
bmesh.ops.delete(bm,geom=kill,context='FACES')
for v in bm.verts:
    v.co.x*=1.02; v.co.y*=1.18; v.co.z*=1.02
    # slight flare at the bottom edge
    if v.co.z< -0.05: v.co.x*=1.03; v.co.y*=1.0
# shell thickness
res=bmesh.ops.extrude_face_region(bm,geom=list(bm.faces)+list(bm.edges)+list(bm.verts)) if False else None
orient_out(bm)
helm=obj_from('Helmet',bm,[M_h,M_s,M_in])
sol=helm.modifiers.new('sol','SOLIDIFY'); sol.thickness=0.07; sol.offset=1
# racing stripe: faces near x ~0 -> stripe material
for p in helm.data.polygons:
    c=sum((helm.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
    if abs(c.x)<0.13 and c.z>0.1: p.material_index=1
subsurf(helm,1)
# chin-bump / ear pads are skipped; add small ear discs
bm2=bmesh.new()
for sx in (-1,1):
    bmesh.ops.create_cone(bm2,cap_ends=True,segments=16,radius1=0.34,radius2=0.30,depth=0.14,matrix=__import__('mathutils').Matrix.Translation(Vector((sx*0.99,0.05,-0.12)))@__import__('mathutils').Matrix.Rotation(math.radians(90),4,'Y'))
ears=obj_from('HelmetEars',bm2,[M_h]); 
M_c=mat('Collar',(1,1,1,1),0.6)
bm3=bmesh.new()
bmesh.ops.create_circle(bm3,segments=24,radius=1.0)
bm3.free()
bpy.ops.mesh.primitive_torus_add(major_radius=0.66,minor_radius=0.30,major_segments=28,minor_segments=12,location=(0,0.05,-1.02))
col=bpy.context.active_object; col.name='Collar'; col.data.materials.append(M_c)
for p in col.data.polygons: p.use_smooth=True
col.scale=(1,1.15,0.8)
export('/workspace/ski-jump-game/models/gear_helmet.glb',[helm,ears,col])

# ---------------- goggles: strap ring + big visor lens; origin at head centre, facing +z (glTF)
clear()
M_f=mat('GogFrame',(1,1,1,1),0.45); M_l=mat('Lens',(0.2,0.55,0.9,1),0.08,0.3); M_st=mat('GogStrap',(0.08,0.08,0.1,1),0.9)
bm=bmesh.new()
# lens: curved band segment of a cylinder radius R around the head, span angle +-55deg, height 0.42
R=1.13; H=0.36; n=22
rows=[]
for j,yy in enumerate((-H/2,H/2)):
    row=[]
    for i in range(n+1):
        a=math.radians(-58+116*i/n)
        row.append(bm.verts.new(B(math.sin(a)*R,yy,math.cos(a)*R)))
    rows.append(row)
for i in range(n): bm.faces.new((rows[0][i],rows[0][i+1],rows[1][i+1],rows[1][i]))
orient_out(bm,B(0,0,0))
lens=obj_from('GogLens',bm,[M_l])
sol=lens.modifiers.new('sol','SOLIDIFY'); sol.thickness=0.06; sol.offset=1
subsurf(lens,1)
# frame: slightly bigger shell around lens (thicker rim)
bm=bmesh.new()
for sc,hh,thk in ((1.0,H+0.13,0.0),):
    rows=[]
    for yy in (-hh/2,hh/2):
        row=[]
        for i in range(n+1):
            a=math.radians(-64+128*i/n); row.append(bm.verts.new(B(math.sin(a)*(R-0.07),yy,math.cos(a)*(R-0.07))))
        rows.append(row)
    for i in range(n): bm.faces.new((rows[0][i],rows[0][i+1],rows[1][i+1],rows[1][i]))
orient_out(bm,B(0,0,0))
frame=obj_from('GogFrame',bm,[M_f])
sol=frame.modifiers.new('sol','SOLIDIFY'); sol.thickness=0.07; sol.offset=1
bev=frame.modifiers.new('bv','BEVEL'); bev.width=0.025; bev.segments=2
# strap around head
bm=bmesh.new()
bmesh.ops.create_cone(bm,cap_ends=False,segments=32,radius1=1.045,radius2=1.045,depth=0.2,matrix=__import__('mathutils').Matrix.Rotation(math.radians(0),4,'Z'))
strap=obj_from('GogStrap',bm,[M_st])
sol=strap.modifiers.new('sol','SOLIDIFY'); sol.thickness=0.04
# scale strap to head shape (depth longer)
for v in strap.data.vertices: v.co.y*=1.15
export('/workspace/ski-jump-game/models/gear_goggles.glb',[lens,frame,strap])

# ---------------- skis: 1 unit = 1 metre, origin at binding centre, tip +z. Chunky cartoon jump ski.
clear()
M_t=mat('SkiTop',(1,1,1,1),0.3); M_b=mat('SkiBase',(0.07,0.07,0.09,1),0.5); M_bind=mat('Binding',(0.15,0.15,0.17,1),0.4,0.6); M_st=mat('SkiStripe',(1,1,1,1),0.3)
L_f=1.45; L_b=1.15; W=0.075; T=0.022
def prof(zz):
    # height of ski centreline: upturned tip (front) and small tail kick
    h=0.0
    if zz>L_f-0.42: t=(zz-(L_f-0.42))/0.42; h=0.11*t*t
    if zz<-L_b+0.18: t=(-L_b+0.18-zz)/0.18; h=0.03*t*t
    return h
def wid(zz):
    w=W
    if zz>L_f-0.5: t=(zz-(L_f-0.5))/0.5; w=W*(1-0.28*t*t)  # taper to rounded tip
    if zz>L_f-0.08: w*=max(0.35,1-(zz-(L_f-0.08))/0.08*0.65)
    if zz<-L_b+0.2: w*=1-0.12*(( -L_b+0.2-zz)/0.2)
    return w
bm=bmesh.new(); N=60
sec=[]
for i in range(N+1):
    zz=-L_b+(L_f+L_b)*i/N; w=wid(zz); h=prof(zz)
    ring=[bm.verts.new(B(sx*w,h+yy,zz)) for (sx,yy) in ((-1,0),(1,0),(1,T),(-1,T))]
    sec.append(ring)
for i in range(N):
    a,b=sec[i],sec[i+1]
    for k in range(4):
        bm.faces.new((a[k],a[(k+1)%4],b[(k+1)%4],b[k]))
bm.faces.new(sec[0][::-1]); bm.faces.new(sec[-1])
ski=obj_from('Ski',bm,[M_t,M_b],smooth=True)
for p in ski.data.polygons:
    n_=p.normal
    p.material_index=1 if n_.z< -0.5 else 0   # blender z is up; bottom faces -> base
bevm=ski.modifiers.new('bv','BEVEL'); bevm.width=0.006; bevm.segments=2
subsurf(ski,1)
# stripe on top near tip
bm=bmesh.new()
for z0,z1 in ((0.15,0.55),):
    pass
# binding block + toe plate
bm=bmesh.new()
bmesh.ops.create_cube(bm,size=1.0,matrix=__import__('mathutils').Matrix.Translation(B(0,T+0.015,0.0))@__import__('mathutils').Matrix.Diagonal((0.07,0.03,0.40,1)))
bmesh.ops.create_cube(bm,size=1.0,matrix=__import__('mathutils').Matrix.Translation(B(0,T+0.02,0.32))@__import__('mathutils').Matrix.Diagonal((0.08,0.035,0.11,1)))
bind=obj_from('Binding',bm,[M_bind],smooth=False)
bevb=bind.modifiers.new('bv','BEVEL'); bevb.width=0.012; bevb.segments=2
export('/workspace/ski-jump-game/models/gear_ski.glb',[ski,bind])
print('GEAR DONE')
