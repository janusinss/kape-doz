import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cafe_dos/domain/cafe_engine.dart';
import 'package:cafe_dos/main.dart';

void useViewport(WidgetTester tester, double width) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 900);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets(
    'payment stays open and receipt is optional after full settlement',
    (tester) async {
      useViewport(tester, 375);
      final engine = CafeEngine.sample();
      final order = engine.createOrder(
        productId: 'spanish-latte',
        quantity: 1,
        dineIn: false,
      );
      CafeEngine? saved;
      await tester.pumpWidget(
        CafeDosApp(
          engine: engine,
          persist: (next) async {
            saved = next;
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Print Bill'), findsNothing);
      await tester.tap(find.text('Ticket (0)'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Record payment'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record payment'));
      await tester.pumpAndSettle();
      final printButton = find.byKey(const ValueKey('paymentPrintReceipt'));
      expect(tester.widget<OutlinedButton>(printButton).onPressed, isNull);
      final amount = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      );
      await tester.enterText(amount, '100');
      await tester.tap(find.text('Confirm payment'));
      await tester.pumpAndSettle();
      expect(find.text('Payment #${order.id}'), findsOneWidget);
      expect(tester.widget<OutlinedButton>(printButton).onPressed, isNull);
      await tester.enterText(amount, '65');
      await tester.tap(find.text('Confirm payment'));
      await tester.pumpAndSettle();
      expect(find.text('Payment #${order.id}'), findsOneWidget);
      expect(
        saved!.printJobs.where((j) => j['type'] == 'Payment slip'),
        isEmpty,
      );
      expect(tester.widget<OutlinedButton>(printButton).onPressed, isNotNull);
      await tester.tap(printButton);
      await tester.pumpAndSettle();
      expect(
        find.text('Receipt printer not configured. No receipt was sent.'),
        findsOneWidget,
      );
      expect(
        saved!.printJobs.where((j) => j['type'] == 'Payment slip'),
        hasLength(1),
      );
      expect(tester.takeException(), isNull);
    },
  );
  for (final width in [375.0, 768.0, 1280.0]) {
    testWidgets('staff register and waste fit a ${width.toInt()}px viewport', (
      tester,
    ) async {
      useViewport(tester, width);
      await tester.pumpWidget(
        CafeDosApp(engine: CafeEngine.sample(), persist: (_) async {}),
      );
      await tester.pumpAndSettle();

      expect(find.text('Register'), findsWidgets);
      expect(find.text('Iced Spanish Latte'), findsWidgets);
      expect(tester.takeException(), isNull);

      final wasteTab = find.text('Waste').last;
      await tester.ensureVisible(wasteTab);
      await tester.tap(wasteTab);
      await tester.pumpAndSettle();
      expect(find.text('Espresso dial-in'), findsWidgets);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Espresso dial-in').first);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('customized product creates a persisted ticket', (tester) async {
    useViewport(tester, 1280);
    final engine = CafeEngine.sample();
    var persistCalls = 0;
    CafeEngine? persisted;
    await tester.pumpWidget(
      CafeDosApp(
        engine: engine,
        persist: (next) async {
          persistCalls++;
          persisted = next;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    expect(find.text('Add to ticket'), findsOneWidget);
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();

    final create = find.text('Create order');
    await tester.ensureVisible(create);
    await tester.tap(create);
    await tester.pumpAndSettle();

    expect(persisted, isNotNull);
    expect(persisted!.orders, hasLength(1));
    expect(persisted!.orders.single.totalCentavos, greaterThan(0));
    expect(engine.orders, isEmpty);
    expect(persistCalls, greaterThanOrEqualTo(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed save retains cart without publishing an open order', (
    tester,
  ) async {
    useViewport(tester, 1280);
    final engine = CafeEngine.sample();
    var attempts = 0;
    var failNext = false;
    CafeEngine? persisted;
    await tester.pumpWidget(
      CafeDosApp(
        engine: engine,
        persist: (next) async {
          attempts++;
          if (failNext) {
            failNext = false;
            throw StateError('Storage unavailable');
          }
          persisted = next;
        },
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    final writesBeforeFinalize = attempts;
    failNext = true;
    await tester.ensureVisible(find.text('Create order'));
    await tester.tap(find.text('Create order'));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'Could not save. Your previous saved data is unchanged. '
        'Please retry.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('Storage unavailable'), findsNothing);
    expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);
    expect(find.text('Create order'), findsOneWidget);
    expect(find.text('Record payment'), findsNothing);
    expect(find.text('Send to bar'), findsNothing);
    expect(engine.orders, isEmpty);
    expect(persisted!.orders, isEmpty);
    expect(
      persisted!.workingOrders.single.lines.single.name,
      'Iced Spanish Latte',
    );
    expect(attempts, writesBeforeFinalize + 1);
    expect(tester.takeException(), isNull);

    // A retry saves the retained ticket once, instead of duplicating the
    // unpublished order from the failed attempt.
    await tester.tap(find.text('Create order'));
    await tester.pumpAndSettle();
    expect(attempts, writesBeforeFinalize + 3);
    expect(persisted!.orders, hasLength(1));
    expect(find.text('Record payment'), findsOneWidget);
    expect(find.text('Create order'), findsNothing);
    expect(engine.orders, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tablet shows six ready actions and completes only one ticket', (
    tester,
  ) async {
    useViewport(tester, 1280);
    final engine = CafeEngine.sample();
    for (var i = 0; i < 6; i++) {
      final order = engine.createOrder(
        productId: 'spanish-latte',
        quantity: 1,
        dineIn: true,
      );
      engine.sendOrder(order.id);
    }
    final beansBefore = engine.stock['beans']!;
    final reservedBefore = engine.reservations['beans']!;
    CafeEngine? persisted;
    var writes = 0;
    await tester.pumpWidget(
      CafeDosApp(
        engine: engine,
        persist: (next) async {
          writes++;
          persisted = next;
        },
      ),
    );
    await tester.pumpAndSettle();
    final writesBeforeReady = writes;
    await tester.tap(find.text('Barista station').last);
    await tester.pumpAndSettle();

    expect(find.text('Active orders · 6'), findsOneWidget);
    expect(find.text('Mark ready').hitTestable(), findsNWidgets(6));
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Mark ready').hitTestable().first);
    await tester.pumpAndSettle();

    expect(writes, writesBeforeReady + 1);
    expect(persisted, isNotNull);
    expect(persisted!.stock['beans'], beansBefore - 18);
    expect(persisted!.reservations['beans'], reservedBefore - 18);
    expect(persisted!.orders.where((order) => order.ready), hasLength(1));
    expect(persisted!.orders.where((order) => !order.ready), hasLength(5));
    expect(find.text('Active orders · 5'), findsOneWidget);
    expect(find.text('Mark ready').hitTestable(), findsNWidgets(5));
    expect(engine.stock['beans'], beansBefore);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'phone opens payment and external verification without overflow',
    (tester) async {
      useViewport(tester, 375);
      final engine = CafeEngine.sample();
      final order = engine.createOrder(
        productId: 'spanish-latte',
        quantity: 1,
        dineIn: false,
      );
      await tester.pumpWidget(
        CafeDosApp(engine: engine, persist: (_) async {}),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ticket (0)'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Record payment'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record payment'));
      await tester.pumpAndSettle();

      expect(find.text('Payment #${order.id}'), findsOneWidget);
      expect(find.text('Cash received (PHP)'), findsOneWidget);
      expect(find.text('Confirm payment').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Cash').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('GCash').last);
      await tester.pumpAndSettle();
      expect(find.text('Merchant payment reference'), findsOneWidget);
      expect(
        find.text(
          'I checked successful payment in the merchant app / terminal',
        ),
        findsOneWidget,
      );
      expect(find.text('Confirm payment').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
