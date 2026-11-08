import 'hub_primitives.dart';

bool validProductAvailability(Map<String, dynamic> product) {
  final hasAvailability = product.containsKey('available');
  final hasVersion = product.containsKey('availabilityVersion');
  if (!hasAvailability && !hasVersion) return true;
  final version = product['availabilityVersion'];
  return hasAvailability &&
      hasVersion &&
      product['available'] is bool &&
      version is int &&
      version >= 1 &&
      version <= maxSafeInt;
}

bool productIsAvailable(Map<String, dynamic> product) =>
    validProductAvailability(product) && product['available'] != false;

Map<String, dynamic> resolveCartLineProduct(
  Map<String, dynamic> product, {
  required bool dineIn,
  String? sizeId,
  String? substitutionId,
  Map<String, int> addons = const {},
}) {
  final options = product['options'];
  if (options is! Map) return product;
  final baseRecipe = product['recipe'];
  if (baseRecipe is! List) return product;
  final bom = <String, int>{};
  for (final item in baseRecipe) {
    if (item is Map &&
        item['ingredientId'] is String &&
        item['quantityMilli'] is int) {
      bom[item['ingredientId'] as String] = item['quantityMilli'] as int;
    }
  }
  var unitPrice = product['priceCentavos'] is int
      ? product['priceCentavos'] as int
      : 0;
  if (sizeId != null && options['sizes'] is List) {
    for (final item in options['sizes'] as List) {
      if (item is Map && item['id'] == sizeId) {
        unitPrice += (item['priceDeltaCentavos'] as int? ?? 0);
        if (item['recipe'] is List) {
          for (final line in item['recipe'] as List) {
            if (line is Map &&
                line['ingredientId'] is String &&
                line['quantityMilli'] is int) {
              bom[line['ingredientId'] as String] =
                  line['quantityMilli'] as int;
            }
          }
        }
        break;
      }
    }
  }
  if (substitutionId != null && options['substitutions'] is List) {
    for (final item in options['substitutions'] as List) {
      if (item is Map && item['id'] == substitutionId) {
        final replaceId = item['replaceIngredientId'] as String?;
        final withId = item['withIngredientId'] as String?;
        if (replaceId != null && withId != null && bom.containsKey(replaceId)) {
          final replacedQty = bom.remove(replaceId)!;
          final addedQty = (item['quantityMilli'] as int?) ?? replacedQty;
          bom[withId] = (bom[withId] ?? 0) + addedQty;
          unitPrice += (item['priceDeltaCentavos'] as int? ?? 0);
        }
        break;
      }
    }
  }
  if (addons.isNotEmpty && options['addons'] is List) {
    for (final item in options['addons'] as List) {
      if (item is Map && item['id'] is String) {
        final count = addons[item['id'] as String] ?? 0;
        if (count > 0) {
          unitPrice += (item['priceDeltaCentavos'] as int? ?? 0) * count;
          if (item['recipe'] is List) {
            for (final line in item['recipe'] as List) {
              if (line is Map &&
                  line['ingredientId'] is String &&
                  line['quantityMilli'] is int) {
                final ingId = line['ingredientId'] as String;
                bom[ingId] =
                    (bom[ingId] ?? 0) + (line['quantityMilli'] as int) * count;
              }
            }
          }
        }
      }
    }
  }
  final pkgKey = dineIn ? 'dineInPackaging' : 'takeoutPackaging';
  if (options[pkgKey] is List) {
    for (final line in options[pkgKey] as List) {
      if (line is Map &&
          line['ingredientId'] is String &&
          line['quantityMilli'] is int) {
        final ingId = line['ingredientId'] as String;
        bom[ingId] = (bom[ingId] ?? 0) + (line['quantityMilli'] as int);
      }
    }
  }
  final sortedKeys = bom.keys.toList()..sort();
  return {
    ...product,
    'priceCentavos': unitPrice,
    'recipe': [
      for (final key in sortedKeys)
        {'ingredientId': key, 'quantityMilli': bom[key]!},
    ],
  };
}

bool validUnavailableLines(Map<String, dynamic> order) {
  if (!order.containsKey('unavailableLines')) return true;
  final values = order['unavailableLines'];
  if (values is! List ||
      (values.isNotEmpty &&
          (order['released'] == true || order['cancelled'] == true))) {
    return false;
  }
  final lines = order['lines'];
  if (lines is! List) return false;
  final seen = <int>{};
  for (final value in values) {
    if (value is! Map ||
        value.length != 3 ||
        value['lineNo'] is! int ||
        (value['lineNo'] as int) < 0 ||
        value['productId'] is! String ||
        (value['productId'] as String).isEmpty ||
        value['name'] is! String ||
        (value['name'] as String).isEmpty ||
        !seen.add(value['lineNo'] as int)) {
      return false;
    }
    if (!lines.any(
      (line) =>
          line is Map &&
          line['lineNo'] == value['lineNo'] &&
          line['productId'] == value['productId'] &&
          line['name'] == value['name'],
    )) {
      return false;
    }
  }
  return true;
}
