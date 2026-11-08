from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out=Path('wireframes/refined/staff'); out.mkdir(parents=True,exist_ok=True)
W,H=1600,1000; bg='#ffffff'; white='#ffffff'; ink='#302720'; gray='#73675b'; stroke='#e3d7c7'; soft='#f4eadc'; dark='#302721'; accent='#966237'
def f(n,b=False): return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if b else 'segoeui.ttf'),n)
def text(x,y,s,n=19,c=ink,b=False): d.text((x,y),s,font=f(n,b),fill=c)
def box(x,y,w,h,fill=white,r=4):
 if fill==white and w>450 and h>350: d.rectangle((x,y,x+w,y+h),fill=fill)
 else: d.rounded_rectangle((x,y,x+w,y+h),radius=r,fill=fill,outline=stroke,width=2)
def btn(x,y,w,h,s,on=False):
 box(x,y,w,h,dark if on else white); text(x+14,y+(h-22)//2,s,17,white if on else ink,True)
def header(active):
 global im,d
 im=Image.new('RGB',(W,H),bg); d=ImageDraw.Draw(im); d.rectangle((0,0,W,66),fill=dark)
 text(24,17,'CAFÉ DOS',23,white,True)
 for i,(x,s) in enumerate([(410,'Register'),(800,'Barista station'),(1250,'Waste')]):
  text(x,21,s,17,white if i==active else '#dacbbc',i==active)
  if i==active: d.rectangle((x,61,x+(len(s)*9),65),fill='#d6aa72')

def rule(x,y,x2): d.line((x,y,x2,y),fill=stroke,width=2)
def save(name): im.save(out/name)
header(0)
box(20,82,185,897,soft); text(40,105,'Menu',17,gray,True)
for i,s in enumerate(['Favorites','Coffee','Non-coffee','Food','All items']):
 y=155+i*66
 if i==0: d.rounded_rectangle((31,y-8,193,y+38),radius=4,fill='#e8d9c6')
 text(45,y,s,18,ink,i==0)
box(220,82,797,897); text(245,105,'Favorites',25,ink,True); btn(800,99,190,45,'Open tickets')
box(245,165,745,52,soft); text(263,177,'Search menu',18,gray)
names=['Iced Spanish Latte','Caramel Latte','Americano','Matcha Latte','Café Mocha','Chocolate']; prices=[165,175,125,180,170,150]
for i,n in enumerate(names):
 x=245+i%2*377; y=238+i//2*174; box(x,y,360,157,white); text(x+18,y+20,n,20,ink,True); text(x+18,y+112,'₱ '+str(prices[i]),19,ink,True)
box(1032,82,548,897); text(1056,107,'Current ticket  #024',21,ink,True); btn(1410,102,145,44,'Dine in'); rule(1056,169,1555)
text(1056,195,'1 × Iced Spanish Latte',20,ink,True); text(1471,195,'₱ 165',19,ink,True); text(1056,231,'16 oz  ·  Oat milk  ·  Less sweet',17,gray); text(1056,260,'Table 04',17,gray); rule(1056,312,1555)
btn(1056,336,210,49,'+ Add customer'); btn(1280,336,177,49,'Add note'); text(1056,410,'Kitchen connected   ·   Printer connected',16,gray)
rule(1056,748,1555); text(1056,770,'TOTAL',18,ink,True); text(1450,760,'₱ 165',29,ink,True); btn(1056,827,500,70,'Charge  ·  ₱ 165',True)
save('cashier-register.png')
header(1)
text(25,85,'Active orders  ·  6',20,ink,True); btn(1210,78,158,44,'Recall'); btn(1380,78,195,44,'All stations')
orders=[('024','TABLE 04','02:14','Iced Spanish Latte','16 oz · Oat milk','Less sweet'),('025','TAKEOUT','04:38','Caramel Latte','12 oz · Hot','Extra shot'),('026','TABLE 02','00:42','Matcha Latte','16 oz · Iced','Regular sweetness'),('027','TABLE 06','03:10','Americano','16 oz · Iced','No sugar'),('028','TAKEOUT','01:28','Café Mocha','12 oz · Hot','Whole milk'),('029','TABLE 01','00:18','Chocolate','16 oz · Iced','Less ice')]
for i,(num,where,t,drink,details,note) in enumerate(orders):
 x=20+i%3*526; y=137+i//3*422; box(x,y,510,405,soft); text(x+20,y+17,'#'+num+'  ·  '+where,19,ink,True); text(x+410,y+19,t,17,accent,True); rule(x+20,y+59,x+490)
 text(x+20,y+80,'1 × '+drink,21,ink,True); text(x+20,y+121,details,18); box(x+20,y+160,470,55,soft); text(x+35,y+176,note,17,ink,True); btn(x+20,y+325,470,57,'Mark ready',True)
save('barista-station.png')
header(2)
box(20,82,1560,897); text(48,106,'Log waste',25,ink,True); text(48,148,'Choose a common entry',18,gray)
for i,(title,sub) in enumerate([('Espresso dial-in','Beans  ·  grams'),('Milk spillage','Milk  ·  milliliters'),('Other waste','Choose ingredient')]):
 x=48+i*502; box(x,195,480,185,soft if i==0 else white); text(x+20,218,title,21,ink,True); text(x+20,258,sub,17,gray); btn(x+20,312,155,45,'Selected' if i==0 else 'Select',i==0)
rule(48,423,1550); text(48,450,'ESPRESSO DIAL-IN',16,gray,True); text(48,492,'Quantity',18,ink,True); box(175,477,200,57,soft); text(194,490,'18',20); box(392,477,180,57,soft); text(410,490,'grams',18)
text(48,588,'Note',18,ink,True); box(175,574,775,57,soft); text(194,588,'Optional',18,gray)
text(48,787,'Recorded by the signed-in staff member',16,gray); btn(48,824,290,65,'Save waste entry',True); btn(355,824,210,65,'Recent entries')
save('waste-dial-in.png')
print('Saved 3 selected wireframes')
