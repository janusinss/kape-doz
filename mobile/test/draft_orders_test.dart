import 'dart:convert';
import 'dart:async';

import 'package:cafe_dos/domain/cafe_engine.dart';
import 'package:cafe_dos/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('switch waits until a pending table save finishes', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final tableGate = Completer<void>();
    var blocked = false;
    Map<String, dynamic>? saved;
    Future<void> persist(CafeEngine engine) async {
      final snapshot =
          jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>;
      if (!blocked &&
          (snapshot['workingOrders'] as List).any(
            (order) => order['table'] == '04',
          )) {
        blocked = true;
        await tableGate.future;
      }
      saved = snapshot;
    }

    await tester.pumpWidget(
      CafeDosApp(engine: CafeEngine.sample(), persist: persist),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('New order'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    final tableField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.labelText == 'Table number (optional)',
    );
    await tester.enterText(tableField, '04');
    await tester.pump();
    expect(blocked, isTrue);
    await tester.tap(find.text('Order #25'));
    await tester.pump();
    expect(tester.widget<TextField>(tableField).controller!.text, '04');
    tableGate.complete();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Order #25'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(tableField).controller!.text, isEmpty);
    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(tableField).controller!.text, '04');
    expect(
      (saved!['workingOrders'] as List).singleWhere(
        (order) => order['id'] == '24',
      )['table'],
      '04',
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'table field is protected during item saves and reopens afterward',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1280, 900);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final saveGate = Completer<void>();
      var blockNext = false;
      var blocked = false;
      Map<String, dynamic>? saved;
      Future<void> persist(CafeEngine engine) async {
        final snapshot =
            jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>;
        if (blockNext) {
          blockNext = false;
          blocked = true;
          await saveGate.future;
        }
        saved = snapshot;
      }

      await tester.pumpWidget(
        CafeDosApp(engine: CafeEngine.sample(), persist: persist),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Iced Spanish Latte').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to ticket'));
      await tester.pumpAndSettle();
      final tableField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Table number (optional)',
      );
      blockNext = true;
      await tester.tap(find.byTooltip('Remove Iced Spanish Latte'));
      await tester.pump();
      expect(blocked, isTrue, reason: 'The item change should be saving.');
      expect(tester.widget<TextField>(tableField).enabled, isFalse);
      saveGate.complete();
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(tableField).enabled, isNot(false));
      await tester.enterText(tableField, '07');
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(tableField).controller!.text, '07');
      expect(saved!['workingOrders'].single['table'], '07');
      expect(saved!['workingOrders'].single['lines'], isEmpty);
      final restored = CafeEngine.fromJson(saved!);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.pumpWidget(CafeDosApp(engine: restored, persist: persist));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(tableField).controller!.text, '07');
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('table field is protected during finalization', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final finalizeGate = Completer<void>();
    var blockFinalize = false;
    var blocked = false;
    Map<String, dynamic>? saved;
    Future<void> persist(CafeEngine engine) async {
      final snapshot =
          jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>;
      if (blockFinalize && (snapshot['orders'] as List).isNotEmpty) {
        blockFinalize = false;
        blocked = true;
        await finalizeGate.future;
      }
      saved = snapshot;
    }

    await tester.pumpWidget(
      CafeDosApp(engine: CafeEngine.sample(), persist: persist),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    final tableField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.labelText == 'Table number (optional)',
    );
    await tester.enterText(tableField, '04');
    await tester.pumpAndSettle();
    blockFinalize = true;
    await tester.tap(find.text('Create order'));
    await tester.pump();
    expect(blocked, isTrue, reason: 'Finalization should be in flight.');
    expect(tester.widget<TextField>(tableField).enabled, isFalse);
    finalizeGate.complete();
    await tester.pumpAndSettle();
    expect(saved!['orders'].single['id'], '24');
    expect(saved!['orders'].single['table'], '04');
    expect(tester.widget<TextField>(tableField).enabled, isNot(false));
    expect(tester.takeException(), isNull);
  });
  testWidgets('rapid table edits persist the latest value across restart', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final firstSave = Completer<void>();
    var holdFirst = true;
    Map<String, dynamic>? saved;
    Future<void> persist(CafeEngine engine) async {
      final snapshot =
          jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>;
      final orders = snapshot['workingOrders'] as List;
      if (holdFirst && orders.isNotEmpty && orders.first['table'] == '0') {
        holdFirst = false;
        await firstSave.future;
      }
      saved = snapshot;
    }

    await tester.pumpWidget(
      CafeDosApp(engine: CafeEngine.sample(), persist: persist),
    );
    await tester.pumpAndSettle();
    final tableField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.labelText == 'Table number (optional)',
    );
    await tester.enterText(tableField, '0');
    await tester.pump();
    expect(holdFirst, isFalse, reason: 'The first write should be in flight.');
    await tester.enterText(tableField, '04');
    await tester.pump();
    firstSave.complete();
    await tester.pumpAndSettle();
    expect(saved!['workingOrders'].single['table'], '04');
    final restored = CafeEngine.fromJson(saved!);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    await tester.pumpWidget(CafeDosApp(engine: restored, persist: persist));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(tableField).controller!.text, '04');
    expect(tester.takeException(), isNull);
  });
  testWidgets('a failed item save keeps the previous order and permits retry', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var failNext = false;
    Map<String, dynamic>? saved;
    await tester.pumpWidget(
      CafeDosApp(
        engine: CafeEngine.sample(),
        persist: (engine) async {
          if (failNext) {
            failNext = false;
            throw StateError('Storage unavailable');
          }
          saved =
              jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>;
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(saved!['workingOrders'].single['id'], '24');
    failNext = true;
    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    expect(saved!['workingOrders'].single['lines'], isEmpty);
    expect(find.text('Add to ticket'), findsOneWidget);
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    expect(
      saved!['workingOrders'].single['lines'].single['name'],
      'Iced Spanish Latte',
    );
    expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'numbered orders and items survive restart and finalize in either order',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1280, 900);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Map<String, dynamic>? saved;
      Future<void> persist(CafeEngine engine) async {
        saved = jsonDecode(jsonEncode(engine.toJson())) as Map<String, dynamic>;
      }

      await tester.pumpWidget(
        CafeDosApp(engine: CafeEngine.sample(), persist: persist),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Iced Spanish Latte').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to ticket'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New order'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Americano').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to ticket'));
      await tester.pumpAndSettle();

      final restored = CafeEngine.fromJson(saved!);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.pumpWidget(CafeDosApp(engine: restored, persist: persist));
      await tester.pumpAndSettle();
      expect(find.text('Order #24'), findsOneWidget);
      expect(find.text('Order #25'), findsOneWidget);
      expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);
      await tester.tap(find.text('Order #25'));
      await tester.pumpAndSettle();
      expect(find.text('1 × Americano'), findsOneWidget);
      await tester.tap(find.text('Create order'));
      await tester.pumpAndSettle();
      expect(saved!['orders'].single['id'], '25');
      await tester.tap(find.text('Order #24'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create order'));
      await tester.pumpAndSettle();
      expect((saved!['orders'] as List).map((order) => order['id']), [
        '25',
        '24',
      ]);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('phone keeps an unfinished ticket when switching drafts', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(375, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      CafeDosApp(engine: CafeEngine.sample(), persist: (_) async {}),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'initial phone layout');
    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'customization sheet');
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'menu with draft item');
    await tester.tap(find.text('New order'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'new draft');
    await tester.ensureVisible(find.text('Order #24'));
    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('View ticket'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'draft ticket');
    expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);
    expect(find.text('Create order').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('switching drafts preserves drinks, service type and table', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    CafeEngine? saved;
    await tester.pumpWidget(
      CafeDosApp(
        engine: CafeEngine.sample(),
        persist: (engine) async => saved = engine,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    final tableField = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.labelText == 'Table number (optional)',
    );
    await tester.enterText(tableField, '04');
    await tester.pumpAndSettle();

    await tester.tap(find.text('New order'));
    await tester.pumpAndSettle();
    expect(find.text('1 × Iced Spanish Latte'), findsNothing);
    await tester.tap(find.text('Takeout').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Americano').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);
    expect(find.text('1 × Americano'), findsNothing);
    expect(tester.widget<TextField>(tableField).controller!.text, '04');

    await tester.tap(find.text('Order #25'));
    await tester.pumpAndSettle();
    expect(find.text('1 × Americano'), findsOneWidget);
    expect(tableField, findsNothing);
    await tester.tap(find.text('Create order'));
    await tester.pumpAndSettle();
    expect(saved!.orders.single.dineIn, isFalse);
    expect(saved!.orders.single.lines.single.name, 'Americano');

    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);
    expect(tester.widget<TextField>(tableField).controller!.text, '04');
    expect(tester.takeException(), isNull);
  });

  testWidgets('closing a nonempty draft asks before discarding it', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      CafeDosApp(engine: CafeEngine.sample(), persist: (_) async {}),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Iced Spanish Latte').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add to ticket'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New order'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Close Order #24'));
    await tester.pumpAndSettle();
    expect(find.text('Remove this order?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    expect(find.text('1 × Iced Spanish Latte'), findsOneWidget);

    await tester.tap(find.byTooltip('Close Order #24'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove order'));
    await tester.pumpAndSettle();
    expect(find.text('Order #24'), findsNothing);
    expect(find.text('Order #25'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
