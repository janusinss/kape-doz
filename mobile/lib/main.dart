import 'package:flutter/material.dart';
import 'connected/hub_setup.dart';

export 'legacy_demo_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const HubSetupApp());
}
