from pathlib import Path
s=Path('wireframes/draw_admin_options.py').read_text(encoding='utf-8')
s=s.split('for v in range(4):',1)[0]
s=s.replace("bg='#f5f2ec'; white='#fff'; ink='#292622'; gray='#706a63'; stroke='#c9c2b8'; soft='#ebe6df'; dark='#403a35'; accent='#765842'", "bg='#f5f0e8'; white='#fff'; ink='#302720'; gray='#73675b'; stroke='#e3d7c7'; soft='#f4eadc'; dark='#302721'; accent='#966237'").replace('radius=6,fill=fill','radius=15,fill=fill')
exec(s)
out=Path('wireframes/cafe-theme/admin'); out.mkdir(parents=True,exist_ok=True)
def head(title,tab):
 global im,d
 im=Image.new('RGB',(W,H),bg); d=ImageDraw.Draw(im); d.rectangle((0,0,W,66),fill=dark); t(24,17,'CAFÉ DOS',23,white,True)
 for x,n in [(310,'Sales'),(535,'Recipes'),(770,'Inventory'),(1015,'Customers'),(1280,'Settings')]:
  t(x,22,n,16,white if n==tab else '#dacbbc',n==tab)
  if n==tab: d.rectangle((x,61,x+len(n)*9,65),fill='#d6aa72')
 t(32,87,title,29,ink,True)
def export(name): im.save(out/name)
head('Sales & margins','Sales'); btn(1215,85,160,'This month'); btn(1390,85,178,'Export CSV')
for i,(a,b,sub) in enumerate([('NET SALES','₱ 128,400','After discounts and refunds'),('EST. GROSS PROFIT','₱ 78,100','Net sales less estimated COGS'),('GROSS MARGIN','60.8%','Estimated gross profit / sales')]):
 x=32+i*522; box(x,155,500,134); t(x+20,173,a,15,gray,True); t(x+20,205,b,29,ink,True); t(x+20,250,sub,15,gray)
box(32,310,940,570); t(58,335,'Sales and gross profit trend',22,ink,True); t(58,374,'— Net sales        — Estimated gross profit',16,gray)
for i in range(4): line(75,465+i*88,850)
d.line([(75,730),(195,650),(310,682),(425,560),(540,595),(655,490),(770,520),(900,425)],fill=dark,width=5)
d.line([(75,790),(195,750),(310,767),(425,680),(540,695),(655,625),(770,645),(900,575)],fill=accent,width=5)
t(75,835,'Week 1                   Week 2                   Week 3                   Week 4',16,gray)
box(992,310,576,570); t(1018,335,'Profit breakdown',22,ink,True)
for i,(a,b) in enumerate([('Net sales','₱ 128,400'),('Estimated COGS','− ₱ 50,300'),('Gross profit','₱ 78,100')]):
 y=395+i*74; t(1018,y,a,18,ink,i==2); t(1380,y,b,18,ink,True); line(1018,y+48,520)
t(1018,655,'Gross profit excludes operating expenses.',16,gray); t(1018,688,'Recipe costs are estimates.',16,gray)
export('sales-margin.png')
head('Recipes & raw materials','Recipes'); btn(1370,85,198,'+ New recipe',True)
box(32,155,350,760); t(55,178,'RECIPES',16,gray,True); box(55,215,304,48,soft); t(70,227,'Search recipes',17,gray)
for i,s in enumerate(['Iced Spanish Latte','Caramel Latte','Americano','Matcha Latte']):
 y=290+i*70
 if i==0: box(50,y-10,310,52,soft)
 t(65,y,s,17,ink,i==0)
box(402,155,1166,760); t(430,180,'Iced Spanish Latte',25,ink,True); t(430,220,'16 oz   ·   Selling price ₱165',17,gray); btn(1352,175,185,'Save recipe',True)
rows(430,285,1100,'INGREDIENT                         AMOUNT               UNIT                 EST. COST',[[('Espresso beans',0),('18',.43),('g',.62),('₱ 15.30',.82)],[('Whole milk',0),('150',.43),('ml',.62),('₱ 21.00',.82)],[('Syrup',0),('15',.43),('ml',.62),('₱ 8.00',.82)],[('16 oz cup',0),('1',.43),('pc',.62),('₱ 4.00',.82)],[('Lid',0),('1',.43),('pc',.62),('₱ 2.00',.82)]],64)
btn(430,725,215,'+ Add ingredient'); t(430,814,'Estimated unit cost  ₱ 50.30',20,accent,True); t(1050,816,'Est. gross margin  69.5%',18,ink,True)
export('recipes.png')
head('Inventory & thresholds','Inventory'); btn(1355,85,212,'Stock count')
box(32,155,350,760); t(55,178,'RAW MATERIALS',16,gray,True); box(55,215,304,48,soft); t(70,227,'Search ingredients',17,gray)
for i,s in enumerate(['Espresso beans','Whole milk','Syrup','16 oz cup','Lid']):
 y=290+i*70
 if i==0: box(50,y-10,310,52,soft)
 t(65,y,s,17,ink,i==0)
box(402,155,1166,760); t(430,180,'Espresso beans',25,ink,True); t(430,221,'Main branch  ·  Stock unit: grams',17,gray); t(430,281,'ON HAND',15,gray,True); t(430,313,'1,200 g',28,ink,True); t(705,281,'ALERT BELOW',15,gray,True); t(705,313,'2,000 g',28,ink,True); t(980,288,'LOW STOCK',17,accent,True)
btn(430,375,200,'Set threshold'); btn(645,375,185,'Adjust stock'); rows(430,460,1100,'RECENT MOVEMENTS                            QUANTITY                  REASON',[[('Today  ·  Sale #024',0),('−18 g',.58),('Sale',.82)],[('Today  ·  Dial-in',0),('−18 g',.58),('Waste',.82)],[('Yesterday  ·  Stock received',0),('+2,000 g',.58),('Received',.82)]])
export('inventory.png')
head('Customers & loyalty','Customers'); btn(1360,85,208,'+ Customer',True)
for i,(a,b,sub) in enumerate([('TOTAL CUSTOMERS','320','All profiles'),('ACTIVE','124','Definition to be agreed'),('INACTIVE','38','Definition to be agreed'),('VIP REGULARS','42','Criteria to be agreed')]):
 x=32+i*391; box(x,155,372,120); t(x+18,171,a,15,gray,True); t(x+18,201,b,26,ink,True); t(x+18,242,sub,14,gray)
box(32,295,570,620); t(56,318,'Customer profiles',22,ink,True); box(56,360,522,50,soft); t(72,372,'Search name or contact',17,gray)
for i,(name,seg) in enumerate([('Sample customer 01','VIP regular'),('Sample customer 02','Active'),('Sample customer 03','Inactive')]):
 y=440+i*105; box(56,y,522,84,soft if i==0 else white); t(72,y+12,name,18,ink,True); t(72,y+47,seg,16,gray)
box(622,295,946,620); t(648,320,'Sample customer 01',23,ink,True); t(648,360,'Contact: 09XX XXX XXXX  ·  VIP regular',17,gray); t(648,425,'POINTS BALANCE',15,gray,True); t(648,456,'42 points',25,accent,True); t(1010,425,'LAST VISIT',15,gray,True); t(1010,456,'Today',22,ink,True); line(648,510,890); t(648,540,'BARISTA NOTES',15,gray,True); t(648,575,'Prefers oat milk, less sweet',18); t(648,650,'RECENT ORDER',15,gray,True); t(648,685,'Iced Spanish Latte  ·  ₱165',18)
export('customers.png')
head('System settings','Settings')
box(32,155,350,760); t(55,178,'SETTINGS',16,gray,True)
for i,s in enumerate(['Business details','Staff & access','Devices & printers','CSV migration']):
 y=244+i*72
 if i==3: box(50,y-10,310,52,soft)
 t(65,y,s,18,ink,i==3)
box(402,155,1166,760); t(430,180,'CSV migration',25,ink,True); t(430,222,'Import a Loyverse export in 4 steps.',17,gray)
t(430,281,'1  Choose file     →     2  Match fields     →     3  Review     →     4  Import',17,ink,True); line(430,333,1100)
t(430,363,'What are you importing?',19,ink,True); btn(430,407,220,'Menu items',True); btn(665,407,220,'Opening stock')
t(430,491,'CSV file',17,ink,True); box(430,525,1080,145,soft); t(450,544,'Drop a CSV file here, or use the button.',18); btn(450,593,205,'Choose CSV file'); t(430,702,'No file selected',17,gray); t(430,743,'You can review column matches and errors before import.',17,gray); btn(1280,810,230,'Continue')
export('settings-migration.png')
print('Created five refined admin wireframes in',out.resolve())
