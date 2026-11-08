import 'dart:convert';

import 'hub_primitives.dart';

class StaffRecoveryException implements Exception {
  final String message;
  const StaffRecoveryException([
    this.message =
        'Recovery data could not be saved or read. Ask your administrator for help.',
  ]);

  @override
  String toString() => 'StaffRecoveryException: $message';
}

Never _invalidRecord() => throw const StaffRecoveryException(
  'The saved recovery data is invalid or uses an unsupported version. Ask your administrator for help.',
);

Uri _origin(Uri value) =>
    validateHubOrigin(
      value,
      allowInsecureLoopback: true,
      allowPrivateLanHttp: true,
    ) ??
    _invalidRecord();

Map<String, dynamic> _requireMap(Object? value, Set<String> keys) =>
    exactMap(value, keys) ? value as Map<String, dynamic> : _invalidRecord();

String _text(Object? value) {
  if (value is! String) _invalidRecord();
  return value;
}

Uri _decodedOrigin(Object? value) {
  final parsed = Uri.tryParse(_text(value));
  if (parsed == null) _invalidRecord();
  return _origin(parsed);
}

Object? _immutableJson(Object? value, [int depth = 0]) {
  if (depth > 12) _invalidRecord();
  if (value == null || value is bool) return value;
  if (value is String) {
    if (value.length > 32768) _invalidRecord();
    return value;
  }
  if (value is num) {
    if (value is! int || value < 0 || value > maxSafeInt) {
      _invalidRecord();
    }
    return value;
  }
  if (value is List) {
    if (value.length > 100) _invalidRecord();
    return List<Object?>.unmodifiable(
      value.map((item) => _immutableJson(item, depth + 1)),
    );
  }
  if (value is Map) {
    if (value.length > 100) _invalidRecord();
    final result = <String, dynamic>{};
    for (final entry in value.entries) {
      if (entry.key is! String) _invalidRecord();
      final key = entry.key as String;
      final compact = key.toLowerCase().replaceAll(RegExp(r'[_-]'), '');
      if (key.length > 120 ||
          RegExp(
            r'pin|password|secret|token|authorization|credential',
          ).hasMatch(compact) ||
          {
            'commandid',
            'expectedversion',
            'actorid',
            'branchid',
            'deviceid',
            'role',
            'huborigin',
          }.contains(compact)) {
        _invalidRecord();
      }
      result[key] = _immutableJson(entry.value, depth + 1);
    }
    return Map<String, dynamic>.unmodifiable(result);
  }
  _invalidRecord();
}

class StaffEnrollment {
  final Uri hubOrigin;
  final String deviceId, deviceSecret;
  final String? authorityId;

  StaffEnrollment({
    required Uri hubOrigin,
    required this.deviceId,
    required this.deviceSecret,
    this.authorityId,
  }) : hubOrigin = _origin(hubOrigin) {
    if (!validateDeviceCredentials(deviceId, deviceSecret) ||
        (authorityId != null && !uuidPattern.hasMatch(authorityId!))) {
      _invalidRecord();
    }
  }

  Map<String, dynamic> _toJson() => {
    'hubOrigin': hubOrigin.toString(),
    'deviceId': deviceId,
    'deviceSecret': deviceSecret,
    if (authorityId != null) 'authorityId': authorityId,
  };

  factory StaffEnrollment._fromJson(Object? value) {
    if (value is! Map<String, dynamic>) _invalidRecord();
    final hasAuth = value.containsKey('authorityId');
    final map = _requireMap(
      value,
      hasAuth
          ? {'hubOrigin', 'deviceId', 'deviceSecret', 'authorityId'}
          : {'hubOrigin', 'deviceId', 'deviceSecret'},
    );
    return StaffEnrollment(
      hubOrigin: _decodedOrigin(map['hubOrigin']),
      deviceId: _text(map['deviceId']),
      deviceSecret: _text(map['deviceSecret']),
      authorityId: map['authorityId'] == null
          ? null
          : _text(map['authorityId']),
    );
  }

  @override
  String toString() => 'StaffEnrollment(enrolled device)';
}

class PendingStaffCommand {
  final String commandId, label, deviceId, actorId, branchId, path;
  final Uri hubOrigin;
  final HubRole role;
  final Map<String, dynamic> payload;
  final int? expectedVersion;
  final int createdAt;

  PendingStaffCommand({
    required this.commandId,
    required this.label,
    required Uri hubOrigin,
    required this.deviceId,
    required this.actorId,
    required this.branchId,
    required this.role,
    required this.path,
    required Map<String, dynamic> payload,
    this.expectedVersion,
    required this.createdAt,
  }) : hubOrigin = _origin(hubOrigin),
       payload = _immutableJson(payload) as Map<String, dynamic> {
    final route = matchStaffCommandRoute(path);
    if (!uuidPattern.hasMatch(commandId) ||
        label.trim().isEmpty ||
        label.length > 120 ||
        ![deviceId, actorId, branchId].every(idPattern.hasMatch) ||
        route == null ||
        route.role != role ||
        createdAt < 0 ||
        createdAt > maxSafeInt ||
        (expectedVersion != null &&
            (expectedVersion! < 1 || expectedVersion! > 1000000000)) ||
        utf8.encode(jsonEncode(this.payload)).length > 32768) {
      _invalidRecord();
    }
  }

  bool matches({
    required Uri hubOrigin,
    required String deviceId,
    required HubActor actor,
  }) {
    return this.hubOrigin == _origin(hubOrigin) &&
        this.deviceId == deviceId &&
        actor.id == actorId &&
        actor.branchId == branchId &&
        actor.role == role;
  }

  // Derived from the persisted route, including descriptors saved by older apps.
  String get businessAction =>
      (matchStaffCommandRoute(path) ?? (throw const StaffRecoveryException()))
          .action(payload);

  Map<String, dynamic> _toJson() => {
    'commandId': commandId,
    'label': label,
    'hubOrigin': hubOrigin.toString(),
    'deviceId': deviceId,
    'actorId': actorId,
    'branchId': branchId,
    'role': role.name,
    'path': path,
    'payload': payload,
    'expectedVersion': expectedVersion,
    'createdAt': createdAt,
  };

  factory PendingStaffCommand._fromJson(Object? value) {
    final map = _requireMap(value, {
      'commandId',
      'label',
      'hubOrigin',
      'deviceId',
      'actorId',
      'branchId',
      'role',
      'path',
      'payload',
      'expectedVersion',
      'createdAt',
    });
    final roleName = _text(map['role']);
    final role = HubRole.values.where(
      (candidate) => candidate.name == roleName,
    );
    if (role.length != 1 ||
        map['payload'] is! Map<String, dynamic> ||
        map['createdAt'] is! int ||
        (map['expectedVersion'] != null && map['expectedVersion'] is! int)) {
      _invalidRecord();
    }
    return PendingStaffCommand(
      commandId: _text(map['commandId']),
      label: _text(map['label']),
      hubOrigin: _decodedOrigin(map['hubOrigin']),
      deviceId: _text(map['deviceId']),
      actorId: _text(map['actorId']),
      branchId: _text(map['branchId']),
      role: role.single,
      path: _text(map['path']),
      payload: map['payload'] as Map<String, dynamic>,
      expectedVersion: map['expectedVersion'] as int?,
      createdAt: map['createdAt'] as int,
    );
  }

  @override
  String toString() => 'PendingStaffCommand(pending staff operation)';
}

class StaffRecoveryState {
  final StaffEnrollment? enrollment;
  final PendingStaffCommand? pending;
  const StaffRecoveryState({this.enrollment, this.pending});

  @override
  String toString() =>
      'StaffRecoveryState(enrolled: ${enrollment != null}, pending: ${pending != null})';
}

abstract interface class StaffRecoveryStorage {
  bool get durable;
  Future<String?> read();
  Future<void> write(String value);
}

class MemoryStaffRecoveryStorage implements StaffRecoveryStorage {
  String? _value;

  @override
  bool get durable => false;

  @override
  Future<String?> read() async => _value;

  @override
  Future<void> write(String value) async {
    _value = value;
  }
}

class StaffRecoveryStore {
  final StaffRecoveryStorage _storage;
  final bool allowInsecureLoopback;
  final bool allowPrivateLanHttp;
  Future<void> _queue = Future<void>.value();

  StaffRecoveryStore(
    this._storage, {
    this.allowInsecureLoopback = false,
    this.allowPrivateLanHttp = false,
  });
  bool get durable => _storage.durable;

  Future<T> _serialized<T>(Future<T> Function() action) {
    final next = _queue.then((_) => action());
    // The caller receives `next` errors. Keep the serialization queue usable for
    // an explicit retry without suppressing that returned failure.
    _queue = next.then<void>(
      (_) {},
      onError: (Object error, StackTrace trace) {},
    );
    return next;
  }

  void _checkOrigin(Uri origin) {
    if (validateHubOrigin(
          origin,
          allowInsecureLoopback: allowInsecureLoopback,
          allowPrivateLanHttp: allowPrivateLanHttp,
        ) ==
        null) {
      _invalidRecord();
    }
  }

  Future<StaffRecoveryState> _read() async {
    String? raw;
    try {
      raw = await _storage.read();
    } catch (_) {
      throw const StaffRecoveryException();
    }
    if (raw == null) return const StaffRecoveryState();
    try {
      if (utf8.encode(raw).length > 65536) _invalidRecord();
      final record = _requireMap(jsonDecode(raw), {
        'version',
        'enrollment',
        'pending',
      });
      if (record['version'] is! int || record['version'] != 1) _invalidRecord();
      final enrollment = record['enrollment'] == null
          ? null
          : StaffEnrollment._fromJson(record['enrollment']);
      final pending = record['pending'] == null
          ? null
          : PendingStaffCommand._fromJson(record['pending']);
      if (enrollment != null) _checkOrigin(enrollment.hubOrigin);
      if (pending != null &&
          (enrollment == null ||
              pending.hubOrigin != enrollment.hubOrigin ||
              pending.deviceId != enrollment.deviceId)) {
        _invalidRecord();
      }
      return StaffRecoveryState(enrollment: enrollment, pending: pending);
    } on StaffRecoveryException {
      rethrow;
    } catch (_) {
      _invalidRecord();
    }
  }

  Future<void> _write(StaffRecoveryState state) async {
    final serialized = jsonEncode({
      'version': 1,
      'enrollment': state.enrollment?._toJson(),
      'pending': state.pending?._toJson(),
    });
    try {
      await _storage.write(serialized);
    } catch (_) {
      throw const StaffRecoveryException();
    }
  }

  Future<StaffRecoveryState> load() => _serialized(_read);

  Future<void> saveValidatedEnrollment(StaffEnrollment enrollment) =>
      _serialized(() async {
        _checkOrigin(enrollment.hubOrigin);
        final state = await _read();
        if (state.pending != null &&
            (state.enrollment!.hubOrigin != enrollment.hubOrigin ||
                state.enrollment!.deviceId != enrollment.deviceId ||
                state.enrollment!.deviceSecret != enrollment.deviceSecret)) {
          throw const StaffRecoveryException(
            'Resolve the saved operation before changing device enrollment.',
          );
        }
        await _write(
          StaffRecoveryState(enrollment: enrollment, pending: state.pending),
        );
      });

  Future<void> savePending(PendingStaffCommand command) =>
      _serialized(() async {
        _checkOrigin(command.hubOrigin);
        final state = await _read();
        if (state.enrollment == null ||
            state.enrollment!.hubOrigin != command.hubOrigin ||
            state.enrollment!.deviceId != command.deviceId) {
          throw const StaffRecoveryException(
            'Sign in with the enrolled device before saving an operation.',
          );
        }
        if (state.pending != null &&
            jsonEncode(_canonical(state.pending!._toJson())) !=
                jsonEncode(_canonical(command._toJson()))) {
          throw const StaffRecoveryException(
            'Resolve the saved operation before starting another one.',
          );
        }
        await _write(
          StaffRecoveryState(enrollment: state.enrollment, pending: command),
        );
      });

  Future<void> clearPending(String commandId) => _serialized(() async {
    if (!uuidPattern.hasMatch(commandId)) _invalidRecord();
    final state = await _read();
    if (state.pending == null) return;
    if (state.pending!.commandId != commandId) {
      throw const StaffRecoveryException(
        'The saved operation does not match the requested cleanup.',
      );
    }
    await _write(StaffRecoveryState(enrollment: state.enrollment));
  });

  Future<StaffRecoveryState> relocateHubOrigin({
    required Uri newHubOrigin,
    String? verifiedAuthorityId,
  }) => _serialized(() async {
    _checkOrigin(newHubOrigin);
    final normalizedOrigin = _origin(newHubOrigin);
    if (verifiedAuthorityId != null &&
        !uuidPattern.hasMatch(verifiedAuthorityId)) {
      _invalidRecord();
    }
    final state = await _read();
    final current = state.enrollment;
    if (current == null) {
      throw const StaffRecoveryException(
        'Enroll this device before switching hub addresses.',
      );
    }
    if (current.authorityId != null &&
        verifiedAuthorityId != null &&
        current.authorityId != verifiedAuthorityId) {
      throw const StaffRecoveryException(
        'The hub at the new address belongs to a different authority.',
      );
    }
    final updatedEnrollment = StaffEnrollment(
      hubOrigin: normalizedOrigin,
      deviceId: current.deviceId,
      deviceSecret: current.deviceSecret,
      authorityId: verifiedAuthorityId ?? current.authorityId,
    );
    final updatedPending = state.pending == null
        ? null
        : PendingStaffCommand(
            commandId: state.pending!.commandId,
            label: state.pending!.label,
            hubOrigin: normalizedOrigin,
            deviceId: state.pending!.deviceId,
            actorId: state.pending!.actorId,
            branchId: state.pending!.branchId,
            role: state.pending!.role,
            path: state.pending!.path,
            payload: state.pending!.payload,
            expectedVersion: state.pending!.expectedVersion,
            createdAt: state.pending!.createdAt,
          );
    final nextState = StaffRecoveryState(
      enrollment: updatedEnrollment,
      pending: updatedPending,
    );
    await _write(nextState);
    return nextState;
  });

  Future<void> clearEnrollment() => _serialized(() async {
    final state = await _read();
    if (state.pending != null) {
      throw const StaffRecoveryException(
        'Resolve the saved operation before unpairing this device.',
      );
    }
    await _write(const StaffRecoveryState());
  });

  @override
  String toString() => 'StaffRecoveryStore(durable: $durable)';
}

Object? _canonical(Object? value) {
  if (value is Map<String, dynamic>) {
    return {
      for (final key in value.keys.toList()..sort())
        key: _canonical(value[key]),
    };
  }
  if (value is List) return value.map(_canonical).toList();
  return value;
}
