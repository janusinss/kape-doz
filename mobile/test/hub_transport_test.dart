import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter_test/flutter_test.dart';

const _ownerPassword = 'Transport-Fixture-Owner-Password!';
const _deviceSecret = 'Transport-Fixture-Device-Secret-32!';

String commandId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final value = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${value.substring(0, 8)}-${value.substring(8, 12)}-${value.substring(12, 16)}-${value.substring(16, 20)}-${value.substring(20)}';
}

void expectOperationalOnly(Object? value) {
  if (value is Map) {
    for (final entry in value.entries) {
      expect(
        entry.key.toString(),
        isNot(
          matches(
            RegExp(
              'cost|margin|profit|expectedCash|variance|credential|secret|hash',
              caseSensitive: false,
            ),
          ),
        ),
      );
      expectOperationalOnly(entry.value);
    }
  } else if (value is List) {
    for (final child in value) {
      expectOperationalOnly(child);
    }
  }
}

void main() {
  test(
    'real loopback transport completes separate cashier, barista and owner service sessions',
    () async {
      // The development wrapper runs tests with mobile/ as the current directory.
      final workspace = Directory.current.parent.absolute;
      expect(
        File(
          '${workspace.path}/services/tests/fixtures/transport_hub.ts',
        ).existsSync(),
        isTrue,
      );
      final scratch = Directory(
        '${workspace.path}/scratch/hub-transport-tests',
      );
      await scratch.create(recursive: true);
      final temporary = await scratch.createTemp('transport-');
      Process? process;
      StreamSubscription<String>? stdoutSubscription;
      StreamSubscription<String>? stderrSubscription;
      final stderrLines = <String>[];
      final clients = <HubClient>[];

      addTearDown(() async {
        for (final client in clients) {
          client.close();
        }
        final child = process;
        if (child != null) {
          try {
            child.stdin.writeln('stop');
            await child.stdin.flush();
            await child.stdin.close();
          } on IOException {
            // Startup failure may already have closed this process's stdin.
          }
          try {
            await child.exitCode.timeout(const Duration(seconds: 10));
          } on TimeoutException {
            child.kill(); // Only the child process spawned by this test.
            await child.exitCode.timeout(const Duration(seconds: 10));
          }
        }
        await stdoutSubscription?.cancel();
        await stderrSubscription?.cancel();
        final expectedParent = await scratch.resolveSymbolicLinks();
        final actualParent = await temporary.parent.resolveSymbolicLinks();
        expect(actualParent, expectedParent);
        final target = await temporary.resolveSymbolicLinks();
        expect(
          target.startsWith(
            '$expectedParent${Platform.pathSeparator}transport-',
          ),
          isTrue,
        );
        await temporary.delete(recursive: true);
      });

      process = await Process.start(
        'node',
        ['--import', 'tsx', 'tests/fixtures/transport_hub.ts'],
        workingDirectory: '${workspace.path}/services',
        environment: {
          'KAPE_DOZ_TEST_DATABASE_PATH': '${temporary.path}/transport.sqlite',
        },
      );
      final ready = Completer<Uri>();
      stdoutSubscription = process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            if (ready.isCompleted) {
              return;
            }
            try {
              final decoded = jsonDecode(line);
              if (decoded is Map<String, dynamic> && decoded['url'] is String) {
                final uri = Uri.parse(decoded['url'] as String);
                if (uri.scheme == 'http' &&
                    uri.host == '127.0.0.1' &&
                    uri.port > 0) {
                  ready.complete(uri);
                }
              }
            } on FormatException {
              ready.completeError(
                StateError(
                  'The transport fixture did not announce a valid URL.',
                ),
              );
            }
          });
      stderrSubscription = process.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            stderrLines.add(line);
            if (stderrLines.length > 30) {
              stderrLines.removeAt(0);
            }
          });
      unawaited(
        process.exitCode.then((code) {
          if (!ready.isCompleted) {
            ready.completeError(
              StateError(
                'Transport fixture exited with $code: ${stderrLines.join('\n')}',
              ),
            );
          }
        }),
      );
      final uri = await ready.future.timeout(const Duration(seconds: 45));

      HubClient client() {
        final connection = HubClient(baseUri: uri, allowInsecureLoopback: true);
        clients.add(connection);
        return connection;
      }

      final owner = client();
      final cashier = client();
      final barista = client();
      await owner.loginAdmin(
        accountId: 'transport-owner',
        password: _ownerPassword,
      );
      await cashier.loginStaff(
        accountId: 'transport-cashier',
        pin: '4826',
        deviceId: 'transport-cashier-tablet',
        deviceSecret: _deviceSecret,
      );
      await barista.loginStaff(
        accountId: 'transport-barista',
        pin: '5937',
        deviceId: 'transport-barista-tablet',
        deviceSecret: _deviceSecret,
      );
      expect(owner.session!.actor.role, HubRole.owner);
      expect(cashier.session!.actor.role, HubRole.cashier);
      expect(barista.session!.actor.role, HubRole.barista);
      expect(cashier.session!.actor.branchId, 'transport-branch');
      expect((await cashier.staffContext())['modules'], ['cashier']);
      expect((await barista.staffContext())['modules'], ['station', 'waste']);

      await owner.mutate(
        '/api/v1/ingredients',
        commandId: commandId(),
        payload: {
          'ingredientId': 'beans',
          'name': 'Transport fixture beans',
          'unit': 'g',
        },
      );
      await owner.mutate(
        '/api/v1/inventory/receipts',
        commandId: commandId(),
        payload: {
          'ingredientId': 'beans',
          'quantityMilli': 1000000,
          'totalCostCentavos': 80000,
          'reference': 'Transport-fixture-receiving',
        },
      );
      await owner.mutate(
        '/api/v1/products',
        commandId: commandId(),
        payload: {
          'productId': 'latte',
          'name': 'Transport fixture latte',
          'priceCentavos': 16500,
          'recipe': [
            {'ingredientId': 'beans', 'quantityMilli': 18000},
          ],
        },
      );
      await owner.mutate(
        '/api/v1/drawers',
        commandId: commandId(),
        payload: {
          'drawerId': 'counter',
          'name': 'Transport fixture counter',
          'deviceIds': ['transport-cashier-tablet'],
        },
      );
      expect((await cashier.products()).single['priceCentavos'], 16500);
      expectOperationalOnly(await cashier.products());
      expectOperationalOnly(await cashier.ingredients());

      final opened = await cashier.openShift(
        commandId: commandId(),
        openingCashCentavos: 100000,
      );
      expectOperationalOnly(opened);
      var order =
          (await cashier.createOrder(
                commandId: commandId(),
                dineIn: true,
                table: '04',
                items: [
                  {'productId': 'latte', 'quantity': 1, 'note': 'Less sweet'},
                ],
              ))['order']
              as Map<String, dynamic>;
      final id = order['id'] as String;
      expect(order['totalCentavos'], 16500);
      expect(order['released'], isFalse);
      expect(await barista.orders(), isEmpty);
      order =
          (await cashier.sendOrder(
                orderId: id,
                commandId: commandId(),
                expectedVersion: order['version'] as int,
              ))['order']
              as Map<String, dynamic>;
      expect(order['released'], isTrue);
      final queued = (await barista.orders()).single;
      expect(queued['id'], id);
      expect(queued['table'], '04');
      expect((queued['lines'] as List).single['note'], 'Less sweet');
      expect(queued.containsKey('paidCentavos'), isFalse);
      expect(queued.containsKey('totalCentavos'), isFalse);
      expect(queued.containsKey('payments'), isFalse);
      expect(
        ((queued['lines'] as List).single as Map).containsKey(
          'unitPriceCentavos',
        ),
        isFalse,
      );
      expectOperationalOnly(queued);

      await expectLater(
        cashier.markReady(
          orderId: id,
          commandId: commandId(),
          expectedVersion: order['version'] as int,
        ),
        throwsA(
          isA<HubException>().having(
            (error) => error.status,
            'role denial',
            403,
          ),
        ),
      );
      final readyResult = await barista.markReady(
        orderId: id,
        commandId: commandId(),
        expectedVersion: queued['version'] as int,
      );
      expect((readyResult['order'] as Map)['ready'], isTrue);
      expect(await barista.orders(), isEmpty);
      expect((await barista.orders(status: 'ready')).single['id'], id);
      final ingredients = await cashier.ingredients();
      expect(ingredients.single['onHandMilli'], 982000);
      expect(ingredients.single['reservedMilli'], 0);

      order = await cashier.order(id);
      await expectLater(
        cashier.requestReceipt(
          orderId: id,
          commandId: commandId(),
          expectedVersion: order['version'] as int,
        ),
        throwsA(
          isA<HubException>().having(
            (error) => error.status,
            'unpaid receipt denial',
            409,
          ),
        ),
      );
      order =
          (await cashier.addPayment(
                orderId: id,
                commandId: commandId(),
                expectedVersion: order['version'] as int,
                method: 'cash',
                amountCentavos: 16500,
                cashReceivedCentavos: 20000,
                verified: true,
              ))['order']
              as Map<String, dynamic>;
      expect(order['paidCentavos'], 16500);
      expect(order['ready'], isTrue);
      final receiptCommand = commandId();
      final receipt = await cashier.requestReceipt(
        orderId: id,
        commandId: receiptCommand,
        expectedVersion: order['version'] as int,
      );
      expect((receipt['job'] as Map)['status'], 'unconfigured');
      expect((receipt['job'] as Map)['type'], 'receipt');
      expect(
        await cashier.requestReceipt(
          orderId: id,
          commandId: receiptCommand,
          expectedVersion: order['version'] as int,
        ),
        receipt,
      );
      await expectLater(
        barista.openShift(commandId: commandId(), openingCashCentavos: 0),
        throwsA(
          isA<HubException>().having(
            (error) => error.status,
            'role denial',
            403,
          ),
        ),
      );

      final shift = (await cashier.currentShift())!;
      expectOperationalOnly(shift);
      final counted = await cashier.submitCount(
        shiftId: shift['id'] as String,
        commandId: commandId(),
        expectedVersion: shift['version'] as int,
        countedCashCentavos: 116500,
        note: 'Transport fixture blind count',
      );
      expectOperationalOnly(counted);
      final reviewed = await owner.mutate(
        '/api/v1/shifts/${shift['id']}/review',
        commandId: commandId(),
        expectedVersion: (counted['shift'] as Map)['version'] as int,
        payload: {'decision': 'approve'},
      );
      expect(reviewed['expectedCashCentavos'], 116500);
      expect(reviewed['varianceCentavos'], 0);
      expect(
        (await cashier.ingredients()).single['onHandMilli'],
        982000,
        reason:
            'settlement and receipt must not consume ready ingredients twice',
      );
      await cashier.logout();
      expect(cashier.session, isNull);
      await expectLater(
        cashier.products(),
        throwsA(
          isA<HubException>().having(
            (error) => error.status,
            'signed-out access',
            401,
          ),
        ),
      );
    },
    timeout: const Timeout(Duration(seconds: 120)),
  );
}
