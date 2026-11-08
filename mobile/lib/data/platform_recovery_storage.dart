import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'hub_primitives.dart';
import 'staff_recovery.dart';

/// Android commits one authenticated encrypted file before acknowledging writes.
class AndroidStaffRecoveryStorage implements StaffRecoveryStorage {
  static const channel = MethodChannel('com.cafedos/recovery');
  String? _observed;
  bool _hasRead = false;

  @override
  bool get durable => true;

  @override
  Future<String?> read() async {
    try {
      final value = await channel.invokeMethod<String>('read');
      _observed = value;
      _hasRead = true;
      return value;
    } catch (_) {
      throw const StaffRecoveryException(storageUnavailableMessage);
    }
  }

  @override
  Future<void> write(String value) async {
    try {
      if (!_hasRead) await read();
      final committed = await channel.invokeMethod<bool>('write', {
        'value': value,
        'expected': _observed,
      });
      if (committed != true) throw StateError('Storage did not commit.');
      _observed = value;
    } catch (_) {
      _hasRead = false;
      throw const StaffRecoveryException(
        'Device state could not be saved. Retry before continuing.',
      );
    }
  }
}

StaffRecoveryStore createPlatformRecoveryStore() {
  final storage = !kIsWeb && defaultTargetPlatform == TargetPlatform.android
      ? AndroidStaffRecoveryStorage()
      : MemoryStaffRecoveryStorage();
  return StaffRecoveryStore(
    storage,
    allowInsecureLoopback: true,
    allowPrivateLanHttp: true,
  );
}
