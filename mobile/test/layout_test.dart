import 'package:cafe_dos/domain/cafe_engine.dart';
import 'package:cafe_dos/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void tabletViewport(WidgetTester tester) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1280, 900);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('long tablet ticket keeps total and create action reachable', (
    tester,
  ) async {
    tabletViewport(tester);
    CafeEngine? persisted;
    await tester.pumpWidget(
      CafeDosApp(
        engine: CafeEngine.sample(),
        persist: (next) async {
          persisted = next;
        },
      ),
    );
    await tester.pumpAndSettle();

    // A rush order with many separately customized drinks must not hide checkout.
    for (var i = 0; i < 8; i++) {
      await tester.tap(find.text('Iced Spanish Latte').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to ticket'));
      await tester.pumpAndSettle();
    }

    expect(find.text('Create order').hitTestable(), findsOneWidget);
    expect(
      find.textContaining('1,320').hitTestable().evaluate().isNotEmpty ||
          find.textContaining('1320').hitTestable().evaluate().isNotEmpty,
      isTrue,
      reason: 'The full ticket total should be visible without scrolling.',
    );
    await tester.tap(find.text('Create order'));
    await tester.pumpAndSettle();
    expect(persisted, isNotNull);
    expect(persisted!.orders.single.quantity, 8);
    expect(persisted!.orders.single.totalCentavos, 132000);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tablet waste places recent activity beside entry form', (
    tester,
  ) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();
    engine.logWaste('beans', 18);
    await tester.pumpWidget(CafeDosApp(engine: engine, persist: (_) async {}));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Waste').last);
    await tester.pumpAndSettle();

    final quantity = tester.getRect(find.byType(TextField).first);
    final history = tester.getRect(find.text('Recent entries'));
    expect(
      history.left,
      greaterThan(quantity.right),
      reason: 'Recent activity belongs in a separate tablet column.',
    );
    expect(
      history.top,
      lessThan(quantity.bottom),
      reason: 'History should be visible alongside entry, not below the form.',
    );
    expect(find.textContaining('18 g'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
