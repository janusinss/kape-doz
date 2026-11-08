// Isolated transport-test host only. Never imported by the production server.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createHub } from '../../src/hub.js';

const databasePath=process.env.KAPE_DOZ_TEST_DATABASE_PATH;
if(!databasePath) throw new Error('An isolated test database path is required.');
const browserOrigin=process.env.KAPE_DOZ_TEST_BROWSER_ORIGIN;
const additionalOrigin=process.env.KAPE_DOZ_TEST_ADDITIONAL_ORIGIN;
const origins=[browserOrigin,additionalOrigin].filter((origin): origin is string => !!origin);
const port=Number(process.env.KAPE_DOZ_TEST_PORT ?? 0);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid fixture port.');
const hub=await createHub({databasePath,allowedOrigins:origins});
try {
  await hub.provisionAccount({id:'transport-owner',branchId:'transport-branch',displayName:'Transport fixture owner',role:'owner',secret:'Transport-Fixture-Owner-Password!'});
  await hub.provisionAccount({id:'transport-cashier',branchId:'transport-branch',displayName:'Transport fixture cashier',role:'cashier',secret:'4826'});
  await hub.provisionAccount({id:'transport-barista',branchId:'transport-branch',displayName:'Transport fixture barista',role:'barista',secret:'5937'});
  await hub.provisionDevice({id:'transport-cashier-tablet',branchId:'transport-branch',secret:'Transport-Fixture-Device-Secret-32!'});
  await hub.provisionDevice({id:'transport-barista-tablet',branchId:'transport-branch',secret:'Transport-Fixture-Device-Secret-32!'});
  if(browserOrigin) {
    // Explicit synthetic catalogue for browser rehearsal only; never production bootstrap data.
    await hub.provisionAccount({id:'transport-manager',branchId:'transport-branch',displayName:'Transport fixture manager',role:'manager',secret:'Transport-Fixture-Manager-Password!'});
    const login=await hub.app.inject({method:'POST',url:'/api/v1/auth/admin',payload:{accountId:'transport-owner',password:'Transport-Fixture-Owner-Password!'}});
    if(login.statusCode!==200)throw new Error('Browser fixture owner could not sign in.');
    const token=login.json().token;
    for(const [url,payload] of [
      ['/api/v1/ingredients',{ingredientId:'beans',name:'Fixture espresso beans',unit:'g'}],
      ['/api/v1/inventory/receipts',{ingredientId:'beans',quantityMilli:1000000,totalCostCentavos:80000,reference:'Browser fixture stock'}],
      ['/api/v1/products',{productId:'fixture-latte',name:'Fixture Latte',priceCentavos:16500,recipe:[{ingredientId:'beans',quantityMilli:18000}]}],
      ...(process.env.KAPE_DOZ_TEST_TAKEOUT_CORRECTION==='1'
        ? [['/api/v1/products',{productId:'fixture-espresso',name:'Fixture Espresso',priceCentavos:9000,recipe:[{ingredientId:'beans',quantityMilli:9000}]}] as const]
        : []),
      ['/api/v1/drawers',{drawerId:'fixture-counter',name:'Fixture counter',deviceIds:['transport-cashier-tablet']}],
    ] as const) {
      const response=await hub.app.inject({method:'POST',url,headers:{authorization:`Bearer ${token}`},payload:{commandId:randomUUID(),...payload}});
      if(response.statusCode!==200)throw new Error('Browser fixture setup failed: '+url);
    }
  }
  const url=await hub.app.listen({host:'127.0.0.1',port});
  console.log(JSON.stringify({url}));
  const input=createInterface({input:process.stdin});
  const close=async()=>{input.close();await hub.close();};
  input.on('line',line=>{if(line==='stop')void close();});
  input.on('close',()=>{void hub.close();});
  process.once('SIGTERM',()=>{void close();});
} catch(error) {
  await hub.close();
  throw error;
}
