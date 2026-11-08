from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out=Path('wireframes/options'); out.mkdir(parents=True,exist_ok=True)
W,H=1600,1000
bg='#f5f2ec'; white='#fff'; ink='#292622'; gray='#706a63'; stroke='#c9c2b8'; soft='#eae5dd'; dark='#403a35'; accent='#765842'
def f(n,b=False): return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if b else 'segoeui.ttf'),n)
def txt(x,y,s,n=19,c=ink,b=False): d.text((x,y),s,font=f(n,b),fill=c)
def rect(x,y,w,h,fill=white,r=8): d.rounded_rectangle((x,y,x+w,y+h),radius=r,fill=fill,outline=stroke,width=2)
def btn(x,y,w,h,s,primary=False):
 rect(x,y,w,h,dark if primary else white,6); txt(x+14,y+(h-23)//2,s,17,white if primary else ink,True)
def header(screen,option,description):
 global im,d
 im=Image.new('RGB',(W,H),bg); d=ImageDraw.Draw(im); d.rectangle((0,0,W,72),fill=dark)
 txt(32,18,'CAFÉ DOS',25,white,True); txt(235,25,'CONCEPT WIREFRAMES',15,'#d8d1c8',True); txt(1240,23,screen.upper()+'  /  '+option,16,white,True)
 txt(32,95,screen,32,ink,True); txt(32,144,description,18,gray); txt(1350,105,'MAIN BRANCH',15,gray,True); txt(1350,135,'●  Online',16,accent,True)
def line(x,y,x2): d.line((x,y,x2,y),fill=stroke,width=2)
def save(name): im.save(out/name)
def menu_grid(x,y,w,cols=3):
 names=['Iced Spanish Latte','Caramel Latte','Americano','Matcha Latte','Café Mocha','Chocolate']; gap=14; cw=(w-gap*(cols-1))//cols
 for i,name in enumerate(names):
  xx=x+i%cols*(cw+gap); yy=y+i//cols*154; rect(xx,yy,cw,140,soft); txt(xx+14,yy+17,name,18,ink,True); txt(xx+14,yy+100,'₱ '+str([165,175,125,180,170,150][i]),18,accent,True)
def ticket(x,y,w,h,with_customize=False):
 rect(x,y,w,h); txt(x+22,y+20,'CURRENT TICKET   #024',17,gray,True); btn(x+w-145,y+14,120,42,'Dine in')
 line(x+22,y+72,x+w-22); txt(x+22,y+94,'1 × Iced Spanish Latte',19,ink,True); txt(x+22,y+128,'16 oz · Oat milk · Less sweet',16,gray); txt(x+22,y+155,'Table 04',16,gray)
 if with_customize:
  line(x+22,y+198,x+w-22); txt(x+22,y+217,'EDIT DRINK',15,gray,True); txt(x+22,y+248,'Size',17,ink,True); btn(x+120,y+236,100,43,'16 oz',True); btn(x+230,y+236,100,43,'12 oz'); txt(x+22,y+305,'Milk',17,ink,True); btn(x+120,y+292,110,43,'Oat',True); btn(x+240,y+292,130,43,'Whole')
 line(x+22,y+h-191,x+w-22); txt(x+22,y+h-170,'Customer  + Add',17,gray,True); txt(x+22,y+h-123,'TOTAL',17,ink,True); txt(x+w-110,y+h-128,'₱ 165',22,ink,True); btn(x+22,y+h-79,w-44,55,'Charge  ·  ₱ 165',True)
for v in range(4):
 desc=['Familiar grid and ticket','Category rail with fast shortcuts','Searchable list and detailed ticket','Quick customization beside the menu'][v]
 header('Cashier register','ABCD'[v],desc)
 if v==0:
  rect(32,190,960,758); txt(55,210,'ALL ITEMS',16,gray,True); rect(55,248,910,52,soft); txt(72,260,'Search drinks or food',18,gray); 
  for i,s in enumerate(['All items','Coffee','Non-coffee','Food']): btn(55+i*145,320,130,46,s,i==0)
  menu_grid(55,389,910); btn(55,817,180,48,'Open tickets'); ticket(1012,190,556,758)
 elif v==1:
  rect(32,190,215,758,dark); txt(52,214,'CATEGORIES',16,'#ddd6cc',True)
  for i,s in enumerate(['★  Favorites','Coffee','Non-coffee','Food','All items']): txt(52,270+i*65,s,19,white,i==0)
  rect(266,190,740,758); txt(289,214,'FAVORITES',18,ink,True); txt(289,251,'Your most ordered items',16,gray); menu_grid(289,301,690,2); btn(289,820,180,48,'Open tickets'); ticket(1026,190,542,758)
 elif v==2:
  rect(32,190,865,758); txt(56,211,'MENU',16,gray,True); rect(56,252,818,52,soft); txt(75,264,'Search by item or category',18,gray)
  for i,(n,p) in enumerate(zip(['Iced Spanish Latte','Caramel Latte','Americano','Matcha Latte','Café Mocha','Chocolate'],['165','175','125','180','170','150'])):
   y=331+i*81; line(56,y+68,873); txt(64,y,n,20,ink,True); txt(724,y,'₱ '+p,19,accent,True); btn(805,y-4,58,46,'+')
  ticket(917,190,651,758); txt(950,510,'QUICK ACTIONS',15,gray,True); btn(950,543,180,45,'Open tickets'); btn(1143,543,160,45,'Add note')
 else:
  rect(32,190,840,758); txt(56,214,'CHOOSE A DRINK',17,gray,True); rect(56,253,790,50,soft); txt(73,264,'Search menu',18,gray); menu_grid(56,330,790,2); ticket(892,190,676,758,True)
 save('cashier-'+str(v+1)+'.png')
def order(x,y,w,h,num,drink,meta,state,style=0):
 rect(x,y,w,h); txt(x+20,y+16,'#'+num+'   '+meta,17,gray,True); txt(x+w-100,y+17,state,16,accent,True); line(x+20,y+56,x+w-20); txt(x+20,y+76,drink,20,ink,True); txt(x+20,y+111,'16 oz  ·  Oat milk',17,ink); txt(x+20,y+145,'Less sweet',17,gray); btn(x+20,y+h-65,w-40,45,'Mark ready',True)
for v in range(4):
 desc=['Ticket cards with elapsed time','Workflow columns by preparation stage','Compact queue with selected order','Large ticket for focused preparation'][v]; header('Barista station','ABCD'[v],desc)
 if v==0:
  txt(34,195,'ACTIVE ORDERS  /  3',18,gray,True); btn(1250,190,160,45,'Recall'); btn(1420,190,148,45,'All drinks')
  for i,(num,n,st) in enumerate([('024','Iced Spanish Latte','02:14'),('025','Caramel Latte','04:38'),('026','Matcha Latte','00:42')]): order(32+i*522,265,500,510,num,n,'TABLE 04',st)
 elif v==1:
  for i,(title,count) in enumerate([('NEW','2 orders'),('PREPARING','1 order'),('READY','1 order')]):
   x=32+i*522; rect(x,190,500,758,soft); txt(x+20,210,title,18,ink,True); txt(x+356,213,count,15,gray); 
   if i==0:
    order(x+16,260,468,270,'024','Iced Spanish Latte','TABLE 04','02:14'); order(x+16,554,468,270,'026','Matcha Latte','TABLE 02','00:42')
   elif i==1: order(x+16,260,468,270,'025','Caramel Latte','TAKEOUT','04:38')
   else: order(x+16,260,468,270,'023','Americano','TABLE 03','DONE')
 elif v==2:
  rect(32,190,600,758); txt(56,214,'ORDER QUEUE',17,gray,True)
  for i,(num,n,st) in enumerate([('024','Iced Spanish Latte','02:14'),('025','Caramel Latte','04:38'),('026','Matcha Latte','00:42')]):
   y=260+i*155; rect(56,y,552,130,soft if i==0 else white); txt(75,y+16,'#'+num+'  ·  '+st,17,accent,True); txt(75,y+50,n,21,ink,True); txt(75,y+88,'Table 04  ·  1 drink',16,gray)
  order(655,190,913,758,'024','Iced Spanish Latte','TABLE 04','02:14'); txt(678,439,'PREPARATION NOTE',15,gray,True); txt(678,473,'Oat milk  /  Less sweet',22,ink,True); btn(678,575,240,52,'Print cup label')
 else:
  txt(34,195,'ORDER 1 OF 3',17,gray,True); btn(1315,190,250,48,'View all orders')
  rect(190,265,1220,580); txt(230,300,'#024   ·   TABLE 04',25,gray,True); txt(1160,302,'02:14',25,accent,True); line(230,361,1370); txt(230,400,'1 × Iced Spanish Latte',36,ink,True); txt(230,472,'16 oz   ·   Oat milk',26); txt(230,527,'LESS SWEET',24,accent,True); btn(230,721,280,62,'Previous'); btn(1000,721,370,62,'Mark ready',True)
 save('barista-'+str(v+1)+'.png')
def fields(x,y,w):
 txt(x,y,'INGREDIENT OR PACKAGING',15,gray,True); rect(x,y+28,w,56,soft); txt(x+16,y+43,'Espresso beans',18)
 txt(x,y+114,'QUANTITY',15,gray,True); rect(x,y+142,200,56,soft); txt(x+16,y+157,'18',18); rect(x+216,y+142,170,56,soft); txt(x+232,y+157,'grams',18)
 txt(x,y+230,'REASON',15,gray,True)
 for i,s in enumerate(['Dial-in','Spillage','Expired','Other']): btn(x+i*145,y+260,135,45,s,i==0)
 txt(x,y+344,'NOTE (OPTIONAL)',15,gray,True); rect(x,y+373,w,60,soft); txt(x+15,y+390,'Morning grinder adjustment',17,gray)
for v in range(4):
 desc=['Single entry with recent activity','Fast presets for common waste','Step-by-step guided entry','Daily log with inline entry'][v]; header('Waste & dial-in','ABCD'[v],desc)
 if v==0:
  rect(32,190,970,758); fields(58,230,900); btn(58,815,250,60,'Save entry',True); rect(1024,190,544,758); txt(1050,220,'RECENT ENTRIES',17,gray,True)
  for i,s in enumerate(['Espresso beans  ·  18 g','Whole milk  ·  100 ml','Espresso beans  ·  12 g']): txt(1050,285+i*105,s,19,ink,True); txt(1050,316+i*105,'Dial-in  ·  Today',16,gray)
 elif v==1:
  rect(32,190,1500,758); txt(60,216,'QUICK LOG',17,gray,True); txt(60,251,'Choose a common entry',25,ink,True)
  for i,(a,b) in enumerate([('Espresso dial-in','Beans  ·  grams'),('Milk spillage','Milk  ·  milliliters'),('Other waste','Choose ingredient')]):
   x=60+i*485; rect(x,310,460,190,soft); txt(x+20,335,a,22,ink,True); txt(x+20,375,b,17,gray); btn(x+20,427,170,45,'Select',i==0)
  txt(60,550,'ESPRESSO DIAL-IN',16,gray,True); txt(60,585,'Quantity',19,ink,True); rect(200,574,180,55,soft); txt(220,589,'18 g',20); btn(1200,740,280,65,'Save entry',True); txt(60,745,'Optional note: Morning adjustment',17,gray)
 elif v==2:
  rect(210,190,1180,758); txt(250,225,'STEP 2 OF 3   /   AMOUNT',16,gray,True); txt(250,280,'How much was used?',31,ink,True); txt(250,336,'Espresso beans  ·  Dial-in',19,gray); rect(250,400,430,85,soft); txt(275,417,'18',34,ink,True); btn(700,414,185,55,'grams'); txt(250,550,'Select the unit used when measuring the ingredient.',18,gray); btn(250,780,210,60,'Back'); btn(1080,780,260,60,'Continue',True)
 else:
  rect(32,190,1000,758); txt(56,216,"TODAY’S WASTE LOG",17,gray,True); btn(790,204,210,48,'+ New entry',True); line(56,280,1005)
  txt(56,300,'INGREDIENT',15,gray,True); txt(440,300,'AMOUNT',15,gray,True); txt(630,300,'REASON',15,gray,True); txt(862,300,'TIME',15,gray,True)
  for i,(a,b,c,t) in enumerate([('Espresso beans','18 g','Dial-in','9:10'),('Whole milk','100 ml','Spillage','8:42'),('Espresso beans','12 g','Dial-in','8:05')]):
   y=345+i*90; txt(56,y,a,18,ink,True); txt(440,y,b,18); txt(630,y,c,18); txt(862,y,t,18); line(56,y+60,1005)
  rect(1054,190,514,758); txt(1080,218,'ADD ENTRY',17,gray,True); txt(1080,272,'Ingredient',16,ink,True); rect(1080,300,455,55,soft); txt(1095,313,'Espresso beans',17); txt(1080,390,'Amount',16,ink,True); rect(1080,419,455,55,soft); txt(1095,432,'18 g',17); txt(1080,510,'Reason',16,ink,True); rect(1080,538,455,55,soft); txt(1095,551,'Dial-in',17); btn(1080,819,455,60,'Save entry',True)
 save('waste-'+str(v+1)+'.png')
print('Created 12 options in',out.resolve())
