import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../domain/cafe_engine.dart';

/// Development persistence only. Production ledger uses a transactional repository.
class DevelopmentStore {
  static const key = 'cafe_dos_development_v1';
  Future<CafeEngine> load() async {
    final raw = await SharedPreferencesAsync().getString(key);
    return raw == null
        ? CafeEngine.sample()
        : CafeEngine.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> save(CafeEngine engine) =>
      SharedPreferencesAsync().setString(key, jsonEncode(engine.toJson()));
}
