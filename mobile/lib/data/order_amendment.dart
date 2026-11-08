import 'hub_primitives.dart';

/// The hub returns a smaller amendment projection to the barista station.
/// Validate it before rendering a change or clearing a durable command.
bool validOrderAmendment(Map<String, dynamic> value, {required bool barista}) {
  const operations = {'add', 'quantity', 'remove', 'replace', 'note'};
  const stationStatuses = {'awaiting_station', 'resolved'};
  const cashierStatuses = {'awaiting_approval', 'denied', 'stale'};
  const commonKeys = {
    'id',
    'orderId',
    'orderNo',
    'orderVersion',
    'operation',
    'status',
    'before',
    'after',
    'reason',
    'decisionReason',
    'requestedAt',
    'appliedAt',
    'resolvedAt',
    'needsDisposition',
    'recipe',
    'dispositionNote',
  };

  bool identifier(Object? input) =>
      input is String && idPattern.hasMatch(input);
  bool integer(
    Object? input, [
    int minimum = 0,
    int maximum = maxSafeInt,
  ]) => input is int && input >= minimum && input <= maximum;
  bool text(Object? input, {bool nonempty = false, int maximum = 300}) =>
      input is String &&
      input.length <= maximum &&
      (!nonempty || input.trim().isNotEmpty);
  bool nullableText(Object? input) => input == null || text(input);
  bool nullableTime(Object? input) => input == null || integer(input);

  bool line(Object? input) {
    if (input is! Map<String, dynamic>) return false;
    const keys = {'lineNo', 'productId', 'name', 'quantity', 'note'};
    return keys.every(input.containsKey) &&
        input.keys.every(
          (key) =>
              keys.contains(key) || (!barista && key == 'unitPriceCentavos'),
        ) &&
        integer(input['lineNo']) &&
        identifier(input['productId']) &&
        text(input['name'], nonempty: true, maximum: 120) &&
        integer(input['quantity'], 1, 99) &&
        text(input['note']) &&
        (!input.containsKey('unitPriceCentavos') ||
            integer(input['unitPriceCentavos'], 1));
  }

  final operation = value['operation'];
  final status = value['status'];
  if (!commonKeys.every(value.containsKey) ||
      !value.keys.every(
        (key) =>
            commonKeys.contains(key) ||
            (!barista &&
                {'totalBeforeCentavos', 'totalAfterCentavos'}.contains(key)),
      ) ||
      !identifier(value['id']) ||
      !identifier(value['orderId']) ||
      !integer(value['orderNo'], 1) ||
      !integer(value['orderVersion'], 1) ||
      !operations.contains(operation) ||
      !(stationStatuses.contains(status) ||
          (!barista && cashierStatuses.contains(status))) ||
      !text(value['reason'], nonempty: true) ||
      !nullableText(value['decisionReason']) ||
      (barista && value['decisionReason'] != null) ||
      !integer(value['requestedAt']) ||
      !nullableTime(value['appliedAt']) ||
      !nullableTime(value['resolvedAt']) ||
      !nullableText(value['dispositionNote']) ||
      value['needsDisposition'] is! bool ||
      (value.containsKey('totalBeforeCentavos') &&
          !integer(value['totalBeforeCentavos'], 1)) ||
      (value.containsKey('totalAfterCentavos') &&
          !integer(value['totalAfterCentavos'], 1))) {
    return false;
  }
  if (status == 'resolved' &&
          (value['resolvedAt'] == null || value['appliedAt'] == null) ||
      status != 'resolved' && value['resolvedAt'] != null ||
      {'awaiting_approval', 'denied'}.contains(status) &&
          value['appliedAt'] != null) {
    return false;
  }
  if (!(operation == 'add' ? value['before'] == null : line(value['before'])) ||
      !(operation == 'remove'
          ? value['after'] == null
          : line(value['after']))) {
    return false;
  }

  final ingredients = <Object?>{};
  final recipe = value['recipe'];
  return recipe is List &&
      value['needsDisposition'] == recipe.isNotEmpty &&
      recipe.every(
        (entry) =>
            entry is Map<String, dynamic> &&
            entry.length == 4 &&
            identifier(entry['ingredientId']) &&
            ingredients.add(entry['ingredientId']) &&
            text(entry['name'], nonempty: true, maximum: 120) &&
            validUnits.contains(entry['unit']) &&
            integer(entry['quantityMilli'], 1),
      );
}
