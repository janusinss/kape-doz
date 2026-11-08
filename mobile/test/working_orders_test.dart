import 'dart:convert';

import 'package:cafe_dos/domain/cafe_engine.dart';
import 'package:flutter_test/flutter_test.dart';

OrderLine line(CafeEngine engine, String id) {
  final p = engine.product(id);
  return OrderLine(p.id, p.name, 1, p.priceCentavos, p.recipe);
}

CafeEngine restart(CafeEngine engine) => CafeEngine.fromJson(
  jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>,
);

void main() {
  test(
    'working orders keep their reserved ids and contents through restart and reverse finalization',
    () {
      var engine = CafeEngine.sample();
      final first = engine.reserveWorkingOrder().id;
      final second = engine.reserveWorkingOrder().id;
      engine.updateWorkingOrder(
        first,
        [line(engine, 'spanish-latte')],
        dineIn: true,
        table: '04',
      );
      engine.updateWorkingOrder(second, [
        line(engine, 'americano'),
      ], dineIn: false);
      engine = restart(engine);
      expect(engine.workingOrders.map((order) => order.id), [first, second]);
      expect(engine.workingOrders.first.table, '04');
      expect(engine.finalizeWorkingOrder(second).id, second);
      expect(engine.finalizeWorkingOrder(first).id, first);
      expect(engine.orders.map((order) => order.id), [second, first]);
      expect(engine.workingOrders, isEmpty);
      expect(
        restart(
          engine,
        ).createOrder(productId: 'matcha', quantity: 1, dineIn: true).id,
        isNot(anyOf(first, second)),
      );
    },
  );

  test(
    'cancellation never reuses an id and invalid finalization keeps the order',
    () {
      var engine = CafeEngine.sample();
      final cancelled = engine.reserveWorkingOrder().id;
      final empty = engine.reserveWorkingOrder().id;
      engine.cancelWorkingOrder(cancelled);
      expect(() => engine.finalizeWorkingOrder(empty), throwsArgumentError);
      expect(engine.workingOrders.single.id, empty);
      engine = restart(engine);
      final next = engine.reserveWorkingOrder().id;
      expect(next, isNot(anyOf(cancelled, empty)));
      expect(() => engine.cancelWorkingOrder(cancelled), throwsArgumentError);
    },
  );

  test('legacy schema without working orders remains readable', () {
    final engine = CafeEngine.sample();
    final legacy = engine.toJson()..remove('workingOrders');
    final restored = CafeEngine.fromJson(legacy);
    expect(restored.workingOrders, isEmpty);
    expect(restored.reserveWorkingOrder().id, '24');
  });

  test('rejected updates preserve existing order contents', () {
    final engine = CafeEngine.sample();
    final id = engine.reserveWorkingOrder().id;
    final original = line(engine, 'americano');
    engine.updateWorkingOrder(id, [original], dineIn: true, table: '03');
    final invalid = OrderLine('americano', 'Americano', 0, 100, {'beans': 18});
    expect(
      () => engine.updateWorkingOrder(id, [invalid], dineIn: false),
      throwsArgumentError,
    );
    expect(engine.workingOrders.single.lines.single.name, original.name);
    expect(engine.workingOrders.single.table, '03');
  });
}
