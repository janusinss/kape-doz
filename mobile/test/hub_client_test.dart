import 'dart:async';
import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const commandId = 'a1b2c3d4-5678-4abc-8def-0123456789ab';
const orderId = '01234567-89ab-4cde-8fab-0123456789ab';
const requestId = '11111111-2222-4333-8444-555555555555';

http.Response jsonResponse(Object? body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, Object?> sessionBody({String role = 'cashier'}) => {
  'token': token,
  'expiresAt': 4102444800000,
  'actor': {
    'id': 'fixture-account',
    'displayName': 'Fixture account',
    'role': role,
    'branchId': 'branch-a',
  },
};

Future<void> staffLogin(HubClient hub) => hub.loginStaff(
  accountId: 'fixture-account',
  pin: '4826',
  deviceId: 'tablet-a',
  deviceSecret: 'Fixture-Tablet-Secret-32-Characters',
);

Map<String, dynamic> tender({
  String id = 'payment-a',
  String method = 'gcash',
  int amount = 6500,
  String status = 'pending',
  String? reference = 'MERCHANT-01',
  int? received,
  int? change,
}) => {
  'id': id,
  'method': method,
  'amountCentavos': amount,
  'status': status,
  'reference': reference,
  'cashReceivedCentavos': received,
  'changeCentavos': change,
};

Map<String, dynamic> cashTender({int received = 20000, int change = 10000}) =>
    tender(
      id: 'payment-cash',
      method: 'cash',
      amount: 10000,
      status: 'confirmed',
      reference: null,
      received: received,
      change: change,
    );

Map<String, dynamic> paymentAcknowledgment(
  Map<String, dynamic> payment, {
  int version = 2,
  int total = 16500,
  bool cancelled = false,
  List<Map<String, dynamic>> otherPayments = const [],
  Map<String, dynamic> orderOverrides = const {},
}) {
  final payments = [payment, ...otherPayments];
  final paid = payments
      .where((entry) => entry['status'] == 'confirmed')
      .fold(0, (sum, entry) => sum + (entry['amountCentavos'] as int));
  final pending = payments.any((entry) => entry['status'] == 'pending');
  return {
    'commandId': commandId,
    'payment': payment,
    'order': {
      'id': orderId,
      'orderNo': 24,
      'version': version,
      'totalCentavos': total,
      'paidCentavos': paid,
      'paymentState': paid >= total
          ? 'paid'
          : pending
          ? 'pending_verification'
          : paid > 0
          ? 'partially_paid'
          : 'unpaid',
      'hasPendingPayments': pending,
      'dineIn': false,
      'released': !cancelled && paid >= total,
      'cancelled': cancelled,
      'payments': payments,
      ...orderOverrides,
    },
  };
}

void main() {
  test(
    'unreadable refund acknowledgements preserve an unknown mutation outcome',
    () async {
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient(
          (request) async => request.url.path.endsWith('/auth/staff')
              ? jsonResponse(sessionBody())
              : jsonResponse({
                  'commandId': commandId,
                  'refund': {'id': 'refund-a'},
                }),
        ),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      for (final path in [
        '/api/v1/orders/$orderId/refunds',
        '/api/v1/refunds/refund-a/legs/leg-a',
      ]) {
        await expectLater(
          hub.mutate(
            path,
            commandId: commandId,
            expectedVersion: 1,
            payload: path.endsWith('/refunds')
                ? {
                    'amountCentavos': 2500,
                    'lineNumbers': [0],
                    'reason': 'Returned item',
                  }
                : {'action': 'record_cash'},
          ),
          throwsA(
            isA<HubException>().having(
              (error) => error.outcomeUnknown,
              'unknown outcome',
              isTrue,
            ),
          ),
        );
      }
    },
  );

  test(
    'late admin read cannot return privileged data after switching to staff',
    () async {
      final started = Completer<void>();
      final response = Completer<http.Response>();
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/admin')) {
            return jsonResponse(sessionBody(role: 'owner'));
          }
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          started.complete();
          return response.future;
        }),
      );
      addTearDown(hub.close);
      await hub.loginAdmin(
        accountId: 'fixture-account',
        password: 'Fixture-Admin-Password!',
      );
      final expectation = expectLater(
        hub.adminContext(),
        throwsA(
          isA<HubException>()
              .having((error) => error.code, 'code', 'session_changed')
              .having((error) => error.outcomeUnknown, 'read outcome', isFalse),
        ),
      );
      await started.future;
      await staffLogin(hub);
      response.complete(jsonResponse({'privateAdminValue': 12345}));
      await expectation;
      expect(hub.session!.actor.role, HubRole.cashier);
    },
  );

  test(
    'session change during a mutation response stream prevents delivery and preserves unknown outcome',
    () async {
      final bodyReading = Completer<void>();
      final releaseBody = Completer<void>();
      Stream<List<int>> delayedBody() async* {
        yield utf8.encode('{"commandId":"$commandId",');
        bodyReading.complete();
        await releaseBody.future;
        yield utf8.encode('"shift":{"id":"accepted-shift","version":1}}');
      }

      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient.streaming((request, body) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return http.StreamedResponse(
              Stream.value(utf8.encode(jsonEncode(sessionBody()))),
              200,
            );
          }
          return http.StreamedResponse(delayedBody(), 200);
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      final expectation = expectLater(
        hub.openShift(commandId: commandId, openingCashCentavos: 100000),
        throwsA(
          isA<HubException>()
              .having((error) => error.code, 'code', 'session_changed')
              .having(
                (error) => error.outcomeUnknown,
                'mutation may already be accepted',
                isTrue,
              ),
        ),
      );
      await bodyReading.future;
      hub.clearSession();
      await staffLogin(hub);
      releaseBody.complete();
      await expectation;
      expect(hub.session!.actor.role, HubRole.cashier);
    },
  );

  test('late logout response cannot clear a newer signed-in session', () async {
    final started = Completer<void>();
    final response = Completer<http.Response>();
    final hub = HubClient(
      baseUri: Uri.parse('https://cafe.example'),
      client: MockClient((request) async {
        if (request.url.path.endsWith('/auth/staff')) {
          return jsonResponse(sessionBody());
        }
        started.complete();
        return response.future;
      }),
    );
    addTearDown(hub.close);
    await staffLogin(hub);
    final expectation = expectLater(
      hub.logout(),
      throwsA(
        isA<HubException>()
            .having((error) => error.code, 'code', 'session_changed')
            .having((error) => error.outcomeUnknown, 'logout outcome', isTrue),
      ),
    );
    await started.future;
    await staffLogin(hub);
    response.complete(http.Response('', 204));
    await expectation;
    expect(hub.session!.actor.role, HubRole.cashier);
  });

  test(
    'late 401 retains its authentication classification without clearing a newer session',
    () async {
      final started = Completer<void>();
      final response = Completer<http.Response>();
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          started.complete();
          return response.future;
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      final expectation = expectLater(
        hub.products(),
        throwsA(
          isA<HubException>()
              .having((error) => error.code, 'code', 'unauthorized')
              .having((error) => error.status, 'status', 401),
        ),
      );
      await started.future;
      await staffLogin(hub);
      response.complete(
        jsonResponse({
          'error': {
            'code': 'unauthorized',
            'message': 'Invalid credentials or session.',
          },
          'requestId': requestId,
        }, 401),
      );
      await expectation;
      expect(hub.session!.actor.role, HubRole.cashier);
    },
  );

  test(
    'HTTPS is required and insecure development access is limited to explicit loopback',
    () {
      for (final value in [
        'http://cafe.example',
        'http://192.168.1.10',
        'https://user:password@cafe.example',
        'https://cafe.example/prefix',
        'https://cafe.example?token=secret',
        'https://cafe.example#fragment',
      ]) {
        expect(() => HubClient(baseUri: Uri.parse(value)), throwsArgumentError);
      }
      expect(
        () => HubClient(baseUri: Uri.parse('http://127.0.0.1')),
        throwsArgumentError,
      );
      for (final host in ['127.0.0.1', 'localhost', '[::1]']) {
        final hub = HubClient(
          baseUri: Uri.parse('http://$host:8080'),
          allowInsecureLoopback: true,
        );
        hub.close();
      }
      expect(
        () => HubClient(
          baseUri: Uri.parse('http://cafe.example'),
          allowInsecureLoopback: true,
        ),
        throwsArgumentError,
      );
    },
  );

  test(
    'staff session is parsed from the hub and authorizes only subsequent requests',
    () async {
      final requests = <http.Request>[];
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          requests.add(request);
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          return jsonResponse({
            'actor': sessionBody()['actor'],
            'modules': ['cashier'],
            'branchId': 'branch-a',
          });
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      expect(hub.session!.actor.role, HubRole.cashier);
      expect(hub.session!.actor.branchId, 'branch-a');
      expect(hub.session!.expiresAt, 4102444800000);
      expect(requests.single.headers['authorization'], isNull);
      expect(jsonDecode(requests.single.body), {
        'accountId': 'fixture-account',
        'pin': '4826',
        'deviceId': 'tablet-a',
        'deviceSecret': 'Fixture-Tablet-Secret-32-Characters',
      });
      await hub.staffContext();
      expect(requests.last.headers['authorization'], 'Bearer $token');
      expect(requests.last.followRedirects, isFalse);
      expect(hub.session.toString(), isNot(contains(token)));
    },
  );

  test('admin login uses the separate route and password contract', () async {
    late http.Request sent;
    final hub = HubClient(
      baseUri: Uri.parse('https://cafe.example'),
      client: MockClient((request) async {
        sent = request;
        return jsonResponse(sessionBody(role: 'manager'));
      }),
    );
    addTearDown(hub.close);
    await hub.loginAdmin(
      accountId: 'fixture-account',
      password: 'Fixture-Admin-Password!',
    );
    expect(sent.url.path, '/api/v1/auth/admin');
    expect(jsonDecode(sent.body), {
      'accountId': 'fixture-account',
      'password': 'Fixture-Admin-Password!',
    });
    expect(hub.session!.actor.role, HubRole.manager);
  });

  test(
    'malformed or wrong-realm sessions never become authenticated local sessions',
    () async {
      for (final bad in [
        {
          'token': token,
          'expiresAt': 4102444800000,
          'actor': {'role': 'owner'},
        },
        {...sessionBody(), 'token': 'not-a-session-token'},
        {...sessionBody(), 'expiresAt': 'tomorrow'},
        {...sessionBody(), 'credential': 'must-not-be-retained'},
        sessionBody(role: 'owner'),
      ]) {
        final hub = HubClient(
          baseUri: Uri.parse('https://cafe.example'),
          client: MockClient((_) async => jsonResponse(bad)),
        );
        await expectLater(
          staffLogin(hub),
          throwsA(
            isA<HubException>().having(
              (e) => e.code,
              'code',
              'invalid_response',
            ),
          ),
        );
        expect(hub.session, isNull);
        hub.close();
      }
    },
  );

  test(
    '401 clears the memory session and subsequent protected calls stay local',
    () async {
      var calls = 0;
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          calls++;
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          return jsonResponse({
            'error': {'code': 'unauthorized', 'message': 'not trusted'},
            'requestId': requestId,
          }, 401);
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      await expectLater(
        hub.products(),
        throwsA(isA<HubException>().having((e) => e.status, 'status', 401)),
      );
      expect(hub.session, isNull);
      await expectLater(
        hub.products(),
        throwsA(
          isA<HubException>().having((e) => e.code, 'code', 'unauthorized'),
        ),
      );
      expect(calls, 2);
    },
  );

  test(
    'logout clears memory even when server revocation outcome is unknown',
    () async {
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          throw http.ClientException(
            'transport includes $token and private URL',
          );
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      await expectLater(
        hub.logout(),
        throwsA(
          isA<HubException>().having(
            (e) => e.outcomeUnknown,
            'unknown outcome',
            isTrue,
          ),
        ),
      );
      expect(hub.session, isNull);
    },
  );

  test(
    'explicit mutation retries preserve caller command ID and never retry automatically',
    () async {
      final requests = <http.Request>[];
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          requests.add(request);
          if (requests.length == 1) {
            throw http.ClientException('lost after send');
          }
          return jsonResponse({
            'commandId': commandId,
            'order': {'id': orderId},
          });
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      Future<Map<String, dynamic>> send() => hub.sendOrder(
        orderId: orderId,
        commandId: commandId,
        expectedVersion: 3,
      );
      await expectLater(
        send(),
        throwsA(
          isA<HubException>().having(
            (e) => e.outcomeUnknown,
            'unknown outcome',
            isTrue,
          ),
        ),
      );
      expect(requests, hasLength(1));
      await send();
      expect(requests, hasLength(2));
      expect(requests[0].body, requests[1].body);
      expect(jsonDecode(requests[1].body), {
        'commandId': commandId,
        'expectedVersion': 3,
      });
    },
  );

  test(
    'timeouts are safe and leave mutation outcome explicitly unknown without replay',
    () async {
      var mutations = 0;
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        timeout: const Duration(milliseconds: 10),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          mutations++;
          await Future<void>.delayed(const Duration(milliseconds: 50));
          return jsonResponse({'commandId': commandId});
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      await expectLater(
        hub.openShift(commandId: commandId, openingCashCentavos: 100000),
        throwsA(
          isA<HubException>()
              .having((e) => e.code, 'code', 'timeout')
              .having((e) => e.outcomeUnknown, 'unknown outcome', isTrue),
        ),
      );
      expect(mutations, 1);
    },
  );

  test(
    'redirects are rejected without forwarding the bearer token to another origin',
    () async {
      var protectedCalls = 0;
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          protectedCalls++;
          expect(request.url.origin, 'https://cafe.example');
          expect(request.followRedirects, isFalse);
          return http.Response(
            '',
            302,
            headers: {'location': 'https://outside.example/steal'},
          );
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      await expectLater(
        hub.products(),
        throwsA(
          isA<HubException>().having((e) => e.code, 'code', 'redirect_blocked'),
        ),
      );
      expect(protectedCalls, 1);
    },
  );

  test(
    'remote errors and malformed success bodies do not expose raw HTML or secrets',
    () async {
      var scenario = 0;
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          scenario++;
          if (scenario == 1) {
            return jsonResponse({
              'error': {
                'code': 'conflict',
                'message': '<html>password=$token</html>',
              },
              'requestId': requestId,
            }, 409);
          }
          if (scenario == 2) {
            return http.Response('<html>password=$token</html>', 502);
          }
          return http.Response('<html>$token</html>', 200);
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      try {
        await hub.products();
        fail('Expected conflict');
      } on HubException catch (error) {
        expect(error.code, 'conflict');
        expect(error.requestId, requestId);
        expect(error.toString(), isNot(contains(token)));
        expect(error.toString(), isNot(contains('<html>')));
      }
      await expectLater(
        hub.products(),
        throwsA(isA<HubException>().having((e) => e.status, 'status', 502)),
      );
      await expectLater(
        hub.products(),
        throwsA(
          isA<HubException>().having((e) => e.code, 'code', 'invalid_response'),
        ),
      );
    },
  );

  test(
    'absolute, traversal and unsupported routes cannot receive authentication headers',
    () async {
      var calls = 0;
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((_) async {
          calls++;
          return jsonResponse(sessionBody());
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      for (final path in [
        'https://outside.example/api/v1/orders',
        '//outside.example/api/v1/orders',
        '/api/v1/../orders',
        '/api/v1/orders?token=x',
        '/api/v1/unknown',
      ]) {
        await expectLater(
          hub.mutate(path, commandId: commandId),
          throwsArgumentError,
        );
      }
      await expectLater(
        hub.mutate(
          '/api/v1/orders',
          commandId: commandId,
          payload: {'commandId': 'replace'},
        ),
        throwsArgumentError,
      );
      expect(calls, 1);
    },
  );

  test(
    'operational read wrappers preserve route, status filter and nullable current shift',
    () async {
      final routes = <String>[];
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          routes.add(
            request.url.path +
                (request.url.hasQuery ? '?${request.url.query}' : ''),
          );
          return jsonResponse(switch (request.url.path) {
            '/api/v1/products' => {
              'products': [
                {'id': 'latte'},
              ],
            },
            '/api/v1/ingredients' => {
              'ingredients': [
                {'id': 'beans'},
              ],
            },
            '/api/v1/orders' => {
              'orders': [
                {'id': orderId},
              ],
            },
            '/api/v1/shifts/current' => {'shift': null},
            _ => {
              'order': {'id': orderId},
            },
          });
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      expect((await hub.products()).single['id'], 'latte');
      expect((await hub.ingredients()).single['id'], 'beans');
      expect((await hub.orders(status: 'ready')).single['id'], orderId);
      expect((await hub.order(orderId))['id'], orderId);
      expect(await hub.currentShift(), isNull);
      expect(routes, [
        '/api/v1/products',
        '/api/v1/ingredients',
        '/api/v1/orders?status=ready',
        '/api/v1/orders/$orderId',
        '/api/v1/shifts/current',
      ]);
    },
  );

  test(
    'service mutation wrappers use the authoritative payment, shift, waste and receipt contracts',
    () async {
      final sent = <http.Request>[];
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return jsonResponse(sessionBody());
          }
          sent.add(request);
          return jsonResponse(switch (request.url.path) {
            '/api/v1/orders/$orderId/payments' => paymentAcknowledgment(
              cashTender(),
              version: 4,
            ),
            '/api/v1/orders/$orderId/payments/payment-a/verify' =>
              paymentAcknowledgment(
                tender(status: 'confirmed'),
                version: 5,
                otherPayments: [cashTender()],
              ),
            '/api/v1/orders/$orderId/payments/payment-a/reject' =>
              paymentAcknowledgment(
                tender(status: 'rejected'),
                version: 6,
                otherPayments: [cashTender()],
              ),
            _ => {'commandId': commandId},
          });
        }),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
      await hub.createOrder(
        commandId: commandId,
        dineIn: true,
        table: '04',
        items: [
          {'productId': 'latte', 'quantity': 1},
        ],
      );
      await hub.openShift(commandId: commandId, openingCashCentavos: 100000);
      await hub.submitCount(
        shiftId: orderId,
        commandId: commandId,
        expectedVersion: 2,
        countedCashCentavos: 110000,
        note: 'Blind count',
      );
      await hub.addPayment(
        orderId: orderId,
        commandId: commandId,
        expectedVersion: 3,
        method: 'cash',
        amountCentavos: 10000,
        verified: true,
        cashReceivedCentavos: 20000,
      );
      await hub.verifyPayment(
        orderId: orderId,
        paymentId: 'payment-a',
        commandId: commandId,
        expectedVersion: 4,
      );
      await hub.rejectPayment(
        orderId: orderId,
        paymentId: 'payment-a',
        commandId: commandId,
        expectedVersion: 5,
        reason: 'Not confirmed',
      );
      await hub.markReady(
        orderId: orderId,
        commandId: commandId,
        expectedVersion: 6,
      );
      await hub.logWaste(
        commandId: commandId,
        ingredientId: 'beans',
        quantityMilli: 18000,
        reason: 'Dial-in',
      );
      await hub.requestReceipt(
        orderId: orderId,
        commandId: commandId,
        expectedVersion: 7,
      );
      expect(sent.map((r) => r.url.path), [
        '/api/v1/orders',
        '/api/v1/shifts/open',
        '/api/v1/shifts/$orderId/submit-count',
        '/api/v1/orders/$orderId/payments',
        '/api/v1/orders/$orderId/payments/payment-a/verify',
        '/api/v1/orders/$orderId/payments/payment-a/reject',
        '/api/v1/orders/$orderId/ready',
        '/api/v1/waste',
        '/api/v1/orders/$orderId/receipt',
      ]);
      for (final request in sent) {
        expect(jsonDecode(request.body)['commandId'], commandId);
        expect(request.method, 'POST');
      }
      expect(jsonDecode(sent[3].body), {
        'commandId': commandId,
        'expectedVersion': 3,
        'method': 'cash',
        'amountCentavos': 10000,
        'verified': true,
        'cashReceivedCentavos': 20000,
      });
      expect(jsonDecode(sent[4].body), {
        'commandId': commandId,
        'expectedVersion': 4,
      });
      expect(jsonDecode(sent[7].body)['quantityMilli'], 18000);
    },
  );

  group('Payment acknowledgment', () {
    late HubClient hub;
    late Map<String, dynamic> reply;
    final uncertain = throwsA(
      isA<HubException>()
          .having((e) => e.code, 'code', 'invalid_response')
          .having((e) => e.outcomeUnknown, 'unknown outcome', isTrue),
    );

    setUp(() async {
      hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient(
          (request) async => jsonResponse(
            request.url.path.endsWith('/auth/staff') ? sessionBody() : reply,
          ),
        ),
      );
      addTearDown(hub.close);
      await staffLogin(hub);
    });

    Future<Map<String, dynamic>> addMerchant({
      String method = 'gcash',
      bool verified = false,
      String reference = ' MERCHANT-01 ',
    }) => hub.addPayment(
      orderId: orderId,
      commandId: commandId,
      expectedVersion: 1,
      method: method,
      amountCentavos: 6500,
      reference: reference,
      verified: verified,
    );

    Future<Map<String, dynamic>> verify() => hub.verifyPayment(
      orderId: orderId,
      paymentId: 'payment-a',
      commandId: commandId,
      expectedVersion: 1,
    );

    Future<Map<String, dynamic>> reject() => hub.rejectPayment(
      orderId: orderId,
      paymentId: 'payment-a',
      commandId: commandId,
      expectedVersion: 1,
      reason: 'No merchant confirmation',
    );

    test(
      'confirmed external payment remains valid when a disabled item holds release',
      () async {
        const heldLine = {'lineNo': 0, 'productId': 'latte', 'name': 'Latte'};
        reply = paymentAcknowledgment(
          tender(status: 'confirmed'),
          otherPayments: [cashTender()],
          orderOverrides: {
            'released': false,
            'lines': [heldLine],
            'unavailableLines': [heldLine],
          },
        );
        expect(await verify(), reply);
        for (final invalid in [
          <String, dynamic>{},
          {'unavailableLines': <Object>[]},
          {'unavailableLines': null},
        ]) {
          reply = paymentAcknowledgment(
            tender(status: 'confirmed'),
            otherPayments: [cashTender()],
            orderOverrides: {
              'released': false,
              'lines': [heldLine],
              ...invalid,
            },
          );
          await expectLater(verify(), uncertain);
        }
      },
    );

    test(
      'accepts pending GCash and immediately verified card tenders',
      () async {
        reply = paymentAcknowledgment(tender(), otherPayments: [cashTender()]);
        expect(await addMerchant(), reply);
        reply = paymentAcknowledgment(
          tender(method: 'card', status: 'confirmed'),
          otherPayments: [cashTender()],
        );
        expect(await addMerchant(method: 'card', verified: true), reply);
        reply = paymentAcknowledgment(tender(reference: '\u0085MERCHANT-01'));
        expect(await addMerchant(reference: ' \u0085MERCHANT-01\uFEFF'), reply);
      },
    );

    test(
      'retains recovery for a create reply that differs from the sent tender',
      () async {
        final badTenders = [
          tender(method: 'card'),
          tender(amount: 6501),
          tender(reference: 'MERCHANT-02'),
          tender(status: 'confirmed'),
          tender()..remove('changeCentavos'),
        ];
        for (final payment in badTenders) {
          reply = paymentAcknowledgment(payment);
          await expectLater(addMerchant(), uncertain, reason: '$payment');
        }

        for (final payment in [
          cashTender(received: 19000, change: 9000),
          cashTender(change: 9999),
        ]) {
          reply = paymentAcknowledgment(payment);
          await expectLater(
            hub.addPayment(
              orderId: orderId,
              commandId: commandId,
              expectedVersion: 1,
              method: 'cash',
              amountCentavos: 10000,
              verified: true,
              cashReceivedCentavos: 20000,
            ),
            uncertain,
            reason: '$payment',
          );
        }
      },
    );

    test(
      'retains recovery for an incomplete or inconsistent order projection',
      () async {
        final payment = tender();
        for (final body in [
          {'commandId': commandId},
          paymentAcknowledgment(payment)..['commandId'] = requestId,
          paymentAcknowledgment(payment, version: 3),
          for (final overrides in <Map<String, dynamic>>[
            {'id': requestId},
            {'payments': []},
            {
              'payments': [payment, payment],
            },
            {
              'payments': [tender(reference: 'MERCHANT-02')],
            },
            {'paidCentavos': 6500},
            {'hasPendingPayments': false},
            {'paymentState': 'paid'},
            {'released': true},
            {'cancelled': true},
          ])
            paymentAcknowledgment(payment, orderOverrides: overrides),
        ]) {
          reply = body;
          await expectLater(addMerchant(), uncertain, reason: '$body');
        }
      },
    );

    test(
      'binds verify and reject to the requested tender and terminal state',
      () async {
        reply = paymentAcknowledgment(
          tender(status: 'confirmed'),
          otherPayments: [cashTender()],
          total: 15000,
          cancelled: true,
        );
        expect(await verify(), reply);
        reply = paymentAcknowledgment(tender(status: 'rejected'));
        expect(await reject(), reply);

        for (final operation in [
          (call: verify, status: 'confirmed'),
          (call: reject, status: 'rejected'),
        ]) {
          for (final payment in [
            tender(id: 'payment-b', status: operation.status),
            tender(),
            tender(
              status: operation.status == 'confirmed'
                  ? 'rejected'
                  : 'confirmed',
            ),
            cashTender()..['id'] = 'payment-a',
          ]) {
            reply = paymentAcknowledgment(payment);
            await expectLater(operation.call(), uncertain, reason: '$payment');
          }
        }
      },
    );
  });
}
