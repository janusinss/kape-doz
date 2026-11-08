import 'package:cafe_dos/data/platform_recovery_storage.dart';
import 'package:cafe_dos/data/staff_recovery.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final channel = AndroidStaffRecoveryStorage.channel;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test(
    'native adapter awaits committed state and reads the saved record',
    () async {
      String? persisted;
      messenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'read') return persisted;
        expect(call.method, 'write');
        final arguments = call.arguments as Map;
        expect(arguments['expected'], persisted);
        persisted = arguments['value'] as String;
        return true;
      });
      final storage = AndroidStaffRecoveryStorage();
      expect(storage.durable, isTrue);
      expect(await storage.read(), isNull);
      await storage.write('fixture encrypted state');
      expect(await storage.read(), 'fixture encrypted state');
      await storage.write('fixture replacement state');
      expect(await storage.read(), 'fixture replacement state');
    },
  );

  test(
    'unconfirmed native write fails instead of acknowledging persistence',
    () async {
      messenger.setMockMethodCallHandler(channel, (_) async => false);
      await expectLater(
        AndroidStaffRecoveryStorage().write('fixture'),
        throwsA(isA<StaffRecoveryException>()),
      );
    },
  );

  test(
    'a stale storage instance cannot replace a newer saved command',
    () async {
      String? persisted;
      messenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'read') return persisted;
        final arguments = call.arguments as Map;
        if (arguments['expected'] != persisted) {
          throw PlatformException(code: 'state_changed');
        }
        persisted = arguments['value'] as String;
        return true;
      });
      final first = AndroidStaffRecoveryStorage();
      final second = AndroidStaffRecoveryStorage();
      await first.read();
      await second.read();
      await first.write('new pending command');
      await expectLater(
        second.write('stale state'),
        throwsA(isA<StaffRecoveryException>()),
      );
      expect(persisted, 'new pending command');
      expect(await second.read(), 'new pending command');
      await second.write('reconciled state');
      expect(persisted, 'reconciled state');
    },
  );

  test(
    'native read failures preserve a controlled error without stored content',
    () async {
      messenger.setMockMethodCallHandler(channel, (_) async {
        throw PlatformException(
          code: 'key_lost',
          message: 'sensitive fixture record',
        );
      });
      try {
        await AndroidStaffRecoveryStorage().read();
        fail('An unreadable record must block recovery.');
      } on StaffRecoveryException catch (error) {
        expect(error.message, contains('could not be opened'));
        expect(error.toString(), isNot(contains('sensitive fixture')));
      }
    },
  );

  test('missing native channel is a storage failure', () async {
    await expectLater(
      AndroidStaffRecoveryStorage().read(),
      throwsA(isA<StaffRecoveryException>()),
    );
  });
}
