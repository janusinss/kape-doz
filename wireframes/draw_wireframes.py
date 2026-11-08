from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out=Path('wireframes')
W,H=1600,1000
ink='#282522'; muted='#706a63'; line='#c9c2b8'; paper='#f5f2ec'; white='#ffffff'; pale='#e9e4dc'; dark='#3e3a35'; accent='#765842'
def font(n,b=False): return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if b else 'segoeui.ttf'),n)
def box(x,y,w,h,fill=white,outline=line,r=8): d.rounded_rectangle((x,y,x+w,y+h),radius=r,fill=fill,outline=outline,width=2)
def text(x,y,s,size=20,color=ink,b=False): d.text((x,y),s,font=font(size,b),fill=color)
def rule(x,y,x2): d.line((x,y,x2,y),fill=line,width=2)
def button(x,y,w,h,s,primary=False):
 box(x,y,w,h,dark if primary else white,dark if primary else line,6); text(x+16,y+(h-24)//2,s,18,'#ffffff' if primary else ink,True)
def start(title,sub,active):
 global im,d
 im=Image.new('RGB',(W,H),paper); d=ImageDraw.Draw(im)
 d.rectangle((0,0,W,75),fill=dark); text(32,18,'CAFÉ DOS',26,'#ffffff',True); text(218,25,'STAFF WORKSPACE  /  WIREFRAME',15,'#d7cfc6',True)
 for i,name in enumerate(['Register','Barista station','Waste log']):
  x=810+i*175; text(x,27,name,16,'#ffffff' if active==i else '#bbb2a8',active==i)
 text(32,100,title,33,ink,True); text(33,148,sub,17,muted)
 text(1368,110,'MAIN BRANCH',15,muted,True); text(1368,138,'●  Online',16,accent,True)
def save(name): im.save(out/name)
start('Register','Fast order entry  /  Cashier view',0)
box(32,195,960,756); text(56,217,'MENU',16,muted,True); box(56,256,910,54,paper); text(75,269,'Search drinks or food...',18,muted)
for i,(s,w) in enumerate([('All items',115),('Coffee',100),('Non-coffee',135),('Food',80)]):
 x=[56,183,295,442][i]; button(x,328,w,46,s,i==0)
items=[('Iced Spanish Latte','₱ 165'),('Caramel Latte','₱ 175'),('Americano','₱ 125'),('Matcha Latte','₱ 180'),('Café Mocha','₱ 170'),('Chocolate','₱ 150')]
for i,(name,price) in enumerate(items):
 x=56+(i%3)*300; y=400+(i//3)*180; box(x,y,282,160,paper); text(x+18,y+22,name,19,ink,True); text(x+18,y+110,price,21,accent,True)
text(58,815,'Select a drink to choose size and customizations.',17,muted)
box(1012,195,556,756); text(1040,219,'CURRENT ORDER',16,muted,True); text(1040,254,'Order #024',27,ink,True); button(1395,220,140,44,'Dine in')
rule(1040,310,1540); text(1040,330,'1 × Iced Spanish Latte',20,ink,True); text(1443,330,'₱ 165',20,ink,True); text(1040,365,'16 oz  ·  Oat milk  ·  Less sweet',17,muted); text(1040,395,'Table 04',17,muted)
rule(1040,445,1540); button(1040,466,240,48,'+ Add customer'); text(1040,533,'Customer & points',15,muted,True); text(1040,558,'Optional at checkout',17,muted)
rule(1040,704,1540); text(1040,724,'Subtotal',18,muted); text(1455,724,'₱ 165',18,ink); text(1040,766,'TOTAL',17,ink,True); text(1428,753,'₱ 165',30,ink,True)
button(1040,822,500,70,'Charge  ·  ₱ 165',True); text(1040,906,'Payment voucher stays at the cashier',15,muted)
save('01-pos-register.png')
start('Barista station','Preparation queue  /  Kitchen display',1)
text(34,205,'ACTIVE ORDERS',16,muted,True); text(34,232,'3 orders to prepare',25,ink,True); button(1288,205,278,48,'Station: All drinks')
orders=[('024','TABLE 04','02:14','Iced Spanish Latte','16 oz  ·  Oat milk','Less sweet','1 drink'),('025','TAKEOUT','04:38','Caramel Latte','Hot  ·  12 oz','Extra shot','2 drinks'),('026','TABLE 02','00:42','Matcha Latte','Iced  ·  16 oz','Regular sweetness','1 drink')]
for i,(num,where,timer,drink,details,note,count) in enumerate(orders):
 x=32+i*522; box(x,295,500,574); text(x+24,317,'ORDER #'+num,22,ink,True); text(x+352,321,timer,20,accent,True); text(x+24,355,where+'   /   '+count,15,muted,True); rule(x+24,398,x+475)
 text(x+24,422,'1 × '+drink,22,ink,True); text(x+24,464,details,19,ink); box(x+24,507,450,68,paper); text(x+40,526,note,19,ink,True)
 if i==1: text(x+24,610,'1 × Americano  ·  Iced',19,ink,True)
 button(x+24,764,450,65,'Mark ready',True)
text(34,907,'Queue timers, routing, and printer status shown here are proposed states.',16,muted)
save('02-barista-station.png')
start('Log waste','Record ingredient use outside a sale  /  Staff view',2)
box(32,195,970,756); text(58,220,'NEW WASTE ENTRY',16,muted,True); text(58,255,'What was used or lost?',25,ink,True)
text(58,318,'INGREDIENT OR PACKAGING',15,muted,True); box(58,345,890,58,paper); text(76,361,'Espresso beans',19,ink); text(912,361,'⌄',20,muted)
text(58,430,'QUANTITY',15,muted,True); text(380,430,'UNIT',15,muted,True); box(58,457,292,58,paper); text(77,473,'18',19); box(380,457,190,58,paper); text(400,473,'grams    ⌄',19)
text(58,551,'REASON',15,muted,True)
for i,s in enumerate(['Dial-in','Spillage','Expired','Other']): button(58+i*170,582,154,50,s,i==0)
text(58,672,'NOTE  (OPTIONAL)',15,muted,True); box(58,699,890,65,paper); text(76,718,'e.g. Morning grinder adjustment',18,muted)
button(58,822,285,67,'Save waste entry',True); text(58,911,'Staff member and time are recorded automatically.',16,muted)
box(1024,195,544,756); text(1050,222,'RECENT ENTRIES',16,muted,True); text(1050,256,'Today',25,ink,True)
for y,a,b,c in [(323,'Espresso beans','18 g  ·  Dial-in','9:10 AM  ·  Barista'),(435,'Whole milk','100 ml  ·  Spillage','8:42 AM  ·  Barista'),(547,'Espresso beans','12 g  ·  Dial-in','8:05 AM  ·  Barista')]:
 rule(1050,y-18,1542); text(1050,y,a,19,ink,True); text(1050,y+32,b,17,ink); text(1050,y+60,c,16,muted)
text(1050,824,'No cost or profit data in staff view.',16,muted)
save('03-waste-log.png')
print('Created:',*[str(p.resolve()) for p in out.glob('*.png')],sep='\n')
