import random, math
random.seed(11)
W,H=779,344
o=[]
o.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="2433" height="1075" viewBox="0 0 {W} {H}">')
o.append('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FB0F2"/><stop offset="0.5" stop-color="#8FD8FA"/><stop offset="0.75" stop-color="#FFF0B8"/><stop offset="0.88" stop-color="#FFD08A"/></linearGradient>
<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFBE6"/><stop offset="0.18" stop-color="#FFF1B8" stop-opacity="0.95"/><stop offset="0.5" stop-color="#FFD27A" stop-opacity="0.35"/><stop offset="1" stop-color="#FFB25A" stop-opacity="0"/></radialGradient>
<linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D79BF0"/><stop offset="1" stop-color="#A98AF0"/></linearGradient>
<linearGradient id="farlit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD9E6"/><stop offset="1" stop-color="#F3A9C9"/></linearGradient>
<linearGradient id="mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5FD8"/><stop offset="1" stop-color="#5B4FC4"/></linearGradient>
<linearGradient id="midlit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E58FB8"/><stop offset="1" stop-color="#B676C4"/></linearGradient>
<linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2C24A"/><stop offset="1" stop-color="#8DBF3E"/></linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE6C2" stop-opacity="0"/><stop offset="1" stop-color="#FFE6C2" stop-opacity="0.55"/></linearGradient>
<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3EE0DE"/><stop offset="0.5" stop-color="#17B6D0"/><stop offset="1" stop-color="#0E86B0"/></linearGradient>
<linearGradient id="glit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4C8" stop-opacity="0.9"/><stop offset="1" stop-color="#FFF4C8" stop-opacity="0"/></linearGradient>
<filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="blur2"><feGaussianBlur stdDeviation="1.6"/></filter>
<filter id="blur1"><feGaussianBlur stdDeviation="0.7"/></filter>
</defs>''')
o.append(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
o.append('<circle cx="390" cy="150" r="150" fill="url(#sun)"/>')
# clouds
for cx,cy,s in [(120,60,1),(640,48,1.2),(470,92,0.7),(250,110,0.6)]:
    o.append(f'<g filter="url(#blur6)" opacity="0.85">'+''.join(f'<ellipse cx="{cx+dx*s}" cy="{cy+dy*s}" rx="{rx*s}" ry="{ry*s}" fill="#FFFFFF"/>' for dx,dy,rx,ry in [(0,0,46,14),(30,-8,30,14),(-28,-4,26,11),(10,6,50,9)])+'</g>')
def smooth(pts,bottom):
    d=f'M{pts[0][0]:.1f} {pts[0][1]:.1f}'
    for i in range(1,len(pts)-1):
        (x1,y1),(x2,y2)=pts[i],pts[i+1]
        d+=f' Q{x1:.1f} {y1:.1f} {(x1+x2)/2:.1f} {(y1+y2)/2:.1f}'
    d+=f' L{pts[-1][0]:.1f} {pts[-1][1]:.1f} L{W} {bottom} L0 {bottom} Z'
    return d
# far range: soft-shouldered peaks
far=[(-20,175)];x=-20;k=0
while x<W+20:
    x+=random.uniform(26,40); k+=1
    hi=random.uniform(92,128) if 160<x<660 else random.uniform(118,150)
    lo=hi+random.uniform(28,45)
    far.append((x,hi if k%2 else lo))
fd=smooth(far,250)
o.append(f'<clipPath id="farclip"><path d="{fd}"/></clipPath>')
o.append(f'<path d="{fd}" fill="url(#far)"/>')
o.append('<g clip-path="url(#farclip)">')
for i in range(1,len(far)-1):
    (x0,y0),(x1,y1),(x2,y2)=far[i-1],far[i],far[i+1]
    if y1<y0 and y1<y2:
        # shadow on right flank, warm light on left flank
        o.append(f'<path d="M{x1:.1f} {y1:.1f} L{x2+10:.1f} {y2+10:.1f} L{x2:.1f} 250 L{x1+6:.1f} 250 Z" fill="#9A7FE0" opacity="0.22" filter="url(#blur6)"/>')
        o.append(f'<path d="M{x1:.1f} {y1:.1f} L{x0-6:.1f} {y0+8:.1f} L{x0:.1f} 250 L{x1-4:.1f} 250 Z" fill="#FFD3E6" opacity="0.28" filter="url(#blur6)"/>')
        cid=f'sn{i}'
        o.append(f'<clipPath id="{cid}"><ellipse cx="{x1:.1f}" cy="{y1:.1f}" rx="{(x2-x0)*0.26:.1f}" ry="15"/></clipPath>')
        o.append(f'<path d="{fd}" fill="#FFFFFF" opacity="0.95" clip-path="url(#{cid})"/>')
        for g in range(4):
            gx=x1+random.uniform(-10,10); gl=random.uniform(12,26)*0.45
            o.append(f'<path d="M{gx:.1f} {y1+14:.1f} q{random.uniform(-2,2):.1f} {gl/2:.1f} {random.uniform(-4,4):.1f} {gl:.1f}" stroke="#FFFFFF" stroke-width="{random.uniform(0.8,1.6):.1f}" fill="none" opacity="0.75" stroke-linecap="round"/>')
o.append('</g>')
o.append(f'<rect y="120" width="{W}" height="130" fill="url(#haze)" opacity="0"/>')
# mid range: rolling and rounded
mid=[(-20,200)];x=-20
while x<W+20:
    x+=random.uniform(45,70); mid.append((x,random.uniform(160,205)))
md=smooth(mid,262)
o.append(f'<clipPath id="midclip"><path d="{md}"/></clipPath>')
o.append(f'<path d="{md}" fill="url(#mid)"/>')
o.append('<g clip-path="url(#midclip)">')
for i in range(1,len(mid)-1):
    (x1,y1)=mid[i]
    o.append(f'<ellipse cx="{x1-18:.1f}" cy="{y1+30:.1f}" rx="40" ry="40" fill="#F7A8D6" opacity="0.35" filter="url(#blur6)"/>')
o.append('</g>')
o.append(f'<rect y="175" width="{W}" height="85" fill="url(#haze)" opacity="0"/>')
# golden near hills
o.append('<path d="M0 238 Q90 212 180 236 Q250 250 300 246 L300 262 L0 262 Z" fill="url(#hill)"/>')
o.append('<path d="M480 246 Q560 220 660 232 Q720 238 779 226 L779 262 L480 262 Z" fill="url(#hill)"/>')
for px in [40,62,76,140,170,505,528,600,690,712]:
    by=238 if px<300 else 236; ph=random.uniform(14,22)
    o.append(f'<ellipse cx="{px}" cy="{by-ph/2:.1f}" rx="{ph/5:.1f}" ry="{ph/2:.1f}" fill="{random.choice(["#E3A93B","#D18E2A","#5E8A3A"])}"/>')
# lake
o.append(f'<rect y="246" width="{W}" height="{H-246}" fill="url(#lake)"/>')
# reflection of mid range
rd='M'+' L'.join(f'{a:.1f} {246+(246-b)*0.45:.1f}' for a,b in mid)+f' L{W} 246 L0 246 Z'
o.append(f'<path d="{rd}" fill="#5B4FA6" opacity="0.28" filter="url(#blur2)"/>')
# sun glitter column
o.append('<path d="M360 248 L420 248 L452 344 L328 344 Z" fill="url(#glit)" opacity="0.55" filter="url(#blur2)"/>')
for i in range(90):
    y=random.uniform(250,330); w=random.uniform(4,22)*(1+(y-250)/80); x=random.gauss(390,25+(y-250)*0.6)
    o.append(f'<path d="M{x-w/2:.1f} {y:.1f} H{x+w/2:.1f}" stroke="#FFF7D6" stroke-width="{random.uniform(0.6,1.4):.1f}" stroke-linecap="round" opacity="{random.uniform(0.4,0.9):.2f}"/>')
for i in range(70):
    y=random.uniform(252,335); x=random.uniform(0,W); w=random.uniform(8,30)
    o.append(f'<path d="M{x:.1f} {y:.1f} h{w:.1f}" stroke="#9EE9EA" stroke-width="0.8" stroke-linecap="round" opacity="0.55"/>')
# steamer (vintage lake steamer, generic)
sx,sy=520,262
o.append(f'<g transform="translate({sx} {sy}) scale(0.9)"><path d="M-22 0 L26 0 L20 7 L-18 7 Z" fill="#2B2F4A"/><rect x="-14" y="-6" width="30" height="6" fill="#F4F1E8"/><rect x="-2" y="-16" width="5" height="10" fill="#C8392B"/><rect x="-2" y="-16" width="5" height="2.5" fill="#1F1F2E"/><path d="M0 -17 Q-8 -30 -20 -34 Q-30 -36 -40 -32" fill="none" stroke="#FFFFFF" stroke-width="4" opacity="0.7" filter="url(#blur2)" stroke-linecap="round"/><path d="M-22 9 h50" stroke="#FFFFFF" stroke-width="0.8" opacity="0.6"/></g>')
# tussock + lupins foreground
def lupin(x,base,h,col,light,dark):
    s=[]
    lean=random.uniform(-5,5)
    # palmate leaves near base
    for k in range(2):
        lx=x+random.uniform(-8,8); ly=base-random.uniform(4,h*0.18)
        for a in range(7):
            ang=math.radians(a*360/7+random.uniform(-8,8)); L=h/9
            s.append(f'<ellipse cx="{lx+math.cos(ang)*L*0.5:.1f}" cy="{ly+math.sin(ang)*L*0.35:.1f}" rx="{L*0.5:.1f}" ry="{L*0.13:.1f}" transform="rotate({math.degrees(ang):.0f} {lx+math.cos(ang)*L*0.5:.1f} {ly+math.sin(ang)*L*0.35:.1f})" fill="{random.choice(["#2F6B3A","#3F8A45","#4E9C4E"])}"/>')
    top=(x+lean,base-h)
    s.append(f'<path d="M{x:.1f} {base} Q{x+lean*0.3:.1f} {base-h*0.5:.1f} {top[0]:.1f} {top[1]:.1f}" stroke="#2F6B3A" stroke-width="{max(1,h/55):.1f}" fill="none"/>')
    n=max(6,int(h*0.62/3.2))
    for i in range(n):
        t=i/n; y=base-h*0.36-(h*0.64)*t; xc=x+lean*(0.4+0.6*t); r=(1-t*0.85)*h/22+0.9
        for side in (-1,1):
            c=light if i%4==0 else (dark if i%5==2 else col)
            if t>0.85: c="#7BAF5A"
            s.append(f'<ellipse cx="{xc+side*r*0.8:.1f}" cy="{y+side*0.8:.1f}" rx="{r:.1f}" ry="{r*0.62:.1f}" fill="{c}"/>')
        if i%2==0: s.append(f'<ellipse cx="{xc:.1f}" cy="{y-1.4:.1f}" rx="{r*0.7:.1f}" ry="{r*0.5:.1f}" fill="{light}" opacity="0.9"/>')
    return ''.join(s)
pal=[('#7B3FB0','#C39BEA','#4F2380'),('#E2508F','#F9B5D0','#A82E66'),('#F5B83C','#FFE59A','#C98A12'),('#5368DA','#A8B8F8','#2F3FA0'),('#F27A9E','#FFD0DD','#C24F76')]
for x in range(0,W,3):
    h=random.uniform(6,18) if (x<230 or x>550) else random.uniform(3,9)
    o.append(f'<path d="M{x} 344 q{random.uniform(-4,4):.1f} {-h/2:.1f} {random.uniform(-6,6):.1f} {-h:.1f}" stroke="{random.choice(["#C9A24A","#A88A35","#6F8F3A"])}" stroke-width="1" fill="none"/>')
items=[]
for x in list(range(0,225,16))+list(range(558,779,16)):
    items.append((x+random.uniform(-4,4),344,random.uniform(45,80)))
for x in list(range(-5,232,26))+list(range(550,795,26)):
    items.append((x+random.uniform(-5,5),352,random.uniform(85,130)))
items.sort(key=lambda t:t[2])
for x,b,h in items:
    c,l,d=random.choice(pal); o.append(lupin(x,b,h,c,l,d))
o.append('</svg>')
open('scene_clean.svg','w').write(''.join(o))
