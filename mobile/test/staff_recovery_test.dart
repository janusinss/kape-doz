import 'dart:async';
import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:cafe_dos/data/staff_recovery.dart';
import 'package:flutter_test/flutter_test.dart';

const _deviceSecret = 'Recovery-Fixture-Device-Secret-32!';
const _commandId = 'e1c20304-5678-4abc-8def-0123456789ab';
final _origin = Uri.parse('https://hub.example');

class _RetainedStorage implements StaffRecoveryStorage {
  String? bytes;
  int reads = 0;
  int writes = 0;
  bool failRead = false;
  bool failWrite = false;
  Completer<void>? pauseWrite;
  Completer<void>? writeStarted;

  @override
  final bool durable;

  _RetainedStorage({this.durable = true, this.bytes});

  @override
  Future<String?> read() async {
    reads++;
    if (failRead) throw StateError('Read failed: $_deviceSecret');
    return bytes;
  }

  @override
  Future<void> write(String value) async {
    writes++;
    if (failWrite) throw StateError('Write failed: $_deviceSecret');
    writeStarted?.complete();
    await pauseWrite?.future;
    bytes = value;
  }
}

StaffEnrollment _enrollment({Uri? origin, String deviceId = 'tablet-a'}) =>
    StaffEnrollment(
      hubOrigin: origin ?? _origin,
      deviceId: deviceId,
      deviceSecret: _deviceSecret,
    );

PendingStaffCommand _command({
  String commandId = _commandId,
  String path = '/api/v1/orders',
  Map<String, dynamic>? payload,
  HubRole role = HubRole.cashier,
  Uri? origin,
  int? expectedVersion,
}) => PendingStaffCommand(
  commandId: commandId,
  label: 'Create order',
  hubOrigin: origin ?? _origin,
  deviceId: 'tablet-a',
  actorId: 'cashier-a',
  branchId: 'branch-a',
  role: role,
  path: path,
  payload:
      payload ??
      {
        'dineIn': true,
        'table': '04',
        'items': [
          {'productId': 'coffee-a', 'quantity': 1, 'note': 'Less sweet'},
        ],
      },
  expectedVersion: expectedVersion,
  createdAt: 1793764800000,
);

HubActor _actor({
  String id = 'cashier-a',
  String branchId = 'branch-a',
  HubRole role = HubRole.cashier,
}) => HubActor(
  id: id,
  displayName: 'Recovery fixture',
  branchId: branchId,
  role: role,
);

final _recoveryError = isA<StaffRecoveryException>().having(
  (error) => error.message,
  'controlled message',
  allOf(isNotEmpty, isNot(contains(_deviceSecret))),
);

void main() {
  test('saved staff paths derive their original command receipt actions', () {
    final paths = {
      '/api/v1/orders': 'order.create',
      '/api/v1/waste': 'inventory.waste',
      '/api/v1/shifts/open': 'shift.open',
      '/api/v1/shifts/shift-a/submit-count': 'shift.submit-count',
      '/api/v1/orders/order-a/send': 'order.send',
      '/api/v1/orders/order-a/ready': 'order.ready',
      '/api/v1/orders/order-a/prepare': 'order.prepare',
      '/api/v1/orders/order-a/receipt': 'order.receipt',
      '/api/v1/orders/order-a/payments': 'order.payment',
      '/api/v1/orders/order-a/approvals': 'approval.request',
      '/api/v1/orders/order-a/refunds': 'refund.request',
      '/api/v1/orders/order-a/amendments': 'order.amendment.request',
      '/api/v1/orders/order-a/amendments/amendment-a/acknowledge':
          'order.amendment.acknowledge',
      '/api/v1/orders/order-a/payments/payment-a/verify':
          'order.payment.verify',
      '/api/v1/orders/order-a/payments/payment-a/reject':
          'order.payment.reject',
      '/api/v1/orders/order-a/cancellation/disposition':
          'order.cancellation.disposition',
      '/api/v1/refunds/refund-a/legs/leg-a': 'refund.leg.record_cash',
    };
    for (final entry in paths.entries) {
      final barista =
          entry.value == 'inventory.waste' ||
          {
            'order.prepare',
            'order.ready',
            'order.cancellation.disposition',
            'order.amendment.acknowledge',
          }.contains(entry.value);
      final descriptor = _command(
        path: entry.key,
        role: barista ? HubRole.barista : HubRole.cashier,
        payload: {'action': 'record_cash'},
      );
      expect(descriptor.businessAction, entry.value);
    }
  });

  test(
    'pending work survives a new store instance with its exact command',
    () async {
      final storage = _RetainedStorage();
      final first = StaffRecoveryStore(storage);
      await first.saveValidatedEnrollment(_enrollment());
      await first.savePending(_command());

      final restarted = StaffRecoveryStore(storage);
      final state = await restarted.load();
      expect(restarted.durable, isTrue);
      expect(state.enrollment!.hubOrigin, _origin);
      expect(state.enrollment!.deviceId, 'tablet-a');
      expect(state.enrollment!.deviceSecret, _deviceSecret);
      expect(state.pending!.commandId, _commandId);
      expect(state.pending!.path, '/api/v1/orders');
      expect(state.pending!.payload, _command().payload);
      expect(state.pending!.createdAt, 1793764800000);
      expect(storage.reads, greaterThanOrEqualTo(3));
      expect(storage.writes, 2);
    },
  );

  test('empty storage loads without creating a replacement record', () async {
    final storage = _RetainedStorage(durable: false);
    final store = StaffRecoveryStore(storage);
    final state = await store.load();
    expect(state.enrollment, isNull);
    expect(state.pending, isNull);
    expect(store.durable, isFalse);
    expect(storage.reads, 1);
    expect(storage.writes, 0);

    final preview = StaffRecoveryStore(MemoryStaffRecoveryStorage());
    expect(preview.durable, isFalse);
    await preview.saveValidatedEnrollment(_enrollment());
    expect((await preview.load()).enrollment!.deviceId, 'tablet-a');
  });

  test(
    'a command snapshots nested payload and retains its named version',
    () async {
      final items = <dynamic>[
        <String, dynamic>{'productId': 'coffee-a', 'quantity': 1},
      ];
      final payload = <String, dynamic>{'dineIn': true, 'items': items};
      final command = _command(payload: payload, expectedVersion: 7);
      (items.first as Map<String, dynamic>)['quantity'] = 999;
      items.add({'productId': 'injected', 'quantity': 2});
      payload['token'] = 'Must-not-enter-snapshot';

      expect(command.payload, {
        'dineIn': true,
        'items': [
          {'productId': 'coffee-a', 'quantity': 1},
        ],
      });
      final storage = _RetainedStorage();
      await StaffRecoveryStore(storage).saveValidatedEnrollment(_enrollment());
      await StaffRecoveryStore(storage).savePending(command);
      final restored = (await StaffRecoveryStore(storage).load()).pending!;
      expect(restored.expectedVersion, 7);
      expect(restored.payload, command.payload);
      expect(storage.bytes, isNot(contains('Must-not-enter-snapshot')));
    },
  );

  test(
    'retry scope requires the original hub, device, actor, branch and role',
    () {
      final command = _command();
      bool matches({
        Uri? origin,
        String deviceId = 'tablet-a',
        HubActor? actor,
      }) => command.matches(
        hubOrigin: origin ?? _origin,
        deviceId: deviceId,
        actor: actor ?? _actor(),
      );
      expect(matches(), isTrue);
      expect(matches(origin: Uri.parse('https://other.example')), isFalse);
      expect(matches(origin: Uri.parse('https://hub.example:8443')), isFalse);
      expect(matches(deviceId: 'tablet-b'), isFalse);
      expect(matches(actor: _actor(id: 'cashier-b')), isFalse);
      expect(matches(actor: _actor(branchId: 'branch-b')), isFalse);
      expect(matches(actor: _actor(role: HubRole.barista)), isFalse);
      expect(matches(actor: _actor(role: HubRole.owner)), isFalse);
    },
  );

  test(
    'unresolved work blocks replacement and conditional cleanup uses its ID',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(_enrollment());
      await store.savePending(_command());
      final original = storage.bytes;
      final writes = storage.writes;
      await expectLater(
        store.savePending(
          _command(commandId: 'e1c20304-5678-4abc-8def-0123456789ac'),
        ),
        throwsA(_recoveryError),
      );
      await expectLater(
        store.savePending(_command(payload: {'dineIn': false, 'items': []})),
        throwsA(_recoveryError),
      );
      await expectLater(
        store.saveValidatedEnrollment(_enrollment(deviceId: 'tablet-b')),
        throwsA(_recoveryError),
      );
      await expectLater(
        store.clearPending('e1c20304-5678-4abc-8def-0123456789ac'),
        throwsA(_recoveryError),
      );
      expect(storage.bytes, original);
      expect(storage.writes, writes);
      await store.clearPending(_commandId);
      expect((await store.load()).pending, isNull);
      expect((await store.load()).enrollment!.deviceId, 'tablet-a');
      await store.saveValidatedEnrollment(_enrollment(deviceId: 'tablet-b'));
      expect((await store.load()).enrollment!.deviceId, 'tablet-b');
    },
  );

  test(
    'write failure preserves enrollment and permits the original command retry',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(_enrollment());
      final before = storage.bytes;
      storage.failWrite = true;
      await expectLater(store.savePending(_command()), throwsA(_recoveryError));
      expect(storage.bytes, before);
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
      storage.failWrite = false;
      await store.savePending(_command());
      expect(
        (await StaffRecoveryStore(storage).load()).pending!.commandId,
        _commandId,
      );
    },
  );

  test(
    'failed cleanup retains the lock across restart until original cleanup succeeds',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(_enrollment());
      await store.savePending(_command());
      final before = storage.bytes;
      storage.failWrite = true;
      await expectLater(
        store.clearPending(_commandId),
        throwsA(_recoveryError),
      );
      expect(storage.bytes, before);
      storage.failWrite = false;
      final restarted = StaffRecoveryStore(storage);
      await expectLater(
        restarted.savePending(
          _command(commandId: 'e1c20304-5678-4abc-8def-0123456789ac'),
        ),
        throwsA(_recoveryError),
      );
      expect((await restarted.load()).pending!.commandId, _commandId);
      await restarted.clearPending(_commandId);
      expect((await StaffRecoveryStore(storage).load()).pending, isNull);
    },
  );

  test(
    'read failure never overwrites stored work or exposes the adapter error',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(_enrollment());
      await store.savePending(_command());
      final before = storage.bytes;
      final writes = storage.writes;
      storage.failRead = true;
      await expectLater(store.load(), throwsA(_recoveryError));
      await expectLater(
        store.clearPending(_commandId),
        throwsA(_recoveryError),
      );
      await expectLater(store.savePending(_command()), throwsA(_recoveryError));
      expect(storage.bytes, before);
      expect(storage.writes, writes);
    },
  );

  test(
    'concurrent saves cannot replace a command awaiting its durable commit',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(_enrollment());
      storage.pauseWrite = Completer<void>();
      storage.writeStarted = Completer<void>();
      final first = store.savePending(_command());
      await storage.writeStarted!.future;
      final blocked = expectLater(
        store.savePending(
          _command(commandId: 'e1c20304-5678-4abc-8def-0123456789ac'),
        ),
        throwsA(_recoveryError),
      );
      storage.pauseWrite!.complete();
      await first;
      await blocked;
      expect(
        (await StaffRecoveryStore(storage).load()).pending!.commandId,
        _commandId,
      );
      expect(storage.writes, 2);
    },
  );

  test('corrupt and future bytes fail closed without a silent reset', () async {
    for (final bytes in [
      '{broken $_deviceSecret',
      jsonEncode({'version': 2, 'enrollment': null, 'pending': null}),
      jsonEncode({'version': 1, 'enrollment': 'invalid', 'pending': null}),
    ]) {
      final storage = _RetainedStorage(bytes: bytes);
      final store = StaffRecoveryStore(storage);
      await expectLater(store.load(), throwsA(_recoveryError));
      await expectLater(
        store.saveValidatedEnrollment(_enrollment()),
        throwsA(_recoveryError),
      );
      expect(storage.bytes, bytes);
      expect(storage.writes, 0);
    }
  });

  test(
    'pending command must match saved enrollment and cannot precede enrollment',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await expectLater(store.savePending(_command()), throwsA(_recoveryError));
      expect(storage.writes, 0);
      await store.saveValidatedEnrollment(_enrollment(deviceId: 'tablet-b'));
      await expectLater(store.savePending(_command()), throwsA(_recoveryError));
      expect((await store.load()).pending, isNull);
    },
  );

  test(
    'unsafe transport is rejected unless loopback is explicitly enabled',
    () async {
      for (final uri in [
        Uri.parse('http://192.168.1.2'),
        Uri.parse('https://$_deviceSecret@hub.example'),
        Uri.parse('https://hub.example/foreign'),
        Uri.parse('https://hub.example?token=$_deviceSecret'),
      ]) {
        final storage = _RetainedStorage();
        await expectLater(
          Future.sync(
            () => StaffRecoveryStore(
              storage,
            ).saveValidatedEnrollment(_enrollment(origin: uri)),
          ),
          throwsA(_recoveryError),
        );
        expect(storage.writes, 0);
      }
      final loopback = Uri.parse('http://127.0.0.1:57590');
      await expectLater(
        Future.sync(
          () => StaffRecoveryStore(
            _RetainedStorage(),
          ).saveValidatedEnrollment(_enrollment(origin: loopback)),
        ),
        throwsA(_recoveryError),
      );
      final allowed = StaffRecoveryStore(
        _RetainedStorage(),
        allowInsecureLoopback: true,
      );
      await allowed.saveValidatedEnrollment(_enrollment(origin: loopback));
      expect((await allowed.load()).enrollment!.hubOrigin, loopback);

      final lan = Uri.parse('http://192.168.1.50:8787');
      final lanAllowed = StaffRecoveryStore(
        _RetainedStorage(),
        allowPrivateLanHttp: true,
      );
      await lanAllowed.saveValidatedEnrollment(_enrollment(origin: lan));
      expect((await lanAllowed.load()).enrollment!.hubOrigin, lan);
    },
  );

  test(
    'relocateHubOrigin updates enrollment and pending command atomically when authorityId matches and clearEnrollment blocks on pending work',
    () async {
      const authA = '11111111-2222-4333-8444-555555555555';
      const authB = '99999999-2222-4333-8444-555555555555';
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage, allowPrivateLanHttp: true);
      final initialOrigin = Uri.parse('http://192.168.1.10:8787');
      final relocatedOrigin = Uri.parse('http://192.168.1.25:8787');

      await store.saveValidatedEnrollment(
        StaffEnrollment(
          hubOrigin: initialOrigin,
          deviceId: 'tablet-a',
          deviceSecret: _deviceSecret,
          authorityId: authA,
        ),
      );
      await store.savePending(_command(origin: initialOrigin));

      // Mismatched authorityId is rejected without changing saved state
      await expectLater(
        store.relocateHubOrigin(
          newHubOrigin: relocatedOrigin,
          verifiedAuthorityId: authB,
        ),
        throwsA(_recoveryError),
      );
      expect((await store.load()).enrollment!.hubOrigin, initialOrigin);

      // Unpairing while pending work exists is blocked
      await expectLater(store.clearEnrollment(), throwsA(_recoveryError));

      // Matching authorityId relocates both enrollment and pending command
      final relocatedState = await store.relocateHubOrigin(
        newHubOrigin: relocatedOrigin,
        verifiedAuthorityId: authA,
      );
      expect(relocatedState.enrollment!.hubOrigin, relocatedOrigin);
      expect(relocatedState.enrollment!.authorityId, authA);
      expect(relocatedState.pending!.hubOrigin, relocatedOrigin);

      // Clearing pending work allows unpairing the device
      await store.clearPending(_commandId);
      await store.clearEnrollment();
      final cleared = await store.load();
      expect(cleared.enrollment, isNull);
      expect(cleared.pending, isNull);
    },
  );

  test(
    'model rejects credential payloads, privileged routes and unsafe JSON values',
    () {
      for (final payload in <Map<String, dynamic>>[
        {'pin': '4826'},
        {
          'nested': {'deviceSecret': _deviceSecret},
        },
        {'token': 'Should-not-be-persisted'},
        {'password': 'Should-not-be-persisted'},
        {'commandId': _commandId},
        {'expectedVersion': 1},
        {'amountCentavos': 9007199254740992},
        {'quantity': double.nan},
        {'quantity': double.infinity},
        {'nonJson': Object()},
      ]) {
        expect(() => _command(payload: payload), throwsA(_recoveryError));
      }
      for (final path in [
        '/api/v1/auth/staff',
        '/api/v1/admin/expenses',
        'https://other.example/api/v1/orders',
        '/api/v1/orders/../auth/logout',
        '/api/v1/orders?token=$_deviceSecret',
      ]) {
        expect(() => _command(path: path), throwsA(_recoveryError));
      }
      for (final role in [HubRole.manager, HubRole.owner]) {
        expect(() => _command(role: role), throwsA(_recoveryError));
      }
      expect(
        () => _command(commandId: 'invalid-command'),
        throwsA(_recoveryError),
      );
      expect(() => _command(expectedVersion: 0), throwsA(_recoveryError));
    },
  );

  test(
    'cashier discount request survives reload with its original identity',
    () async {
      final storage = _RetainedStorage();
      final store = StaffRecoveryStore(storage);
      await store.saveValidatedEnrollment(_enrollment());
      await store.savePending(
        _command(
          path: '/api/v1/orders/order-a/approvals',
          expectedVersion: 4,
          payload: {
            'action': 'discount',
            'amountCentavos': 1250,
            'reason': 'Service adjustment',
          },
        ),
      );
      final restored = (await StaffRecoveryStore(storage).load()).pending!;
      expect(restored.commandId, _commandId);
      expect(restored.expectedVersion, 4);
      expect(restored.payload['amountCentavos'], 1250);
      expect(
        () => _command(path: restored.path, role: HubRole.barista),
        throwsA(_recoveryError),
      );
      expect(
        () => _command(path: '/api/v1/approvals/approval-a/decide'),
        throwsA(_recoveryError),
      );
    },
  );

  test(
    'cashier refund commands preserve identity and role restrictions after reload',
    () async {
      for (final entry in {
        '/api/v1/orders/order-a/refunds': <String, dynamic>{
          'amountCentavos': 2500,
          'lineNumbers': [0],
          'reason': 'Returned item',
        },
        '/api/v1/refunds/refund-a/legs/leg-a': <String, dynamic>{
          'action': 'record_cash',
        },
      }.entries) {
        final storage = _RetainedStorage();
        final store = StaffRecoveryStore(storage);
        await store.saveValidatedEnrollment(_enrollment());
        await store.savePending(
          _command(path: entry.key, expectedVersion: 3, payload: entry.value),
        );
        final restored = (await StaffRecoveryStore(storage).load()).pending!;
        expect(restored.commandId, _commandId);
        expect(restored.expectedVersion, 3);
        expect(restored.payload, entry.value);
        expect(
          () => _command(path: entry.key, role: HubRole.barista),
          throwsA(_recoveryError),
        );
      }
      expect(
        () => _command(path: '/api/v1/refunds/refund-a/decision'),
        throwsA(_recoveryError),
      );
    },
  );

  test(
    'object descriptions exclude device secrets and raw command details',
    () {
      expect(_enrollment().toString(), isNot(contains(_deviceSecret)));
      expect(
        _command(payload: {'note': 'Private customer note'}).toString(),
        isNot(contains('Private customer note')),
      );
    },
  );
}
