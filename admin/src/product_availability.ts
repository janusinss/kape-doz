import { exactKeys, idRouteSegment, isId, isNonblankText, isSafeInt } from './primitives';

export type RecipeLineSpec = { ingredientId: string; quantityMilli: number };
export type ProductSizeOption = { id: string; name: string; priceDeltaCentavos: number; recipe: RecipeLineSpec[] };
export type ProductSubstitutionOption = {
  id: string;
  name: string;
  priceDeltaCentavos: number;
  replaceIngredientId: string;
  withIngredientId: string;
  quantityMilli?: number;
};
export type ProductAddonOption = { id: string; name: string; priceDeltaCentavos: number; recipe: RecipeLineSpec[] };
export type ProductOptions = {
  sizes?: ProductSizeOption[];
  substitutions?: ProductSubstitutionOption[];
  addons?: ProductAddonOption[];
  dineInPackaging?: RecipeLineSpec[];
  takeoutPackaging?: RecipeLineSpec[];
};

export function isRecipeLines(value: unknown, min = 1, max = 50): value is RecipeLineSpec[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return false;
  const ingredients = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const line = entry as Record<string, unknown>;
    if (!isId(line.ingredientId) || ingredients.has(line.ingredientId) || !isSafeInt(line.quantityMilli, 1, 1_000_000_000)) return false;
    ingredients.add(line.ingredientId);
  }
  return true;
}

export function isProductOptions(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const opts = value as Record<string, unknown>;
  if (opts.sizes !== undefined) {
    if (!Array.isArray(opts.sizes) || opts.sizes.length > 20) return false;
    const ids = new Set<string>();
    for (const s of opts.sizes) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
      const size = s as Record<string, unknown>;
      if (!isId(size.id) || ids.has(size.id) || !isNonblankText(size.name, 120) ||
          !isSafeInt(size.priceDeltaCentavos, -100_000_000_000, 100_000_000_000) || !isRecipeLines(size.recipe, 1, 50)) return false;
      ids.add(size.id);
    }
  }
  if (opts.substitutions !== undefined) {
    if (!Array.isArray(opts.substitutions) || opts.substitutions.length > 20) return false;
    const ids = new Set<string>();
    for (const s of opts.substitutions) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
      const sub = s as Record<string, unknown>;
      if (!isId(sub.id) || ids.has(sub.id) || !isNonblankText(sub.name, 120) ||
          !isSafeInt(sub.priceDeltaCentavos, -100_000_000_000, 100_000_000_000) ||
          !isId(sub.replaceIngredientId) || !isId(sub.withIngredientId) ||
          sub.replaceIngredientId === sub.withIngredientId ||
          (sub.quantityMilli !== undefined && !isSafeInt(sub.quantityMilli, 1, 1_000_000_000))) return false;
      ids.add(sub.id);
    }
  }
  if (opts.addons !== undefined) {
    if (!Array.isArray(opts.addons) || opts.addons.length > 20) return false;
    const ids = new Set<string>();
    for (const a of opts.addons) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
      const addon = a as Record<string, unknown>;
      if (!isId(addon.id) || ids.has(addon.id) || !isNonblankText(addon.name, 120) ||
          !isSafeInt(addon.priceDeltaCentavos, 0, 100_000_000_000) || !isRecipeLines(addon.recipe, 1, 50)) return false;
      ids.add(addon.id);
    }
  }
  if (opts.dineInPackaging !== undefined && !isRecipeLines(opts.dineInPackaging, 0, 20)) return false;
  if (opts.takeoutPackaging !== undefined && !isRecipeLines(opts.takeoutPackaging, 0, 20)) return false;
  return true;
}

export function availabilityCommand(path: string, data: Record<string, unknown>) {
  const route = new RegExp(`^/api/v1/products/(${idRouteSegment})/availability$`).exec(path);
  if (!route?.[1] || !exactKeys(data, ['expectedVersion', 'available', 'reason']) ||
      !isSafeInt(data.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) || typeof data.available !== 'boolean' ||
      !isNonblankText(data.reason, 160, true)) return null;
  return { id: route[1], expectedVersion: data.expectedVersion, available: data.available, reason: data.reason };
}

export function recipeUpdateCommand(path: string, data: Record<string, unknown>) {
  const route = new RegExp(`^/api/v1/products/(${idRouteSegment})/recipe$`).exec(path);
  if (!route?.[1] || !isSafeInt(data.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) ||
      (data.name !== undefined && !isNonblankText(data.name, 120, true)) ||
      !isSafeInt(data.priceCentavos, 1, 100_000_000_000) ||
      !isRecipeLines(data.recipe, 1, 50) || !isProductOptions(data)) return null;
  return { id: route[1], expectedVersion: data.expectedVersion };
}

export function isProduct(value: unknown, requireAvailability = false): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!isId(item.id) || !isNonblankText(item.name, 120) ||
      !isSafeInt(item.priceCentavos, 1, 100_000_000_000) || !isSafeInt(item.version, 1) ||
      !isRecipeLines(item.recipe, 1, 50) || !isProductOptions(item.options)) return false;
  const hasAvailability = Object.hasOwn(item, 'available');
  const hasVersion = Object.hasOwn(item, 'availabilityVersion');
  if (!hasAvailability && !hasVersion) return !requireAvailability;
  return hasAvailability && hasVersion && typeof item.available === 'boolean' && isSafeInt(item.availabilityVersion, 1);
}
