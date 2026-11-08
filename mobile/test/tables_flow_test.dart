import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cafe_dos/domain/cafe_engine.dart';
import 'package:cafe_dos/main.dart';

void tabletViewport(WidgetTester tester) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1280, 900);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('tables view shows floor plan with available tables and can start order',
      (tester) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();

    await tester.pumpWidget(
      CafeDosApp(engine: engine, persist: (_) async {}),
    );
    await tester.pumpAndSettle();

    // Tap Tables in navigation
    final tablesNav = find.text('Tables').last;
    expect(tablesNav, findsOneWidget);
    await tester.tap(tablesNav);
    await tester.pumpAndSettle();

    expect(find.text('Floor Plan & Active Tables'), findsOneWidget);
    expect(find.text('Table 01'), findsOneWidget);
    expect(find.text('Table 12'), findsOneWidget);

    // Tap Start Order on Table 03
    final startOrderButtons = find.text('Start Order');
    expect(startOrderButtons, findsWidgets);
    await tester.tap(startOrderButtons.at(2)); // Table 03
    await tester.pumpAndSettle();

    // Should return to Register with Table 03 selected
    expect(find.text('Table No.'), findsOneWidget);
    expect(find.text('03'), findsWidgets);
  });

  testWidgets('ticket panel table text field updates active table',
      (tester) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();

    await tester.pumpWidget(
      CafeDosApp(engine: engine, persist: (_) async {}),
    );
    await tester.pumpAndSettle();

    final tableField = find.byWidgetPredicate(
      (w) =>
          w is TextField &&
          w.decoration?.labelText == 'Table number (optional)',
    );
    expect(tableField, findsOneWidget);
    await tester.enterText(tableField, '05');
    await tester.pumpAndSettle();

    expect(find.text('05'), findsWidgets);
  });

  testWidgets('merge tables combines items and closes source working order',
      (tester) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();

    // Create 2 working orders with tables and drinks
    final o1 = engine.reserveWorkingOrder();
    engine.updateWorkingOrder(
      o1.id,
      [
        OrderLine('spanish-latte', 'Iced Spanish Latte', 1, 16500, {
          'beans': 18,
          'milk': 150,
        }),
      ],
      dineIn: true,
      table: '01',
    );

    final o2 = engine.reserveWorkingOrder();
    engine.updateWorkingOrder(
      o2.id,
      [
        OrderLine('americano', 'Americano', 2, 12500, {
          'beans': 18,
        }),
      ],
      dineIn: true,
      table: '02',
    );

    await tester.pumpWidget(
      CafeDosApp(engine: engine, persist: (_) async {}),
    );
    await tester.pumpAndSettle();

    // Navigate to Tables view
    await tester.tap(find.text('Tables').last);
    await tester.pumpAndSettle();

    // Verify Merge Tables button is visible
    final mergeButton = find.text('Merge Tables');
    expect(mergeButton, findsOneWidget);
    await tester.tap(mergeButton);
    await tester.pumpAndSettle();

    expect(find.text('Merge Tables & Orders'), findsOneWidget);

    // Confirm merge
    await tester.tap(find.text('Confirm Merge'));
    await tester.pumpAndSettle();

    // Verify merge success message
    expect(find.textContaining('Merged Order #'), findsOneWidget);
  });
}
