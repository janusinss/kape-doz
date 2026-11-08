import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'connected_staff_test.dart' as support;

const _id = '01234567-89ab-4cde-8fab-0123456789ab';

class _Fixture {
  final String role;
  final bool saved;
  final bool missingRecipe;
  final bool unavailable;
  bool sent = false, ready = false;
  int version = 1;
  final calls = <String>[];
  late final HubClient client;

  _Fixture({
    this.role = 'cashier',
    this.saved = true,
    this.missingRecipe = false,
    this.unavailable = false,
  }) {
    client = HubClient(
      baseUri: Uri.parse('https://cafe.example'),
      client: MockClient((request) async {
        final path = request.url.path;
        calls.add('${request.method} $path');
        http.Response response(Object value) =>
            http.Response(jsonEncode(value), 200);
        if (request.method == 'POST' && !path.endsWith('/auth/staff')) {
          final input = jsonDecode(request.body) as Map;
          if (path.endsWith('/send')) sent = true;
          if (path.endsWith('/ready')) ready = true;
          version++;
          return response({'commandId': input['commandId'], 'order': order});
        }
        return response(switch (path) {
          '/api/v1/auth/staff' => {
            'token': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            'expiresAt': 4102444800000,
            'actor': {
              'id': 'fixture-staff',
              'displayName': 'Fixture staff',
              'role': role,
              'branchId': 'branch-a',
            },
          },
          '/api/v1/staff/context' => {
            'modules': role == 'cashier' ? ['cashier'] : ['station', 'waste'],
          },
          '/api/v1/ingredients' => {
            'ingredients': [
              {
                'id': 'beans',
                'name': 'Espresso beans',
                'unit': 'g',
                'onHandMilli': 30000,
                'reservedMilli': 10000,
              },
              {
                'id': 'milk',
                'name': 'Whole milk',
                'unit': 'ml',
                'onHandMilli': 150000,
                'reservedMilli': 0,
              },
            ],
          },
          '/api/v1/products' => {
            'products': [
              {
                'id': 'latte',
                'name': 'Fixture latte',
                'priceCentavos': 16500,
                if (unavailable) ...{
                  'available': false,
                  'availabilityVersion': 2,
                },
                if (!missingRecipe)
                  'recipe': [
                    {'ingredientId': 'beans', 'quantityMilli': 18000},
                    {'ingredientId': 'milk', 'quantityMilli': 150000},
                  ],
              },
              {
                'id': 'espresso',
                'name': 'Fixture espresso',
                'priceCentavos': 9000,
                'recipe': [
                  {'ingredientId': 'beans', 'quantityMilli': 9000},
                ],
              },
            ],
          },
          '/api/v1/orders' => {
            'orders': saved ? [order] : <Object>[],
          },
          '/api/v1/orders/$_id' => {'order': order},
          '/api/v1/approvals' => {'approvals': <Object>[]},
          '/api/v1/refunds' => {'refunds': <Object>[]},
          '/api/v1/shifts/current' => {'shift': null},
          _ => throw StateError('Unexpected fixture route $path'),
        });
      }),
    );
  }

  Map<String, dynamic> get order => {
    'id': _id,
    'orderNo': 24,
    'version': version,
    'dineIn': true,
    'table': '04',
    'released': sent || role == 'barista',
    'ready': ready,
    'cancelled': false,
    'preparing': false,
    'paymentState': 'unpaid',
    'kitchenState': ready ? 'ready' : 'queued',
    'lines': [
      {
        'lineNo': 0,
        'productId': 'latte',
        'name': 'Fixture latte',
        'quantity': 1,
        'unitPriceCentavos': 16500,
        'note': '',
      },
    ],
    if (unavailable && role == 'cashier')
      'unavailableLines': [
        {'lineNo': 0, 'productId': 'latte', 'name': 'Fixture latte'},
      ],
    'shortages': ready
        ? <Object>[]
        : [
            {
              'ingredientId': 'beans',
              'name': 'Espresso beans',
              'unit': 'g',
              'requiredMilli': 18000,
              'availableMilli': 10000,
              'shortfallMilli': 8000,
            },
          ],
    if (role == 'cashier') ...{
      'totalCentavos': 16500,
      'paidCentavos': 0,
      'payments': <Object>[],
      'discountCentavos': 0,
    },
  };
}

Future<void> _mount(WidgetTester tester, _Fixture fixture, Size size) async {
  support.viewport(tester, size);
  addTearDown(fixture.client.close);
  await support.mount(tester, fixture.client);
  await support.signIn(tester);
}

Finder _verticalScroll() => find
    .byWidgetPredicate(
      (widget) =>
          widget is Scrollable && widget.axisDirection == AxisDirection.down,
    )
    .last;

Future<void> _reveal(
  WidgetTester tester,
  Finder target, {
  double delta = 180,
}) async {
  if (target.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      target,
      delta,
      scrollable: _verticalScroll(),
    );
  }
  await Scrollable.ensureVisible(tester.element(target), alignment: 0.5);
  await tester.pump();
}

Future<void> _tap(WidgetTester tester, Finder target) async {
  await _reveal(tester, target);
  final buttons = find.ancestor(
    of: target,
    matching: find.byWidgetPredicate(
      (widget) =>
          widget is FilledButton ||
          widget is OutlinedButton ||
          widget is TextButton,
    ),
  );
  final hit = buttons.evaluate().isEmpty ? target : buttons.first;
  await Scrollable.ensureVisible(tester.element(hit), alignment: 0.5);
  await tester.pump();
  await tester.tap(hit);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('disabled catalog items are visible but cannot be added', (
    tester,
  ) async {
    final fixture = _Fixture(saved: false, unavailable: true);
    await _mount(tester, fixture, const Size(1280, 800));
    final card = find
        .ancestor(
          of: find.text('Fixture latte'),
          matching: find.byType(OutlinedButton),
        )
        .first;
    expect(tester.widget<OutlinedButton>(card).onPressed, isNull);
    expect(find.text('Unavailable'), findsOneWidget);
  });

  testWidgets('held order offers replacement while preventing send', (
    tester,
  ) async {
    final fixture = _Fixture(unavailable: true);
    await _mount(tester, fixture, const Size(1280, 800));
    await _tap(tester, find.text('Order #24 · unpaid'));
    await _reveal(tester, find.text('Replace'));
    expect(find.textContaining('Replace it before sending'), findsOneWidget);
    final send = find.widgetWithText(OutlinedButton, 'Send to bar');
    await _reveal(tester, send);
    expect(tester.widget<OutlinedButton>(send).onPressed, isNull);
    await _tap(tester, find.text('Replace'));
    expect(find.text('Replace Fixture latte'), findsOneWidget);
    expect(find.text('Replacement item'), findsOneWidget);
  });

  testWidgets('incomplete cached recipe shows a nonblocking stock notice', (
    tester,
  ) async {
    final fixture = _Fixture(saved: false, missingRecipe: true);
    await _mount(tester, fixture, const Size(1280, 800));
    await _tap(tester, find.text('Fixture latte'));
    await _tap(tester, find.text('Add to order'));
    expect(
      find.text('Stock availability unavailable. Refresh to check stock.'),
      findsOneWidget,
    );
    final create = find.widgetWithText(FilledButton, 'Create order');
    await _reveal(tester, create);
    expect(tester.widget<FilledButton>(create).onPressed, isNotNull);
  });
  for (final size in [const Size(375, 667), const Size(1280, 800)]) {
    testWidgets(
      'cart aggregates recipes against available stock at ${size.width}',
      (tester) async {
        final fixture = _Fixture(saved: false);
        await _mount(tester, fixture, size);
        await _tap(tester, find.text('Fixture latte'));
        await _tap(tester, find.text('Add to order'));
        await _tap(tester, find.text('Fixture espresso'));
        await tester.tap(find.byTooltip('Increase quantity'));
        await _tap(tester, find.text('Add to order'));
        if (size.width < 900) await _tap(tester, find.text('Ticket'));
        expect(find.text('Recorded stock is short'), findsOneWidget);
        expect(find.text('Espresso beans: short 16 g'), findsOneWidget);
        expect(find.textContaining('Whole milk: short'), findsNothing);
        final create = find.widgetWithText(FilledButton, 'Create order');
        await _reveal(tester, create);
        expect(tester.widget<FilledButton>(create).onPressed, isNotNull);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'cashier warning permits sending and opening payment at ${size.width}',
      (tester) async {
        final fixture = _Fixture();
        await _mount(tester, fixture, size);
        if (size.width < 900) await _tap(tester, find.text('Ticket'));
        await _tap(tester, find.text('Order #24 · unpaid'));
        await _reveal(
          tester,
          find.text('Espresso beans: short 8 g'),
          delta: -180,
        );
        expect(find.text('Espresso beans: short 8 g'), findsOneWidget);
        await _tap(tester, find.text('Send to bar'));
        expect(fixture.calls, contains('POST /api/v1/orders/$_id/send'));
        await _tap(tester, find.text('Take payment'));
        expect(find.text('Payment · Order #24'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('barista warning permits Ready at ${size.width}', (
      tester,
    ) async {
      final fixture = _Fixture(role: 'barista');
      await _mount(tester, fixture, size);
      expect(find.text('Espresso beans: short 8 g'), findsOneWidget);
      await _tap(tester, find.text('Mark ready'));
      expect(fixture.calls, contains('POST /api/v1/orders/$_id/ready'));
      expect(tester.takeException(), isNull);
    });
  }
}
