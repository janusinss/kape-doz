import 'package:flutter/widgets.dart';

import 'admin/admin_app.dart';
import 'staff_wireframe/staff_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final view = Uri.base.queryParameters['view'];
  runApp(view == 'admin' ? const AdminWireframeApp() : const StaffWireframeApp());
}
