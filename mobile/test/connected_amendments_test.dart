import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'connected_staff_test.dart' as support;

const _orderId = '01234567-89ab-4cde-8fab-0123456789ab';

class _AmendmentFixture {
  final String role;
  final bool paid;
  bool preparing = false;
  bool malformedResponse = false;
  int version = 2;
  Map<String, dynamic>? amendment;
  final commands = <Map<String, dynamic>>[];
  late final HubClient client;

  _AmendmentFixture({this.role = 'cashier', this.paid = false}) {
    client = HubClient(
      baseUri: Uri.parse('https://cafe.example'),
      client: MockClient((request) async {
        http.Response response(Object value) =>
            http.Response(jsonEncode(value), 200);
        final path = request.url.path;
        if (path.startsWith('/api/v1/commands/')) {
          return response({
            'commandId': path.split('/').last,
            'status': 'accepted',
            'action': 'order.amendment.request',
            'acceptedAt': 110,
          });
        }
        if (path.contains('/amendments')) {
          final payload = jsonDecode(request.body) as Map<String, dynamic>;
          commands.add(payload);
          if (path.endsWith('/acknowledge')) {
            amendment = {
              ...amendment!,
              'status': 'resolved',
              'appliedAt': 110,
              'resolvedAt': 110,
              'dispositionNote': payload['note'],
            };
            version++;
          } else {
            final operation = payload['operation'] as String;
            final after = switch (operation) {
              'quantity' => {...line, 'quantity': payload['quantity']},
              'note' => {...line, 'note': payload['note']},
              _ => throw StateError('Unexpected fixture operation $operation'),
            };
            final needsApproval =
                operation == 'quantity' && (payload['quantity'] as int) < 2;
            amendment = change(
              orderVersion: version,
              operation: operation,
              status: needsApproval ? 'awaiting_approval' : 'awaiting_station',
              after: after,
              reason: payload['reason'] as String,
              appliedAt: needsApproval || preparing ? null : 105,
            );
            if (!needsApproval) version++;
          }
          return response({
            'commandId': payload['commandId'],
            'amendment': malformedResponse
                ? {...amendment!, 'orderId': 'other-order'}
                : amendment,
          });
        }
        final result = switch (request.url.path) {
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
          '/api/v1/ingredients' => {'ingredients': <Object>[]},
          '/api/v1/products' => {
            'products': [
              {'id': 'tea', 'name': 'Fixture tea', 'priceCentavos': 8500},
            ],
          },
          '/api/v1/shifts/current' => {'shift': null},
          '/api/v1/orders' => {
            'orders': [order],
          },
          '/api/v1/orders/$_orderId' => {'order': order},
          '/api/v1/approvals' => {'approvals': <Object>[]},
          '/api/v1/refunds' => {'refunds': <Object>[]},
          _ => throw StateError('Unexpected fixture route ${request.url.path}'),
        };
        return response(result);
      }),
    );
  }

  Map<String, dynamic> get order => {
    'id': _orderId,
    'orderNo': 24,
    'version': version,
    'dineIn': true,
    'table': '04',
    'released': true,
    'ready': false,
    'preparing': preparing,
    'cancelled': false,
    'lines': [line],
    'amendment': amendment,
    'paymentState': paid ? 'paid' : 'unpaid',
    'kitchenState': preparing ? 'preparing' : 'queued',
    if (role == 'cashier') ...{
      'discountCentavos': 0,
      'totalCentavos': 33000,
      'paidCentavos': paid ? 33000 : 0,
      'payments': <Object>[],
    },
  };

  Map<String, dynamic> get line => {
    'lineNo': 0,
    'productId': 'latte',
    'name': 'Fixture latte',
    'quantity': 2,
    if (role == 'cashier') 'unitPriceCentavos': 16500,
    'note': 'Less sweet',
  };

  Map<String, dynamic> change({
    required int orderVersion,
    required String operation,
    required Map<String, dynamic> after,
    String status = 'awaiting_station',
    String reason = 'Customer changed preference',
    int? appliedAt,
    bool needsDisposition = false,
    List<Map<String, dynamic>> recipe = const [],
  }) => {
    'id': 'amendment-a',
    'orderId': _orderId,
    'orderNo': 24,
    'orderVersion': orderVersion,
    'operation': operation,
    'status': status,
    'before': line,
    'after': after,
    'reason': reason,
    'decisionReason': null,
    'requestedAt': 100,
    'appliedAt': appliedAt,
    'resolvedAt': null,
    'needsDisposition': needsDisposition,
    'recipe': recipe,
    'dispositionNote': null,
  };
}

Future<void> _selectOrder(
  WidgetTester tester,
  _AmendmentFixture fixture,
) async {
  support.viewport(tester, const Size(1280, 800));
  addTearDown(fixture.client.close);
  await support.mount(tester, fixture.client);
  await support.signIn(tester);
  final savedOrder = find.text('Order #24 · ${fixture.order['paymentState']}');
  await tester.ensureVisible(savedOrder);
  await tester.tap(savedOrder);
  await tester.pumpAndSettle();
}

Finder _field(String label) => find.widgetWithText(TextField, label);

Future<void> _choose(WidgetTester tester, String current, String choice) async {
  await tester.ensureVisible(find.text(current));
  await tester.tap(find.text(current));
  await tester.pumpAndSettle();
  await tester.tap(find.text(choice).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('queued cashier ticket opens its sent-order amendment form', (
    tester,
  ) async {
    final fixture = _AmendmentFixture();
    await _selectOrder(tester, fixture);
    await tester.tap(find.text('Change sent order'));
    await tester.pumpAndSettle();
    expect(find.text('Change sent order · Order #24'), findsOneWidget);
    expect(find.text('Change type'), findsOneWidget);
  });

  testWidgets('paid cashier ticket explains the correction path', (
    tester,
  ) async {
    final fixture = _AmendmentFixture(paid: true);
    await _selectOrder(tester, fixture);
    await tester.tap(find.text('Change sent order'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('manager-approved cancellation or refund'),
      findsOneWidget,
    );
    expect(find.text('Change type'), findsNothing);
    await tester.enterText(_field('Preparation note'), 'No sweetener');
    await tester.enterText(
      _field('Reason for change'),
      'Customer changed preference',
    );
    await tester.tap(find.text('Send change to bar'));
    await tester.pumpAndSettle();
    expect(fixture.commands.single['operation'], 'note');
    expect(find.text('Total ₱330.00 · Paid ₱330.00'), findsOneWidget);
  });

  testWidgets('decreasing quantity requests review without sending a price', (
    tester,
  ) async {
    final fixture = _AmendmentFixture();
    await _selectOrder(tester, fixture);
    await tester.tap(find.text('Change sent order'));
    await tester.pumpAndSettle();
    await _choose(tester, 'Change preparation note', 'Change quantity');
    await tester.enterText(_field('Quantity'), '1');
    await tester.enterText(
      _field('Reason for change'),
      'Customer only wants one',
    );
    await tester.tap(find.text('Send for approval'));
    await tester.pumpAndSettle();
    final command = {...fixture.commands.single}..remove('commandId');
    expect(command, {
      'operation': 'quantity',
      'expectedVersion': 2,
      'lineNo': 0,
      'quantity': 1,
      'reason': 'Customer only wants one',
    });
    expect(find.text('Change awaiting manager approval'), findsOneWidget);
  });

  testWidgets('staged price change blocks payment pending station review', (
    tester,
  ) async {
    final fixture = _AmendmentFixture()..preparing = true;
    fixture.version = 3;
    fixture.amendment = fixture.change(
      orderVersion: 2,
      operation: 'quantity',
      after: {...fixture.line, 'quantity': 1},
    );
    await _selectOrder(tester, fixture);
    expect(
      find.text('The station must review the order change before payment.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Take payment'),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets(
    'station reviews changed notes and records measured waste before Ready',
    (tester) async {
      final fixture = _AmendmentFixture(role: 'barista')..preparing = true;
      fixture.version = 4;
      fixture.amendment = fixture.change(
        orderVersion: 3,
        operation: 'note',
        after: {...fixture.line, 'note': 'No sweetener'},
        needsDisposition: true,
        recipe: [
          {
            'ingredientId': 'syrup',
            'name': 'Vanilla syrup',
            'unit': 'ml',
            'quantityMilli': 16000,
          },
        ],
      );
      support.viewport(tester, const Size(375, 812));
      addTearDown(fixture.client.close);
      await support.mount(tester, fixture.client);
      await support.signIn(tester);
      expect(find.text('Mark ready'), findsNothing);
      await tester.tap(find.text('Review order change'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Less sweet'), findsWidgets);
      expect(find.textContaining('No sweetener'), findsOneWidget);
      await _choose(tester, 'Preparation disposition', 'Ingredients discarded');
      await tester.ensureVisible(_field('Vanilla syrup discarded (ml)'));
      await tester.enterText(_field('Vanilla syrup discarded (ml)'), '4.5');
      await tester.ensureVisible(_field('Disposition note'));
      await tester.enterText(
        _field('Disposition note'),
        'Discarded syrup from affected drink',
      );
      await tester.tap(find.text('Acknowledge change'));
      await tester.pumpAndSettle();
      final command = {...fixture.commands.single}..remove('commandId');
      expect(command, {
        'expectedVersion': 4,
        'used': [
          {'ingredientId': 'syrup', 'quantityMilli': 4500},
        ],
        'note': 'Discarded syrup from affected drink',
      });
      expect(find.text('Review order change'), findsNothing);
      expect(find.text('Mark ready'), findsOneWidget);
    },
  );

  testWidgets(
    'mismatched mutation response keeps the journal until the exact receipt is recovered',
    (tester) async {
      final fixture = _AmendmentFixture()..malformedResponse = true;
      await _selectOrder(tester, fixture);
      await tester.tap(find.text('Change sent order'));
      await tester.pumpAndSettle();
      await tester.enterText(_field('Preparation note'), 'No sweetener');
      await tester.enterText(
        _field('Reason for change'),
        'Customer changed preference',
      );
      await tester.tap(find.text('Send change to bar'));
      await tester.pumpAndSettle();
      expect(find.text('Retry previous action'), findsOneWidget);
      expect(fixture.commands, hasLength(1));
      await tester.tap(find.text('Retry previous action'));
      await tester.pumpAndSettle();
      expect(fixture.commands, hasLength(1));
      expect(find.text('Retry previous action'), findsNothing);
      expect(
        find.text('Change sent to bar. Awaiting acknowledgment.'),
        findsOneWidget,
      );
    },
  );
}
