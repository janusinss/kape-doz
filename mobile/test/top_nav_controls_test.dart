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
  testWidgets('topNavBell opens notifications dialog and allows clearing', (
    tester,
  ) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();
    // Add an unready order to trigger kitchen notification
    engine.createOrder(productId: 'spanish-latte', quantity: 2, dineIn: true);

    await tester.pumpWidget(CafeDosApp(engine: engine, persist: (_) async {}));
    await tester.pumpAndSettle();

    // Tap bell button
    final bell = find.byTooltip('1 Unread Notifications');
    expect(bell, findsOneWidget);
    await tester.tap(bell);
    await tester.pumpAndSettle();

    expect(find.text('Notifications'), findsOneWidget);
    expect(find.textContaining('Kitchen Order #'), findsOneWidget);
    expect(find.text('Clear all'), findsOneWidget);

    await tester.tap(find.text('Clear all'));
    await tester.pumpAndSettle();
    expect(find.text('All caught up!'), findsOneWidget);
  });

  testWidgets('topNavSettings opens settings dialog and triggers test print', (
    tester,
  ) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();

    await tester.pumpWidget(CafeDosApp(engine: engine, persist: (_) async {}));
    await tester.pumpAndSettle();

    // Tap settings button
    final settings = find.byTooltip('Settings');
    expect(settings, findsOneWidget);
    await tester.tap(settings);
    await tester.pumpAndSettle();

    expect(find.text('POS Terminal Settings'), findsOneWidget);
    expect(find.text('Receipt printer'), findsOneWidget);
    expect(find.text('Print Test Receipt'), findsOneWidget);

    await tester.tap(find.text('Print Test Receipt'));
    await tester.pumpAndSettle();

    expect(
      find.text('Printer not configured. No test receipt was sent.'),
      findsOneWidget,
    );
    expect(engine.printJobs, isEmpty);
    expect(find.text('Done'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
  });

  testWidgets('topNavProfile opens staff profile and switches cashier', (
    tester,
  ) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();

    await tester.pumpWidget(CafeDosApp(engine: engine, persist: (_) async {}));
    await tester.pumpAndSettle();

    // Tap staff profile chip
    final profile = find.text('Elina Gilbert');
    expect(profile, findsOneWidget);
    await tester.tap(profile);
    await tester.pumpAndSettle();

    expect(find.text('Shift Clock-In'), findsOneWidget);
    expect(find.text('Switch Staff / Cashier'), findsOneWidget);

    await tester.tap(find.text('Switch Staff / Cashier'));
    await tester.pumpAndSettle();

    expect(find.text('Select Cashier / Staff'), findsOneWidget);
    expect(find.text('Marco Rossi'), findsOneWidget);

    await tester.tap(find.text('Marco Rossi'));
    await tester.pumpAndSettle();

    // Chip now displays Marco Rossi
    expect(find.text('Marco Rossi'), findsOneWidget);
    expect(find.text('Senior Barista'), findsOneWidget);
  });

  testWidgets('topNavLogout locks terminal and unlocks with quick unlock', (
    tester,
  ) async {
    tabletViewport(tester);
    final engine = CafeEngine.sample();

    await tester.pumpWidget(CafeDosApp(engine: engine, persist: (_) async {}));
    await tester.pumpAndSettle();

    // Tap logout/lock button
    final logout = find.byTooltip('Sign out / Lock');
    expect(logout, findsOneWidget);
    await tester.tap(logout);
    await tester.pumpAndSettle();

    expect(find.text('Staff Session'), findsOneWidget);
    expect(find.text('Lock Terminal'), findsOneWidget);

    await tester.tap(find.text('Lock Terminal'));
    await tester.pumpAndSettle();

    expect(find.text('TERMINAL LOCKED'), findsOneWidget);
    expect(find.text('Quick Unlock'), findsOneWidget);

    await tester.tap(find.text('Quick Unlock'));
    await tester.pumpAndSettle();

    expect(find.text('TERMINAL LOCKED'), findsNothing);
  });
}
