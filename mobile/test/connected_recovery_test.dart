import 'dart:async';
import 'dart:convert';

import 'package:cafe_dos/connected/staff_app.dart';
import 'package:cafe_dos/data/hub_client.dart';
import 'package:cafe_dos/data/staff_recovery.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _secret = 'Recovery-Fixture-Device-Secret-32!';
const _token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const _requestId = '11111111-2222-4333-8444-555555555555';
final _origin = Uri.parse('https://hub.example');

class _Storage implements StaffRecoveryStorage {
  String? bytes;
  bool failWrite = false;
  bool failClear = false;
  bool failRead = false;
  int writes = 0;
  Completer<void>? blockNextPendingWrite;
  bool pendingWriteBlocked = false;
  @override
  bool get durable => true;
  @override
  Future<String?> read() async {
    if (failRead) throw StateError('Private read error: $_secret');
    return bytes;
  }

  @override
  Future<void> write(String value) async {
    writes++;
    if (failWrite) throw StateError('Private storage error: $_secret');
    final nextPending = (jsonDecode(value) as Map)['pending'];
    if (failClear &&
        bytes != null &&
        (jsonDecode(bytes!) as Map)['pending'] != null &&
        nextPending == null) {
      throw StateError('Private cleanup error: $_secret');
    }
    final blocker = blockNextPendingWrite;
    if (nextPending != null && blocker != null) {
      blockNextPendingWrite = null;
      pendingWriteBlocked = true;
      await blocker.future;
      pendingWriteBlocked = false;
    }
    bytes = value;
  }
}

class _HubFixture {
  final requests = <http.Request>[];
  String accountId = 'cashier-a';
  String status = 'unrecorded';
  String mutationResult = 'accepted';
  bool failRefresh = false;
  bool failLookup = false;
  Object? lookupReply;
  String statusAction = 'shift.open';
  final products = <Map<String, dynamic>>[];
  int sessionExpiresAt = 4102444800000;
  Map<String, dynamic>? shift;
  late final HubClient client = HubClient(
    baseUri: _origin,
    client: MockClient(_respond),
  );

  List<http.Request> get mutations => requests
      .where(
        (request) =>
            request.method == 'POST' &&
            request.url.path == '/api/v1/shifts/open',
      )
      .toList();

  Future<http.Response> _respond(http.Request request) async {
    requests.add(request);
    http.Response json(Object body, [int code = 200]) => http.Response(
      jsonEncode(body),
      code,
      headers: {'content-type': 'application/json'},
    );
    if (request.url.path == '/api/v1/auth/staff') {
      final body = jsonDecode(request.body) as Map;
      accountId = body['accountId'] as String;
      return json({
        'token': _token,
        'expiresAt': sessionExpiresAt,
        'actor': {
          'id': accountId,
          'displayName': 'Recovery cashier',
          'branchId': 'branch-a',
          'role': 'cashier',
        },
      });
    }
    expect(request.headers['authorization'], 'Bearer $_token');
    if (request.url.path == '/api/v1/auth/logout') {
      return http.Response('', 204);
    }
    if (request.url.path.startsWith('/api/v1/commands/')) {
      if (failLookup) throw http.ClientException('Lookup failed: $_secret');
      if (lookupReply != null) return json(lookupReply!);
      final id = request.url.pathSegments.last;
      return json({
        'commandId': id,
        'status': status,
        if (status == 'accepted') ...{
          'action': statusAction,
          'acceptedAt': 1793764800000,
        },
        if (status == 'rejected') ...{
          'action': statusAction,
          'rejectedAt': 1793764800000,
          'error': {
            'code': 'conflict',
            'message': 'The command conflicts with the accepted state.',
          },
        },
      });
    }
    if (request.method == 'POST' && request.url.path == '/api/v1/orders') {
      statusAction = 'order.create';
      status = 'rejected';
      return json({
        'error': {
          'code': 'conflict',
          'message': 'The command conflicts with the accepted state.',
        },
        'requestId': _requestId,
      }, 409);
    }
    if (request.method == 'POST' && request.url.path == '/api/v1/shifts/open') {
      if (mutationResult == 'unknown') {
        throw http.ClientException('Lost accepted response: $_secret');
      }
      if (mutationResult == 'unauthorized') {
        return json({
          'error': {'code': 'unauthorized', 'message': 'Unauthorized.'},
          'requestId': _requestId,
        }, 401);
      }
      if (mutationResult == 'rejected' ||
          mutationResult == 'nonterminal_rejection') {
        if (mutationResult == 'rejected') status = 'rejected';
        return json({
          'error': {
            'code': 'conflict',
            'message': 'The command conflicts with the accepted state.',
          },
          'requestId': _requestId,
        }, 409);
      }
      final body = jsonDecode(request.body) as Map;
      shift = {
        'id': 'shift-a',
        'drawerId': 'drawer-a',
        'status': 'open',
        'version': 1,
        'openingCashCentavos': body['openingCashCentavos'],
      };
      status = 'accepted';
      if (mutationResult == 'accepted_then_lost') {
        throw http.ClientException('Lost accepted response: $_secret');
      }
      return json({'commandId': body['commandId'], 'shift': shift});
    }
    if (failRefresh && request.url.path == '/api/v1/ingredients') {
      throw http.ClientException('Refresh unavailable: $_secret');
    }
    return json(switch (request.url.path) {
      '/api/v1/ingredients' => {'ingredients': <Object>[]},
      '/api/v1/products' => {'products': products},
      '/api/v1/approvals' => {'approvals': <Object>[]},
      '/api/v1/refunds' => {'refunds': <Object>[]},
      '/api/v1/orders' => {'orders': <Object>[]},
      '/api/v1/shifts/current' => {'shift': shift},
      '/api/v1/staff/context' => {
        'actor': {
          'id': accountId,
          'displayName': 'Recovery cashier',
          'branchId': 'branch-a',
          'role': 'cashier',
        },
        'branchId': 'branch-a',
        'modules': ['cashier'],
      },
      _ => {
        'error': {'code': 'not_found', 'message': 'Unavailable.'},
      },
    });
  }
}

Future<void> _mount(
  WidgetTester tester,
  _HubFixture fixture,
  _Storage storage,
) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(1280, 800);
  await tester.pumpWidget(
    ConnectedStaffApp(
      client: fixture.client,
      deviceId: 'tablet-a',
      deviceSecret: _secret,
      recoveryStore: StaffRecoveryStore(storage),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _signIn(
  WidgetTester tester, {
  String account = 'cashier-a',
}) async {
  await tester.enterText(find.widgetWithText(TextField, 'Account ID'), account);
  await tester.enterText(find.widgetWithText(TextField, 'PIN'), '4826');
  await _tap(tester, find.text('Sign in'));
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _openShift(WidgetTester tester) async {
  await _tap(tester, find.text('Open shift'));
  await tester.enterText(
    find.widgetWithText(TextField, 'Opening cash (PHP)'),
    '1000',
  );
  await _tap(tester, find.widgetWithText(FilledButton, 'Open shift'));
  final back = find.widgetWithText(TextButton, 'Back');
  if (back.evaluate().isNotEmpty) await _tap(tester, back);
}

Future<Completer<void>> _holdOpeningShift(
  WidgetTester tester,
  _Storage storage,
) async {
  final blocker = Completer<void>();
  storage.blockNextPendingWrite = blocker;
  await _tap(tester, find.text('Open shift'));
  await tester.enterText(
    find.widgetWithText(TextField, 'Opening cash (PHP)'),
    '1000',
  );
  await tester.tap(find.widgetWithText(FilledButton, 'Open shift'));
  await tester.pump();
  expect(storage.pendingWriteBlocked, isTrue);
  return blocker;
}

Future<void> _replaceSession(_HubFixture fixture, String accountId) async {
  await fixture.client.loginStaff(
    accountId: accountId,
    pin: '4826',
    deviceId: 'tablet-a',
    deviceSecret: _secret,
  );
}

void main() {
  testWidgets(
    'fresh business rejection is verified and refreshed before journal cleanup',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture()..mutationResult = 'rejected';
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      await _openShift(tester);
      final id =
          (jsonDecode(fixture.mutations.single.body) as Map)['commandId'];
      expect(
        fixture.requests.any((r) => r.url.path == '/api/v1/commands/$id'),
        isTrue,
      );
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      expect(
        find.textContaining('Previous operation was not applied'),
        findsOneWidget,
      );
      expect(fixture.shift, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'raw business conflict without a rejection receipt retains its original command',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture()..mutationResult = 'nonterminal_rejection';
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      await _openShift(tester);
      final id =
          (jsonDecode(fixture.mutations.single.body) as Map)['commandId'];
      expect((await StaffRecoveryStore(storage).load()).pending!.commandId, id);
      expect(find.text('Retry previous action'), findsOneWidget);
      expect(
        fixture.requests.any((r) => r.url.path == '/api/v1/commands/$id'),
        isTrue,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'restarted stale retry resolves rejected work without repeated POST',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final first = _HubFixture()..mutationResult = 'unknown';
      addTearDown(first.client.close);
      final storage = _Storage();
      await _mount(tester, first, storage);
      await _signIn(tester);
      await _openShift(tester);
      final originalBody = jsonDecode(first.mutations.single.body);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
      final restarted = _HubFixture()..mutationResult = 'rejected';
      addTearDown(restarted.client.close);
      await _mount(tester, restarted, storage);
      await _signIn(tester);
      await _retryPending(tester);
      expect(restarted.mutations, hasLength(1));
      expect(jsonDecode(restarted.mutations.single.body), originalBody);
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      expect(
        find.textContaining('Previous operation was not applied'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final failure in ['lookup', 'malformed', 'action', 'refresh', 'clear']) {
    testWidgets(
      'terminal rejection retains the original journal on $failure failure',
      (tester) async {
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final fixture = _HubFixture()..mutationResult = 'rejected';
        addTearDown(fixture.client.close);
        final storage = _Storage();
        await _mount(tester, fixture, storage);
        await _signIn(tester);
        fixture.failLookup = failure == 'lookup';
      fixture.statusAction = failure == 'action' ? 'inventory.waste' : 'shift.open';
        fixture.lookupReply = failure == 'malformed'
            ? {'commandId': 'wrong', 'status': 'rejected'}
            : null;
        fixture.failRefresh = failure == 'refresh';
        storage.failClear = failure == 'clear';
        await _openShift(tester);
        final id =
            (jsonDecode(fixture.mutations.single.body) as Map)['commandId'];
        expect(
          (await StaffRecoveryStore(storage).load()).pending!.commandId,
          id,
        );
        expect(find.text('Retry previous action'), findsOneWidget);
        fixture.failLookup = false;
      fixture.statusAction = 'shift.open';
        fixture.lookupReply = null;
        fixture.failRefresh = false;
        storage.failClear = false;
        await _retryPending(tester);
        expect(fixture.mutations, hasLength(1));
        expect((await StaffRecoveryStore(storage).load()).pending, isNull);
        expect(
          find.textContaining('Previous operation was not applied'),
          findsOneWidget,
        );
        expect(find.textContaining(_secret), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('rejected order creation preserves the cashier cart for review', (
    tester,
  ) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fixture = _HubFixture();
    fixture.products.add({
      'id': 'latte',
      'name': 'Recovery latte',
      'priceCentavos': 16500,
      'version': 1,
    });
    addTearDown(fixture.client.close);
    final storage = _Storage();
    await _mount(tester, fixture, storage);
    await _signIn(tester);
    await _tap(tester, find.text('Recovery latte'));
    await _tap(tester, find.text('Add to order'));
    await _tap(tester, find.text('Create order'));
    expect(find.text('1 × Recovery latte'), findsOneWidget);
    expect(
      find.textContaining('Previous operation was not applied'),
      findsOneWidget,
    );
    expect((await StaffRecoveryStore(storage).load()).pending, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed journal save prevents the shift POST', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fixture = _HubFixture();
    addTearDown(fixture.client.close);
    final storage = _Storage();
    await _mount(tester, fixture, storage);
    await _signIn(tester);
    final before = storage.bytes;
    storage.failWrite = true;
    await _openShift(tester);
    expect(fixture.mutations, isEmpty);
    expect(storage.bytes, before);
    expect((await StaffRecoveryStore(storage).load()).pending, isNull);
    expect(find.textContaining(_secret), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a replacement session cannot send a command from a held journal write',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture();
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      final blocker = await _holdOpeningShift(tester, storage);
      await _replaceSession(fixture, 'cashier-b');
      blocker.complete();
      await tester.pumpAndSettle();

      expect(fixture.mutations, isEmpty);
      final original = (await StaffRecoveryStore(storage).load()).pending!;
      expect(original.actorId, 'cashier-a');
      expect(original.payload['openingCashCentavos'], 100000);

      final back = find.widgetWithText(TextButton, 'Back');
      if (back.evaluate().isNotEmpty) await _tap(tester, back);
      final signOut = find.byTooltip('Sign out');
      if (signOut.evaluate().isNotEmpty) await _tap(tester, signOut);
      await _signIn(tester);
      expect(find.text('Retry previous action'), findsOneWidget);
      expect(fixture.mutations, isEmpty);
      expect(
        (await StaffRecoveryStore(storage).load()).pending!.commandId,
        original.commandId,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'sign-in reloads a journal write that finished after session expiry',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture();
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      final blocker = await _holdOpeningShift(tester, storage);

      fixture.sessionExpiresAt = 1;
      await _replaceSession(fixture, 'cashier-a');
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(
        find.text('Your session expired. Sign in again to continue.'),
        findsOneWidget,
      );
      blocker.complete();
      await tester.pumpAndSettle();

      final original = (await StaffRecoveryStore(storage).load()).pending!;
      fixture.sessionExpiresAt = 4102444800000;
      await _signIn(tester);
      expect(find.text('Retry previous action'), findsOneWidget);
      expect(fixture.mutations, isEmpty);
      expect(
        (await StaffRecoveryStore(storage).load()).pending!.commandId,
        original.commandId,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an uncertain command survives sign-out and only its employee can retry it',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture()..mutationResult = 'unknown';
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      await _openShift(tester);
      final original = (await StaffRecoveryStore(storage).load()).pending!;
      expect(fixture.mutations, hasLength(1));
      expect(original.payload['openingCashCentavos'], 100000);
      expect(find.byTooltip('Sign out'), findsOneWidget);
      await _tap(tester, find.byTooltip('Sign out'));
      expect(fixture.client.session, isNull);
      expect(
        (await StaffRecoveryStore(storage).load()).pending!.commandId,
        original.commandId,
      );

      final lookupsBefore = fixture.requests
          .where((r) => r.url.path.startsWith('/api/v1/commands/'))
          .length;
      await _signIn(tester, account: 'cashier-b');
      expect(fixture.mutations, hasLength(1));
      expect(
        fixture.requests
            .where((r) => r.url.path.startsWith('/api/v1/commands/'))
            .length,
        lookupsBefore,
      );
      expect(
        (await StaffRecoveryStore(storage).load()).pending!.commandId,
        original.commandId,
      );
      expect(find.textContaining(_secret), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a restarted client reconciles accepted work without another POST',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final first = _HubFixture()..mutationResult = 'accepted_then_lost';
      addTearDown(first.client.close);
      final storage = _Storage();
      await _mount(tester, first, storage);
      await _signIn(tester);
      await _openShift(tester);
      final original = (await StaffRecoveryStore(storage).load()).pending!;
      expect(first.mutations, hasLength(1));
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();

      final restarted = _HubFixture()
        ..status = 'accepted'
        ..shift = first.shift;
      addTearDown(restarted.client.close);
      await _mount(tester, restarted, storage);
      await _signIn(tester);
      await _checkPending(tester);
      expect(restarted.mutations, isEmpty);
      expect(
        restarted.requests.any(
          (r) => r.url.path == '/api/v1/commands/${original.commandId}',
        ),
        isTrue,
      );
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      expect(restarted.shift?['status'], 'open');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an unrecorded restart retries the exact saved command identity and payload',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final first = _HubFixture()..mutationResult = 'unknown';
      addTearDown(first.client.close);
      final storage = _Storage();
      await _mount(tester, first, storage);
      await _signIn(tester);
      await _openShift(tester);
      final originalBody = jsonDecode(first.mutations.single.body);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();

      final restarted = _HubFixture();
      addTearDown(restarted.client.close);
      await _mount(tester, restarted, storage);
      await _signIn(tester);
      await _retryPending(tester);
      expect(restarted.mutations, hasLength(1));
      expect(jsonDecode(restarted.mutations.single.body), originalBody);
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an unauthorized POST retains the pending command through sign-in recovery',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture()..mutationResult = 'unauthorized';
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      await _openShift(tester);
      final original = (await StaffRecoveryStore(storage).load()).pending!;
      expect(fixture.client.session, isNull);
      expect(find.text('Sign in'), findsOneWidget);
      fixture.mutationResult = 'accepted';
      await _signIn(tester);
      await _retryPending(tester);
      expect(fixture.mutations, hasLength(2));
      expect(
        (jsonDecode(fixture.mutations.last.body) as Map)['commandId'],
        original.commandId,
      );
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed local cleanup keeps accepted work locked until status reconciliation succeeds',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture();
      addTearDown(fixture.client.close);
      final storage = _Storage();
      await _mount(tester, fixture, storage);
      await _signIn(tester);
      storage.failClear = true;
      await _openShift(tester);
      final pending = (await StaffRecoveryStore(storage).load()).pending!;
      expect(fixture.mutations, hasLength(1));
      expect(find.textContaining(_secret), findsNothing);
      storage.failClear = false;
      await _checkPending(tester);
      expect(fixture.mutations, hasLength(1));
      expect(
        fixture.requests.any(
          (r) => r.url.path == '/api/v1/commands/${pending.commandId}',
        ),
        isTrue,
      );
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'corrupt recovery storage remains unchanged and prevents staff commands',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = _HubFixture();
      addTearDown(fixture.client.close);
      final storage = _Storage()
        ..bytes = '{"version":999,"preserve":"fixture"}';
      final original = storage.bytes;
      await _mount(tester, fixture, storage);
      expect(fixture.mutations, isEmpty);
      expect(storage.bytes, original);
      expect(storage.writes, 0);
      expect(find.textContaining(_secret), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _checkPending(WidgetTester tester) async {
  final candidates = find.text('Retry previous action');
  if (candidates.evaluate().isNotEmpty) await _tap(tester, candidates);
}

Future<void> _retryPending(WidgetTester tester) async {
  await _checkPending(tester);
}
