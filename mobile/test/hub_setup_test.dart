import 'dart:convert';

import 'package:cafe_dos/connected/hub_setup.dart';
import 'package:cafe_dos/data/staff_recovery.dart';
import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class RetainedSetupStorage implements StaffRecoveryStorage {
  String? value;
  int writes = 0;
  @override
  bool get durable => true;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String data) async {
    writes++;
    value = data;
  }
}

void main() {
  testWidgets(
    'restored enrollment opens individual sign-in without requesting the device key again',
    (tester) async {
      final storage = RetainedSetupStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(
        StaffEnrollment(
          hubOrigin: Uri.parse('https://hub.example'),
          deviceId: 'tablet-a',
          deviceSecret: 'Fixture-Device-Key-At-Least32-Chars!',
        ),
      );
      final client = HubClient(baseUri: Uri.parse('https://hub.example'));
      await tester.pumpWidget(
        HubSetupApp(
          recoveryStore: StaffRecoveryStore(storage),
          clientFactory: (uri) {
            expect(uri.origin, 'https://hub.example');
            return client;
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Sign in'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Device key'), findsNothing);
      expect(client.session, isNull);
      expect(storage.writes, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'unreadable saved state blocks replacement enrollment without overwriting its bytes',
    (tester) async {
      final storage = RetainedSetupStorage()
        ..value = '{"version":99,"enrollment":null,"pending":null}';
      await tester.pumpWidget(
        HubSetupApp(recoveryStore: StaffRecoveryStore(storage)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Device recovery'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Device key'), findsNothing);
      await tester.tap(find.text('Retry saved state'));
      await tester.pumpAndSettle();
      expect(find.text('Device recovery'), findsOneWidget);
      expect(storage.writes, 0);
      expect(storage.value, contains('"version":99'));
    },
  );

  testWidgets(
    'first launch requires explicit hub enrollment without exposing a sample staff session',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(375, 667);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        HubSetupApp(
          recoveryStore: StaffRecoveryStore(MemoryStaffRecoveryStorage()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Connect to café hub'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Hub address'), findsOneWidget);
      expect(
        find.widgetWithText(TextField, 'Enrolled device ID'),
        findsOneWidget,
      );
      final secret = tester.widget<TextField>(
        find.widgetWithText(TextField, 'Device key'),
      );
      expect(secret.obscureText, isTrue);
      expect(find.text('Elina Gilbert'), findsNothing);
      await tester.ensureVisible(find.text('Connect'));
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Enter an HTTPS hub address and the enrolled device credentials.',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'setup rejects insecure LAN transport without sending credentials',
    (tester) async {
      await tester.pumpWidget(
        HubSetupApp(
          recoveryStore: StaffRecoveryStore(MemoryStaffRecoveryStorage()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Hub address'),
        'http://192.168.1.10:8787',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Enrolled device ID'),
        'tablet-a',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Device key'),
        'Fixture-Device-Key-At-Least32-Chars!',
      );
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Enter an HTTPS hub address and the enrolled device credentials.',
        ),
        findsOneWidget,
      );
      expect(find.text('Sign in'), findsNothing);
    },
  );

  testWidgets(
    'QR / pairing bundle claims one-time code, saves enrollment, and supports switching hub address or unpairing on sign-in screen',
    (tester) async {
      const authorityId = '11111111-2222-4333-8444-555555555555';
      const claimedSecret = 'Claimed-Device-Secret-Key-32-Chars!!';
      final storage = RetainedSetupStorage();
      final store = StaffRecoveryStore(storage, allowPrivateLanHttp: true);

      HubClient makeMockClient(Uri uri) => HubClient(
        baseUri: uri,
        allowPrivateLanHttp: true,
        client: MockClient((request) async {
          if (request.method == 'POST' &&
              request.url.path == '/api/v1/devices/pair/claim') {
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            expect(body['pairingCode'], 'ABCD-2345');
            return http.Response(
              jsonEncode({
                'enrollment': {
                  'authorityId': authorityId,
                  'branchId': 'b1',
                  'deviceId': 'tablet-paired-1',
                  'deviceSecret': claimedSecret,
                  'hubOrigin': uri.origin,
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/hub-info') {
            return http.Response(
              jsonEncode({
                'authorityId': authorityId,
                'branchId': 'b1',
                'displayName': 'KAPE DOZ Main',
                'schemaVersion': 20,
                'status': 'ready',
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
      );

      await tester.pumpWidget(
        HubSetupApp(recoveryStore: store, clientFactory: makeMockClient),
      );
      await tester.pumpAndSettle();

      final qrBundle = jsonEncode({
        'type': 'kape-doz-pair-v1',
        'hubOrigin': 'http://192.168.1.50:8787',
        'authorityId': authorityId,
        'branchId': 'b1',
        'deviceId': 'tablet-paired-1',
        'pairingCode': 'ABCD-2345',
      });
      await tester.ensureVisible(
        find.widgetWithText(TextField, 'Pairing code or QR bundle'),
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Pairing code or QR bundle'),
        qrBundle,
      );
      await tester.ensureVisible(find.text('Pair with code'));
      await tester.tap(find.text('Pair with code'));
      await tester.pumpAndSettle();

      // Transitions directly to Staff sign-in with connected hub banner
      expect(find.text('Sign in'), findsOneWidget);
      expect(
        find.textContaining(
          'Hub: http://192.168.1.50:8787 · Device: tablet-paired-1',
        ),
        findsOneWidget,
      );

      // Switch hub address to a new LAN IP with the same authorityId
      await tester.tap(find.text('Switch hub address'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'New hub address'),
        'http://192.168.1.88:8787',
      );
      await tester.tap(find.text('Verify & switch'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining(
          'Hub: http://192.168.1.88:8787 · Device: tablet-paired-1',
        ),
        findsOneWidget,
      );
      expect(
        (await store.load()).enrollment!.hubOrigin.origin,
        'http://192.168.1.88:8787',
      );

      // Unpair device returns to HubSetupApp
      await tester.tap(find.text('Unpair device'));
      await tester.pumpAndSettle();
      expect(find.text('Connect to café hub'), findsOneWidget);
      expect((await store.load()).enrollment, isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'pairingOnlyLogin mode shows only Pairing code input and automatically signs into the assigned role',
    (tester) async {
      const authorityId = '11111111-2222-4333-8444-555555555555';
      const claimedSecret = 'Claimed-Device-Secret-Key-32-Chars!!';
      const sessionToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      final storage = RetainedSetupStorage();
      final store = StaffRecoveryStore(storage, allowPrivateLanHttp: true);

      HubClient makeMockClient(Uri uri) => HubClient(
        baseUri: uri,
        allowPrivateLanHttp: true,
        client: MockClient((request) async {
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/hub-info') {
            return http.Response(
              jsonEncode({
                'authorityId': authorityId,
                'branchId': 'b1',
                'displayName': 'KAPE DOZ Main',
                'schemaVersion': 20,
                'status': 'ready',
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'POST' &&
              request.url.path == '/api/v1/devices/pair/claim') {
            final body = jsonDecode(request.body) as Map<String, dynamic>;
            expect(body['pairingCode'], 'JHB7-5HT2');
            return http.Response(
              jsonEncode({
                'enrollment': {
                  'authorityId': authorityId,
                  'branchId': 'b1',
                  'deviceId': 'janus-cashier-1',
                  'deviceSecret': claimedSecret,
                  'hubOrigin': uri.origin,
                  'session': {
                    'token': sessionToken,
                    'expiresAt':
                        DateTime.now().millisecondsSinceEpoch + 3600000,
                    'actor': {
                      'id': 'staffCashier',
                      'displayName': 'Staff Cashier',
                      'role': 'cashier',
                      'branchId': 'b1',
                    },
                  },
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/ingredients') {
            return http.Response(
              jsonEncode({'ingredients': []}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/products') {
            return http.Response(
              jsonEncode({'products': []}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' && request.url.path == '/api/v1/orders') {
            return http.Response(
              jsonEncode({'orders': []}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/shifts/current') {
            return http.Response(
              jsonEncode({'shift': null}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/approvals') {
            return http.Response(
              jsonEncode({'approvals': []}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path == '/api/v1/refunds') {
            return http.Response(
              jsonEncode({'refunds': []}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'POST' &&
              request.url.path == '/api/v1/auth/logout') {
            return http.Response('', 204);
          }
          return http.Response('{}', 404);
        }),
      );

      await tester.pumpWidget(
        HubSetupApp(
          recoveryStore: store,
          clientFactory: makeMockClient,
          pairingOnlyLogin: true,
        ),
      );
      await tester.pumpAndSettle();

      // Only Pairing code input and Sign in button are displayed
      expect(find.widgetWithText(TextField, 'Pairing code'), findsOneWidget);
      expect(find.text('Sign in'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Account ID'), findsNothing);
      expect(find.widgetWithText(TextField, 'PIN'), findsNothing);
      expect(find.widgetWithText(TextField, 'Hub address'), findsNothing);
      expect(find.widgetWithText(TextField, 'Device key'), findsNothing);

      // Enter pairing code and tap Sign in -> auto-logs in as Staff Cashier
      await tester.enterText(
        find.widgetWithText(TextField, 'Pairing code'),
        'JHB7-5HT2',
      );
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Cashier'), findsOneWidget);
      expect(find.byTooltip('Sign out'), findsOneWidget);

      // Sign out returns to Pairing-Code-Only login screen
      await tester.tap(find.byTooltip('Sign out'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Pairing code'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Account ID'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
