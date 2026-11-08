import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import type { HubDatabase } from './database.js';
import type { Session } from './identity.js';
import { ADMIN_ROLES, identifier, type Role } from './validation.js';
import { BusinessService } from './business.js';
import { ingredientSchema, stockReceiptSchema, productSchema, productRecipeUpdateSchema, drawerSchema, shiftOpenSchema, shiftCountSchema, shiftReviewSchema, orderSchema, versionSchema, paymentSchema, paymentRejectSchema, wasteSchema, orderListSchema } from './business_validation.js';
import { expenseCoverageSchema, expenseSchema, expensePeriodSchema } from './business_validation.js';
import { approvalRequestSchema, approvalDecisionSchema, cancellationDispositionSchema } from './business_validation.js';
import { amendmentRequestSchema, amendmentDecisionSchema, amendmentAcknowledgeSchema } from './business_validation.js';
import { refundRequestSchema, refundDecisionSchema, refundLegSchema } from './business_validation.js';
import { stockCountStartSchema, stockCountObserveSchema, stockCountDecisionSchema, stockCountCostSchema, stockCountRevalueSchema } from './business_validation.js';
import { stockThresholdSchema, stockAlertAcknowledgeSchema, stockAlertListSchema, stockThresholdHistorySchema } from './business_validation.js';
import { productAvailabilitySchema, replaceUnavailableSchema } from './business_validation.js';
import {
  orderCustomerSchema, customerCreateSchema, customerUpdateSchema, customerListSchema, customerPolicySchema,
  loyaltyCloudModeSchema, loyaltySyncSchema, loyaltyRedeemRequestSchema, loyaltyRedeemDecisionSchema,
  loyaltyRedeemCloudValidateSchema, loyaltyRedeemCloudReconcileSchema,
  loyaltyRefundCaseDecisionSchema, loyaltyRefundCaseExceptionSchema,
  accountCreateSchema, accountUpdateSchema, deviceCreateSchema, devicePairingCreateSchema, devicePairingClaimSchema, branchConfigSchema,
  printerAdapterModeSchema, printJobRetrySchema, wasteCorrectionSchema,
  csvPreviewSchema, csvImportSchema, csvExportQuerySchema,
  syncModeSchema, syncPushSchema, syncIngestSchema, syncConflictResolveSchema, backupRestoreSchema,
} from './business_validation.js';

export type Authorize = (request:FastifyRequest,roles?:readonly Role[])=>Session;
export function registerBusinessRoutes(app:FastifyInstance,store:HubDatabase,authorize:Authorize,now:()=>number,querySchemas?:Map<string,z.ZodType>) {
  const business = new BusinessService(store,now);
  const id = (request:FastifyRequest) => z.strictObject({id:identifier}).parse(request.params).id;
  const paymentIds = (request:FastifyRequest) => z.strictObject({id:identifier,paymentId:z.uuid()}).parse(request.params);
  function get<T>(path:string, roles:readonly Role[]|undefined, schema:z.ZodType<T>, action:(session:Session,query:T,request:FastifyRequest)=>unknown) {
    querySchemas?.set(path, schema);
    app.get(path, async request => {
      const session = authorize(request, roles);
      const query = (querySchemas ? request.query : schema.parse(request.query)) as T;
      return action(session, query, request);
    });
  }
  function post<T>(path:string, roles:readonly Role[], schema:z.ZodType<T>, action:(session:Session,input:T,request:FastifyRequest)=>unknown) {
    app.post(path,async request => {
      const session = authorize(request,roles);
      const input = schema.parse(request.body);
      const actor = { ...session.actor, deviceId:session.deviceId };
      return action({ ...session, actor },input,request);
    });
  }
  post('/api/v1/ingredients',ADMIN_ROLES,ingredientSchema,(s,input)=>business.createIngredient(s.actor,input));
  app.get('/api/v1/ingredients',async request=>business.listIngredients(authorize(request).actor));
  post('/api/v1/inventory/receipts',ADMIN_ROLES,stockReceiptSchema,(s,input)=>business.receiveStock(s.actor,input));
  const countId = (request: FastifyRequest) => z.strictObject({ id: z.uuid() }).parse(request.params).id;
  app.get('/api/v1/inventory/counts', async request => business.listStockCounts(authorize(request, ADMIN_ROLES).actor));
  post('/api/v1/inventory/counts', ADMIN_ROLES, stockCountStartSchema, (s, input) => business.startStockCount(s.actor, input));
  post('/api/v1/inventory/counts/:id/observe', ADMIN_ROLES, stockCountObserveSchema, (s, input, r) => business.observeStockCount(s.actor, countId(r), input));
  post('/api/v1/inventory/counts/:id/decide', ADMIN_ROLES, stockCountDecisionSchema, (s, input, r) => business.decideStockCount(s.actor, countId(r), input));
  post('/api/v1/inventory/counts/:id/confirm-cost', ADMIN_ROLES, stockCountCostSchema, (s, input, r) => business.confirmStockCountCost(s.actor, countId(r), input));
  post('/api/v1/inventory/counts/:id/revalue', ADMIN_ROLES, stockCountRevalueSchema, (s, input, r) => business.revalueStockCount(s.actor, countId(r), input));
  get('/api/v1/inventory/alerts', ADMIN_ROLES, stockAlertListSchema, (s, query) => business.listStockAlerts(s.actor, query));
  app.get('/api/v1/inventory/alerts/:id/history', async r => business.stockAlertHistory(authorize(r, ADMIN_ROLES).actor, countId(r)));
  get('/api/v1/inventory/thresholds/:id/history', ADMIN_ROLES, stockThresholdHistorySchema, (s, query, r) => business.stockThresholdHistory(s.actor, id(r), query.beforeVersion));
  post('/api/v1/inventory/thresholds/:id', ADMIN_ROLES, stockThresholdSchema, (s, input, r) => business.setStockThreshold(s.actor, id(r), input));
  post('/api/v1/inventory/alerts/:id/acknowledge', ADMIN_ROLES, stockAlertAcknowledgeSchema, (s, input, r) => business.acknowledgeStockAlert(s.actor, countId(r), input));
  post('/api/v1/products',ADMIN_ROLES,productSchema,(s,input)=>business.createProduct(s.actor,input));
  post('/api/v1/products/:id/recipe',ADMIN_ROLES,productRecipeUpdateSchema,(s,input,r)=>business.updateProductRecipe(s.actor,id(r),input));
  post('/api/v1/products/:id/availability',ADMIN_ROLES,productAvailabilitySchema,(s,input,r)=>business.setProductAvailability(s.actor,id(r),input));
  app.get('/api/v1/products',async request=>business.listProducts(authorize(request).actor));
  post('/api/v1/drawers',['owner'],drawerSchema,(s,input)=>business.createDrawer(s.actor,input));
  app.get('/api/v1/admin/shifts',async request=>business.listAdminShifts(authorize(request,ADMIN_ROLES).actor));
  post('/api/v1/admin/expenses', ADMIN_ROLES, expenseSchema, (s, input) => business.recordExpense(s.actor, input));
  get('/api/v1/admin/expenses', ADMIN_ROLES, expensePeriodSchema, (s, query) => business.listExpenses(s.actor, query));
  get('/api/v1/admin/sales', ADMIN_ROLES, expensePeriodSchema, (s, query) => business.listSales(s.actor, query));
  post('/api/v1/admin/expense-coverage', ADMIN_ROLES, expenseCoverageSchema, (s, input) => business.confirmExpenseCoverage(s.actor, input));
  app.get('/api/v1/shifts/current',async request=>business.currentShift(authorize(request,['cashier'])));
  post('/api/v1/shifts/open',['cashier'],shiftOpenSchema,(s,input)=>business.openShift(s,input));
  post('/api/v1/shifts/:id/submit-count',['cashier'],shiftCountSchema,(s,input,request)=>business.submitCount(s,id(request),input));
  post('/api/v1/shifts/:id/review',ADMIN_ROLES,shiftReviewSchema,(s,input,request)=>business.reviewShift(s.actor,id(request),input));
  post('/api/v1/orders',['cashier'],orderSchema,(s,input)=>business.createOrder(s.actor,input));
  post('/api/v1/orders/:id/replace-unavailable',['cashier'],replaceUnavailableSchema,(s,input,r)=>business.replaceUnavailable(s.actor,id(r),input));
  get('/api/v1/orders', undefined, orderListSchema, (s, query) => business.listOrders(s.actor, query.status));
  app.get('/api/v1/orders/:id',async request=>business.getOrder(authorize(request).actor,id(request)));
  app.get('/api/v1/orders/:id/amendments', async request => business.orderAmendmentHistory(authorize(request).actor, id(request)));
  app.get('/api/v1/amendments', async request => business.listAmendmentReviews(authorize(request, ADMIN_ROLES).actor));
  post('/api/v1/orders/:id/amendments', ['cashier'], amendmentRequestSchema, (s, input, request) => business.requestAmendment(s.actor, id(request), input));
  post('/api/v1/amendments/:id/decision', ADMIN_ROLES, amendmentDecisionSchema, (s, input, request) => business.decideAmendment(s.actor, id(request), input));
  post('/api/v1/orders/:id/amendments/:amendmentId/acknowledge', ['barista'], amendmentAcknowledgeSchema, (s, input, request) => {
    const ids = z.strictObject({ id: identifier, amendmentId: z.uuid() }).parse(request.params);
    return business.acknowledgeAmendment(s.actor, ids.id, ids.amendmentId, input);
  });
  app.get('/api/v1/approvals', async request => business.listApprovals(authorize(request, ['cashier', ...ADMIN_ROLES]).actor));
  post('/api/v1/orders/:id/approvals', ['cashier'], approvalRequestSchema, (s, input, request) => business.requestApproval(s, id(request), input));
  post('/api/v1/approvals/:id/decision', ADMIN_ROLES, approvalDecisionSchema, (s, input, request) => business.decideApproval(s.actor, id(request), input));
  app.get('/api/v1/refunds', async request => business.listRefunds(authorize(request, ['cashier', ...ADMIN_ROLES]).actor));
  post('/api/v1/orders/:id/refunds', ['cashier'], refundRequestSchema, (s, input, request) => business.requestRefund(s, id(request), input));
  post('/api/v1/refunds/:id/decision', ADMIN_ROLES, refundDecisionSchema, (s, input, request) => business.decideRefund(s.actor, id(request), input));
  post('/api/v1/refunds/:id/legs/:legId', ['cashier', ...ADMIN_ROLES], refundLegSchema, (s, input, request) => {
    const ids = z.strictObject({ id: identifier, legId: z.uuid() }).parse(request.params);
    return business.updateRefundLeg(s, ids.id, ids.legId, input);
  });
  post('/api/v1/orders/:id/send',['cashier'],versionSchema,(s,input,request)=>business.sendOrder(s.actor,id(request),input));
  post('/api/v1/orders/:id/payments',['cashier'],paymentSchema,(s,input,request)=>business.addPayment(s,id(request),input));
  post('/api/v1/orders/:id/payments/:paymentId/verify',['cashier'],versionSchema,(s,input,request)=>{
    const ids=paymentIds(request);
    return business.verifyPayment(s,ids.id,ids.paymentId,input);
  });
  post('/api/v1/orders/:id/payments/:paymentId/reject',['cashier'],paymentRejectSchema,(s,input,request)=>{
    const ids=paymentIds(request);
    return business.rejectPayment(s,ids.id,ids.paymentId,input);
  });
  post('/api/v1/orders/:id/ready',['barista'],versionSchema,(s,input,request)=>business.markReady(s.actor,id(request),input));
  post('/api/v1/orders/:id/prepare', ['barista'], versionSchema, (s, input, request) => business.startPreparation(s.actor, id(request), input));
  post('/api/v1/orders/:id/cancellation/disposition', ['barista'], cancellationDispositionSchema, (s, input, request) => business.resolveCancellation(s.actor, id(request), input));
  post('/api/v1/orders/:id/receipt',['cashier'],versionSchema,(s,input,request)=>business.requestReceipt(s.actor,id(request),input));
  post('/api/v1/waste',['barista'],wasteSchema,(s,input)=>business.logWaste(s.actor,input));
  app.get('/api/v1/customers/policy', async r => business.getCustomerPolicy(authorize(r, ADMIN_ROLES).actor));
  post('/api/v1/customers/policy', ['owner'], customerPolicySchema, (s, input) => business.updateCustomerPolicy(s.actor, input));
  get('/api/v1/customers', ['cashier', ...ADMIN_ROLES], customerListSchema, (s, query) => business.listCustomers(s.actor, query));
  post('/api/v1/customers', ['cashier', ...ADMIN_ROLES], customerCreateSchema, (s, input) => business.createCustomer(s.actor, input));
  app.get('/api/v1/customers/:id', async r => business.getCustomerProfile(authorize(r, ['cashier', ...ADMIN_ROLES]).actor, id(r)));
  post('/api/v1/customers/:id', ['cashier', ...ADMIN_ROLES], customerUpdateSchema, (s, input, r) => business.updateCustomer(s.actor, id(r), input));
  post('/api/v1/orders/:id/customer', ['cashier'], orderCustomerSchema, (s, input, r) => business.setOrderCustomer(s.actor, id(r), input));
  app.get('/api/v1/loyalty/cloud-state', async r => business.getLoyaltyCloudState(authorize(r, ['cashier', ...ADMIN_ROLES]).actor));
  post('/api/v1/loyalty/cloud-mode', ADMIN_ROLES, loyaltyCloudModeSchema, (s, input) => business.setLoyaltyCloudMode(s.actor, input));
  post('/api/v1/loyalty/sync', ['cashier', ...ADMIN_ROLES], loyaltySyncSchema, (s, input) => business.syncPendingLoyalty(s.actor, input));
  app.get('/api/v1/loyalty/redemptions', async r => business.listLoyaltyRedemptions(authorize(r, ['cashier', ...ADMIN_ROLES]).actor));
  post('/api/v1/orders/:id/loyalty/redeem-request', ['cashier'], loyaltyRedeemRequestSchema, (s, input, r) => business.requestLoyaltyRedemption(s, id(r), input));
  post('/api/v1/loyalty/redemptions/:id/decision', ADMIN_ROLES, loyaltyRedeemDecisionSchema, (s, input, r) => business.decideLoyaltyRedemption(s.actor, id(r), input));
  post('/api/v1/loyalty/redemptions/:id/validate-cloud', ['cashier', ...ADMIN_ROLES], loyaltyRedeemCloudValidateSchema, (s, input, r) => business.validateLoyaltyRedemptionCloud(s.actor, id(r), input));
  post('/api/v1/loyalty/redemptions/:id/reconcile-cloud', ADMIN_ROLES, loyaltyRedeemCloudReconcileSchema, (s, input, r) => business.reconcileLoyaltyRedemptionCloud(s.actor, id(r), input));
  app.get('/api/v1/loyalty/refund-cases', async r => business.listLoyaltyRefundCases(authorize(r, ADMIN_ROLES).actor));
  post('/api/v1/loyalty/refund-cases/:id/decision', ADMIN_ROLES, loyaltyRefundCaseDecisionSchema, (s, input, r) => business.decideLoyaltyRefundCase(s.actor, countId(r), input));
  post('/api/v1/loyalty/refund-cases/:id/resolve-exception', ADMIN_ROLES, loyaltyRefundCaseExceptionSchema, (s, input, r) => business.resolveLoyaltyRefundCaseException(s.actor, countId(r), input));
  post('/api/v1/orders/:id/handover', ['barista', 'cashier'], versionSchema, (s, input, r) => business.handoverOrder(s.actor, id(r), input));
  post('/api/v1/orders/:id/recall', ['barista', 'cashier'], versionSchema, (s, input, r) => business.recallOrder(s.actor, id(r), input));
  app.get('/api/v1/waste', async r => business.listWasteEntries(authorize(r, ['barista', ...ADMIN_ROLES]).actor));
  post('/api/v1/waste/:id/correct', ['barista', ...ADMIN_ROLES], wasteCorrectionSchema, (s, input, r) => business.correctWasteEntry(s.actor, countId(r), input));
  app.get('/api/v1/accounts', async r => business.listAccounts(authorize(r, ADMIN_ROLES).actor));
  post('/api/v1/accounts', ['owner'], accountCreateSchema, async (s, input) => {
    const credentialHash = await hash(input.secret, 12);
    return business.createAccount(s.actor, input, credentialHash);
  });
  post('/api/v1/accounts/:id', ['owner'], accountUpdateSchema, async (s, input, r) => {
    const credentialHash = input.secret !== undefined ? await hash(input.secret, 12) : undefined;
    return business.updateAccount(s.actor, id(r), input, credentialHash);
  });
  post('/api/v1/devices', ['owner'], deviceCreateSchema, (s, input) => business.enrollDevice(s.actor, input));
  app.get('/api/v1/hub-info', async () => business.getHubInfo());
  post('/api/v1/devices/:id/pair', ['owner'], devicePairingCreateSchema, (s, input, r) => business.createDevicePairingCode(s.actor, id(r), input));
  app.post('/api/v1/devices/pair/claim', async r => {
    const input = devicePairingClaimSchema.parse(r.body);
    return business.claimDevicePairingCode(input, r.ip);
  });
  app.get('/api/v1/settings/config', async r => business.getBranchConfig(authorize(r, ['cashier', 'barista', ...ADMIN_ROLES]).actor));
  post('/api/v1/settings/config', ['owner'], branchConfigSchema, (s, input) => business.updateBranchConfig(s.actor, input));
  app.get('/api/v1/printers', async r => business.getPrinterAdapters(authorize(r, ['cashier', 'barista', ...ADMIN_ROLES]).actor));
  post('/api/v1/printers/mode', ADMIN_ROLES, printerAdapterModeSchema, (s, input) => business.setPrinterAdapterMode(s.actor, input));
  get('/api/v1/print-jobs', ['cashier', 'barista', ...ADMIN_ROLES], z.strictObject({ orderId: identifier.optional() }), (s, query) => business.listPrintJobs(s.actor, query.orderId));
  post('/api/v1/print-jobs/:id/retry', ['cashier', 'barista', ...ADMIN_ROLES], printJobRetrySchema, (s, input, r) => business.retryPrintJob(s.actor, countId(r), input));
  app.post('/api/v1/csv/preview', async r => {
    const session = authorize(r, ADMIN_ROLES);
    const input = csvPreviewSchema.parse(r.body);
    return business.previewCsv(session.actor, input);
  });
  post('/api/v1/csv/import', ADMIN_ROLES, csvImportSchema, (s, input) => business.importCsv(s.actor, input));
  app.get('/api/v1/csv/imports', async r => business.listCsvImports(authorize(r, ADMIN_ROLES).actor));
  get('/api/v1/csv/export', ['cashier', ...ADMIN_ROLES], csvExportQuerySchema, (s, query) => business.exportCsv(s.actor, query));
  app.get('/api/v1/sync/status', async r => business.getSyncStatus(authorize(r, ['cashier', ...ADMIN_ROLES]).actor));
  post('/api/v1/sync/mode', ADMIN_ROLES, syncModeSchema, (s, input) => business.setSyncMode(s.actor, input));
  post('/api/v1/sync/push', ['cashier', ...ADMIN_ROLES], syncPushSchema, (s, input) => business.pushOutboxSync(s.actor, input));
  post('/api/v1/sync/ingest', ADMIN_ROLES, syncIngestSchema, (s, input) => business.ingestSyncEnvelopes(s.actor, input));
  post('/api/v1/sync/conflicts/:id/resolve', ADMIN_ROLES, syncConflictResolveSchema, (s, input, r) => business.resolveSyncConflict(s.actor, countId(r), input));
  app.get('/api/v1/admin/backup', async r => business.exportBackup(authorize(r, ['owner']).actor));
  app.post('/api/v1/admin/restore', { bodyLimit: 512 * 1024 }, async r => {
    const session = authorize(r, ['owner']);
    const input = backupRestoreSchema.parse(r.body);
    const actor = { ...session.actor, deviceId: session.deviceId };
    return business.restoreBackup(actor, input);
  });
}
