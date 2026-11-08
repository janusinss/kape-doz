import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:cafe_dos/domain/cafe_engine.dart';

CafeOrder orderById(CafeEngine engine, String id) =>
    engine.orders.singleWhere((order) => order.id == id);

CafeOrder latte(CafeEngine engine, {bool dineIn = false, int quantity = 1}) =>
    engine.createOrder(
      productId: 'spanish-latte',
      quantity: quantity,
      dineIn: dineIn,
    );

void main() {
  group('optional receipt printing', () {
    test('settlement does not automatically request a customer receipt', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      engine.addPayment(
        order.id,
        amountCentavos: 16500,
        method: 'cash',
        verified: true,
      );
      expect(
        engine.printJobs.where((j) => j['type'] == 'Payment slip'),
        isEmpty,
      );
    });

    test('receipt request requires full payment and stays unconfigured', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      expect(() => engine.requestReceipt(order.id), throwsStateError);
      engine.addPayment(
        order.id,
        amountCentavos: 10000,
        method: 'cash',
        verified: true,
      );
      expect(() => engine.requestReceipt(order.id), throwsStateError);
      engine.addPayment(
        order.id,
        amountCentavos: 6500,
        method: 'cash',
        verified: true,
      );
      engine.requestReceipt(order.id);
      engine.requestReceipt(order.id);
      final receipts = engine.printJobs.where(
        (j) => j['type'] == 'Payment slip',
      );
      expect(receipts, hasLength(1));
      expect(receipts.single['status'], 'Unconfigured');
    });
  });
  group('order release and confirmed payment', () {
    test('takeout waits for the full confirmed split payment', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      expect(order.totalCentavos, 16500);

      engine.addPayment(
        order.id,
        amountCentavos: 10000,
        method: 'cash',
        verified: true,
      );
      expect(orderById(engine, order.id).paidCentavos, 10000);
      expect(orderById(engine, order.id).released, isFalse);

      engine.addPayment(
        order.id,
        amountCentavos: 6500,
        method: 'gcash',
        verified: false,
      );
      expect(orderById(engine, order.id).paidCentavos, 10000);
      expect(orderById(engine, order.id).released, isFalse);

      engine.addPayment(
        order.id,
        amountCentavos: 6500,
        method: 'gcash',
        verified: true,
      );
      expect(orderById(engine, order.id).paidCentavos, 16500);
      expect(orderById(engine, order.id).released, isTrue);
      expect(engine.reservations['beans'], 18);
    });

    test('unpaid takeout cannot be explicitly sent or marked ready', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      final initialStock = Map<String, int>.from(engine.stock);
      expect(() => engine.sendOrder(order.id), throwsStateError);
      expect(() => engine.markReady(order.id), throwsStateError);
      expect(orderById(engine, order.id).released, isFalse);
      expect(engine.stock, initialStock);
    });

    test(
      'dine-in explicitly reserves before payment without consuming stock',
      () {
        final engine = CafeEngine.sample();
        final order = latte(engine, dineIn: true, quantity: 2);
        final initialStock = Map<String, int>.from(engine.stock);
        engine.sendOrder(order.id);
        expect(orderById(engine, order.id).released, isTrue);
        expect(orderById(engine, order.id).paidCentavos, 0);
        expect(engine.stock, initialStock);
        expect(engine.reservations['beans'], 36);
        expect(engine.reservations['milk'], 300);

        engine.sendOrder(order.id);
        expect(engine.reservations['beans'], 36);
        engine.addPayment(
          order.id,
          amountCentavos: 33000,
          method: 'cash',
          verified: true,
        );
        expect(engine.reservations['beans'], 36);
      },
    );

    test('rejects excess confirmed payment without changing the order', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      engine.addPayment(
        order.id,
        amountCentavos: 10000,
        method: 'cash',
        verified: true,
      );
      expect(
        () => engine.addPayment(
          order.id,
          amountCentavos: 6501,
          method: 'card',
          verified: true,
        ),
        throwsStateError,
      );
      expect(orderById(engine, order.id).paidCentavos, 10000);
      expect(orderById(engine, order.id).released, isFalse);
    });

    test('rejects invalid order and payment inputs', () {
      final engine = CafeEngine.sample();
      expect(
        () =>
            engine.createOrder(productId: 'missing', quantity: 1, dineIn: true),
        throwsArgumentError,
      );
      expect(() => latte(engine, quantity: 0), throwsArgumentError);
      expect(() => latte(engine, quantity: -1), throwsArgumentError);
      final order = latte(engine);
      expect(
        () => engine.addPayment(
          order.id,
          amountCentavos: 0,
          method: 'cash',
          verified: true,
        ),
        throwsArgumentError,
      );
      expect(
        () => engine.addPayment(
          order.id,
          amountCentavos: 1,
          method: 'unsupported',
          verified: true,
        ),
        throwsArgumentError,
      );
      expect(() => engine.sendOrder('missing'), throwsArgumentError);
    });
  });

  group('ingredient consumption and waste', () {
    test('ready consumes the captured quantity exactly once', () {
      final engine = CafeEngine.sample();
      final order = latte(engine, dineIn: true, quantity: 2);
      final before = Map<String, int>.from(engine.stock);
      engine.sendOrder(order.id);
      engine.markReady(order.id);

      expect(orderById(engine, order.id).ready, isTrue);
      expect(engine.stock['beans'], before['beans']! - 36);
      expect(engine.stock['milk'], before['milk']! - 300);
      expect(engine.stock['syrup'], before['syrup']! - 30);
      expect(engine.stock['cup'], before['cup']! - 2);
      expect(engine.stock['lid'], before['lid']! - 2);
      expect(engine.reservations['beans'] ?? 0, 0);
      final after = Map<String, int>.from(engine.stock);

      engine.markReady(order.id);
      engine.sendOrder(order.id);
      expect(engine.stock, after);
      expect(engine.reservations['beans'] ?? 0, 0);
    });

    test('waste does not alter a sale or its payment', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      engine.addPayment(
        order.id,
        amountCentavos: 16500,
        method: 'cash',
        verified: true,
      );
      final beansBefore = engine.stock['beans']!;
      engine.logWaste('beans', 18);
      expect(engine.stock['beans'], beansBefore - 18);
      expect(orderById(engine, order.id).totalCentavos, 16500);
      expect(orderById(engine, order.id).paidCentavos, 16500);
      expect(engine.orders.length, 1);
    });

    test('warn-and-continue policy permits negative recorded stock', () {
      final engine = CafeEngine.sample();
      engine.logWaste('beans', engine.stock['beans']!);
      final order = latte(engine, dineIn: true);
      engine.sendOrder(order.id);
      engine.markReady(order.id);
      expect(engine.stock['beans'], -18);
      expect(orderById(engine, order.id).ready, isTrue);
    });

    test('invalid waste entries have no effect', () {
      final engine = CafeEngine.sample();
      final before = Map<String, int>.from(engine.stock);
      expect(() => engine.logWaste('beans', 0), throwsArgumentError);
      expect(() => engine.logWaste('beans', -1), throwsArgumentError);
      expect(() => engine.logWaste('missing', 1), throwsArgumentError);
      expect(engine.stock, before);
    });
  });

  group('restart and staff projection', () {
    test('JSON restart preserves reservations, consumption and unique IDs', () {
      final engine = CafeEngine.sample();
      final readyOrder = latte(engine, dineIn: true);
      engine.sendOrder(readyOrder.id);
      engine.markReady(readyOrder.id);
      final waitingOrder = latte(engine, dineIn: true, quantity: 2);
      engine.sendOrder(waitingOrder.id);
      engine.addPayment(
        waitingOrder.id,
        amountCentavos: 10000,
        method: 'cash',
        verified: true,
      );
      engine.logWaste('milk', 10);
      final encoded = jsonEncode(engine.toJson());
      final restored = CafeEngine.fromJson(
        jsonDecode(encoded) as Map<String, dynamic>,
      );

      expect(restored.stock, engine.stock);
      expect(restored.reservations, engine.reservations);
      expect(orderById(restored, waitingOrder.id).paidCentavos, 10000);
      expect(orderById(restored, waitingOrder.id).released, isTrue);
      expect(orderById(restored, readyOrder.id).ready, isTrue);
      final before = Map<String, int>.from(restored.stock);
      restored.markReady(readyOrder.id);
      expect(restored.stock, before);
      final next = latte(restored);
      expect(next.id, isNot(readyOrder.id));
      expect(next.id, isNot(waitingOrder.id));
    });

    test('staff snapshot uses explicit operational field allowlists', () {
      final engine = CafeEngine.sample();
      latte(engine);
      final snapshot = engine.staffSnapshot();
      expect(snapshot.keys.toSet(), {
        'products',
        'orders',
        'stock',
        'reservations',
      });
      final products = snapshot['products'] as List;
      final orders = snapshot['orders'] as List;
      expect((products.first as Map).keys.toSet(), {
        'id',
        'name',
        'priceCentavos',
        'recipe',
      });
      expect((orders.first as Map).keys.toSet(), {
        'id',
        'productId',
        'quantity',
        'dineIn',
        'totalCentavos',
        'paidCentavos',
        'released',
        'ready',
      });
      expect(() => jsonEncode(snapshot), returnsNormally);
      final serialized = jsonEncode(snapshot).toLowerCase();
      for (final forbidden in [
        'purchasecost',
        'recipecost',
        'margin',
        'profit',
        'opex',
        'expectedcash',
        'variance',
      ]) {
        expect(serialized, isNot(contains(forbidden)));
      }
    });
  });

  group('audit regression guards', () {
    test('order line freezes the caller recipe before reservation and use', () {
      final engine = CafeEngine.sample();
      final recipe = <String, int>{'beans': 18, 'milk': 150};
      final order = engine.createTicket([
        OrderLine('spanish-latte', 'Iced Spanish Latte', 1, 16500, recipe),
      ], dineIn: true);
      final beansBefore = engine.stock['beans']!;
      final milkBefore = engine.stock['milk']!;
      engine.sendOrder(order.id);

      recipe['beans'] = 900;
      recipe['milk'] = 1;
      recipe['syrup'] = 500;
      expect(engine.reservations['beans'], 18);
      expect(engine.reservations['milk'], 150);

      engine.markReady(order.id);
      expect(engine.stock['beans'], beansBefore - 18);
      expect(engine.stock['milk'], milkBefore - 150);
      expect(engine.reservations['beans'] ?? 0, 0);
      expect(engine.reservations['milk'] ?? 0, 0);
    });

    test(
      'negative recipe quantities cannot create a ticket or change stock',
      () {
        final engine = CafeEngine.sample();
        final before = jsonEncode(engine.toJson());
        expect(
          () => engine.createTicket([
            OrderLine('spanish-latte', 'Iced Spanish Latte', 1, 16500, {
              'beans': -18,
              'milk': 150,
            }),
          ], dineIn: true),
          throwsArgumentError,
        );
        expect(jsonEncode(engine.toJson()), before);
      },
    );

    test('stable payment retry has one effect and rejects changed amount', () {
      final engine = CafeEngine.sample();
      final order = latte(engine);
      engine.addPayment(
        order.id,
        amountCentavos: 16500,
        method: 'gcash',
        verified: true,
        paymentId: 'stable',
        reference: 'ref',
      );
      final afterFirst = jsonEncode(engine.toJson());

      engine.addPayment(
        order.id,
        amountCentavos: 16500,
        method: 'gcash',
        verified: true,
        paymentId: 'stable',
        reference: 'ref',
      );
      expect(jsonEncode(engine.toJson()), afterFirst);
      expect(orderById(engine, order.id).payments, hasLength(1));
      expect(orderById(engine, order.id).paidCentavos, 16500);
      expect(engine.reservations['beans'], 18);

      expect(
        () => engine.addPayment(
          order.id,
          amountCentavos: 16501,
          method: 'gcash',
          verified: true,
          paymentId: 'stable',
          reference: 'ref',
        ),
        throwsStateError,
      );
      expect(jsonEncode(engine.toJson()), afterFirst);
    });

    test('confirmed external reference cannot fund a second order', () {
      final engine = CafeEngine.sample();
      final first = latte(engine);
      final second = latte(engine);
      engine.addPayment(
        first.id,
        amountCentavos: 16500,
        method: 'card',
        verified: true,
        paymentId: 'first-payment',
        reference: 'terminal-approval-1',
      );
      final beforeSecondAttempt = jsonEncode(engine.toJson());

      expect(
        () => engine.addPayment(
          second.id,
          amountCentavos: 16500,
          method: 'card',
          verified: true,
          paymentId: 'second-payment',
          reference: 'terminal-approval-1',
        ),
        throwsStateError,
      );
      expect(jsonEncode(engine.toJson()), beforeSecondAttempt);
      expect(orderById(engine, second.id).paidCentavos, 0);
      expect(orderById(engine, second.id).released, isFalse);
    });
  });
}
