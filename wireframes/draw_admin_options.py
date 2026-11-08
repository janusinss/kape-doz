from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out=Path('wireframes/admin-options'); out.mkdir(parents=True,exist_ok=True)
W,H=1600,1000; bg='#f5f2ec'; white='#fff'; ink='#292622'; gray='#706a63'; stroke='#c9c2b8'; soft='#ebe6df'; dark='#403a35'; accent='#765842'
def f(n,b=False): return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if b else 'segoeui.ttf'),n)
def t(x,y,s,n=19,c=ink,b=False): d.text((x,y),s,font=f(n,b),fill=c)
def box(x,y,w,h,fill=white): d.rounded_rectangle((x,y,x+w,y+h),radius=6,fill=fill,outline=stroke,width=2)
def line(x,y,w): d.line((x,y,x+w,y),fill=stroke,width=2)
def btn(x,y,w,s,on=False): box(x,y,w,48,dark if on else white); t(x+14,y+12,s,16,white if on else ink,True)
def base(title,letter,subtitle):
 global im,d
 im=Image.new('RGB',(W,H),bg); d=ImageDraw.Draw(im); d.rectangle((0,0,W,66),fill=dark)
 t(24,17,'CAFÉ DOS',23,white,True); t(245,23,'OWNER / MANAGER',15,'#d7cfc6',True); t(1255,23,'Main branch  ·  Admin',16,white,True)
 t(32,86,title,29,ink,True); t(32,131,subtitle,17,gray); t(1460,94,'OPTION '+letter,15,accent,True)
def rows(x,y,w,head,data,step=72):
 t(x,y,head,15,gray,True); line(x,y+30,w)
 for i,row in enumerate(data):
  yy=y+44+i*step
  for j,(s,pos) in enumerate(row): t(x+int(w*pos),yy,s,17,ink,j==0)
  line(x,yy+47,w)
def save(pre,i): im.save(out/f'{pre}-{i+1}.png')
for v in range(4):
 base('Sales & margin','ABCD'[v],['Overview with trend and product margins','Profit-first dashboard with cost breakdown','Product performance table with summary','Daily operations snapshot'][v]); btn(1240,140,155,'This month'); btn(1407,140,160,'Export CSV')
 if v==0:
  for i,(a,b) in enumerate([('NET SALES','₱ 128,400'),('EST. GROSS PROFIT','₱ 78,100'),('GROSS MARGIN','60.8%')]):
   x=32+i*522; box(x,205,500,125); t(x+20,225,a,15,gray,True); t(x+20,259,b,29,ink,True)
  box(32,350,940,560); t(55,375,'Sales trend',22,ink,True); d.line([(75,765),(190,700),(300,730),(410,615),(520,650),(635,530),(750,560),(870,450)],fill=accent,width=5); t(55,855,'Daily sales  ·  sample period',16,gray)
  box(992,350,576,560); rows(1015,380,530,'TOP PRODUCTS   /   EST. MARGIN',[[('Spanish Latte',0),('62%',.8)],[('Caramel Latte',0),('58%',.8)],[('Americano',0),('71%',.8)]])
 elif v==1:
  box(32,205,730,300); t(58,230,'Estimated gross profit',18,gray,True); t(58,270,'₱ 78,100',43,ink,True); t(58,340,'Sales minus estimated ingredient and packaging cost',17,gray); t(58,400,'Gross margin  60.8%',22,accent,True)
  box(782,205,786,300); t(810,235,'Cost breakdown',22,ink,True)
  for j,(a,b) in enumerate([('Net sales','₱ 128,400'),('Estimated COGS','₱ 50,300'),('Gross profit','₱ 78,100')]): t(810,290+j*58,a,18); t(1390,290+j*58,b,18,ink,True)
  box(32,525,1536,385); rows(58,553,1480,'PRODUCT     /     SALES     /     EST. COST     /     EST. MARGIN',[[('Iced Spanish Latte',0),('₱ 28,050',.42),('₱ 10,659',.65),('62%',.9)],[('Americano',0),('₱ 18,750',.42),('₱ 5,438',.65),('71%',.9)],[('Caramel Latte',0),('₱ 17,500',.42),('₱ 7,350',.65),('58%',.9)]])
 elif v==2:
  box(32,205,1536,705); t(58,228,'Product performance',24,ink,True); t(58,270,'Net sales  ₱ 128,400     ·     Estimated COGS  ₱ 50,300     ·     Gross margin  60.8%',18,gray); btn(1330,225,210,'Search products')
  rows(58,335,1480,'PRODUCT       SOLD       SALES       UNIT COST       GROSS MARGIN',[[('Iced Spanish Latte',0),('170',.33),('₱ 28,050',.48),('₱ 62.70',.68),('62%',.88)],[('Americano',0),('150',.33),('₱ 18,750',.48),('₱ 36.25',.68),('71%',.88)],[('Caramel Latte',0),('100',.33),('₱ 17,500',.48),('₱ 73.50',.68),('58%',.88)],[('Matcha Latte',0),('85',.33),('₱ 15,300',.48),('₱ 79.20',.68),('56%',.88)]])
 else:
  box(32,205,1000,705); t(58,230,'Today at a glance',24,ink,True)
  for i,(a,b) in enumerate([('Sales','₱ 8,250'),('Estimated COGS','₱ 3,220'),('Gross profit','₱ 5,030'),('Transactions','48')]):
   x=58+i%2*460; y=290+i//2*150; box(x,y,435,125,soft); t(x+20,y+18,a,16,gray,True); t(x+20,y+55,b,27,ink,True)
  t(58,660,'Gross profit excludes rent, payroll, and utilities.',17,gray)
  box(1052,205,516,705); rows(1076,240,468,'SALES BY HOUR',[[('8–10 AM',0),('₱ 1,850',.7)],[('10–12 PM',0),('₱ 3,100',.7)],[('12–2 PM',0),('₱ 3,300',.7)]])
 save('sales',v)
for v in range(4):
 base('Recipes & raw materials','ABCD'[v],['Recipe list and ingredient editor','Recipe cards with cost summary','Ingredient-first usage view','Focused recipe worksheet'][v]); btn(1360,140,208,'+ New recipe',True)
 if v in (0,3):
  left=400 if v==0 else 300; box(32,205,left,705); t(55,230,'RECIPES',16,gray,True)
  for i,s in enumerate(['Iced Spanish Latte','Caramel Latte','Americano','Matcha Latte']):
   if i==0: box(48,274+i*69,left-32,55,soft)
   t(63,288+i*69,s,17,ink,i==0)
  x=52+left; box(x,205,1516-left,705); t(x+25,229,'Iced Spanish Latte',24,ink,True); t(x+25,270,'16 oz  ·  Selling price ₱165',17,gray); btn(1335,225,200,'Save recipe',True)
  rows(x+25,330,1460-left,'INGREDIENT                QUANTITY          UNIT COST',[[('Espresso beans',0),('18 g',.55),('₱ 15.30',.8)],[('Whole milk',0),('150 ml',.55),('₱ 21.00',.8)],[('Syrup',0),('15 ml',.55),('₱ 8.00',.8)],[('16 oz cup + lid',0),('1 each',.55),('₱ 6.00',.8)]],65)
  btn(x+25,700,220,'+ Add ingredient'); t(x+25,780,'Estimated recipe cost  ₱ 50.30',20,accent,True)
 elif v==1:
  for i,(a,b) in enumerate([('Iced Spanish Latte','₱ 50.30'),('Caramel Latte','₱ 73.50'),('Americano','₱ 36.25'),('Matcha Latte','₱ 79.20')]):
   x=32+i%2*782; y=205+i//2*340; box(x,y,754,315); t(x+25,y+25,a,23,ink,True); t(x+25,y+75,'16 oz  ·  4 ingredients',17,gray); t(x+25,y+140,'Estimated unit cost',16,gray,True); t(x+25,y+175,b,26,accent,True); btn(x+520,y+237,200,'Edit recipe')
 else:
  box(32,205,600,705); t(58,228,'RAW MATERIALS',16,gray,True)
  for i,s in enumerate(['Espresso beans','Whole milk','Syrup','16 oz cup','Lid']): box(55,274+i*90,552,72,soft if i==0 else white); t(72,295+i*90,s,19,ink,i==0)
  box(652,205,916,705); t(680,230,'Espresso beans',25,ink,True); t(680,273,'Stock unit: grams    ·    Cost per gram: ₱ 0.85',17,gray); t(680,340,'USED IN RECIPES',16,gray,True); rows(680,380,860,'RECIPE                                 AMOUNT PER DRINK',[[('Iced Spanish Latte',0),('18 g',.75)],[('Americano',0),('18 g',.75)],[('Caramel Latte',0),('18 g',.75)]])
 save('recipes',v)
for v in range(4):
 base('Inventory & alerts','ABCD'[v],['Stock list with alert summary','Critical stock first','Branch stock and movement detail','Stock count workspace'][v]); btn(1360,140,208,'Stock count')
 if v==0:
  for i,(a,b) in enumerate([('ITEMS TRACKED','48'),('LOW STOCK','4'),('OUT OF STOCK','1')]):
   x=32+i*522; box(x,205,500,115); t(x+20,225,a,15,gray,True); t(x+20,258,b,27,ink,True)
  box(32,340,1536,570); rows(58,375,1480,'RAW MATERIAL           ON HAND             THRESHOLD             STATUS',[[('Espresso beans',0),('1,200 g',.4),('2,000 g',.64),('LOW',.87)],[('Whole milk',0),('8 L',.4),('10 L',.64),('LOW',.87)],[('16 oz cups',0),('220 pcs',.4),('100 pcs',.64),('OK',.87)],[('Syrup',0),('3 L',.4),('2 L',.64),('OK',.87)]])
 elif v==1:
  box(32,205,550,705); t(58,230,'NEEDS ATTENTION',17,gray,True)
  for i,(a,b) in enumerate([('Espresso beans','1,200 g  /  min. 2,000 g'),('Whole milk','8 L  /  min. 10 L'),('Lids','Out of stock')]): box(58,280+i*135,500,115,soft); t(76,296+i*135,a,20,ink,True); t(76,337+i*135,b,17,accent,True)
  box(602,205,966,705); t(630,230,'All inventory',24,ink,True); rows(630,300,900,'ITEM                                   ON HAND                    STATUS',[[('Espresso beans',0),('1,200 g',.58),('LOW',.87)],[('Whole milk',0),('8 L',.58),('LOW',.87)],[('16 oz cups',0),('220 pcs',.58),('OK',.87)]])
 elif v==2:
  box(32,205,650,705); t(58,230,'Main branch stock',24,ink,True); rows(58,300,600,'ITEM                             ON HAND',[[('Espresso beans',0),('1,200 g',.7)],[('Whole milk',0),('8 L',.7)],[('16 oz cups',0),('220 pcs',.7)]])
  box(702,205,866,705); t(730,230,'Espresso beans',24,ink,True); t(730,275,'On hand: 1,200 g    ·    Alert below: 2,000 g',18,gray); btn(730,335,190,'Set threshold'); btn(935,335,180,'Adjust stock'); rows(730,420,810,'RECENT MOVEMENTS',[[('Sale #024',0),('−18 g',.8)],[('Dial-in waste',0),('−18 g',.8)],[('Stock received',0),('+2,000 g',.8)]])
 else:
  box(32,205,1536,705); t(58,230,'Count stock',24,ink,True); t(58,272,'Enter physical quantities before reviewing discrepancies.',17,gray); rows(58,335,1480,'INGREDIENT                   EXPECTED               COUNTED               DIFFERENCE',[[('Espresso beans',0),('1,200 g',.4),('1,180 g',.62),('−20 g',.86)],[('Whole milk',0),('8 L',.4),('8 L',.62),('0 L',.86)],[('16 oz cups',0),('220 pcs',.4),('—',.62),('—',.86)]]); btn(58,760,220,'Review count',True)
 save('inventory',v)
for v in range(4):
 base('Customers & loyalty','ABCD'[v],['Customer list with profile detail','Loyalty overview and segments','Customer-first profile workspace','Visit and points activity'][v]); btn(1360,140,208,'+ Customer',True)
 if v==0 or v==2:
  left=860 if v==0 else 550; box(32,205,left,705); t(58,230,'Customers',24,ink,True); box(58,275,left-52,52,soft); t(75,287,'Search name or contact',17,gray)
  for i,(n,tag) in enumerate([('Sample customer 01','Regular'),('Sample customer 02','Returning'),('Sample customer 03','Inactive')]):
   box(58,355+i*100,left-52,80,soft if i==0 else white); t(75,368+i*100,n,18,ink,True); t(75,397+i*100,tag,16,gray)
  x=52+left; box(x,205,1516-left,705); t(x+25,230,'Sample customer 01',23,ink,True); t(x+25,275,'Contact: 09XX XXX XXXX',17,gray); t(x+25,340,'POINTS BALANCE',15,gray,True); t(x+25,373,'42 points',25,accent,True); t(x+25,450,'BARISTA NOTES',15,gray,True); t(x+25,485,'Prefers oat milk, less sweet',18); t(x+25,560,'RECENT ORDERS',15,gray,True); t(x+25,596,'Iced Spanish Latte  ·  ₱165',18)
 elif v==1:
  for i,(a,b) in enumerate([('CUSTOMERS','320'),('RETURNING','124'),('INACTIVE','38')]):
   x=32+i*522; box(x,205,500,125); t(x+20,225,a,15,gray,True); t(x+20,259,b,29,ink,True)
  box(32,350,800,560); t(58,375,'Customer segments',24,ink,True); rows(58,445,745,'SEGMENT                                  CUSTOMERS',[[('Regulars',0),('42',.8)],[('Returning',0),('124',.8)],[('Inactive',0),('38',.8)]])
  box(852,350,716,560); t(878,375,'Loyalty activity',24,ink,True); t(878,435,'Points earned',17,gray); t(878,465,'1,240',27,ink,True); t(878,530,'Points redeemed',17,gray); t(878,560,'380',27,ink,True)
 else:
  box(32,205,1536,705); t(58,230,'Loyalty activity',24,ink,True); t(58,272,'Example: 1 point per ₱100 spent',17,gray); rows(58,335,1480,'CUSTOMER                     ACTIVITY                    POINTS                 DATE',[[('Sample customer 01',0),('Earned from sale',.36),('+2',.68),('Today',.87)],[('Sample customer 02',0),('Redeemed',.36),('−20',.68),('Today',.87)],[('Sample customer 03',0),('Earned from sale',.36),('+1',.68),('Yesterday',.87)]])
 save('crm',v)
for v in range(4):
 base('Settings & CSV migration','ABCD'[v],['Settings navigation and import workspace','Guided import process','File review and field mapping','Migration history and status'][v]);
 if v==0:
  box(32,205,300,705); t(58,230,'SETTINGS',16,gray,True)
  for i,s in enumerate(['Business','Staff access','Devices','CSV migration']): t(58,285+i*65,s,18,ink,i==3)
  box(352,205,1216,705); t(380,230,'Import from Loyverse',24,ink,True); t(380,275,'Choose a CSV export to begin.',17,gray); box(380,330,1155,270,soft); t(700,400,'Drop CSV file here',24,ink,True); t(680,445,'or choose a file from your device',17,gray); btn(780,510,200,'Choose CSV'); t(380,660,'Menu items and opening inventory',18,gray)
 elif v==1:
  box(32,205,1536,705); t(58,230,'Import wizard',24,ink,True); t(58,282,'1  Upload       →       2  Map fields       →       3  Review       →       4  Import',19,gray,True); line(58,340,1480); t(58,380,'What would you like to import?',23,ink,True); btn(58,440,240,'Menu items',True); btn(315,440,240,'Opening stock'); box(58,530,1480,155,soft); t(78,555,'Drop CSV file here or select a file',20,ink,True); btn(78,610,200,'Choose CSV'); btn(1300,785,235,'Continue',True)
 elif v==2:
  box(32,205,1536,705); t(58,230,'Map CSV fields',24,ink,True); t(58,270,'Review the preview before any data is imported.',17,gray); rows(58,340,1480,'CSV COLUMN                         CAFE DOS FIELD                         EXAMPLE',[[('Item name',0),('Product name',.43),('Iced Spanish Latte',.76)],[('Price',0),('Selling price',.43),('165.00',.76)],[('Quantity',0),('Opening quantity',.43),('20',.76)],[('Unit',0),('Stock unit',.43),('pieces',.76)]]); btn(58,760,200,'Back'); btn(1280,760,240,'Review import',True)
 else:
  box(32,205,1030,705); t(58,230,'Migration activity',24,ink,True); rows(58,300,980,'FILE                          TYPE                      STATUS',[[('menu-export.csv',0),('Menu',.43),('Ready to review',.78)],[('inventory.csv',0),('Opening stock',.43),('Completed',.78)]]); btn(58,700,240,'Start new import',True)
  box(1082,205,486,705); t(1108,230,'Before importing',21,ink,True); t(1108,290,'1. Choose the CSV type',18); t(1108,340,'2. Match columns',18); t(1108,390,'3. Review errors',18); t(1108,440,'4. Confirm import',18)
 save('settings',v)
for pre in ('sales','recipes','inventory','crm','settings'):
 sheet=Image.new('RGB',(1600,1000),white)
 for i in range(4): sheet.paste(Image.open(out/f'{pre}-{i+1}.png').resize((800,500),Image.Resampling.LANCZOS),((i%2)*800,(i//2)*500))
 sheet.save(out/f'{pre}-comparison.png')
print('Created 20 admin options and 5 comparisons:',out.resolve())
