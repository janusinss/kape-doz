import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:cafe_dos/data/staff_recovery.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

const _deviceSecret = 'Transport-Fixture-Device-Secret-32!';
const _wasteCommandId = '081529a4-8900-4cf4-9ba0-317ca6db3333';

/// Synthetic plaintext adapter exercises restart semantics, not Android crypto.
class _FixtureFileStorage implements StaffRecoveryStorage {
  final File file;
  _FixtureFileStorage(this.file);
  @override
  bool get durable => true;
  @override
  Future<String?> read() async => await file.exists() ? file.readAsString() : null;
  @override
  Future<void> write(String value) => file.writeAsString(value, flush: true);
}

class _DropAcceptedWasteResponse extends http.BaseClient {
  final http.Client inner = http.Client();
  bool dropped = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await inner.send(request);
    if (!dropped && request.method == 'POST' && request.url.path == '/api/v1/waste') {
      dropped = true;
      await response.stream.drain<void>();
      throw http.ClientException('Synthetic response loss after hub acceptance');
    }
    return response;
  }

  @override
  void close() => inner.close();
}

void main() {
  test('a file-backed command survives client restart after the real hub accepted a lost response', () async {
    final workspace = Directory.current.parent.absolute;
    final scratch = Directory('${workspace.path}/scratch/recovery-transport-tests');
    await scratch.create(recursive: true);
    final folder = await scratch.createTemp('recovery-');
    final stderrLines = <String>[];
    final ready = Completer<Uri>();
    final clients = <HubClient>[];
    Process? child;
    StreamSubscription<String>? output;
    StreamSubscription<String>? errors;
    addTearDown(() async {
      for (final client in clients) {
        client.close();
      }
      final process = child;
      if (process != null) {
        try {
          process.stdin.writeln('stop');
          await process.stdin.flush();
          await process.stdin.close();
        } on IOException {
          // The isolated child may already have exited.
        }
        try {
          await process.exitCode.timeout(const Duration(seconds: 10));
        } on TimeoutException {
          process.kill();
          await process.exitCode.timeout(const Duration(seconds: 10));
        }
      }
      await output?.cancel();
      await errors?.cancel();
      final root = await scratch.resolveSymbolicLinks();
      expect(await folder.parent.resolveSymbolicLinks(), root);
      final target = await folder.resolveSymbolicLinks();
      expect(target.startsWith('$root${Platform.pathSeparator}recovery-'), isTrue);
      await folder.delete(recursive: true);
    });

    child = await Process.start(
      'node',
      ['--import', 'tsx', 'tests/fixtures/transport_hub.ts'],
      workingDirectory: '${workspace.path}/services',
      environment: {'KAPE_DOZ_TEST_DATABASE_PATH': '${folder.path}/hub.sqlite'},
    );
    output = child.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      if (ready.isCompleted) return;
      try {
        final value = jsonDecode(line);
        if (value is Map<String, dynamic> && value['url'] is String) {
          final uri = Uri.parse(value['url'] as String);
          if (uri.scheme == 'http' && uri.host == '127.0.0.1' && uri.port > 0) {
            ready.complete(uri);
          }
        }
      } on FormatException {
        ready.completeError(StateError('The isolated fixture announced an invalid address.'));
      }
    });
    errors = child.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      stderrLines.add(line);
      if (stderrLines.length > 20) stderrLines.removeAt(0);
    });
    unawaited(child.exitCode.then((code) {
      if (!ready.isCompleted) {
        ready.completeError(StateError('Fixture exited with $code: ${stderrLines.join('\n')}'));
      }
    }));
    final origin = await ready.future.timeout(const Duration(seconds: 45));
    HubClient connection({http.Client? transport}) {
      final client = HubClient(baseUri: origin, client: transport, allowInsecureLoopback: true);
      clients.add(client);
      return client;
    }
    final owner = connection();
    await owner.loginAdmin(accountId: 'transport-owner', password: 'Transport-Fixture-Owner-Password!');
    await owner.mutate('/api/v1/ingredients',
      commandId: '105a8000-0000-4000-8000-000000000001',
      payload: {'ingredientId': 'beans', 'name': 'Recovery fixture beans', 'unit': 'g'});
    await owner.mutate('/api/v1/inventory/receipts',
      commandId: '105a8000-0000-4000-8000-000000000002',
      payload: {'ingredientId': 'beans', 'quantityMilli': 1000000,
        'totalCostCentavos': 80000, 'reference': 'Recovery fixture receipt'});

    final first = connection(transport: _DropAcceptedWasteResponse());
    await first.loginStaff(accountId: 'transport-barista', pin: '5937',
      deviceId: 'transport-barista-tablet', deviceSecret: _deviceSecret);
    final file = File('${folder.path}/synthetic-journal.json');
    final store = StaffRecoveryStore(_FixtureFileStorage(file), allowInsecureLoopback: true);
    await store.saveValidatedEnrollment(StaffEnrollment(hubOrigin: origin,
      deviceId: 'transport-barista-tablet', deviceSecret: _deviceSecret));
    final pending = PendingStaffCommand(
      commandId: _wasteCommandId, label: 'Waste entry', hubOrigin: origin,
      deviceId: 'transport-barista-tablet', actorId: first.session!.actor.id,
      branchId: first.session!.actor.branchId, role: HubRole.barista,
      path: '/api/v1/waste',
      payload: {'ingredientId': 'beans', 'quantityMilli': 60000, 'reason': 'Fixture dial-in'},
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );
    await store.savePending(pending);
    await expectLater(first.mutate(pending.path, commandId: pending.commandId, payload: pending.payload),
      throwsA(isA<HubException>().having((e) => e.outcomeUnknown, 'uncertain response', isTrue)));
    first.close();

    final reopenedStore = StaffRecoveryStore(_FixtureFileStorage(file), allowInsecureLoopback: true);
    final reopened = (await reopenedStore.load()).pending!;
    final second = connection();
    await second.loginStaff(accountId: 'transport-barista', pin: '5937',
      deviceId: 'transport-barista-tablet', deviceSecret: _deviceSecret);
    expect(reopened.matches(hubOrigin: origin, deviceId: 'transport-barista-tablet', actor: second.session!.actor), isTrue);
    expect((await second.commandStatus(reopened.commandId))['status'], 'accepted');
    expect((await second.ingredients()).single['onHandMilli'], 940000);
    final replay = await second.mutate(reopened.path, commandId: reopened.commandId, payload: reopened.payload);
    expect(replay['commandId'], _wasteCommandId);
    expect((await second.ingredients()).single['onHandMilli'], 940000);

    final cashier = connection();
    await cashier.loginStaff(accountId: 'transport-cashier', pin: '4826',
      deviceId: 'transport-cashier-tablet', deviceSecret: _deviceSecret);
    expect(reopened.matches(hubOrigin: origin, deviceId: 'transport-cashier-tablet', actor: cashier.session!.actor), isFalse);
    expect((await cashier.commandStatus(_wasteCommandId))['status'], 'unrecorded');

    await reopenedStore.clearPending(reopened.commandId);
    expect((await StaffRecoveryStore(_FixtureFileStorage(file), allowInsecureLoopback: true).load()).pending, isNull);
    expect((await second.ingredients()).single['onHandMilli'], 940000);
    final saved = jsonDecode(await file.readAsString()) as Map;
    expect(saved.keys, unorderedEquals(['version', 'enrollment', 'pending']));
    expect(saved.toString(), isNot(contains('5937')));
    await second.logout();
    expect(second.session, isNull);
  }, timeout: const Timeout(Duration(minutes: 2)));
}

