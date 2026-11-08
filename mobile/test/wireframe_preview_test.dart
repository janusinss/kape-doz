import 'package:cafe_dos/admin/admin_app.dart';
import 'package:cafe_dos/staff_wireframe/staff_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void useViewport(WidgetTester tester, double width) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 900);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('staff order tabs keep each service type and table', (
    tester,
  ) async {
    useViewport(tester, 1280);
    await tester.pumpWidget(const StaffWireframeApp());
    await tester.pumpAndSettle();
    final table = find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.labelText == 'Table number',
    );
    await tester.enterText(table, '04');
    await tester.tap(find.text('Order #25'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Takeout'));
    await tester.pumpAndSettle();
    expect(table, findsNothing);
    await tester.tap(find.text('Order #24'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(table).controller!.text, '04');
    await tester.tap(find.text('Order #25'));
    await tester.pumpAndSettle();
    expect(table, findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('wide staff preview shows six barista tickets', (tester) async {
    useViewport(tester, 1280);
    await tester.pumpWidget(const StaffWireframeApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Barista station').first);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('barista-order-card')).hitTestable(),
      findsNWidgets(6),
    );
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Waste').first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  for (final width in [375.0, 768.0, 1280.0]) {
    testWidgets('admin screens remain navigable at ${width.toInt()} pixels', (
      tester,
    ) async {
      useViewport(tester, width);
      await tester.pumpWidget(const AdminWireframeApp());
      await tester.pumpAndSettle();

      const headings = {
        'Sales': 'Sales & margin',
        'Recipes': 'Recipes & raw materials',
        'Inventory': 'Inventory & thresholds',
        'Customers': 'Customers',
        'Settings': 'Settings & migration',
      };
      for (final entry in headings.entries) {
        final label = entry.key;
        final destination = find.text(label).first;
        await tester.ensureVisible(destination);
        await tester.tap(destination);
        await tester.pumpAndSettle();
        expect(
          find.text(entry.value),
          findsWidgets,
          reason: '$label screen at $width',
        );
        final error = tester.takeException();
        expect(error, isNull, reason: '$label at $width');
      }
    });
  }
}
