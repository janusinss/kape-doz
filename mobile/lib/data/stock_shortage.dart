import 'hub_primitives.dart';

const _fields = {
  'ingredientId',
  'name',
  'unit',
  'requiredMilli',
  'availableMilli',
  'shortfallMilli',
};

/// Operational quantities only. Ingredient costs never belong in staff warnings.
class StockShortage {
  final String ingredientId, name, unit;
  final int requiredMilli, availableMilli, shortfallMilli;

  const StockShortage({
    required this.ingredientId,
    required this.name,
    required this.unit,
    required this.requiredMilli,
    required this.availableMilli,
    required this.shortfallMilli,
  });

  String get shortfallLabel {
    final whole = shortfallMilli ~/ 1000;
    final remainder = shortfallMilli % 1000;
    final amount = remainder == 0
        ? '$whole'
        : '$whole.${remainder.toString().padLeft(3, '0').replaceFirst(RegExp(r'0+$'), '')}';
    return '$amount $unit';
  }
}

bool _integer(Object? value, {bool positive = false, bool signed = false}) =>
    value is int &&
    value >=
        (positive
            ? 1
            : signed
            ? -maxSafeInt
            : 0) &&
    value <= maxSafeInt;

/// Legacy orders omit this optional field. A present field must be trustworthy.
bool validOrderStockShortages(Map<String, dynamic> order) {
  if (!order.containsKey('shortages')) return true;
  final shortages = order['shortages'];
  if (shortages is! List ||
      (shortages.isNotEmpty &&
          (order['ready'] == true || order['cancelled'] == true))) {
    return false;
  }
  final ids = <String>{};
  for (final item in shortages) {
    if (!exactMap(item, _fields) ||
        item['ingredientId'] is! String ||
        !idPattern.hasMatch(item['ingredientId'] as String) ||
        !ids.add(item['ingredientId'] as String) ||
        item['name'] is! String ||
        (item['name'] as String).trim().isEmpty ||
        (item['name'] as String).length > 120 ||
        !validUnits.contains(item['unit']) ||
        !_integer(item['requiredMilli'], positive: true) ||
        !_integer(item['availableMilli'], signed: true) ||
        !_integer(item['shortfallMilli'], positive: true)) {
      return false;
    }
    if (BigInt.from(item['requiredMilli'] as int) -
            BigInt.from(item['availableMilli'] as int) !=
        BigInt.from(item['shortfallMilli'] as int)) {
      return false;
    }
  }
  return true;
}

List<StockShortage> orderStockShortages(Map<String, dynamic> order) {
  if (!validOrderStockShortages(order)) {
    throw const FormatException('Invalid stock shortage response.');
  }
  return [
    for (final item in order['shortages'] as List? ?? const [])
      StockShortage(
        ingredientId: item['ingredientId'] as String,
        name: item['name'] as String,
        unit: item['unit'] as String,
        requiredMilli: item['requiredMilli'] as int,
        availableMilli: item['availableMilli'] as int,
        shortfallMilli: item['shortfallMilli'] as int,
      ),
  ];
}

/// A cart has no reservations of its own. Saved orders use the hub's projection.
({List<StockShortage> shortages, bool incomplete}) cartStockShortages(
  Iterable<({Map<String, dynamic> product, int quantity})> lines,
  List<Map<String, dynamic>> ingredients,
) {
  final required = <String, BigInt>{};
  var incomplete = false;
  for (final line in lines) {
    final recipe = line.product['recipe'];
    if (recipe is! List || recipe.isEmpty || line.quantity <= 0) {
      incomplete = true;
      continue;
    }
    final recipeIds = <String>{};
    for (final item in recipe) {
      if (item is! Map ||
          item['ingredientId'] is! String ||
          !idPattern.hasMatch(item['ingredientId'] as String) ||
          !recipeIds.add(item['ingredientId'] as String) ||
          !_integer(item['quantityMilli'], positive: true)) {
        incomplete = true;
        continue;
      }
      final id = item['ingredientId'] as String;
      required[id] =
          (required[id] ?? BigInt.zero) +
          BigInt.from(item['quantityMilli'] as int) *
              BigInt.from(line.quantity);
    }
  }
  final result = <StockShortage>[];
  final bound = BigInt.from(maxSafeInt);
  final matched = <String>{};
  for (final ingredient in ingredients) {
    final needed = required[ingredient['id']];
    if (needed == null) continue;
    if (!matched.add(ingredient['id'] as String) ||
        needed > bound ||
        !_integer(ingredient['onHandMilli'], signed: true) ||
        !_integer(ingredient['reservedMilli']) ||
        ingredient['name'] is! String ||
        (ingredient['name'] as String).trim().isEmpty ||
        !validUnits.contains(ingredient['unit'])) {
      incomplete = true;
      continue;
    }
    final available =
        BigInt.from(ingredient['onHandMilli'] as int) -
        BigInt.from(ingredient['reservedMilli'] as int);
    final shortfall = needed - available;
    if (shortfall > bound || available < -bound) {
      incomplete = true;
      continue;
    }
    if (shortfall <= BigInt.zero) continue;
    result.add(
      StockShortage(
        ingredientId: ingredient['id'] as String,
        name: ingredient['name'] as String,
        unit: ingredient['unit'] as String,
        requiredMilli: needed.toInt(),
        availableMilli: available.toInt(),
        shortfallMilli: shortfall.toInt(),
      ),
    );
  }
  if (!matched.containsAll(required.keys)) incomplete = true;
  return (shortages: result, incomplete: incomplete);
}
