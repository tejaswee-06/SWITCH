import json,struct,sys,re,numpy as np
from PIL import Image, ImageDraw
b=open('public/models/switch_villa.glb','rb').read()
jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl]); off=20+jl+8; bin_=b[off:]
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    ct={5126:'f4',5125:'u4',5123:'u2',5121:'u1'}[a['componentType']]; n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    o=bv.get('byteOffset',0)+a.get('byteOffset',0); st=bv.get('byteStride')
    if st and st!=np.dtype(ct).itemsize*n:
        raw=np.frombuffer(bin_,dtype='u1',count=a['count']*st,offset=o).reshape(a['count'],st)[:,:np.dtype(ct).itemsize*n].copy()
        return raw.view(ct).reshape(a['count'],n)
    return np.frombuffer(bin_,dtype=ct,count=a['count']*n,offset=o).reshape(a['count'],n)
def mat4(n):
    m=np.eye(4)
    if 'matrix' in n: return np.array(n['matrix']).reshape(4,4).T
    t=np.eye(4); t[:3,3]=n.get('translation',[0,0,0])
    x,y,z,w=n.get('rotation',[0,0,0,1]); r=np.eye(4)
    r[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    s=np.eye(4); s[0,0],s[1,1],s[2,2]=n.get('scale',[1,1,1]); return t@r@s
tris=[]  # (verts(3,3), color, name)
hide=re.compile(sys.argv[3]) if len(sys.argv)>3 and sys.argv[3] else None
def walk(i,P,top):
    n=j['nodes'][i]; M=P@mat4(n); top=top or n['name']
    if hide and hide.match(top): return
    if 'mesh' in n:
        for p in j['meshes'][n['mesh']]['primitives']:
            pos=acc(p['attributes']['POSITION']); idx=acc(p['indices']).reshape(-1) if 'indices' in p else np.arange(len(pos))
            m=j['materials'][p['material']]; c=m['pbrMetallicRoughness'].get('baseColorFactor',[.8,.8,.8,1]); 
            if m['name']=='MAT_GLASS': c=[.6,.8,.9,.25]
            wp=(np.c_[pos,np.ones(len(pos))]@M.T)[:,:3]; t=wp[idx].reshape(-1,3,3)
            for k in range(len(t)): tris.append((t[k],c,m['name']))
    for c in n.get('children',[]): walk(c,M,top)
for r in j['scenes'][0]['nodes']: walk(r,np.eye(4),None)
W,H=1100,700; eye=np.array(eval(sys.argv[1])); tgt=np.array(eval(sys.argv[2]))
f=(tgt-eye); f/=np.linalg.norm(f); r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f)
def proj(p):
    d=p-eye; x=d@r; y=d@u; z=d@f; s=(H/2)/np.tan(np.radians(20)); return np.c_[W/2+s*x/z, H/2-s*y/z], z
V=np.array([t for t,_,_ in tris]); S,Z=proj(V.reshape(-1,3)); S=S.reshape(-1,3,2); Z=Z.reshape(-1,3)
cen=V.mean(1); depth=((cen-eye)**2).sum(1); order=np.argsort(-depth)
img=Image.new('RGB',(W,H),(150,190,225)); d=ImageDraw.Draw(img,'RGBA'); L=np.array([.4,.8,.45]); L/=np.linalg.norm(L)
for k in order:
    if (Z[k]<0.1).any(): continue
    t,c,nm=tris[k]; nrm=np.cross(t[1]-t[0],t[2]-t[0]); ln=np.linalg.norm(nrm)
    if ln<1e-12: continue
    nrm/=ln; sh=0.45+0.55*abs(nrm@L)
    col=tuple(int(min(255,max(0,v**(1/2.2)*255*sh))) for v in c[:3])
    d.polygon([tuple(p) for p in S[k]],fill=col+(int(c[3]*255) if c[3]<1 else 255,))
img.save(sys.argv[4]); print('saved',sys.argv[4],len(tris),'tris')
