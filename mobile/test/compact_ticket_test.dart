import 'package:cafe_dos/domain/cafe_engine.dart';
import 'package:cafe_dos/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void compactViewport(WidgetTester tester, double width) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 667);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> openTicket(WidgetTester tester, int count) async {
  final shortcut = find.textContaining('View ticket');
  if (shortcut.evaluate().isNotEmpty) {
    await tester.ensureVisible(shortcut);
    await tester.pumpAndSettle();
    if (shortcut.hitTestable().evaluate().isNotEmpty) {
      await tester.tap(shortcut.hitTestable());
      await tester.pumpAndSettle();
      return;
    }
  }
  final ticketTab = find.text('Ticket ($count)');
  await tester.ensureVisible(ticketTab);
  await tester.pumpAndSettle();
  await tester.tap(ticketTab);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('375x667 ticket keeps order creation and subsequent payment reachable', (
    tester,
  ) async {
    compactViewport(tester, 375);
    CafeEngine? saved;
    await tester.pumpWidget(
      CafeDosApp(
        engine: CafeEngine.sample(),
        persist: (next) async {
          saved = next;
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'compact menu');

    final product = find.text('Iced Spanish Latte').first;
    await tester.ensureVisible(product);
    await tester.pumpAndSettle();
    await tester.tap(product);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    await openTicket(tester, 1);
    expect(tester.takeException(), isNull, reason: 'compact ticket must not overflow');

    final create = find.text('Create order');
    await tester.ensureVisible(create);
    await tester.pumpAndSettle();
    expect(create.hitTestable(), findsOneWidget);
    await tester.tap(create);
    await tester.pumpAndSettle();
    expect(saved!.orders.single.totalCentavos, 16500);

    final payment = find.text('Record payment');
    await tester.ensureVisible(payment);
    await tester.pumpAndSettle();
    expect(payment.hitTestable(), findsOneWidget);
    await tester.tap(payment);
    await tester.pumpAndSettle();
    expect(find.text('Confirm payment').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull, reason: 'payment remains usable after compact checkout');
  });

  testWidgets('768x667 long ticket keeps total and finalization accessible without overflow', (
    tester,
  ) async {
    compactViewport(tester, 768);
    final engine = CafeEngine.sample();
    final product = engine.product('spanish-latte');
    final working = engine.reserveWorkingOrder();
    engine.updateWorkingOrder(
      working.id,
      List.generate(
        8,
        (index) => OrderLine(
          product.id,
          product.name,
          1,
          product.priceCentavos,
          product.recipe,
          note: '16 oz · Drink ${index + 1}',
        ),
      ),
      dineIn: true,
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
    await openTicket(tester, 8);
    expect(tester.takeException(), isNull, reason: 'short tablet ticket');

    final create = find.text('Create order');
    await tester.ensureVisible(create);
    await tester.pumpAndSettle();
    expect(create.hitTestable(), findsOneWidget);
    expect(find.text('₱1320.00').hitTestable(), findsWidgets);
    await tester.tap(create);
    await tester.pumpAndSettle();
    expect(saved!.orders.single.quantity, 8);
    expect(saved!.orders.single.totalCentavos, 132000);
    expect(tester.takeException(), isNull, reason: 'short tablet finalization');
  });
}
