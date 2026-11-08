import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'connected_staff_test.dart' as support;

const _orderId = '01234567-89ab-4cde-8fab-0123456789ab';

class _ApprovalFixture {
  final requests = <Map<String, dynamic>>[];
  final approvals = <Map<String, dynamic>>[];
  late final HubClient client;
  bool loseResponse = false;
  bool unreadableResponse = false;
  bool discountAtPayment = false;
  final payments = <Map<String, dynamic>>[];
  final recordedPayments = <Map<String, dynamic>>[];
  int paidCentavos = 0;
  int discountCentavos = 0;
  int version = 1;
  final String role;
  bool ready = true, preparing = false;
  Map<String, dynamic>? cancellation;
  final dispositions = <Map<String, dynamic>>[];
  final refunds = <Map<String, dynamic>>[];
  final refundRequests = <Map<String, dynamic>>[];
  final payoutRequests = <Map<String, dynamic>>[];
  final commandOutcomes = <String, Map<String, dynamic>>{};
  Map<String, dynamic>? shift;
  bool losePayoutResponse = false;

  _ApprovalFixture({this.role = 'cashier'}) {
    client = HubClient(
      baseUri: Uri.parse('https://cafe.example'),
      client: MockClient((request) async {
        http.Response response(Object data) =>
            http.Response(jsonEncode(data), 200);
        switch (request.url.path) {
          case '/api/v1/auth/staff':
            return response({
              'token': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
              'expiresAt': 4102444800000,
              'actor': {
                'id': 'fixture-staff',
                'displayName': 'Fixture staff',
                'role': role,
                'branchId': 'branch-a',
              },
            });
          case '/api/v1/staff/context':
            return response({
              'modules': ['cashier'],
            });
          case '/api/v1/ingredients':
            return response({'ingredients': <Object>[]});
          case '/api/v1/products':
            return response({'products': <Object>[]});
          case '/api/v1/shifts/current':
            return response({'shift': shift});
          case '/api/v1/orders':
            return response({
              'orders':
                  role == 'barista' &&
                      request.url.queryParameters['status'] == 'active' &&
                      cancellation?['status'] == 'resolved'
                  ? <Object>[]
                  : [order],
            });
          case '/api/v1/orders/$_orderId':
            return response({'order': order});
          case '/api/v1/approvals':
            return response({'approvals': approvals.reversed.toList()});
          case '/api/v1/refunds':
            return response({'refunds': refunds.reversed.toList()});
          case '/api/v1/orders/$_orderId/refunds':
            final payload = Map<String, dynamic>.from(
              jsonDecode(request.body) as Map,
            );
            refundRequests.add(payload);
            refunds.add({
              'id': 'refund-${refunds.length + 1}',
              'orderId': _orderId,
              'orderNo': 24,
              'orderVersion': version,
              'requesterId': 'fixture-staff',
              'requesterName': 'Fixture staff',
              'requestedAt': 100,
              'amountCentavos': payload['amountCentavos'],
              'reason': payload['reason'],
              'status': 'pending',
              'decidedAt': null,
              'decisionReason': null,
              'lines': [
                {
                  'lineNo': 0,
                  'name': 'Fixture latte',
                  'quantity': 1,
                  'unitPriceCentavos': 16500,
                },
              ],
              'tenders': [
                {
                  'paymentId': 'cash-a',
                  'method': 'cash',
                  'amountCentavos': paidCentavos,
                  'reference': null,
                  'refundableCentavos': paidCentavos,
                },
              ],
              'legs': <Map<String, dynamic>>[],
            });
            return response({
              'commandId': payload['commandId'],
              'refund': refunds.last,
            });
          case '/api/v1/refunds/refund-1/legs/leg-a':
            final payload = Map<String, dynamic>.from(
              jsonDecode(request.body) as Map,
            );
            payoutRequests.add(payload);
            final leg = (refunds.first['legs'] as List).first as Map;
            leg['status'] = 'completed';
            leg['completedAt'] = 200;
            leg['version'] = (leg['version'] as int) + 1;
            if (losePayoutResponse) throw http.ClientException('Response lost');
            return response({
              'commandId': payload['commandId'],
              'refund': refunds.first,
            });
          case '/api/v1/orders/$_orderId/approvals':
            final payload = Map<String, dynamic>.from(
              jsonDecode(request.body) as Map,
            );
            requests.add(payload);
            approvals.add({
              'id': 'approval-${requests.length}',
              'orderId': _orderId,
              'orderNo': 24,
              'orderVersion': version,
              'action': payload['action'],
              'amountCentavos': payload['action'] == 'cancel'
                  ? 16500 - discountCentavos
                  : payload['amountCentavos'],
              'subtotalCentavos': 16500,
              'requesterId': 'fixture-staff',
              'requesterName': 'Fixture staff',
              'reason': payload['reason'],
              'requestedAt': 100,
              'status': 'pending',
              'decisionReason': null,
              'decidedAt': null,
              if (payload['action'] == 'cancel') ...{
                'requestedKitchenState': ready ? 'ready' : 'queued',
                'requestedPaymentState': paidCentavos > 0 ? 'paid' : 'unpaid',
                'collectedCentavos': paidCentavos,
                'pendingCentavos': 0,
                'cancellationStatus': null,
              },
            });
            if (loseResponse) throw http.ClientException('Response lost');
            return response({
              'commandId': payload['commandId'],
              'approval': unreadableResponse
                  ? {'status': 'pending'}
                  : approvals.last,
            });
          case '/api/v1/orders/$_orderId/prepare':
            preparing = true;
            version++;
            return response({
              'commandId': (jsonDecode(request.body) as Map)['commandId'],
              'order': order,
            });
          case '/api/v1/orders/$_orderId/cancellation/disposition':
            final payload = Map<String, dynamic>.from(
              jsonDecode(request.body) as Map,
            );
            dispositions.add(payload);
            cancellation!['status'] = 'resolved';
            cancellation!['outcome'] = payload['outcome'];
            cancellation!['dispositionNote'] = payload['note'];
            cancellation!['actualUsed'] = payload['used'];
            version++;
            return response({
              'commandId': payload['commandId'],
              'order': order,
            });
          case '/api/v1/orders/$_orderId/payments':
            final payload = Map<String, dynamic>.from(
              jsonDecode(request.body) as Map,
            );
            payments.add(payload);
            if (discountAtPayment) {
              discountAtPayment = false;
              discountCentavos = 1650;
              version++;
              commandOutcomes[payload['commandId'] as String] = {
                'commandId': payload['commandId'],
                'status': 'rejected',
                'action': 'order.payment',
                'rejectedAt': 100,
                'error': {
                  'code': 'conflict',
                  'message': 'The command conflicts with the accepted state.',
                },
              };
              return http.Response(
                jsonEncode({
                  'error': {'code': 'conflict'},
                }),
                409,
              );
            }
            final verified = payload['verified'] == true;
            final cash = payload['method'] == 'cash';
            final amount = payload['amountCentavos'] as int;
            final received = cash ? payload['cashReceivedCentavos'] as int : null;
            final payment = <String, dynamic>{
              'id': 'payment-${recordedPayments.length + 1}',
              'method': payload['method'],
              'amountCentavos': amount,
              'status': verified ? 'confirmed' : 'pending',
              'reference': cash ? null : (payload['reference'] as String).trim(),
              'cashReceivedCentavos': received,
              'changeCentavos': received == null ? null : received - amount,
            };
            recordedPayments.add(payment);
            if (verified) paidCentavos += amount;
            version++;
            return response({
              'commandId': payload['commandId'],
              'order': order,
              'payment': payment,
            });
          case '/api/v1/orders/$_orderId/payments/payment-1/verify':
            final payload = jsonDecode(request.body) as Map;
            final payment = recordedPayments.single;
            expect(payload['expectedVersion'], version);
            expect(payment['status'], 'pending');
            payment['status'] = 'confirmed';
            paidCentavos += payment['amountCentavos'] as int;
            version++;
            return response({
              'commandId': payload['commandId'],
              'order': order,
              'payment': payment,
            });
          default:
            if (request.url.path.startsWith('/api/v1/commands/')) {
              final outcome = commandOutcomes[request.url.pathSegments.last];
              if (outcome != null) return response(outcome);
              return response({
                'status': 'accepted',
                'commandId': request.url.pathSegments.last,
                'action': payoutRequests.isEmpty
                    ? 'approval.request'
                    : 'refund.leg.record_cash',
                'acceptedAt': 100,
              });
            }
            throw StateError('Unexpected fixture route ${request.url}');
        }
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
    'ready': ready,
    'preparing': preparing,
    'preparingAt': preparing ? 100 : null,
    'cancelled': cancellation != null,
    'cancellation': cancellation,
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
    'paymentState': paidCentavos == 16500 - discountCentavos
        ? 'paid'
        : recordedPayments.any((payment) => payment['status'] == 'pending')
        ? 'pending_verification'
        : paidCentavos > 0
        ? 'partially_paid'
        : 'unpaid',
    'hasPendingPayments': recordedPayments.any((payment) => payment['status'] == 'pending'),
    'kitchenState': 'ready',
    'subtotalCentavos': 16500,
    'discountCentavos': discountCentavos,
    'totalCentavos': 16500 - discountCentavos,
    'paidCentavos': paidCentavos,
    'refundedCentavos': refunds.fold<int>(
      0,
      (sum, refund) =>
          sum +
          (refund['legs'] as List)
              .where((leg) => leg['status'] == 'completed')
              .fold<int>(
                0,
                (subtotal, leg) => subtotal + (leg['amountCentavos'] as int),
              ),
    ),
    'payments': recordedPayments,
  };
}

Future<void> _selectOrder(
  WidgetTester tester,
  _ApprovalFixture fixture,
  Size size,
) async {
  support.viewport(tester, size);
  addTearDown(fixture.client.close);
  await support.mount(tester, fixture.client);
  await support.signIn(tester);
  if (size.width < 950) {
    await tester.tap(find.text('Ticket'));
    await tester.pumpAndSettle();
  }
  final savedOrder = find.text('Order #24 · ${fixture.order['paymentState']}');
  if (savedOrder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      savedOrder,
      160,
      scrollable: find
          .byWidgetPredicate(
            (widget) =>
                widget is Scrollable &&
                widget.axisDirection == AxisDirection.down,
          )
          .last,
    );
  }
  await tester.ensureVisible(savedOrder);
  await tester.tap(savedOrder);
  await tester.pumpAndSettle();
}

Future<void> _request(
  WidgetTester tester, {
  String amount = '16.50',
  String reason = 'Customer service adjustment',
}) async {
  await tester.ensureVisible(find.text('Request discount'));
  await tester.tap(find.text('Request discount'));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.widgetWithText(TextField, 'Discount amount (PHP)'),
    amount,
  );
  await tester.enterText(
    find.widgetWithText(TextField, 'Reason for discount'),
    reason,
  );
  await tester.tap(find.text('Send request'));
  await tester.pumpAndSettle();
}

Map<String, dynamic> _pendingCancellation() => {
  'approvalId': 'cancel-a',
  'reason': 'Customer cancelled',
  'status': 'awaiting_disposition',
  'cancelledAt': 100,
  'resolvedAt': null,
  'outcome': null,
  'dispositionNote': null,
  'actualUsed': <Object>[],
  'recipe': [
    {
      'ingredientId': 'beans',
      'name': 'Espresso beans',
      'unit': 'g',
      'quantityMilli': 18000,
    },
    {
      'ingredientId': 'milk',
      'name': 'Whole milk',
      'unit': 'ml',
      'quantityMilli': 200000,
    },
  ],
  'confirmedPaymentCentavos': 0,
  'pendingPaymentCentavos': 0,
};

void main() {
  testWidgets(
    'refund request binds zero-based item references and exact centavos',
    (tester) async {
      final fixture = _ApprovalFixture()..paidCentavos = 16500;
      await _selectOrder(tester, fixture, const Size(375, 667));
      if (find.text('Request refund').evaluate().isEmpty) {
        await tester.scrollUntilVisible(
          find.text('Request refund'),
          120,
          scrollable: find
              .byWidgetPredicate(
                (widget) =>
                    widget is Scrollable &&
                    widget.axisDirection == AxisDirection.down,
              )
              .last,
        );
      }
      await tester.ensureVisible(find.text('Request refund'));
      await tester.tap(find.text('Request refund'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(CheckboxListTile, 'Fixture latte'));
      await tester.enterText(
        find.widgetWithText(TextField, 'Refund amount (PHP)'),
        '50.25',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Reason for refund'),
        'Drink returned',
      );
      await tester.ensureVisible(find.text('Send refund request'));
      await tester.tap(find.text('Send refund request'));
      await tester.pumpAndSettle();
      expect(fixture.refundRequests.single['lineNumbers'], [0]);
      expect(fixture.refundRequests.single['amountCentavos'], 5025);
      expect(fixture.refundRequests.single['expectedVersion'], 1);
      expect(fixture.payoutRequests, isEmpty);
      expect(find.text('Refund awaiting approval'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('approved cash leg records once and recovers a lost response', (
    tester,
  ) async {
    final fixture = _ApprovalFixture()
      ..paidCentavos = 16500
      ..losePayoutResponse = true
      ..shift = {
        'id': 'shift-b',
        'drawerId': 'drawer-a',
        'status': 'open',
        'version': 1,
      };
    fixture.refunds.add({
      'id': 'refund-1',
      'orderId': _orderId,
      'orderNo': 24,
      'orderVersion': 1,
      'requesterId': 'another-cashier',
      'requesterName': 'Previous cashier',
      'requestedAt': 100,
      'amountCentavos': 5000,
      'reason': 'Customer adjustment',
      'status': 'approved',
      'decidedAt': 150,
      'decisionReason': null,
      'lines': [
        {
          'lineNo': 0,
          'name': 'Fixture latte',
          'quantity': 1,
          'unitPriceCentavos': 16500,
        },
      ],
      'tenders': [
        {
          'paymentId': 'cash-a',
          'method': 'cash',
          'amountCentavos': 16500,
          'reference': null,
          'refundableCentavos': 11500,
        },
      ],
      'legs': [
        {
          'id': 'leg-a',
          'paymentId': 'cash-a',
          'method': 'cash',
          'amountCentavos': 5000,
          'version': 1,
          'status': 'pending',
          'reference': null,
          'note': null,
          'completedAt': null,
        },
      ],
    });
    await _selectOrder(tester, fixture, const Size(1280, 800));
    await tester.ensureVisible(find.text('Record cash payout'));
    await tester.tap(find.text('Record cash payout'));
    await tester.pumpAndSettle();
    expect(find.textContaining('₱50.00'), findsWidgets);
    await tester.tap(find.text('Record cash handed back'));
    await tester.pumpAndSettle();
    expect(fixture.payoutRequests.single['action'], 'record_cash');
    expect(fixture.payoutRequests.single['expectedVersion'], 1);
    expect(find.text('Retry previous action'), findsOneWidget);
    await tester.tap(find.text('Retry previous action'));
    await tester.pumpAndSettle();
    expect(fixture.payoutRequests, hasLength(1));
    expect(find.text('Retry previous action'), findsNothing);
    expect(find.text('Refund completed'), findsOneWidget);
    if (find.text('Refunded ₱50.00').evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        find.text('Refunded ₱50.00'),
        -160,
        scrollable: find
            .byWidgetPredicate(
              (widget) =>
                  widget is Scrollable &&
                  widget.axisDirection == AxisDirection.down,
            )
            .last,
      );
    }
    expect(find.text('Refunded ₱50.00'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'station refreshes to the cancelled order without a manual refresh',
    (tester) async {
      support.viewport(tester, const Size(1280, 800));
      final fixture = _ApprovalFixture(role: 'barista')..ready = false;
      addTearDown(fixture.client.close);
      await support.mount(tester, fixture.client);
      await support.signIn(tester);
      await tester.tap(find.text('Start preparation'));
      await tester.pumpAndSettle();
      expect(fixture.preparing, isTrue);
      expect(find.text('Preparing'), findsOneWidget);
      fixture.cancellation = _pendingCancellation();
      fixture.preparing = false;
      fixture.version++;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('Cancelled. Stop preparation.'), findsOneWidget);
      expect(find.text('Resolve cancellation'), findsOneWidget);
      expect(find.text('Mark ready'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'paid cashier cancellation requests approval without reversing payment',
    (tester) async {
      final fixture = _ApprovalFixture()..paidCentavos = 16500;
      await _selectOrder(tester, fixture, const Size(1280, 800));
      await tester.ensureVisible(find.text('Request cancellation'));
      await tester.tap(find.text('Request cancellation'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Reason for cancellation'),
        'Customer cancelled',
      );
      await tester.tap(find.text('Send cancellation request'));
      await tester.pumpAndSettle();
      expect(fixture.requests.single['action'], 'cancel');
      expect(fixture.requests.single.containsKey('amountCentavos'), isFalse);
      expect(fixture.paidCentavos, 16500);
      expect(find.text('Cancellation awaiting approval'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'barista records two actual used ingredient quantities after cancellation',
    (tester) async {
      support.viewport(tester, const Size(375, 667));
      final fixture = _ApprovalFixture(role: 'barista')
        ..ready = false
        ..cancellation = _pendingCancellation();
      addTearDown(fixture.client.close);
      await support.mount(tester, fixture.client);
      await support.signIn(tester);
      expect(find.text('Mark ready'), findsNothing);
      expect(find.text('Start preparation'), findsNothing);
      await tester.tap(find.text('Resolve cancellation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ingredients used'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Espresso beans used (g)'),
        '8.25',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Whole milk used (ml)'),
        '85',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Disposition note'),
        'Disposed partly prepared drink',
      );
      await tester.ensureVisible(find.text('Record disposition'));
      await tester.tap(find.text('Record disposition'));
      await tester.pumpAndSettle();
      expect(fixture.dispositions.single['outcome'], 'used');
      expect(fixture.dispositions.single['used'], [
        {'ingredientId': 'beans', 'quantityMilli': 8250},
        {'ingredientId': 'milk', 'quantityMilli': 85000},
      ]);
      expect(find.text('Resolve cancellation'), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ready cancellation records disposition without another ingredient deduction',
    (tester) async {
      support.viewport(tester, const Size(1280, 800));
      final fixture = _ApprovalFixture(role: 'barista')
        ..cancellation = _pendingCancellation();
      addTearDown(fixture.client.close);
      await support.mount(tester, fixture.client);
      await support.signIn(tester);
      await tester.tap(find.text('Resolve cancellation'));
      await tester.pumpAndSettle();
      expect(find.text('Already consumed'), findsOneWidget);
      expect(find.text('Ingredients used'), findsNothing);
      await tester.enterText(
        find.widgetWithText(TextField, 'Disposition note'),
        'Drink disposed after cancellation',
      );
      await tester.tap(find.text('Record disposition'));
      await tester.pumpAndSettle();
      expect(fixture.dispositions.single['outcome'], 'already_consumed');
      expect(fixture.dispositions.single['used'], isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  for (final size in [const Size(375, 667), const Size(1280, 800)]) {
    testWidgets(
      'cashier requests exact cents on ready unpaid order at ${size.width}px',
      (tester) async {
        final fixture = _ApprovalFixture();
        await _selectOrder(tester, fixture, size);
        await _request(tester);
        expect(fixture.requests.single['amountCentavos'], 1650);
        expect(fixture.requests.single['expectedVersion'], 1);
        expect(
          fixture.requests.single['reason'],
          'Customer service adjustment',
        );
        expect(fixture.requests.single['action'], 'discount');
        expect(find.text('Discount awaiting approval'), findsOneWidget);
        expect(find.byType(AlertDialog), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('invalid discount remains in the dialog without posting', (
    tester,
  ) async {
    final fixture = _ApprovalFixture();
    await _selectOrder(tester, fixture, const Size(1280, 800));
    await _request(tester, amount: '165.00');
    expect(fixture.requests, isEmpty);
    expect(
      find.text(
        'Enter a discount greater than ₱0.00 and below the order total.',
      ),
      findsOneWidget,
    );
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'refresh applies manager decision and net balance to the selected ticket',
    (tester) async {
      final fixture = _ApprovalFixture();
      await _selectOrder(tester, fixture, const Size(1280, 800));
      await _request(tester);
      fixture.approvals.last['status'] = 'approved';
      fixture.discountCentavos = 1650;
      fixture.version++;
      await tester.tap(find.byTooltip('Refresh'));
      await tester.pumpAndSettle();
      expect(find.text('Discount approved'), findsOneWidget);
      expect(find.text('Subtotal ₱165.00'), findsOneWidget);
      expect(find.text('Discount −₱16.50'), findsOneWidget);
      expect(find.text('Total ₱148.50 · Paid ₱0.00'), findsOneWidget);
      expect(find.text('Request discount'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('lost approval response reconciles without another request', (
    tester,
  ) async {
    final fixture = _ApprovalFixture()..loseResponse = true;
    await _selectOrder(tester, fixture, const Size(1280, 800));
    await _request(tester);
    expect(fixture.requests, hasLength(1));
    expect(find.text('Retry previous action'), findsOneWidget);
    await tester.tap(find.text('Retry previous action'));
    await tester.pumpAndSettle();
    expect(fixture.requests, hasLength(1));
    expect(find.text('Retry previous action'), findsNothing);
    expect(find.text('Discount awaiting approval'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'unreadable accepted approval response retains its pending journal',
    (tester) async {
      final fixture = _ApprovalFixture()..unreadableResponse = true;
      await _selectOrder(tester, fixture, const Size(1280, 800));
      await _request(tester);
      expect(find.text('Retry previous action'), findsOneWidget);
      expect(
        find.textContaining('outcome of discount request is unknown'),
        findsOneWidget,
      );
      await tester.tap(find.text('Retry previous action'));
      await tester.pumpAndSettle();
      expect(fixture.requests, hasLength(1));
      expect(find.text('Discount awaiting approval'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'discount approved during checkout refreshes amount before payment retry',
    (tester) async {
      final fixture = _ApprovalFixture()..discountAtPayment = true;
      await _selectOrder(tester, fixture, const Size(1280, 800));
      await tester.ensureVisible(find.text('Take payment'));
      await tester.tap(find.text('Take payment'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm payment'));
      await tester.pumpAndSettle();
      expect(find.text('Remaining ₱148.50'), findsOneWidget);
      expect(find.text('Approved discount ₱16.50'), findsOneWidget);
      expect(fixture.payments, hasLength(1));
      await tester.tap(find.text('Confirm payment'));
      await tester.pumpAndSettle();
      expect(fixture.payments.last['amountCentavos'], 14850);
      expect(fixture.payments.last['expectedVersion'], 2);
      expect(find.text('Remaining ₱0.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('partially paid order does not offer a discount request', (
    tester,
  ) async {
    final fixture = _ApprovalFixture()..paidCentavos = 100;
    await _selectOrder(tester, fixture, const Size(1280, 800));
    expect(find.text('Request discount'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('external tender copy distinguishes recording from verification', (
    tester,
  ) async {
    final fixture = _ApprovalFixture();
    await _selectOrder(tester, fixture, const Size(1280, 800));
    await tester.tap(find.text('Take payment'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm payment'), findsOneWidget);
    await tester.tap(find.text('Cash'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('GCash').last);
    await tester.pumpAndSettle();

    final verification = find.text('I verified success in the merchant app or terminal');
    expect(find.text('Record pending payment'), findsOneWidget);
    await tester.tap(verification);
    await tester.pumpAndSettle();
    expect(find.text('Confirm payment'), findsOneWidget);
    await tester.tap(verification);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Merchant reference'),
      'GCASH-TEST-24',
    );
    await tester.tap(find.text('Record pending payment'));
    await tester.pumpAndSettle();

    expect(fixture.payments.single['verified'], isFalse);
    expect(fixture.paidCentavos, 0);
    expect(find.text('Remaining ₱165.00'), findsOneWidget);
    expect(find.text('Payment recorded. Merchant verification is pending.'), findsOneWidget);
    expect(find.text('Payment confirmed by the hub.'), findsNothing);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Record pending payment')).onPressed, isNull);

    await tester.ensureVisible(find.text('Verify pending payment'));
    await tester.tap(find.text('Verify pending payment'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('I verified success'));
    await tester.pumpAndSettle();
    expect(fixture.paidCentavos, 16500);
    expect(find.text('Remaining ₱0.00'), findsOneWidget);
    expect(find.text('Payment verification confirmed by the hub.'), findsOneWidget);
    expect(find.text('Payment recorded. Merchant verification is pending.'), findsNothing);
    expect(find.text('Return to cashier'), findsOneWidget);
  });
}
