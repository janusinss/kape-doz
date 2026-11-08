import 'dart:convert';

import 'package:cafe_dos/connected/staff_app.dart';
import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const _requestId = '11111111-2222-4333-8444-555555555555';

HubClient hubFixture({
  required String role,
  List<String>? calls,
  bool expiredPayment = false,
}) {
  return HubClient(
    baseUri: Uri.parse('https://cafe.example'),
    client: MockClient((request) async {
      calls?.add('${request.method} ${request.url.path}');
      http.Response response(Object body, [int status = 200]) => http.Response(
        jsonEncode(body),
        status,
        headers: {'content-type': 'application/json'},
      );
      final actor = {
        'id': 'fixture-staff',
        'displayName': 'Fixture staff',
        'role': role,
        'branchId': 'branch-a',
      };
      if (request.url.path == '/api/v1/auth/staff') {
        final credentials = jsonDecode(request.body) as Map;
        if (credentials['pin'] != '4826') {
          return response({
            'error': {
              'code': 'unauthorized',
              'message': 'Invalid credentials or session.',
            },
            'requestId': _requestId,
          }, 401);
        }
        expect(credentials['deviceId'], 'tablet-a');
        expect(
          credentials['deviceSecret'],
          'Fixture-Device-Secret-32-Characters',
        );
        return response({
          'token': _token,
          'expiresAt': 4102444800000,
          'actor': actor,
        });
      }
      expect(request.headers['authorization'], 'Bearer $_token');
      if (request.url.path == '/api/v1/auth/logout') {
        return http.Response('', 204);
      }
      if (expiredPayment && request.url.path.endsWith('/payments')) {
        return response({
          'error': {
            'code': 'unauthorized',
            'message': 'Invalid credentials or session.',
          },
          'requestId': _requestId,
        }, 401);
      }
      return response(switch (request.url.path) {
        '/api/v1/staff/context' => {
          'actor': actor,
          'branchId': 'branch-a',
          'modules': role == 'cashier' ? ['cashier'] : ['station', 'waste'],
        },
        '/api/v1/products' => {'products': <Object>[]},
        '/api/v1/ingredients' => {'ingredients': <Object>[]},
        '/api/v1/approvals' => {'approvals': <Object>[]},
        '/api/v1/refunds' => {'refunds': <Object>[]},
        '/api/v1/orders' => {
          'orders': expiredPayment
              ? [
                  {
                    'id': '01234567-89ab-4cde-8fab-0123456789ab',
                    'orderNo': 24,
                    'version': 1,
                    'dineIn': true,
                    'table': '04',
                    'released': true,
                    'ready': false,
                    'lines': [
                      {
                        'productId': 'latte',
                        'name': 'Fixture latte',
                        'quantity': 1,
                        'unitPriceCentavos': 16500,
                        'note': 'Less sweet',
                      },
                    ],
                    'paymentState': 'unpaid',
                    'kitchenState': 'released',
                    'totalCentavos': 16500,
                    'paidCentavos': 0,
                    'payments': <Object>[],
                  },
                ]
              : <Object>[],
        },
        '/api/v1/shifts/current' => {'shift': null},
        _ => {
          'error': {'code': 'not_found', 'message': 'Resource not found.'},
        },
      });
    }),
  );
}

Future<void> signIn(WidgetTester tester, {String pin = '4826'}) async {
  final account = find.widgetWithText(TextField, 'Account ID');
  final pinField = find.widgetWithText(TextField, 'PIN');
  expect(account, findsOneWidget);
  expect(pinField, findsOneWidget);
  await tester.enterText(account, 'fixture-staff');
  await tester.enterText(pinField, pin);
  await tester.ensureVisible(find.text('Sign in'));
  await tester.tap(find.text('Sign in'));
  await tester.pumpAndSettle();
}

void viewport(WidgetTester tester, Size size) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> mount(WidgetTester tester, HubClient client) async {
  await tester.pumpWidget(
    ConnectedStaffApp(
      client: client,
      deviceId: 'tablet-a',
      deviceSecret: 'Fixture-Device-Secret-32-Characters',
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final size in [const Size(375, 667), const Size(1280, 800)]) {
    testWidgets(
      'connected cashier uses server role at ${size.width.toInt()}px without barista navigation',
      (tester) async {
        viewport(tester, size);
        final client = hubFixture(role: 'cashier');
        addTearDown(client.close);
        await mount(tester, client);
        expect(tester.takeException(), isNull);
        await signIn(tester);
        expect(client.session!.actor.role, HubRole.cashier);
        expect(find.text('Cashier'), findsWidgets);
        expect(find.text('Station'), findsNothing);
        expect(find.text('Waste'), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'connected barista uses only station and waste at ${size.width.toInt()}px',
      (tester) async {
        viewport(tester, size);
        final calls = <String>[];
        final client = hubFixture(role: 'barista', calls: calls);
        addTearDown(client.close);
        await mount(tester, client);
        await signIn(tester);
        expect(client.session!.actor.role, HubRole.barista);
        expect(find.text('Station'), findsWidgets);
        expect(find.text('Waste'), findsWidgets);
        expect(find.text('Cashier'), findsNothing);
        expect(calls, isNot(contains('GET /api/v1/shifts/current')));
        expect(calls, isNot(contains('GET /api/v1/refunds')));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'wrong staff PIN remains on sign-in with a readable error and no local session',
    (tester) async {
      viewport(tester, const Size(375, 667));
      final calls = <String>[];
      final client = hubFixture(role: 'cashier', calls: calls);
      addTearDown(client.close);
      await mount(tester, client);
      await signIn(tester, pin: '9999');
      expect(client.session, isNull);
      expect(find.text('Sign in'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Account ID'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'PIN'), findsOneWidget);
      expect(
        find.widgetWithText(TextField, 'Manager pairing code'),
        findsOneWidget,
      );
      expect(find.textContaining('Sign in again'), findsWidgets);
      expect(calls, ['POST /api/v1/auth/staff']);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'expired payment session closes the order dialog and returns to sign-in',
    (tester) async {
      viewport(tester, const Size(1280, 800));
      final calls = <String>[];
      final client = hubFixture(
        role: 'cashier',
        calls: calls,
        expiredPayment: true,
      );
      addTearDown(client.close);
      await mount(tester, client);
      await signIn(tester);
      final savedOrder = find.text('Order #24 · unpaid');
      await tester.ensureVisible(savedOrder);
      await tester.pumpAndSettle();
      await tester.tap(savedOrder);
      await tester.pumpAndSettle();
      final takePayment = find.text('Take payment');
      await tester.ensureVisible(takePayment);
      await tester.pumpAndSettle();
      await tester.tap(takePayment);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.tap(find.text('Confirm payment'));
      await tester.pumpAndSettle();
      expect(client.session, isNull);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Sign in'), findsOneWidget);
      expect(find.textContaining('Fixture latte'), findsNothing);
      expect(
        calls,
        contains(
          'POST /api/v1/orders/01234567-89ab-4cde-8fab-0123456789ab/payments',
        ),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'sign-out revokes the session and returns the connected client to sign-in',
    (tester) async {
      viewport(tester, const Size(1280, 800));
      final calls = <String>[];
      final client = hubFixture(role: 'cashier', calls: calls);
      addTearDown(client.close);
      await mount(tester, client);
      await signIn(tester);
      final logout = find.byTooltip('Sign out');
      expect(logout, findsOneWidget);
      await tester.tap(logout);
      await tester.pumpAndSettle();
      expect(client.session, isNull);
      expect(find.text('Sign in'), findsOneWidget);
      expect(calls, contains('POST /api/v1/auth/logout'));
      expect(tester.takeException(), isNull);
    },
  );
}
