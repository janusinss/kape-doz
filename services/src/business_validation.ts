import { z } from 'zod';
import { identifier, isStaffRole, MAX_MONEY_CENTAVOS, MAX_VERSION, passwordSchema, pinSchema, roleSchema } from './validation.js';
const commandId = z.uuid();
const money = z.number().int().min(0).max(MAX_MONEY_CENTAVOS);
const positiveMoney = money.refine(value => value > 0);
const quantity = z.number().int().min(1).max(MAX_VERSION);
const name = z.string().trim().min(1).max(120);
const recipeLineSchema = z.strictObject({ ingredientId: identifier, quantityMilli: quantity });
const uniqueRecipeLines = (lines: { ingredientId: string }[]) => new Set(lines.map(r => r.ingredientId)).size === lines.length;
const priceDelta = z.number().int().min(-MAX_MONEY_CENTAVOS).max(MAX_MONEY_CENTAVOS);
export const productSizeSchema = z.strictObject({
  id: identifier, name, priceDeltaCentavos: priceDelta,
  recipe: z.array(recipeLineSchema).min(1).max(50).refine(uniqueRecipeLines, { message: 'Size recipe ingredients must be unique.' }),
});
export const productSubstitutionSchema = z.strictObject({
  id: identifier, name, replaceIngredientId: identifier, withIngredientId: identifier,
  quantityMilli: quantity.optional(), priceDeltaCentavos: priceDelta,
}).refine(v => v.replaceIngredientId !== v.withIngredientId, { message: 'Substitution must replace with a different ingredient.' });
export const productAddonSchema = z.strictObject({
  id: identifier, name, priceDeltaCentavos: money,
  recipe: z.array(recipeLineSchema).min(1).max(50).refine(uniqueRecipeLines, { message: 'Add-on recipe ingredients must be unique.' }),
});
const packagingLinesSchema = z.array(recipeLineSchema).max(20).refine(uniqueRecipeLines, { message: 'Packaging ingredients must be unique.' });
const productOptionFields = {
  sizes: z.array(productSizeSchema).max(20).refine(items => new Set(items.map(i => i.id)).size === items.length, { message: 'Size IDs must be unique.' }).optional(),
  substitutions: z.array(productSubstitutionSchema).max(20).refine(items => new Set(items.map(i => i.id)).size === items.length, { message: 'Substitution IDs must be unique.' }).optional(),
  addons: z.array(productAddonSchema).max(20).refine(items => new Set(items.map(i => i.id)).size === items.length, { message: 'Add-on IDs must be unique.' }).optional(),
  dineInPackaging: packagingLinesSchema.optional(),
  takeoutPackaging: packagingLinesSchema.optional(),
};
export const ingredientSchema = z.strictObject({ commandId, ingredientId:identifier, name, unit:z.enum(['g','ml','piece']) });
export const stockReceiptSchema = z.strictObject({
  commandId, ingredientId: identifier, quantityMilli: quantity.optional(),
  supplier: z.string().trim().min(1).max(120).optional(),
  packCount: z.number().int().min(1).max(1_000_000).optional(),
  packSizeMilli: quantity.optional(),
  totalCostCentavos: money, reference: z.string().trim().min(1).max(120),
}).superRefine((value, ctx) => {
  const hasPacks = value.packCount !== undefined || value.packSizeMilli !== undefined;
  if (hasPacks && (value.packCount === undefined || value.packSizeMilli === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Pack receipts require both pack count and conversion size.' });
    return;
  }
  const converted = hasPacks ? value.packCount! * value.packSizeMilli! : value.quantityMilli;
  if (converted === undefined || !Number.isSafeInteger(converted) || converted < 1 || converted > MAX_VERSION) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid stock receipt quantity.' });
    return;
  }
  if (hasPacks && value.quantityMilli !== undefined && value.quantityMilli !== converted) {
    ctx.addIssue({ code: 'custom', message: 'Quantity must match pack count multiplied by pack conversion size.' });
  }
});
export const productSchema = z.strictObject({
  commandId, productId: identifier, name, priceCentavos: positiveMoney,
  recipe: z.array(recipeLineSchema).min(1).max(50),
  ...productOptionFields,
}).refine(value => uniqueRecipeLines(value.recipe), { message: 'Recipe ingredients must be unique.' });
export const productRecipeUpdateSchema = z.strictObject({
  commandId, expectedVersion: z.number().int().min(1).max(MAX_VERSION),
  name: name.optional(), priceCentavos: positiveMoney,
  recipe: z.array(recipeLineSchema).min(1).max(50),
  ...productOptionFields,
}).refine(value => uniqueRecipeLines(value.recipe), { message: 'Recipe ingredients must be unique.' });
export const drawerSchema = z.strictObject({ commandId,drawerId:identifier,name,deviceIds:z.array(identifier).min(1).max(30) }).refine(value=>new Set(value.deviceIds).size===value.deviceIds.length,{message:'Devices must be unique.'});
export const shiftOpenSchema = z.strictObject({ commandId,openingCashCentavos:money });
export const versionSchema = z.strictObject({ commandId,expectedVersion:z.number().int().min(1).max(MAX_VERSION) });
export const productAvailabilitySchema = versionSchema.extend({ available: z.boolean(), reason: z.string().trim().min(1).max(160) });
export const replaceUnavailableSchema = versionSchema.extend({ lineNo: z.number().int().min(0).max(MAX_VERSION), productId: identifier, reason: z.string().trim().min(1).max(160) });
export type ProductAvailabilityInput = z.infer<typeof productAvailabilitySchema>;
export type ReplaceUnavailableInput = z.infer<typeof replaceUnavailableSchema>;
const countReference = z.string().trim().min(1).max(160);
export const stockCountStartSchema = z.strictObject({ commandId, ingredientId: identifier });
export const stockCountObserveSchema = versionSchema.extend({
  unit: z.enum(['g', 'ml', 'piece']), observedMilli: z.number().int().min(0).max(1_000_000_000_000),
});
export const stockCountDecisionSchema = versionSchema.extend({
  decision: z.enum(['approve', 'discard']), reason: countReference,
});
export const stockCountCostSchema = versionSchema.extend({ totalCostCentavos: money, reference: countReference });
export const stockCountRevalueSchema = stockCountCostSchema.extend({
  expectedStockVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type StockCountStartInput = z.infer<typeof stockCountStartSchema>;
export type StockCountObserveInput = z.infer<typeof stockCountObserveSchema>;
export type StockCountDecisionInput = z.infer<typeof stockCountDecisionSchema>;
export type StockCountCostInput = z.infer<typeof stockCountCostSchema>;
export type StockCountRevalueInput = z.infer<typeof stockCountRevalueSchema>;
export const stockThresholdSchema = z.strictObject({ commandId,
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  thresholdMilli: z.number().int().min(0).max(1_000_000_000_000).nullable(), reason: countReference,
});
export const stockAlertAcknowledgeSchema = versionSchema.extend({ note: countReference });
export const stockAlertListSchema = z.strictObject({ status: z.enum(['active', 'resolved']).default('active'), before: z.uuid().optional() });
export const stockThresholdHistorySchema = z.strictObject({ beforeVersion: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() });
export type StockThresholdInput = z.infer<typeof stockThresholdSchema>;
export type StockAlertAcknowledgeInput = z.infer<typeof stockAlertAcknowledgeSchema>;
export type StockAlertListInput = z.infer<typeof stockAlertListSchema>;
export const shiftCountSchema = versionSchema.extend({countedCashCentavos:money,note:z.string().max(500).default('')});
export const shiftReviewSchema = versionSchema.extend({decision:z.enum(['approve','recount'])});
export const paymentRejectSchema = versionSchema.extend({reason:z.string().trim().min(1).max(300)});
export const approvalRequestSchema = z.discriminatedUnion('action', [
  versionSchema.extend({ action: z.literal('discount'), amountCentavos: positiveMoney, reason: z.string().trim().min(1).max(300) }),
  versionSchema.extend({ action: z.literal('cancel'), reason: z.string().trim().min(1).max(300) }),
]);
export const cancellationDispositionSchema = versionSchema.extend({
  outcome: z.enum(['unprepared', 'used', 'already_consumed']),
  used: z.array(z.strictObject({ ingredientId: identifier, quantityMilli: quantity })).max(50),
  note: z.string().trim().min(1).max(300),
}).refine(value => new Set(value.used.map(item => item.ingredientId)).size === value.used.length);
const lineNumber = z.number().int().min(0).max(MAX_VERSION);
const lineQuantity = z.number().int().min(1).max(99);
const amendmentNote = z.string().trim().max(300);
const amendmentReason = z.string().trim().min(1).max(300);
const amendmentBase = versionSchema.extend({ reason: amendmentReason });
const lineAddonSelection = z.strictObject({ addonId: identifier, quantity: z.number().int().min(1).max(20).default(1) });
const lineSelectionFields = {
  sizeId: identifier.optional(),
  substitutionId: identifier.optional(),
  addons: z.array(lineAddonSelection).max(20).refine(items => new Set(items.map(i => i.addonId)).size === items.length, { message: 'Selected add-ons must be unique.' }).optional(),
};
export const amendmentRequestSchema = z.discriminatedUnion('operation', [
  amendmentBase.extend({ operation: z.literal('add'), productId: identifier, quantity: lineQuantity, note: amendmentNote, ...lineSelectionFields }),
  amendmentBase.extend({ operation: z.literal('quantity'), lineNo: lineNumber, quantity: lineQuantity }),
  amendmentBase.extend({ operation: z.literal('remove'), lineNo: lineNumber }),
  amendmentBase.extend({ operation: z.literal('replace'), lineNo: lineNumber, productId: identifier, quantity: lineQuantity, note: amendmentNote, ...lineSelectionFields }),
  amendmentBase.extend({ operation: z.literal('note'), lineNo: lineNumber, note: amendmentNote }),
]);
export const amendmentDecisionSchema = z.strictObject({ commandId, decision: z.enum(['approve', 'deny']), reason: amendmentReason });
export const amendmentAcknowledgeSchema = versionSchema.extend({
  note: amendmentNote,
  used: z.array(z.strictObject({ ingredientId: identifier, quantityMilli: quantity })).max(50),
}).refine(value => new Set(value.used.map(item => item.ingredientId)).size === value.used.length && (!value.used.length || !!value.note));
export type AmendmentRequestInput = z.infer<typeof amendmentRequestSchema>;
export type AmendmentDecisionInput = z.infer<typeof amendmentDecisionSchema>;
export type AmendmentAcknowledgeInput = z.infer<typeof amendmentAcknowledgeSchema>;
export const refundRequestSchema = versionSchema.extend({
  amountCentavos: positiveMoney, reason: z.string().trim().min(1).max(300),
  lineNumbers: z.array(lineNumber).min(1).max(50),
}).refine(value => new Set(value.lineNumbers).size === value.lineNumbers.length);
export const refundDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ commandId, decision: z.literal('approve'), reason: z.string().trim().min(1).max(300).optional(),
    allocations: z.array(z.strictObject({ paymentId: z.uuid(), amountCentavos: positiveMoney })).min(1).max(100),
  }).refine(value => new Set(value.allocations.map(item => item.paymentId)).size === value.allocations.length),
  z.strictObject({ commandId, decision: z.literal('deny'), reason: z.string().trim().min(1).max(300) }),
]);
const refundNote = z.string().trim().min(1).max(300);
export const refundLegSchema = z.discriminatedUnion('action', [
  versionSchema.extend({ action: z.literal('record_cash') }),
  versionSchema.extend({ action: z.literal('confirm_external'), note: refundNote, reference: z.string().trim().min(1).max(120) }),
  versionSchema.extend({ action: z.enum(['mark_unknown', 'mark_failed', 'retry', 'void']), note: refundNote }),
]);
export const approvalDecisionSchema = z.strictObject({
  commandId, decision: z.enum(['approve', 'deny']), reason: z.string().trim().min(1).max(300).optional(),
}).refine(input => input.decision !== 'deny' || input.reason !== undefined);
export const orderListSchema = z.strictObject({status:z.enum(['active','ready','all']).optional()});
export const orderSchema = z.strictObject({commandId,dineIn:z.boolean(),table:z.string().trim().max(12).default(''),customerId:identifier.optional(),items:z.array(z.strictObject({productId:identifier,quantity:z.number().int().min(1).max(99),note:z.string().trim().max(300).default(''), ...lineSelectionFields})).min(1).max(50)});
export const orderCustomerSchema = versionSchema.extend({ customerId: identifier.nullable() });
export const customerCreateSchema = z.strictObject({
  commandId,
  customerId: identifier.optional(),
  displayName: name,
  phone: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(500).default(''),
});
export const customerUpdateSchema = versionSchema.extend({
  displayName: name,
  phone: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(500).default(''),
});
export const customerListSchema = z.strictObject({
  q: z.string().trim().max(120).optional(),
  segment: z.enum(['all', 'active', 'inactive', 'no_purchases', 'vip']).optional(),
});
export const customerPolicySchema = z.strictObject({
  commandId,
  expectedVersion: z.number().int().min(1).max(MAX_VERSION),
  inactivityDays: z.number().int().min(1).max(3650),
  vipRule: z.enum(['unconfigured', 'lifetime_spend', 'purchase_count']),
  vipThreshold: z.number().int().min(1).max(MAX_MONEY_CENTAVOS).nullable().default(null),
  pointsExpiryDays: z.number().int().min(1).max(3650).nullable().default(null),
}).refine(v => (v.vipRule === 'unconfigured') === (v.vipThreshold === null), {
  message: 'VIP threshold is required only when a VIP rule is selected.',
});
export const loyaltyCloudModeSchema = z.strictObject({
  commandId,
  mode: z.enum(['online', 'offline', 'timeout']),
});
export const loyaltySyncSchema = z.strictObject({ commandId });
export const loyaltyRedeemRequestSchema = versionSchema.extend({
  points: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(1).max(300),
});
export const loyaltyRedeemDecisionSchema = z.strictObject({
  commandId,
  decision: z.enum(['approve', 'deny']),
  reason: z.string().trim().min(1).max(300).optional(),
}).refine(v => v.decision !== 'deny' || v.reason !== undefined);
export const loyaltyRedeemCloudValidateSchema = versionSchema.extend({
  cloudReference: z.string().trim().min(1).max(120).optional(),
});
export const loyaltyRedeemCloudReconcileSchema = versionSchema.extend({
  outcome: z.enum(['confirm_authorized', 'confirm_not_debited']),
  cloudReference: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().min(1).max(300),
}).refine(v => v.outcome !== 'confirm_authorized' || v.cloudReference !== undefined, {
  message: 'Authorized cloud reconciliation requires a cloud reference.',
});
export const loyaltyRefundCaseDecisionSchema = versionSchema.extend({
  reverseEarnedPoints: z.number().int().min(0).max(10_000_000),
  restoreRedeemedPoints: z.number().int().min(0).max(10_000_000),
  reason: z.string().trim().min(1).max(300),
});
export const loyaltyRefundCaseExceptionSchema = versionSchema.extend({
  action: z.enum(['apply_available_and_waive', 'apply_after_replenishment']),
  appliedReversalPoints: z.number().int().min(0).max(10_000_000),
  resolutionNote: z.string().trim().min(1).max(300),
});
export const paymentSchema = versionSchema.extend({method:z.enum(['cash','gcash','card']),amountCentavos:positiveMoney,verified:z.boolean(),reference:z.string().trim().max(120).optional(),cashReceivedCentavos:money.optional()}).superRefine((value,ctx)=>{
  if(value.method==='cash'&&(!value.verified||value.cashReceivedCentavos===undefined||value.cashReceivedCentavos<value.amountCentavos))ctx.addIssue({code:'custom',message:'Cash requires a received amount covering the allocation.'});
  if(value.method!=='cash'&&(!value.reference||value.cashReceivedCentavos!==undefined))ctx.addIssue({code:'custom',message:'External payments need a reference and no cash received amount.'});
});
export const wasteSchema = z.strictObject({commandId,ingredientId:identifier,quantityMilli:quantity,reason:z.string().trim().min(1).max(100),note:z.string().trim().max(500).default('')});
const calendarDate = z.iso.date().refine(value => !value.startsWith('0000-'));
export const expenseSchema = z.strictObject({
  commandId,
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240),
  amountCentavos: z.number().int().min(1).max(1_000_000_000),
  startsOn: calendarDate,
  endsOn: calendarDate,
}).refine(value => value.startsOn <= value.endsOn);
const expensePeriod = {
  from: calendarDate,
  through: calendarDate,
};
export const expensePeriodSchema = z.strictObject(expensePeriod).refine(value => value.from <= value.through);
export const expenseCoverageSchema = z.strictObject({ commandId, ...expensePeriod }).refine(value => value.from <= value.through);

export const accountCreateSchema = z.strictObject({
  commandId,
  accountId: identifier,
  displayName: name,
  role: roleSchema,
  secret: z.string(),
}).superRefine((value, ctx) => {
  const schema = isStaffRole(value.role) ? pinSchema : passwordSchema;
  if (!schema.safeParse(value.secret).success) {
    ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Invalid credential format.' });
  }
});

export const accountUpdateSchema = z.strictObject({
  commandId,
  expectedVersion: z.number().int().min(1).max(MAX_VERSION),
  displayName: name,
  role: roleSchema,
  disabled: z.boolean(),
  secret: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.secret !== undefined) {
    const schema = isStaffRole(value.role) ? pinSchema : passwordSchema;
    if (!schema.safeParse(value.secret).success) {
      ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Invalid credential format.' });
    }
  }
});

export const deviceCreateSchema = z.strictObject({
  commandId,
  deviceId: identifier,
  secret: z.string().min(32).max(128),
});

export const devicePairingCreateSchema = z.strictObject({
  commandId,
  role: z.enum(['cashier', 'barista']).optional(),
  accountId: identifier.optional(),
  hubOrigin: z.string().trim().min(1).max(200).optional(),
  ttlMinutes: z.number().int().min(1).max(1440).default(15),
});

export const devicePairingClaimSchema = z.strictObject({
  pairingCode: z.string().trim().min(4).max(32),
});

export const branchConfigSchema = z.strictObject({
  commandId,
  expectedVersion: z.number().int().min(1).max(MAX_VERSION),
  receiptHeader: z.string().trim().min(1).max(120),
  receiptFooter: z.string().trim().min(1).max(200),
  taxDisplayNote: z.string().trim().min(1).max(200),
  stationVisibleCards: z.number().int().min(1).max(24),
  offlineAccessExpiryMinutes: z.number().int().min(5).max(10080),
});

export const printerAdapterModeSchema = z.strictObject({
  commandId,
  type: z.enum(['receipt', 'label']),
  mode: z.enum(['unconfigured', 'confirmed', 'pending', 'failed', 'unknown']),
  failureReason: z.string().trim().min(1).max(200).optional(),
});

export const printJobRetrySchema = z.strictObject({
  commandId,
  action: z.enum(['retry', 'reprint', 'resolve']).default('retry'),
  resolutionStatus: z.enum(['confirmed', 'failed']).optional(),
  note: z.string().trim().max(200).optional(),
}).refine(v => v.action !== 'resolve' || v.resolutionStatus !== undefined, {
  message: 'Resolution status is required when resolving an unknown print job.',
});

export const wasteCorrectionSchema = z.strictObject({
  commandId,
  correctedQuantityMilli: z.number().int().min(0).max(100_000_000),
  reason: z.string().trim().min(1).max(200),
});

export const csvPreviewSchema = z.strictObject({
  kind: z.enum(['catalog', 'customers']),
  duplicatePolicy: z.enum(['skip', 'update']),
  csvText: z.string().min(1).max(24_000),
});

export const csvImportSchema = z.strictObject({
  commandId,
  kind: z.enum(['catalog', 'customers']),
  duplicatePolicy: z.enum(['skip', 'update']),
  csvText: z.string().min(1).max(24_000),
});

export const csvExportQuerySchema = z.strictObject({
  kind: z.enum(['catalog', 'customers', 'financial']),
});

export const syncModeSchema = z.strictObject({
  commandId,
  mode: z.enum(['online', 'offline']),
});

export const syncPushSchema = z.strictObject({ commandId });

export const syncIngestSchema = z.strictObject({
  commandId,
  envelopes: z.array(z.strictObject({
    envelopeId: identifier,
    entityType: z.enum(['product', 'customer', 'config']),
    entityId: identifier,
    version: z.number().int().min(1).max(MAX_VERSION),
    payload: z.record(z.string(), z.unknown()),
  })).min(1).max(50),
});

export const syncConflictResolveSchema = z.strictObject({
  commandId,
  resolutionNote: z.string().trim().min(1).max(300),
});

export const backupRestoreSchema = z.strictObject({
  commandId,
  backup: z.record(z.string(), z.unknown()),
});

export type IngredientInput=z.infer<typeof ingredientSchema>;
export type StockReceiptInput=z.infer<typeof stockReceiptSchema>;
export type ProductInput=z.infer<typeof productSchema>;
export type ProductRecipeUpdateInput=z.infer<typeof productRecipeUpdateSchema>;
export type DrawerInput=z.infer<typeof drawerSchema>;
export type ShiftOpenInput=z.infer<typeof shiftOpenSchema>;
export type VersionInput=z.infer<typeof versionSchema>;
export type ShiftCountInput=z.infer<typeof shiftCountSchema>;
export type ShiftReviewInput=z.infer<typeof shiftReviewSchema>;
export type OrderInput=z.infer<typeof orderSchema>;
export type PaymentInput=z.infer<typeof paymentSchema>;
export type WasteInput=z.infer<typeof wasteSchema>;
export type PaymentRejectInput=z.infer<typeof paymentRejectSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type ExpensePeriodInput = z.infer<typeof expensePeriodSchema>;
export type ExpenseCoverageInput = z.infer<typeof expenseCoverageSchema>;
export type ApprovalRequestInput = z.infer<typeof approvalRequestSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type CancellationDispositionInput = z.infer<typeof cancellationDispositionSchema>;
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;
export type RefundDecisionInput = z.infer<typeof refundDecisionSchema>;
export type RefundLegInput = z.infer<typeof refundLegSchema>;
export type OrderCustomerInput = z.infer<typeof orderCustomerSchema>;
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type CustomerListInput = z.infer<typeof customerListSchema>;
export type CustomerPolicyInput = z.infer<typeof customerPolicySchema>;
export type LoyaltyCloudModeInput = z.infer<typeof loyaltyCloudModeSchema>;
export type LoyaltySyncInput = z.infer<typeof loyaltySyncSchema>;
export type LoyaltyRedeemRequestInput = z.infer<typeof loyaltyRedeemRequestSchema>;
export type LoyaltyRedeemDecisionInput = z.infer<typeof loyaltyRedeemDecisionSchema>;
export type LoyaltyRedeemCloudValidateInput = z.infer<typeof loyaltyRedeemCloudValidateSchema>;
export type LoyaltyRedeemCloudReconcileInput = z.infer<typeof loyaltyRedeemCloudReconcileSchema>;
export type LoyaltyRefundCaseDecisionInput = z.infer<typeof loyaltyRefundCaseDecisionSchema>;
export type LoyaltyRefundCaseExceptionInput = z.infer<typeof loyaltyRefundCaseExceptionSchema>;
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DevicePairingCreateInput = z.infer<typeof devicePairingCreateSchema>;
export type DevicePairingClaimInput = z.infer<typeof devicePairingClaimSchema>;
export type BranchConfigInput = z.infer<typeof branchConfigSchema>;
export type PrinterAdapterModeInput = z.infer<typeof printerAdapterModeSchema>;
export type PrintJobRetryInput = z.infer<typeof printJobRetrySchema>;
export type WasteCorrectionInput = z.infer<typeof wasteCorrectionSchema>;
export type CsvPreviewInput = z.infer<typeof csvPreviewSchema>;
export type CsvImportInput = z.infer<typeof csvImportSchema>;
export type CsvExportQueryInput = z.infer<typeof csvExportQuerySchema>;
export type SyncModeInput = z.infer<typeof syncModeSchema>;
export type SyncPushInput = z.infer<typeof syncPushSchema>;
export type SyncIngestInput = z.infer<typeof syncIngestSchema>;
export type SyncConflictResolveInput = z.infer<typeof syncConflictResolveSchema>;
export type BackupRestoreInput = z.infer<typeof backupRestoreSchema>;
