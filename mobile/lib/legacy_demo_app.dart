import 'dart:async';
import 'package:flutter/material.dart';
import 'domain/cafe_engine.dart';
import 'data/development_store.dart';
import 'data/hub_primitives.dart';
import 'app/cafe_theme.dart';

const ink = CafeTheme.ink,
    canvas = CafeTheme.canvas,
    border = CafeTheme.border,
    warm = CafeTheme.warm,
    accent = CafeTheme.accent;
String money(int amount) => formatCentavos(amount);
const ingredientNames = {
  'beans': 'Espresso beans',
  'milk': 'Whole milk',
  'syrup': 'Syrup',
  'cup': '16 oz cup',
  'lid': 'Lid',
  'matcha': 'Matcha powder',
  'chocolate': 'Chocolate',
};
String unit(String id) => ['cup', 'lid'].contains(id)
    ? 'pcs'
    : ['milk', 'syrup', 'chocolate'].contains(id)
    ? 'ml'
    : 'g';
int? parseMoney(String s) => parseDecimalFixed(s, 2, max: maxSafeInt);

class CoffeeBeanPainter extends CustomPainter {
  const CoffeeBeanPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    canvas.save();
    canvas.translate(w / 2, h / 2);
    canvas.rotate(-0.384); // -22 degrees

    final rect = Rect.fromCenter(center: Offset.zero, width: w, height: h);

    // Roasted espresso gradient body
    final beanPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment(-0.64, -0.76),
        end: Alignment(0.68, 0.76),
        colors: [
          Color(0xFFA46439),
          Color(0xFF884C25),
          Color(0xFF673617),
          Color(0xFF3D1D0B),
        ],
        stops: [0.0, 0.28, 0.68, 1.0],
      ).createShader(rect)
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    // Organic bean silhouette with slight indentations
    final beanPath = Path()
      ..moveTo(0, -h * 0.42)
      ..cubicTo(w * 0.32, -h * 0.41, w * 0.52, -h * 0.25, w * 0.52, 0)
      ..cubicTo(w * 0.52, h * 0.25, w * 0.32, h * 0.42, 0, h * 0.43)
      ..cubicTo(-w * 0.32, h * 0.42, -w * 0.52, h * 0.25, -w * 0.52, 0)
      ..cubicTo(-w * 0.52, -h * 0.25, -w * 0.32, -h * 0.41, 0, -h * 0.42)
      ..close();
    canvas.drawPath(beanPath, beanPaint);

    // Left ambient depth shadow
    final shadowPath = Path()
      ..moveTo(0, -h * 0.415)
      ..cubicTo(-w * 0.28, -h * 0.40, -w * 0.49, -h * 0.25, -w * 0.49, 0)
      ..cubicTo(-w * 0.49, h * 0.24, -w * 0.28, h * 0.41, 0, h * 0.425)
      ..cubicTo(-w * 0.12, h * 0.24, -w * 0.12, -h * 0.24, 0, -h * 0.415)
      ..close();
    final shadowPaint = Paint()
      ..color = const Color(0x5A251006)
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;
    canvas.drawPath(shadowPath, shadowPaint);

    // Deep under-seam cleft groove
    final groovePath = Path()
      ..moveTo(0, -h * 0.42)
      ..cubicTo(w * 0.14, -h * 0.23, -w * 0.16, -h * 0.09, w * 0.02, h * 0.09)
      ..cubicTo(w * 0.13, h * 0.19, w * 0.04, h * 0.33, 0, h * 0.43);
    final groovePaint = Paint()
      ..color = const Color(0xFF1F0D04)
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.125
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..isAntiAlias = true;
    canvas.drawPath(groovePath, groovePaint);

    // Crisp artisanal cleft seam line
    final seamPath = Path()
      ..moveTo(0, -h * 0.40)
      ..cubicTo(w * 0.13, -h * 0.23, -w * 0.15, -h * 0.09, w * 0.02, h * 0.08)
      ..cubicTo(w * 0.11, h * 0.18, w * 0.03, h * 0.32, 0, h * 0.41);
    final seamPaint = Paint()
      ..color = const Color(0xFFFFFDF9)
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.06
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..isAntiAlias = true;
    canvas.drawPath(seamPath, seamPaint);

    // Upper right caramel gloss highlight
    final sheenPath = Path()
      ..moveTo(w * 0.12, -h * 0.36)
      ..cubicTo(w * 0.32, -h * 0.30, w * 0.43, -h * 0.18, w * 0.43, -h * 0.02)
      ..cubicTo(w * 0.43, h * 0.06, w * 0.38, h * 0.13, w * 0.31, h * 0.19);
    final sheenPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xF5F7C498), Color(0x99E29A5C), Color(0x0DA46439)],
        stops: [0.0, 0.5, 1.0],
      ).createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.075
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;
    canvas.drawPath(sheenPath, sheenPaint);

    // Lower right specular accent
    final accentPath = Path()
      ..moveTo(w * 0.25, h * 0.25)
      ..cubicTo(w * 0.21, h * 0.30, w * 0.14, h * 0.34, w * 0.07, h * 0.36);
    final accentPaint = Paint()
      ..color = const Color(0xD9F2B583)
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.05
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;
    canvas.drawPath(accentPath, accentPaint);

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class CoffeeBeanLogo extends StatelessWidget {
  final double size;
  const CoffeeBeanLogo({super.key, this.size = 32});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: const CustomPaint(painter: CoffeeBeanPainter()),
    );
  }
}

class StaffMember {
  final String id;
  final String name;
  final String role;
  final String pin;
  final String initials;
  final String shiftStarted;
  const StaffMember({
    required this.id,
    required this.name,
    required this.role,
    required this.pin,
    required this.initials,
    required this.shiftStarted,
  });
}

const defaultStaffList = [
  StaffMember(
    id: 'EMP-0428',
    name: 'Elina Gilbert',
    role: 'Cashier',
    pin: '1234',
    initials: 'EG',
    shiftStarted: '08:00 AM',
  ),
  StaffMember(
    id: 'EMP-0429',
    name: 'Marco Rossi',
    role: 'Senior Barista',
    pin: '2345',
    initials: 'MR',
    shiftStarted: '07:30 AM',
  ),
  StaffMember(
    id: 'EMP-0410',
    name: 'Sarah Jenkins',
    role: 'Shift Manager',
    pin: '9999',
    initials: 'SJ',
    shiftStarted: '07:00 AM',
  ),
];

class Startup extends StatefulWidget {
  const Startup({super.key});
  @override
  State<Startup> createState() => _StartupState();
}

class _StartupState extends State<Startup> {
  final store = DevelopmentStore();
  late Future<CafeEngine> loading;
  @override
  void initState() {
    super.initState();
    loading = store.load();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<CafeEngine>(
    future: loading,
    builder: (context, s) {
      if (s.hasData) return CafeDosApp(engine: s.data!, persist: store.save);
      return MaterialApp(
        home: Scaffold(
          body: Center(
            child: s.hasError
                ? Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'Saved data could not be loaded. It has not been reset.',
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: () =>
                              setState(() => loading = store.load()),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  )
                : const CircularProgressIndicator(),
          ),
        ),
      );
    },
  );
}

class CafeDosApp extends StatefulWidget {
  final CafeEngine engine;
  final Future<void> Function(CafeEngine) persist;
  const CafeDosApp({super.key, required this.engine, required this.persist});
  @override
  State<CafeDosApp> createState() => _CafeDosAppState();
}

class _CafeDosAppState extends State<CafeDosApp> {
  late CafeEngine engine;
  final messenger = GlobalKey<ScaffoldMessengerState>();
  int screen = 0;
  bool busy = false, dineIn = true;
  String query = '', category = 'Favorites';
  final List<OrderLine> cart = [];
  final tableNumber = TextEditingController();
  String? currentOrderId;
  bool initializingOrder = false;
  bool transitioningOrder = false;
  Future<bool> tableWrites = Future<bool>.value(true);
  Future<void> writeIdle = Future<void>.value();
  String? wasteAmountError;
  String wasteIngredient = 'beans', wasteReason = 'Dial-in';
  final wasteAmount = TextEditingController(),
      wasteNote = TextEditingController();

  StaffMember currentStaff = defaultStaffList.first;
  bool isTerminalLocked = false;
  String lockPinEntered = '';
  String? lockError;

  int cashDrawerFloatCentavos = 200000;
  final Set<String> dismissedNotificationIds = {};
  void _onTableChanged() {
    if (mounted) setState(() {});
  }

  @override
  void initState() {
    super.initState();
    tableNumber.addListener(_onTableChanged);
    engine = widget.engine;
    if (engine.workingOrders.isNotEmpty) {
      adoptOrder(engine.workingOrders.first);
    } else {
      initializingOrder = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) createInitialOrder();
      });
    }
  }

  @override
  void dispose() {
    tableNumber.removeListener(_onTableChanged);
    tableNumber.dispose();
    wasteAmount.dispose();
    wasteNote.dispose();
    super.dispose();
  }

  void message(String s) =>
      messenger.currentState?.showSnackBar(SnackBar(content: Text(s)));
  Future<bool> change(void Function(CafeEngine) action) async {
    if (busy) return false;
    final done = Completer<void>();
    writeIdle = done.future;
    setState(() => busy = true);
    try {
      final next = CafeEngine.fromJson(engine.toJson());
      action(next);
      await widget.persist(next);
      if (mounted) setState(() => engine = next);
      return true;
    } catch (e) {
      message(
        'Could not save. Your previous saved data is unchanged. Please retry.',
      );
      return false;
    } finally {
      if (mounted) setState(() => busy = false);
      done.complete();
    }
  }

  ThemeData get theme => CafeTheme.light;
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: theme,
    scaffoldMessengerKey: messenger,
    home: Builder(
      builder: (context) {
        final isTablet = MediaQuery.sizeOf(context).width >= 900;
        return Scaffold(
          backgroundColor: CafeTheme.canvas,
          body: Stack(
            children: [
              SafeArea(
                top: !isTablet,
                child: Row(
                  children: [
                    if (isTablet)
                      Container(
                        width: 64,
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          border: Border(
                            right: BorderSide(color: CafeTheme.border),
                          ),
                        ),
                        child: staffNavigation(rail: true),
                      ),
                    Expanded(
                      child: Column(
                        children: [
                          topNavHeader(context, isTablet: isTablet),
                          if (busy) const LinearProgressIndicator(minHeight: 3),
                          Expanded(
                            child: screen == 0
                                ? register(context)
                                : screen == 1
                                ? kitchen(context)
                                : screen == 2
                                ? tablesView(context)
                                : wasteView(context),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (isTerminalLocked) terminalLockOverlay(context),
            ],
          ),
          bottomNavigationBar: isTablet
              ? null
              : Container(
                  height: 64,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    border: Border(top: BorderSide(color: CafeTheme.border)),
                  ),
                  child: staffNavigation(rail: false),
                ),
        );
      },
    ),
  );

  Widget topNavHeader(BuildContext context, {required bool isTablet}) {
    return Container(
      height: 60,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: CafeTheme.border)),
      ),
      padding: EdgeInsets.symmetric(horizontal: isTablet ? 20 : 14),
      child: Row(
        children: [
          if (!isTablet) ...[
            Container(
              width: 36,
              height: 36,
              margin: const EdgeInsets.only(right: 12),
              alignment: Alignment.center,
              child: const CoffeeBeanLogo(size: 30),
            ),
          ],
          if (screen == 0) ...[
            if (isTablet)
              SizedBox(
                width: 280,
                height: 38,
                child: Container(
                  decoration: BoxDecoration(
                    color: CafeTheme.field,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: TextField(
                    onChanged: (v) => setState(() => query = v),
                    decoration: const InputDecoration(
                      isDense: true,
                      hintText: 'Search products...',
                      hintStyle: TextStyle(
                        color: CafeTheme.muted,
                        fontSize: 13,
                      ),
                      prefixIcon: Icon(
                        Icons.search,
                        size: 19,
                        color: CafeTheme.muted,
                      ),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 9,
                      ),
                    ),
                  ),
                ),
              )
            else
              Expanded(
                child: SizedBox(
                  height: 38,
                  child: Container(
                    decoration: BoxDecoration(
                      color: CafeTheme.field,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: TextField(
                      onChanged: (v) => setState(() => query = v),
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText: 'Search products...',
                        hintStyle: TextStyle(
                          color: CafeTheme.muted,
                          fontSize: 13,
                        ),
                        prefixIcon: Icon(
                          Icons.search,
                          size: 19,
                          color: CafeTheme.muted,
                        ),
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 9,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            const Spacer(),
          ] else ...[
            if (isTablet) ...[
              Text(
                screen == 1
                    ? 'Barista Station'
                    : screen == 2
                    ? 'Floor Plan & Tables'
                    : 'Waste & Dial-in',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ink,
                  letterSpacing: -0.3,
                ),
              ),
            ],
            const Spacer(),
          ],
          if (!isTablet) ...[
            topNavBell(context),
            const SizedBox(width: 8),
            topNavProfile(context, compact: true),
          ] else ...[
            topNavBell(context),
            const SizedBox(width: 8),
            topNavSettings(context),
            const SizedBox(width: 8),
            topNavLogout(context),
            const SizedBox(width: 12),
            topNavProfile(context, compact: false),
          ],
        ],
      ),
    );
  }

  Widget circularNavButton({
    required Widget child,
    required VoidCallback onTap,
    String? tooltip,
  }) => Tooltip(
    message: tooltip ?? '',
    child: Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: CafeTheme.border),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Center(child: child),
        ),
      ),
    ),
  );

  List<Map<String, dynamic>> get activeNotifications {
    final list = <Map<String, dynamic>>[];
    // 1. Pending kitchen orders
    final pendingOrders = engine.orders.where((o) => !o.ready).toList();
    for (final o in pendingOrders) {
      final id = 'order-${o.id}';
      if (!dismissedNotificationIds.contains(id)) {
        list.add({
          'id': id,
          'type': 'order',
          'title': 'Kitchen Order #${o.id}',
          'subtitle':
              '${o.quantity} ${o.quantity == 1 ? "drink" : "drinks"} · ${o.dineIn ? (o.table.isEmpty ? "Dine In" : "Table ${o.table}") : "Takeout"}',
          'time': 'Needs prep',
          'icon': Icons.coffee_rounded,
          'color': CafeTheme.accent,
          'actionLabel': 'Open Barista',
          'action': () {
            setState(() => screen = 1);
          },
        });
      }
    }

    // 2. Low inventory alerts (< 25% threshold)
    final thresholds = {
      'beans': 300,
      'milk': 2000,
      'cup': 50,
      'lid': 50,
      'syrup': 500,
      'chocolate': 250,
      'matcha': 100,
    };
    for (final entry in thresholds.entries) {
      final current = engine.stock[entry.key] ?? 0;
      if (current <= entry.value) {
        final id = 'stock-${entry.key}';
        if (!dismissedNotificationIds.contains(id)) {
          final name = ingredientNames[entry.key] ?? entry.key;
          list.add({
            'id': id,
            'type': 'stock',
            'title': 'Low Stock Alert',
            'subtitle': '$name is low: $current ${unit(entry.key)} remaining',
            'time': 'Restock alert',
            'icon': Icons.warning_amber_rounded,
            'color': const Color(0xFFD97706),
            'actionLabel': 'Stock & Waste',
            'action': () {
              setState(() => screen = 3);
            },
          });
        }
      }
    }

    // 3. Print queue
    final pendingPrint = engine.printJobs
        .where((j) => j['status'] != 'printed')
        .toList();
    if (pendingPrint.isNotEmpty &&
        !dismissedNotificationIds.contains('print-queue')) {
      list.add({
        'id': 'print-queue',
        'type': 'print',
        'title': 'Thermal Print Queue',
        'subtitle':
            '${pendingPrint.length} print ${pendingPrint.length == 1 ? "job" : "jobs"} in spooler',
        'time': 'Spooler active',
        'icon': Icons.print_outlined,
        'color': const Color(0xFF2563EB),
        'actionLabel': 'View Settings',
        'action': () {
          showSettingsDialog(context);
        },
      });
    }

    return list;
  }

  Widget topNavBell(BuildContext context) {
    final count = activeNotifications.length;
    return circularNavButton(
      tooltip: count > 0 ? '$count Unread Notifications' : 'Notifications',
      onTap: () => showNotificationsDialog(context),
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          const Icon(Icons.notifications_none_outlined, size: 20, color: ink),
          if (count > 0)
            Positioned(
              top: 5,
              right: 6,
              child: Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: Color(0xFFE54D2E),
                  shape: BoxShape.circle,
                ),
              ),
            ),
        ],
      ),
    );
  }

  void showNotificationsDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (dialogCtx, setModalState) {
          final items = activeNotifications;
          return AlertDialog(
            backgroundColor: Colors.white,
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            titlePadding: const EdgeInsets.fromLTRB(22, 20, 16, 12),
            contentPadding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
            title: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: const BoxDecoration(
                    color: CafeTheme.warm,
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Icon(
                      Icons.notifications_rounded,
                      size: 18,
                      color: accent,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                const Text(
                  'Notifications',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
                const SizedBox(width: 8),
                if (items.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: accent,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '${items.length}',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ),
                const Spacer(),
                if (items.isNotEmpty)
                  TextButton(
                    onPressed: () {
                      setState(() {
                        for (final item in items) {
                          dismissedNotificationIds.add(item['id'] as String);
                        }
                      });
                      setModalState(() {});
                    },
                    child: const Text(
                      'Clear all',
                      style: TextStyle(fontSize: 13, color: CafeTheme.muted),
                    ),
                  ),
                IconButton(
                  icon: const Icon(
                    Icons.close,
                    size: 20,
                    color: CafeTheme.muted,
                  ),
                  onPressed: () => Navigator.pop(dialogCtx),
                ),
              ],
            ),
            content: SizedBox(
              width: 440,
              child: items.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 36),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: const [
                          Icon(
                            Icons.check_circle_outline_rounded,
                            size: 48,
                            color: Color(0xFF10B981),
                          ),
                          SizedBox(height: 12),
                          Text(
                            'All caught up!',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: ink,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'No active kitchen alerts or low stock items.',
                            style: TextStyle(
                              fontSize: 13,
                              color: CafeTheme.muted,
                            ),
                          ),
                        ],
                      ),
                    )
                  : SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (final item in items) ...[
                            Container(
                              margin: const EdgeInsets.only(bottom: 10),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: CafeTheme.field,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: CafeTheme.border),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    width: 36,
                                    height: 36,
                                    decoration: BoxDecoration(
                                      color: (item['color'] as Color)
                                          .withValues(alpha: 0.15),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Center(
                                      child: Icon(
                                        item['icon'] as IconData,
                                        size: 20,
                                        color: item['color'] as Color,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Expanded(
                                              child: Text(
                                                item['title'] as String,
                                                style: const TextStyle(
                                                  fontSize: 14,
                                                  fontWeight: FontWeight.w700,
                                                  color: ink,
                                                ),
                                              ),
                                            ),
                                            Text(
                                              item['time'] as String,
                                              style: const TextStyle(
                                                fontSize: 11,
                                                color: CafeTheme.muted,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 3),
                                        Text(
                                          item['subtitle'] as String,
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: ink,
                                          ),
                                        ),
                                        const SizedBox(height: 8),
                                        Row(
                                          children: [
                                            FilledButton(
                                              onPressed: () {
                                                Navigator.pop(dialogCtx);
                                                (item['action']
                                                    as VoidCallback)();
                                              },
                                              style: FilledButton.styleFrom(
                                                backgroundColor: accent,
                                                foregroundColor: Colors.white,
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                      horizontal: 14,
                                                      vertical: 6,
                                                    ),
                                                minimumSize: const Size(0, 30),
                                                tapTargetSize:
                                                    MaterialTapTargetSize
                                                        .shrinkWrap,
                                                shape: RoundedRectangleBorder(
                                                  borderRadius:
                                                      BorderRadius.circular(8),
                                                ),
                                              ),
                                              child: Text(
                                                item['actionLabel'] as String,
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w700,
                                                ),
                                              ),
                                            ),
                                            const Spacer(),
                                            IconButton(
                                              icon: const Icon(
                                                Icons.delete_outline,
                                                size: 18,
                                                color: CafeTheme.muted,
                                              ),
                                              tooltip: 'Dismiss',
                                              onPressed: () {
                                                setState(() {
                                                  dismissedNotificationIds.add(
                                                    item['id'] as String,
                                                  );
                                                });
                                                setModalState(() {});
                                              },
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
            ),
          );
        },
      ),
    );
  }

  Widget topNavSettings(BuildContext context) => circularNavButton(
    tooltip: 'Settings',
    onTap: () => showSettingsDialog(context),
    child: const Icon(Icons.settings_outlined, size: 20, color: ink),
  );

  void showSettingsDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (dialogCtx, setModalState) => AlertDialog(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          titlePadding: const EdgeInsets.fromLTRB(22, 20, 16, 12),
          contentPadding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
          title: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(
                  color: CafeTheme.field,
                  shape: BoxShape.circle,
                ),
                child: const Center(
                  child: Icon(Icons.settings_outlined, size: 20, color: ink),
                ),
              ),
              const SizedBox(width: 10),
              const Text(
                'POS Terminal Settings',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close, size: 20, color: CafeTheme.muted),
                onPressed: () => Navigator.pop(dialogCtx),
              ),
            ],
          ),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: CafeTheme.field,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: CafeTheme.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Text(
                              'CAFÉ DOS',
                              style: TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 15,
                                color: ink,
                              ),
                            ),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFDCFCE7),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text(
                                'Terminal #01 · Online',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF166534),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'BGC High Street Branch · Currency: ₱ (PHP) · 12% VAT Included',
                          style: TextStyle(
                            fontSize: 12,
                            color: CafeTheme.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Hardware & Printing',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      'Receipt printer',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: Text(
                      'Not configured. Configure a supported printer before printing.\nCustomer receipts are optional after full payment.',
                      style: TextStyle(fontSize: 12, color: CafeTheme.muted),
                    ),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => message(
                      'Printer not configured. No test receipt was sent.',
                    ),
                    icon: const Icon(Icons.print, size: 16),
                    label: const Text('Print Test Receipt'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ink,
                      side: const BorderSide(color: CafeTheme.border),
                    ),
                  ),
                  const Divider(height: 32),
                  const Text(
                    'Cash Drawer',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Starting Float: ${money(cashDrawerFloatCentavos)}',
                          style: const TextStyle(fontSize: 13, color: ink),
                        ),
                      ),
                      FilledButton.tonalIcon(
                        onPressed: () {
                          message('Cash drawer triggered open');
                        },
                        icon: const Icon(Icons.point_of_sale_rounded, size: 16),
                        label: const Text('Kick Drawer'),
                        style: FilledButton.styleFrom(
                          backgroundColor: CafeTheme.warm,
                          foregroundColor: accent,
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 32),
                  const Text(
                    'Storage & Diagnostics',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Storage Engine: Local Persistent Store\nApplication Build: v1.0.4-pos (Zillo POS System)',
                    style: TextStyle(
                      fontSize: 12,
                      color: CafeTheme.muted,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(dialogCtx),
              style: FilledButton.styleFrom(
                backgroundColor: accent,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
  }

  Widget topNavLogout(BuildContext context) => circularNavButton(
    tooltip: 'Sign out / Lock',
    onTap: () => showLogoutOptions(context),
    child: const Icon(Icons.logout_rounded, size: 18, color: ink),
  );

  void showLogoutOptions(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(22, 20, 16, 12),
        contentPadding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: const BoxDecoration(
                color: CafeTheme.field,
                shape: BoxShape.circle,
              ),
              child: const Center(
                child: Icon(Icons.lock_outline_rounded, size: 18, color: ink),
              ),
            ),
            const SizedBox(width: 10),
            const Text(
              'Staff Session',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: ink,
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Signed in as ${currentStaff.name} (${currentStaff.role}).\nWhat would you like to do?',
              style: const TextStyle(fontSize: 14, color: ink, height: 1.35),
            ),
            const SizedBox(height: 18),
            ListTile(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: CafeTheme.border),
              ),
              tileColor: CafeTheme.field,
              leading: const Icon(Icons.lock_rounded, color: accent),
              title: const Text(
                'Lock Terminal',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
              ),
              subtitle: const Text(
                'Requires staff PIN to unlock',
                style: TextStyle(fontSize: 12, color: CafeTheme.muted),
              ),
              onTap: () {
                Navigator.pop(dialogCtx);
                setState(() {
                  isTerminalLocked = true;
                  lockPinEntered = '';
                  lockError = null;
                });
              },
            ),
            const SizedBox(height: 10),
            ListTile(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: CafeTheme.border),
              ),
              tileColor: CafeTheme.field,
              leading: const Icon(Icons.people_outline_rounded, color: ink),
              title: const Text(
                'Switch Staff / Cashier',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
              ),
              subtitle: const Text(
                'Switch to another crew member',
                style: TextStyle(fontSize: 12, color: CafeTheme.muted),
              ),
              onTap: () {
                Navigator.pop(dialogCtx);
                showSwitchStaffDialog(context);
              },
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx),
            child: const Text(
              'Cancel',
              style: TextStyle(color: CafeTheme.muted),
            ),
          ),
        ],
      ),
    );
  }

  Widget topNavProfile(BuildContext context, {bool compact = false}) => Tooltip(
    message: '${currentStaff.name} (${currentStaff.role})',
    child: Container(
      height: 38,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CafeTheme.border),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => showStaffProfileDialog(context),
          child: Padding(
            padding: EdgeInsets.fromLTRB(4, 4, compact ? 4 : 10, 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: const BoxDecoration(
                    color: Color(0xFFF1F5F9),
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Icon(Icons.person_rounded, size: 18, color: ink),
                  ),
                ),
                if (!compact) ...[
                  const SizedBox(width: 8),
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        currentStaff.name,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: ink,
                          height: 1.15,
                        ),
                      ),
                      Text(
                        currentStaff.role,
                        style: const TextStyle(
                          fontSize: 10,
                          color: CafeTheme.muted,
                          height: 1.15,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 6),
                  const Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 18,
                    color: CafeTheme.muted,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    ),
  );

  void showStaffProfileDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(22, 20, 16, 12),
        contentPadding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        title: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: const BoxDecoration(
                color: Color(0xFFF1F5F9),
                shape: BoxShape.circle,
              ),
              child: const Center(
                child: Icon(Icons.person_rounded, size: 22, color: ink),
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  currentStaff.name,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
                Text(
                  '${currentStaff.role} · ${currentStaff.id}',
                  style: const TextStyle(fontSize: 12, color: CafeTheme.muted),
                ),
              ],
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.close, size: 20, color: CafeTheme.muted),
              onPressed: () => Navigator.pop(dialogCtx),
            ),
          ],
        ),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: CafeTheme.field,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: CafeTheme.border),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Shift Clock-In',
                          style: TextStyle(
                            fontSize: 13,
                            color: CafeTheme.muted,
                          ),
                        ),
                        Text(
                          'Today, ${currentStaff.shiftStarted}',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: ink,
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 18),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Tickets Processed',
                          style: TextStyle(
                            fontSize: 13,
                            color: CafeTheme.muted,
                          ),
                        ),
                        Text(
                          '${engine.orders.length} tickets',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: ink,
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 18),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Shift Sales Revenue',
                          style: TextStyle(
                            fontSize: 13,
                            color: CafeTheme.muted,
                          ),
                        ),
                        Text(
                          money(
                            engine.orders.fold<int>(
                              0,
                              (s, o) => s + o.paidCentavos,
                            ),
                          ),
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: accent,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(dialogCtx);
                  showSwitchStaffDialog(context);
                },
                icon: const Icon(Icons.people_outline_rounded, size: 18),
                label: const Text('Switch Staff / Cashier'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: ink,
                  side: const BorderSide(color: CafeTheme.border),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: () {
                  Navigator.pop(dialogCtx);
                  setState(() {
                    isTerminalLocked = true;
                    lockPinEntered = '';
                    lockError = null;
                  });
                },
                icon: const Icon(Icons.lock_rounded, size: 18),
                label: const Text('Lock Terminal'),
                style: FilledButton.styleFrom(
                  backgroundColor: ink,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              TextButton.icon(
                onPressed: () {
                  Navigator.pop(dialogCtx);
                  showShiftSummary(context);
                },
                icon: const Icon(
                  Icons.receipt_long_rounded,
                  size: 16,
                  color: CafeTheme.muted,
                ),
                label: const Text(
                  'End Shift & View Z-Report',
                  style: TextStyle(color: CafeTheme.muted, fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void showSwitchStaffDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(22, 20, 16, 12),
        contentPadding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        title: const Text(
          'Select Cashier / Staff',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: ink,
          ),
        ),
        content: SizedBox(
          width: 380,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final staff in defaultStaffList) ...[
                ListTile(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(
                      color: currentStaff.id == staff.id
                          ? accent
                          : CafeTheme.border,
                      width: currentStaff.id == staff.id ? 1.5 : 1,
                    ),
                  ),
                  tileColor: currentStaff.id == staff.id
                      ? CafeTheme.warm
                      : CafeTheme.field,
                  leading: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: currentStaff.id == staff.id
                          ? accent
                          : Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        staff.initials,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: currentStaff.id == staff.id
                              ? Colors.white
                              : ink,
                        ),
                      ),
                    ),
                  ),
                  title: Text(
                    staff.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                  subtitle: Text(
                    '${staff.role} · ${staff.id}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: CafeTheme.muted,
                    ),
                  ),
                  trailing: currentStaff.id == staff.id
                      ? const Icon(
                          Icons.check_circle_rounded,
                          color: accent,
                          size: 20,
                        )
                      : null,
                  onTap: () {
                    setState(() {
                      currentStaff = staff;
                      isTerminalLocked = false;
                    });
                    Navigator.pop(dialogCtx);
                    message(
                      'Switched active cashier to ${staff.name} (${staff.role})',
                    );
                  },
                ),
                const SizedBox(height: 8),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void showShiftSummary(BuildContext context) {
    final totalRevenue = engine.orders.fold<int>(
      0,
      (s, o) => s + o.paidCentavos,
    );
    final totalOrders = engine.orders.length;
    showDialog<void>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(22, 20, 16, 12),
        contentPadding: const EdgeInsets.fromLTRB(22, 0, 22, 20),
        title: const Text(
          'Shift Z-Reading Summary',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: ink,
          ),
        ),
        content: SizedBox(
          width: 380,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Cashier: ${currentStaff.name} · ${currentStaff.id}',
                style: const TextStyle(fontSize: 12, color: CafeTheme.muted),
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: CafeTheme.field,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: CafeTheme.border),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Orders Completed:',
                          style: TextStyle(fontSize: 13),
                        ),
                        Text(
                          '$totalOrders',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Total Net Sales:',
                          style: TextStyle(fontSize: 13),
                        ),
                        Text(
                          money(totalRevenue),
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                            color: accent,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Cash Float Opening:',
                          style: TextStyle(fontSize: 13),
                        ),
                        Text(
                          money(cashDrawerFloatCentavos),
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 18),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Expected in Drawer:',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          money(cashDrawerFloatCentavos + totalRevenue),
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          OutlinedButton(
            onPressed: () {
              Navigator.pop(dialogCtx);
              message('Printer not configured. No Z-report was sent.');
            },
            child: const Text('Print Z-Report'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogCtx),
            style: FilledButton.styleFrom(backgroundColor: ink),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget terminalLockOverlay(BuildContext context) {
    return Positioned.fill(
      child: Material(
        color: Colors.black.withValues(alpha: 0.75),
        child: Center(
          child: Container(
            width: 380,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x33000000),
                  blurRadius: 30,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  child: const CoffeeBeanLogo(size: 46),
                ),
                const SizedBox(height: 12),
                const Text(
                  'CAFÉ DOS',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                    color: ink,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'TERMINAL LOCKED',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.8,
                    color: CafeTheme.muted,
                  ),
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: CafeTheme.field,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: CafeTheme.border),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 22,
                        height: 22,
                        decoration: const BoxDecoration(
                          color: Color(0xFFE2E8F0),
                          shape: BoxShape.circle,
                        ),
                        child: const Center(
                          child: Icon(Icons.person, size: 14, color: ink),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        ' ()',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: ink,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (int i = 0; i < 4; i++) ...[
                      Container(
                        width: 14,
                        height: 14,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: i < lockPinEntered.length
                              ? accent
                              : const Color(0xFFE2E8F0),
                        ),
                      ),
                      if (i < 3) const SizedBox(width: 14),
                    ],
                  ],
                ),
                if (lockError != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    lockError!,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFFDC2626),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                Column(
                  children: [
                    for (final row in [
                      ['1', '2', '3'],
                      ['4', '5', '6'],
                      ['7', '8', '9'],
                      ['back', '0', 'ok'],
                    ]) ...[
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          for (final key in row) ...[
                            InkWell(
                              borderRadius: BorderRadius.circular(14),
                              onTap: () {
                                setState(() {
                                  lockError = null;
                                  if (key == 'back') {
                                    if (lockPinEntered.isNotEmpty) {
                                      lockPinEntered = lockPinEntered.substring(
                                        0,
                                        lockPinEntered.length - 1,
                                      );
                                    }
                                  } else if (key == 'ok') {
                                    if (lockPinEntered == currentStaff.pin) {
                                      isTerminalLocked = false;
                                      lockPinEntered = '';
                                      message('Terminal unlocked for ');
                                    } else {
                                      lockError = 'Incorrect PIN. Try again.';
                                      lockPinEntered = '';
                                    }
                                  } else {
                                    if (lockPinEntered.length < 4) {
                                      lockPinEntered += key;
                                      if (lockPinEntered.length == 4) {
                                        if (lockPinEntered ==
                                            currentStaff.pin) {
                                          isTerminalLocked = false;
                                          lockPinEntered = '';
                                          message('Terminal unlocked for ');
                                        } else {
                                          lockError =
                                              'Incorrect PIN. Try again.';
                                          lockPinEntered = '';
                                        }
                                      }
                                    }
                                  }
                                });
                              },
                              child: Container(
                                width: 68,
                                height: 48,
                                margin: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: key == 'ok' ? accent : CafeTheme.field,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: CafeTheme.border),
                                ),
                                child: Center(
                                  child: key == 'back'
                                      ? const Icon(
                                          Icons.backspace_outlined,
                                          size: 19,
                                          color: ink,
                                        )
                                      : key == 'ok'
                                      ? const Icon(
                                          Icons.check_rounded,
                                          size: 22,
                                          color: Colors.white,
                                        )
                                      : Text(
                                          key,
                                          style: const TextStyle(
                                            fontSize: 17,
                                            fontWeight: FontWeight.w700,
                                            color: ink,
                                          ),
                                        ),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: () {
                        setState(() {
                          isTerminalLocked = false;
                          lockPinEntered = '';
                          lockError = null;
                        });
                        message('Quick unlocked ()');
                      },
                      child: const Text(
                        'Quick Unlock',
                        style: TextStyle(fontSize: 12, color: accent),
                      ),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: () {
                        showSwitchStaffDialog(context);
                      },
                      child: const Text(
                        'Switch Staff',
                        style: TextStyle(fontSize: 12, color: CafeTheme.muted),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget staffNavigation({bool rail = false}) {
    const names = ['Register', 'Barista station', 'Tables', 'Waste'];

    Widget navButton(int i) {
      final selected = screen == i;
      final iconData = [
        Icons.grid_view_rounded,
        selected ? Icons.receipt_long_rounded : Icons.receipt_long_outlined,
        selected ? Icons.layers_rounded : Icons.layers_outlined,
        selected ? Icons.delete_outline_rounded : Icons.delete_outline_rounded,
      ][i];

      return Tooltip(
        message: names[i],
        child: Semantics(
          selected: selected,
          button: true,
          label: names[i],
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: busy ? null : () => setState(() => screen = i),
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: selected ? CafeTheme.accent : Colors.transparent,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Icon(
                      iconData,
                      size: 22,
                      color: selected ? Colors.white : CafeTheme.muted,
                    ),
                    Positioned.fill(
                      child: Center(
                        child: Text(
                          names[i],
                          style: const TextStyle(
                            fontSize: 1,
                            color: Colors.transparent,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    if (rail) {
      return Column(
        children: [
          Container(
            height: 60,
            alignment: Alignment.center,
            child: const CoffeeBeanLogo(size: 34),
          ),
          const SizedBox(height: 10),
          navButton(0),
          const SizedBox(height: 12),
          navButton(1),
          const SizedBox(height: 12),
          navButton(2),
          const SizedBox(height: 12),
          navButton(3),
        ],
      );
    }

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [for (var i = 0; i < names.length; i++) navButton(i)],
    );
  }

  Widget panel(Widget child) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: border),
      borderRadius: BorderRadius.circular(CafeTheme.panelRadius),
    ),
    child: child,
  );
  void adoptOrder(WorkingOrder order) {
    currentOrderId = order.id;
    cart
      ..clear()
      ..addAll(order.lines);
    dineIn = order.dineIn;
    tableNumber.text = order.table;
  }

  Future<void> createInitialOrder() async {
    if (busy || !mounted) return;
    setState(() => initializingOrder = true);
    String? id;
    final saved = await change((e) => id = e.reserveWorkingOrder().id);
    if (!mounted) return;
    setState(() {
      initializingOrder = false;
      if (saved) adoptOrder(engine.workingOrders.firstWhere((o) => o.id == id));
    });
  }

  // Serialize each table edit: do not drop characters typed during a save.
  void queueTableWrite(String value) {
    final id = currentOrderId;
    if (id == null) return;
    tableWrites = tableWrites.then((_) async {
      while (busy) {
        await writeIdle;
      }
      if (!mounted) return false;
      return change((e) {
        final order = e.workingOrders.firstWhere((o) => o.id == id);
        e.updateWorkingOrder(
          id,
          order.lines,
          dineIn: order.dineIn,
          table: value,
        );
      });
    });
  }

  Future<bool> flushTable() async {
    Future<bool> pending;
    bool ok;
    do {
      pending = tableWrites;
      ok = await pending;
    } while (pending != tableWrites);
    if (!mounted || currentOrderId == null) return false;
    if (ok) return true;
    // Keep the typed value visible; retry it before any transition.
    queueTableWrite(tableNumber.text);
    do {
      pending = tableWrites;
      ok = await pending;
    } while (pending != tableWrites);
    return ok && mounted;
  }

  Future<T?> withOrderLock<T>(Future<T> Function() action) async {
    if (busy || transitioningOrder) return null;
    setState(() => transitioningOrder = true);
    try {
      return await action();
    } finally {
      if (mounted) setState(() => transitioningOrder = false);
    }
  }

  Future<bool> saveOrderContents(List<OrderLine> lines, bool service) async =>
      await withOrderLock(() async {
        if (!await flushTable() || !mounted) return false;
        final id = currentOrderId!;
        final table = tableNumber.text;
        final saved = await change(
          (e) => e.updateWorkingOrder(id, lines, dineIn: service, table: table),
        );
        if (saved && mounted) {
          final order = engine.workingOrders.firstWhere((o) => o.id == id);
          setState(() {
            cart
              ..clear()
              ..addAll(order.lines);
            dineIn = order.dineIn;
          });
        }
        return saved;
      }) ??
      false;

  Future<void> switchDraft(int index) async {
    await withOrderLock(() async {
      if (!await flushTable() || !mounted) return;
      setState(() => adoptOrder(engine.workingOrders[index]));
    });
  }

  Future<void> addDraft() async {
    await withOrderLock(() async {
      if (!await flushTable() || !mounted) return;
      String? id;
      final saved = await change((e) => id = e.reserveWorkingOrder().id);
      if (saved && mounted) {
        setState(
          () => adoptOrder(engine.workingOrders.firstWhere((o) => o.id == id)),
        );
      }
    });
  }

  Future<void> closeDraft(BuildContext context, int index) async {
    await withOrderLock(() async {
      if (engine.workingOrders.length == 1 ||
          !await flushTable() ||
          !mounted ||
          !context.mounted) {
        return;
      }
      final order = engine.workingOrders[index];
      final hasData = order.lines.isNotEmpty || order.table.trim().isNotEmpty;
      if (hasData) {
        final discard = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Remove this order?'),
            content: Text('Order #${order.id} has items or a table number.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Remove order'),
              ),
            ],
          ),
        );
        if (discard != true || !mounted) return;
      }
      final saved = await change((e) => e.cancelWorkingOrder(order.id));
      if (saved && mounted && order.id == currentOrderId) {
        setState(
          () => adoptOrder(
            engine.workingOrders[index.clamp(
              0,
              engine.workingOrders.length - 1,
            )],
          ),
        );
      }
    });
  }

  Widget newOrderButton() => FilledButton.icon(
    onPressed: busy ? null : addDraft,
    style: FilledButton.styleFrom(
      backgroundColor: accent,
      foregroundColor: Colors.white,
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
      elevation: 0,
    ),
    icon: const Icon(Icons.add, size: 18, color: Colors.white),
    label: const Text(
      'New order',
      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
    ),
  );

  Widget draftTabs(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (var i = 0; i < engine.workingOrders.length; i++) ...[
          Builder(
            builder: (context) {
              final isCurrent = engine.workingOrders[i].id == currentOrderId;
              return Container(
                margin: const EdgeInsets.only(right: 6),
                decoration: BoxDecoration(
                  color: isCurrent ? Colors.white : const Color(0xfffddcd4),
                  borderRadius: isCurrent
                      ? const BorderRadius.vertical(top: Radius.circular(12))
                      : BorderRadius.circular(10),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Semantics(
                      selected: isCurrent,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(10),
                        onTap: busy ? null : () => switchDraft(i),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(14, 10, 4, 10),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Order #${engine.workingOrders[i].id}',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: isCurrent
                                      ? FontWeight.w700
                                      : FontWeight.w600,
                                  color: ink,
                                ),
                              ),
                              if (engine.workingOrders[i].table
                                  .trim()
                                  .isNotEmpty) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 5,
                                    vertical: 1.5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: isCurrent
                                        ? CafeTheme.accent.withValues(
                                            alpha: 0.15,
                                          )
                                        : const Color(0xFFF3F4F6),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'T${engine.workingOrders[i].table.trim()}',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: isCurrent ? CafeTheme.accent : ink,
                                    ),
                                  ),
                                ),
                              ] else if (!engine.workingOrders[i].dineIn) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 5,
                                    vertical: 1.5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF3F4F6),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Text(
                                    'Takeout',
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.w600,
                                      color: CafeTheme.muted,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (engine.workingOrders.length > 1)
                      IconButton(
                        tooltip: 'Close Order #${engine.workingOrders[i].id}',
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        constraints: const BoxConstraints(
                          minWidth: 28,
                          minHeight: 28,
                        ),
                        iconSize: 15,
                        onPressed: busy ? null : () => closeDraft(context, i),
                        icon: const Icon(Icons.close, color: ink),
                      ),
                    if (engine.workingOrders.length == 1)
                      const SizedBox(width: 8),
                  ],
                ),
              );
            },
          ),
        ],
      ],
    ),
  );

  Widget register(BuildContext context) => currentOrderId == null
      ? Center(
          child: initializingOrder || busy
              ? const CircularProgressIndicator()
              : FilledButton(
                  onPressed: createInitialOrder,
                  child: const Text('Retry creating order'),
                ),
        )
      : registerBody(context);

  Widget registerBody(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      if (c.maxWidth >= 900) {
        final ticketWidth = (c.maxWidth * .34).clamp(350.0, 430.0);
        final isFirstTabCurrent =
            engine.workingOrders.isNotEmpty &&
            engine.workingOrders.first.id == currentOrderId;
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    draftTabs(context),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.only(
                          topRight: const Radius.circular(16),
                          bottomLeft: const Radius.circular(16),
                          bottomRight: const Radius.circular(16),
                          topLeft: isFirstTabCurrent
                              ? Radius.zero
                              : const Radius.circular(16),
                        ),
                      ),
                      child: categories(),
                    ),
                    const SizedBox(height: 16),
                    Expanded(child: menuView(context, c.maxWidth)),
                  ],
                ),
              ),
              const SizedBox(width: 20),
              SizedBox(
                width: ticketWidth,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      height: 40,
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: newOrderButton(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Expanded(child: ticketView(context)),
                  ],
                ),
              ),
            ],
          ),
        );
      }
      return DefaultTabController(
        length: 2,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(
                children: [
                  Expanded(child: draftTabs(context)),
                  const SizedBox(width: 8),
                  newOrderButton(),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: categories(),
              ),
            ),
            TabBar(
              tabs: [
                const Tab(text: 'Menu'),
                Tab(
                  text:
                      'Ticket (${cart.fold<int>(0, (s, l) => s + l.quantity)})',
                ),
              ],
            ),
            Expanded(
              child: TabBarView(
                children: [
                  Builder(
                    builder: (context) => Padding(
                      padding: const EdgeInsets.all(16),
                      child: menuView(context, c.maxWidth),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: ticketView(context),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );

  Widget categories() => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final name in ['All items', 'Favorites', 'Coffee', 'Non-coffee'])
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Semantics(
              selected: category == name,
              child: TextButton(
                style: TextButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: category == name ? CafeTheme.accent : ink,
                  side: BorderSide(
                    color: category == name
                        ? CafeTheme.accent
                        : const Color(0xffd1d5db),
                    width: category == name ? 1.5 : 1.0,
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 8,
                  ),
                  shape: const StadiumBorder(),
                ),
                onPressed: busy ? null : () => setState(() => category = name),
                child: Text(
                  name == 'All items' ? 'All Menu' : name,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: category == name
                        ? FontWeight.w700
                        : FontWeight.w500,
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );

  Widget menuView(BuildContext context, double width) {
    final list = engine.products
        .where(
          (p) =>
              p.name.toLowerCase().contains(query.toLowerCase()) &&
              (category != 'Coffee' ||
                  [
                    'spanish-latte',
                    'caramel-latte',
                    'americano',
                    'mocha',
                  ].contains(p.id)) &&
              (category != 'Non-coffee' ||
                  ['matcha', 'chocolate'].contains(p.id)),
        )
        .toList();
    final total = cart.fold<int>(0, (s, l) => s + l.quantity * l.unitPrice);
    final count = cart.fold<int>(0, (s, l) => s + l.quantity);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.end,
          spacing: 12,
          runSpacing: 4,
          children: [
            Text(
              category == 'All items' ? 'All Menu' : category,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                letterSpacing: -.5,
              ),
            ),
            Text(
              ' drinks · Sample photos',
              style: const TextStyle(fontSize: 14, color: CafeTheme.muted),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Expanded(
          child: LayoutBuilder(
            builder: (context, c) {
              if (list.isEmpty) {
                return const Center(
                  child: Text('No drinks match your search.'),
                );
              }
              final columns = c.maxWidth >= 700
                  ? 3
                  : c.maxWidth >= 440
                  ? 3
                  : 2;
              return GridView.builder(
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  mainAxisExtent: c.maxWidth < 360 ? 248 : 266,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                ),
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final p = list[i];
                  final photo = switch (p.id) {
                    'caramel-latte' => 'caramel-latte.jpg',
                    'americano' => 'americano.jpg',
                    'matcha' => 'matcha-latte.jpg',
                    'mocha' => 'mocha.jpg',
                    'chocolate' => 'chocolate.jpg',
                    _ => 'iced-latte.jpg',
                  };
                  return OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      backgroundColor: Colors.white,
                      side: const BorderSide(color: border),
                      padding: const EdgeInsets.all(8),
                      alignment: Alignment.topLeft,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: busy ? null : () => customize(context, p),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(11),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Image.asset(
                                'assets/menu/$photo',
                                fit: BoxFit.cover,
                                excludeFromSemantics: true,
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(4, 10, 4, 4),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  p.name,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: ink,
                                    height: 1.2,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        money(p.priceCentavos),
                                        style: const TextStyle(
                                          color: ink,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 10,
                                        vertical: 5,
                                      ),
                                      decoration: BoxDecoration(
                                        color: accent,
                                        borderRadius: BorderRadius.circular(20),
                                      ),
                                      child: const Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(
                                            Icons.add,
                                            size: 16,
                                            color: Colors.white,
                                          ),
                                          SizedBox(width: 3),
                                          Text(
                                            'Add',
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
        if (width < 900 && cart.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: FilledButton(
              onPressed: () => DefaultTabController.of(context).animateTo(1),
              child: Text('View ticket · $count drinks · ${money(total)}'),
            ),
          ),
      ],
    );
  }

  Future<void> customize(BuildContext context, Product p) async {
    var quantity = 1;
    var size = '16 oz';
    var sweetness = 'Regular';
    var shot = false;
    final compact = MediaQuery.sizeOf(context).width < 600;
    Widget editor(BuildContext context) => StatefulBuilder(
      builder: (context, update) {
        final content = SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Sample recipes and prices; confirm before live use.',
                  style: TextStyle(fontSize: 12),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: size,
                  decoration: const InputDecoration(labelText: 'Size'),
                  items: ['12 oz', '16 oz']
                      .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                      .toList(),
                  onChanged: (s) => update(() => size = s!),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: sweetness,
                  decoration: const InputDecoration(labelText: 'Sweetness'),
                  items: ['Regular', 'Less sweet', 'No sugar']
                      .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                      .toList(),
                  onChanged: (s) => update(() => sweetness = s!),
                ),
                if (p.recipe.containsKey('beans'))
                  CheckboxListTile(
                    title: const Text('Extra espresso shot (+₱25)'),
                    value: shot,
                    onChanged: (v) => update(() => shot = v!),
                    contentPadding: EdgeInsets.zero,
                  ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Quantity'),
                    IconButton(
                      tooltip: 'Decrease quantity',
                      onPressed: quantity > 1
                          ? () => update(() => quantity--)
                          : null,
                      icon: const Icon(Icons.remove),
                    ),
                    Text('$quantity'),
                    IconButton(
                      tooltip: 'Increase quantity',
                      onPressed: quantity < 20
                          ? () => update(() => quantity++)
                          : null,
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
        final actions = <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              final recipe = Map<String, int>.from(p.recipe);
              if (size == '12 oz') {
                for (final k in recipe.keys.toList()) {
                  if (!['beans', 'cup', 'lid'].contains(k)) {
                    recipe[k] = (recipe[k]! * 0.75).round();
                  }
                }
              }
              if (sweetness == 'No sugar') recipe.remove('syrup');
              if (sweetness == 'Less sweet' && recipe.containsKey('syrup')) {
                recipe['syrup'] = (recipe['syrup']! / 2).round();
              }
              if (shot) recipe['beans'] = recipe['beans']! + 18;
              final lines = List<OrderLine>.from(cart)
                ..add(
                  OrderLine(
                    p.id,
                    p.name,
                    quantity,
                    p.priceCentavos -
                        (size == '12 oz' ? 2000 : 0) +
                        (shot ? 2500 : 0),
                    recipe,
                    note: '$size · $sweetness${shot ? ' · Extra shot' : ''}',
                  ),
                );
              final saved = await saveOrderContents(lines, dineIn);
              if (saved && context.mounted) Navigator.pop(context);
            },
            child: const Text('Add to ticket'),
          ),
        ];
        if (!compact) {
          return AlertDialog(
            title: Text(p.name),
            content: content,
            actions: actions,
          );
        }
        return SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * .85,
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            p.name,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Close customization',
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                    const Divider(height: 24),
                    Flexible(child: content),
                    const SizedBox(height: 12),
                    Wrap(
                      alignment: WrapAlignment.end,
                      spacing: 8,
                      children: [actions[0], actions[1]],
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
    if (compact) {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: editor,
      );
    } else {
      await showDialog<void>(context: context, builder: editor);
    }
  }

  String ticketPhoto(String productId) => switch (productId) {
    'spanish-latte' => 'iced-latte.jpg',
    'caramel-latte' => 'caramel-latte.jpg',
    'americano' => 'americano.jpg',
    'matcha' => 'matcha-latte.jpg',
    'mocha' => 'mocha.jpg',
    'chocolate' => 'chocolate.jpg',
    _ => '',
  };

  Widget ticketView(BuildContext context) {
    final needed = <String, int>{};
    for (final l in cart) {
      l.recipe.forEach((k, v) => needed[k] = (needed[k] ?? 0) + v * l.quantity);
    }
    final shortages = needed.keys
        .where(
          (k) =>
              needed[k]! >
              (engine.stock[k] ?? 0) - (engine.reservations[k] ?? 0),
        )
        .toList();
    final total = cart.fold<int>(0, (s, l) => s + l.quantity * l.unitPrice);
    final open = engine.orders
        .where((o) => o.paidCentavos < o.totalCentavos || !o.ready)
        .toList()
        .reversed
        .toList();
    return panel(
      LayoutBuilder(
        builder: (context, constraints) {
          final scrollWholeTicket = constraints.maxHeight < 600;
          Widget listRegion({required Widget child}) =>
              scrollWholeTicket ? child : Expanded(child: child);
          final content = Column(
            mainAxisSize: scrollWholeTicket
                ? MainAxisSize.min
                : MainAxisSize.max,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Order No.',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: CafeTheme.muted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '#${currentOrderId ?? ""}',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: ink,
                        ),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      const Text(
                        'Table No.',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: CafeTheme.muted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        tableNumber.text.trim().isEmpty
                            ? '—'
                            : tableNumber.text.trim(),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: ink,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('Dine in')),
                  ButtonSegment(value: false, label: Text('Takeout')),
                ],
                selected: {dineIn},
                onSelectionChanged: busy
                    ? null
                    : (v) => saveOrderContents(
                        List<OrderLine>.from(cart),
                        v.first,
                      ),
                showSelectedIcon: false,
              ),
              if (dineIn) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: tableNumber,
                  enabled: !transitioningOrder,
                  maxLength: 12,
                  onChanged: queueTableWrite,
                  decoration: const InputDecoration(
                    labelText: 'Table number (optional)',
                    counterText: '',
                  ),
                ),
              ] else ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF9FAFB),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFFE5E7EB)),
                  ),
                  child: const Row(
                    children: [
                      Icon(
                        Icons.shopping_bag_outlined,
                        size: 16,
                        color: CafeTheme.muted,
                      ),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Takeout · Payment required before prep',
                          style: TextStyle(
                            fontSize: 12,
                            color: CafeTheme.muted,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const Divider(height: 28),
              listRegion(
                child: ListView(
                  shrinkWrap: scrollWholeTicket,
                  physics: scrollWholeTicket
                      ? const NeverScrollableScrollPhysics()
                      : null,
                  children: [
                    if (cart.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8, bottom: 24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Your next order starts here.',
                              style: TextStyle(fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Choose a drink from the menu.',
                              style: TextStyle(
                                fontSize: 14,
                                color: CafeTheme.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    for (var i = 0; i < cart.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Column(
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: ticketPhoto(cart[i].productId).isEmpty
                                      ? const SizedBox(
                                          width: 48,
                                          height: 48,
                                          child: ColoredBox(
                                            color: CafeTheme.field,
                                          ),
                                        )
                                      : Image.asset(
                                          'assets/menu/${ticketPhoto(cart[i].productId)}',
                                          width: 48,
                                          height: 48,
                                          fit: BoxFit.cover,
                                          excludeFromSemantics: true,
                                        ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${cart[i].quantity} × ${cart[i].name}',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        cart[i].note,
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: CafeTheme.muted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      money(
                                        cart[i].quantity * cart[i].unitPrice,
                                      ),
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    IconButton(
                                      tooltip: 'Remove ${cart[i].name}',
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final lines =
                                                  List<OrderLine>.from(cart)
                                                    ..removeAt(i);
                                              saveOrderContents(lines, dineIn);
                                            },
                                      icon: const Icon(Icons.close, size: 18),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const Divider(height: 16),
                          ],
                        ),
                      ),
                    if (shortages.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          'Recorded stock is short: ${shortages.map((k) => ingredientNames[k]).join(', ')}. You can continue; manager stock review is needed.',
                          style: const TextStyle(
                            fontSize: 13,
                            color: Color(0xff854020),
                          ),
                        ),
                      ),
                    if (open.isNotEmpty) ...[
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'Open orders',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Text(
                            '${open.length}',
                            style: const TextStyle(
                              color: CafeTheme.muted,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      for (final o in open) orderSummary(context, o),
                    ],
                  ],
                ),
              ),
              if (cart.isNotEmpty) ...[
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Subtotal',
                      style: TextStyle(color: CafeTheme.muted, fontSize: 13),
                    ),
                    Text(
                      money(total),
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'VAT (12% incl.)',
                      style: TextStyle(color: CafeTheme.muted, fontSize: 13),
                    ),
                    Text(
                      money((total * 0.12 / 1.12).round()),
                      style: const TextStyle(
                        color: CafeTheme.muted,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
                const Divider(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Total',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      money(total),
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: ink,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      flex: 6,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.black,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        onPressed: busy
                            ? null
                            : () async {
                                await withOrderLock(() async {
                                  if (!await flushTable() || !mounted) return;
                                  final id = currentOrderId!;
                                  if (await change(
                                    (e) => e.finalizeWorkingOrder(id),
                                  )) {
                                    if (!mounted) return;
                                    if (engine.workingOrders.isNotEmpty) {
                                      setState(
                                        () => adoptOrder(
                                          engine.workingOrders.first,
                                        ),
                                      );
                                    } else {
                                      setState(() {
                                        currentOrderId = null;
                                        cart.clear();
                                        tableNumber.clear();
                                      });
                                      await createInitialOrder();
                                    }
                                    if (!mounted) return;
                                    message(
                                      'Order saved. Send it to the bar or record payment.',
                                    );
                                  }
                                });
                              },
                        child: Text(busy ? 'Saving…' : 'Create order'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          );
          return scrollWholeTicket
              ? SingleChildScrollView(child: content)
              : content;
        },
      ),
    );
  }

  Widget orderSummary(BuildContext context, CafeOrder o) => Container(
    margin: const EdgeInsets.symmetric(vertical: 6),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: CafeTheme.field,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '#${o.id} · ${o.dineIn ? (o.table.isEmpty ? 'Dine in' : 'Table ${o.table}') : 'Takeout'}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            Text(
              money(o.totalCentavos),
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          o.lines.map((l) => '${l.quantity} × ${l.name}').join(', '),
          style: const TextStyle(fontSize: 14),
        ),
        const SizedBox(height: 8),
        Text(
          '${o.ready
              ? 'Ready'
              : o.released
              ? 'Sent to bar'
              : 'Not sent'} · ${o.paidCentavos == o.totalCentavos ? 'Paid' : 'Due ${money(o.totalCentavos - o.paidCentavos)}'}',
          style: const TextStyle(fontSize: 13, color: CafeTheme.muted),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (!o.released && o.dineIn)
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () async {
                        if (await change((e) => e.sendOrder(o.id))) {
                          message(
                            'Sent locally. Multi-device routing is not connected.',
                          );
                        }
                      },
                child: const Text('Send to bar'),
              ),
            if (o.paidCentavos < o.totalCentavos)
              FilledButton(
                onPressed: busy ? null : () => payment(context, o),
                child: const Text('Record payment'),
              ),
          ],
        ),
      ],
    ),
  );

  Future<void> payment(BuildContext context, CafeOrder order) async {
    var paymentId = '${order.id}-${DateTime.now().microsecondsSinceEpoch}';
    final amount = TextEditingController(
      text: ((order.totalCentavos - order.paidCentavos) / 100).toStringAsFixed(
        2,
      ),
    );
    final reference = TextEditingController();
    var method = 'cash';
    var verified = false;
    String? error;
    String? status;
    var submitting = false;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => StatefulBuilder(
        builder: (context, update) {
          final current = engine.order(order.id);
          final remaining = current.totalCentavos - current.paidCentavos;
          final fullyPaid = remaining == 0;
          return AlertDialog(
            title: Text('Payment #${order.id}'),
            content: SizedBox(
              width: 390,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Remaining ${money(remaining)}'),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      value: method,
                      decoration: const InputDecoration(
                        labelText: 'Payment method',
                      ),
                      items: ['cash', 'gcash', 'card']
                          .map(
                            (s) => DropdownMenuItem(
                              value: s,
                              child: Text(
                                s == 'gcash'
                                    ? 'GCash'
                                    : s == 'card'
                                    ? 'Card'
                                    : 'Cash',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: submitting || fullyPaid
                          ? null
                          : (s) => update(() => method = s!),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: amount,
                      enabled: !submitting && !fullyPaid,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText: method == 'cash'
                            ? 'Cash received (PHP)'
                            : 'Amount (PHP)',
                        errorText: error,
                      ),
                    ),
                    if (method != 'cash') ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: reference,
                        enabled: !submitting && !fullyPaid,
                        decoration: const InputDecoration(
                          labelText: 'Merchant payment reference',
                        ),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: verified,
                        onChanged: submitting || fullyPaid
                            ? null
                            : (v) => update(() => verified = v!),
                        title: const Text(
                          'I checked successful payment in the merchant app / terminal',
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    const Text(
                      'Payment recording does not charge a card or move money.',
                      style: TextStyle(fontSize: 12),
                    ),
                    if (status != null) ...[
                      const SizedBox(height: 12),
                      Text(status!),
                    ],
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      key: const ValueKey('paymentPrintReceipt'),
                      onPressed: !fullyPaid || submitting
                          ? null
                          : () async {
                              update(() => submitting = true);
                              final ok = await change(
                                (e) => e.requestReceipt(order.id),
                              );
                              if (context.mounted) {
                                update(() {
                                  submitting = false;
                                  if (ok) {
                                    status =
                                        'Receipt printer not configured. No receipt was sent.';
                                  }
                                });
                              }
                            },
                      icon: const Icon(Icons.print_outlined),
                      label: const Text('Print receipt'),
                    ),
                    if (!fullyPaid)
                      const Text(
                        'Available after full payment is confirmed.',
                        style: TextStyle(fontSize: 12),
                      ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: submitting ? null : () => Navigator.pop(context),
                child: Text(fullyPaid ? 'Return to cashier' : 'Back'),
              ),
              FilledButton(
                onPressed: submitting || fullyPaid
                    ? null
                    : () async {
                        final entered = parseMoney(amount.text);
                        if (entered == null || entered <= 0) {
                          update(
                            () => error =
                                'Enter a positive amount, up to 2 decimal places',
                          );
                          return;
                        }
                        if (method != 'cash' &&
                            (!verified || reference.text.trim().isEmpty)) {
                          update(
                            () => error =
                                'Verify merchant payment and enter its reference',
                          );
                          return;
                        }
                        if (method != 'cash' && entered > remaining) {
                          update(
                            () =>
                                error = 'Amount exceeds the remaining balance',
                          );
                          return;
                        }
                        update(() => submitting = true);
                        final allocation =
                            method == 'cash' && entered > remaining
                            ? remaining
                            : entered;
                        final ok = await change(
                          (e) => e.addPayment(
                            order.id,
                            amountCentavos: allocation,
                            paymentId: paymentId,
                            method: method,
                            verified: true,
                            reference: reference.text.trim(),
                          ),
                        );
                        if (context.mounted) {
                          if (ok) {
                            update(() {
                              submitting = false;
                              error = null;
                              status = method == 'cash'
                                  ? 'Saved. Change: ${money(entered - allocation)}'
                                  : 'Verified payment recorded.';
                              amount.text =
                                  ((engine.order(order.id).totalCentavos -
                                              engine
                                                  .order(order.id)
                                                  .paidCentavos) /
                                          100)
                                      .toStringAsFixed(2);
                              reference.clear();
                              verified = false;
                              paymentId =
                                  '${order.id}-${DateTime.now().microsecondsSinceEpoch}';
                            });
                          } else {
                            update(() => submitting = false);
                          }
                        }
                      },
                child: Text(submitting ? 'Saving…' : 'Confirm payment'),
              ),
            ],
          );
        },
      ),
    );
    amount.dispose();
    reference.dispose();
  }

  Widget kitchen(BuildContext context) {
    final orders = engine.orders.where((o) => o.released && !o.ready).toList();
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Active orders · ${orders.length}',
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Oldest orders first',
                      style: TextStyle(fontSize: 14, color: CafeTheme.muted),
                    ),
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: () => showReady(context),
                child: const Text('Ready orders'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Expanded(
            child: LayoutBuilder(
              builder: (context, c) {
                final cols = c.maxWidth >= 1100
                    ? 3
                    : c.maxWidth >= 650
                    ? 2
                    : 1;
                if (orders.isEmpty) {
                  return Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 380),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.local_cafe_outlined,
                            size: 36,
                            color: CafeTheme.muted,
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'The bar is clear.',
                            style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'New drinks will appear here when the cashier sends an order or confirms takeout payment.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: CafeTheme.muted),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                return GridView.builder(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: cols,
                    mainAxisExtent: cols == 3 && c.maxHeight >= 600
                        ? (c.maxHeight - 16) / 2
                        : 390,
                    crossAxisSpacing: 16,
                    mainAxisSpacing: 16,
                  ),
                  itemCount: orders.length,
                  itemBuilder: (context, i) {
                    final o = orders[i];
                    final age = DateTime.now().difference(
                      DateTime.parse(o.createdAt),
                    );
                    return Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: warm,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  '#${o.id}',
                                  style: const TextStyle(
                                    fontSize: 28,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: -.5,
                                  ),
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    o.dineIn
                                        ? (o.table.isEmpty
                                              ? 'Dine in'
                                              : 'Table ${o.table}')
                                        : 'Takeout',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${age.inMinutes} min waiting',
                                    style: const TextStyle(
                                      fontSize: 13,
                                      color: CafeTheme.onWarmAccent,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          const Divider(height: 24),
                          Expanded(
                            child: ListView(
                              children: [
                                for (final l in o.lines)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 16),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          '${l.quantity} × ${l.name}',
                                          style: const TextStyle(
                                            fontSize: 20,
                                            fontWeight: FontWeight.w700,
                                            height: 1.25,
                                          ),
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          l.note,
                                          style: const TextStyle(fontSize: 15),
                                        ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '${o.quantity} ${o.quantity == 1 ? 'drink' : 'drinks'}',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                              Text(
                                o.paidCentavos == o.totalCentavos
                                    ? 'Paid'
                                    : 'Unpaid',
                                style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: busy
                                ? null
                                : () async {
                                    if (await change(
                                      (e) => e.markReady(o.id),
                                    )) {
                                      message(
                                        'Ready. Ingredients deducted once.',
                                      );
                                    }
                                  },
                            child: const Text('Mark ready'),
                          ),
                        ],
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void showReady(BuildContext context) => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Ready orders'),
      content: SizedBox(
        width: 420,
        height: 300,
        child: ListView(
          children: [
            for (final o in engine.orders.where((o) => o.ready))
              ListTile(
                title: Text('#${o.id} · ${o.quantity} drinks'),
                subtitle: Text(o.lines.map((l) => l.name).join(', ')),
              ),
            if (!engine.orders.any((o) => o.ready))
              const Text('No completed drinks yet.'),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    ),
  );
  void showMergeTablesDialog(BuildContext context) {
    final availableOrders = engine.workingOrders.toList();
    if (availableOrders.length < 2) {
      message('At least 2 active orders or tables are required to merge');
      return;
    }

    String sourceId = availableOrders.first.id;
    String targetId = availableOrders[1].id;

    showDialog<void>(
      context: context,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (context, setDlgState) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          title: const Row(
            children: [
              Icon(Icons.merge_type_rounded, color: CafeTheme.accent),
              SizedBox(width: 10),
              Text('Merge Tables & Orders'),
            ],
          ),
          content: SizedBox(
            width: 400,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Combine all drinks from a source order into a target order/table.',
                  style: TextStyle(fontSize: 13, color: CafeTheme.muted),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Source Order (will be combined & closed):',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: sourceId,
                  decoration: InputDecoration(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  items: availableOrders.map((o) {
                    final t = o.table.trim().isEmpty
                        ? 'Order #${o.id}'
                        : 'Table ${o.table} (#${o.id})';
                    final itemsCount = o.lines.fold<int>(
                      0,
                      (s, l) => s + l.quantity,
                    );
                    return DropdownMenuItem(
                      value: o.id,
                      child: Text(
                        '$t · $itemsCount ${itemsCount == 1 ? "drink" : "drinks"}',
                        style: const TextStyle(fontSize: 13),
                      ),
                    );
                  }).toList(),
                  onChanged: (v) {
                    if (v != null) {
                      setDlgState(() {
                        sourceId = v;
                        if (sourceId == targetId) {
                          targetId = availableOrders
                              .firstWhere((o) => o.id != sourceId)
                              .id;
                        }
                      });
                    }
                  },
                ),
                const SizedBox(height: 14),
                const Text(
                  'Destination Table / Order (will receive all items):',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: targetId,
                  decoration: InputDecoration(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  items: availableOrders.where((o) => o.id != sourceId).map((
                    o,
                  ) {
                    final t = o.table.trim().isEmpty
                        ? 'Order #${o.id}'
                        : 'Table ${o.table} (#${o.id})';
                    final itemsCount = o.lines.fold<int>(
                      0,
                      (s, l) => s + l.quantity,
                    );
                    return DropdownMenuItem(
                      value: o.id,
                      child: Text(
                        '$t · $itemsCount ${itemsCount == 1 ? "drink" : "drinks"}',
                        style: const TextStyle(fontSize: 13),
                      ),
                    );
                  }).toList(),
                  onChanged: (v) {
                    if (v != null) setDlgState(() => targetId = v);
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogCtx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                Navigator.pop(dialogCtx);
                await withOrderLock(() async {
                  if (!await flushTable() || !mounted) return;
                  final source = engine.workingOrders.firstWhere(
                    (w) => w.id == sourceId,
                  );
                  final target = engine.workingOrders.firstWhere(
                    (w) => w.id == targetId,
                  );
                  final mergedLines = [...target.lines, ...source.lines];
                  final saved = await change((e) {
                    e.updateWorkingOrder(
                      target.id,
                      mergedLines,
                      dineIn: target.dineIn,
                      table: target.table,
                    );
                    e.cancelWorkingOrder(source.id);
                  });
                  if (saved && mounted) {
                    if (currentOrderId == source.id ||
                        currentOrderId == target.id) {
                      adoptOrder(
                        engine.workingOrders.firstWhere(
                          (w) => w.id == target.id,
                        ),
                      );
                    }
                    message(
                      'Merged Order #${source.id} into ${target.table.trim().isEmpty ? "Order #${target.id}" : "Table ${target.table}"}',
                    );
                  }
                });
              },
              style: FilledButton.styleFrom(backgroundColor: CafeTheme.accent),
              child: const Text('Confirm Merge'),
            ),
          ],
        ),
      ),
    );
  }

  Widget tablesView(BuildContext context) {
    final isTablet = MediaQuery.sizeOf(context).width >= 900;
    const totalTables = 12;

    return LayoutBuilder(
      builder: (context, constraints) {
        final crossAxisCount = constraints.maxWidth >= 1100
            ? 4
            : constraints.maxWidth >= 650
            ? 3
            : 2;

        final occupiedWorkingOrders = engine.workingOrders
            .where((w) => w.table.trim().isNotEmpty)
            .toList();

        final occupiedTablesCount = <String>{
          ...occupiedWorkingOrders.map((w) => w.table.trim()),
          ...engine.orders
              .where(
                (o) =>
                    (!o.ready || o.paidCentavos < o.totalCentavos) &&
                    o.table.trim().isNotEmpty,
              )
              .map((o) => o.table.trim()),
        }.length;

        return SingleChildScrollView(
          padding: EdgeInsets.all(isTablet ? 24 : 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Floor Plan & Active Tables',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.5,
                            color: ink,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '12 Tables · $occupiedTablesCount Occupied · ${totalTables - occupiedTablesCount} Available',
                          style: const TextStyle(
                            fontSize: 13,
                            color: CafeTheme.muted,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (occupiedWorkingOrders.length >= 2) ...[
                    OutlinedButton.icon(
                      onPressed: () => showMergeTablesDialog(context),
                      icon: const Icon(Icons.merge_type_rounded, size: 18),
                      label: const Text('Merge Tables'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: ink,
                        side: const BorderSide(color: CafeTheme.border),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  FilledButton.icon(
                    onPressed: busy
                        ? null
                        : () async {
                            await withOrderLock(() async {
                              if (!await flushTable() || !mounted) return;
                              String? id;
                              final saved = await change(
                                (e) => id = e.reserveWorkingOrder().id,
                              );
                              if (saved && mounted) {
                                final o = engine.workingOrders.firstWhere(
                                  (w) => w.id == id,
                                );
                                adoptOrder(o);
                                setState(() {
                                  dineIn = false;
                                  tableNumber.text = '';
                                  screen = 0;
                                });
                              }
                            });
                          },
                    icon: const Icon(Icons.shopping_bag_outlined, size: 18),
                    label: const Text('New Takeout'),
                    style: FilledButton.styleFrom(
                      backgroundColor: CafeTheme.accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: totalTables,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: crossAxisCount,
                  mainAxisSpacing: 14,
                  crossAxisSpacing: 14,
                  childAspectRatio: isTablet ? 1.2 : 1.0,
                ),
                itemBuilder: (context, idx) {
                  final tableNum = idx + 1;
                  final tableStr = '$tableNum';
                  final padStr = tableNum < 10 ? '0$tableNum' : '$tableNum';

                  final working = engine.workingOrders.where((w) {
                    final t = w.table.trim();
                    return t == tableStr ||
                        t == padStr ||
                        t == 'T$tableStr' ||
                        t == 'T$padStr';
                  }).firstOrNull;

                  final sentOrder = engine.orders.where((o) {
                    if (o.ready && o.paidCentavos >= o.totalCentavos) {
                      return false;
                    }
                    final t = o.table.trim();
                    return t == tableStr ||
                        t == padStr ||
                        t == 'T$tableStr' ||
                        t == 'T$padStr';
                  }).firstOrNull;

                  final isOccupied = working != null || sentOrder != null;
                  final seats = tableNum <= 4
                      ? '2 Seats'
                      : tableNum <= 8
                      ? '4 Seats'
                      : tableNum <= 10
                      ? '6 Seats'
                      : 'Outdoor · 4 Seats';

                  return Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isOccupied
                            ? CafeTheme.accent.withValues(alpha: 0.35)
                            : CafeTheme.border,
                        width: isOccupied ? 1.5 : 1,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: isOccupied
                              ? CafeTheme.accent.withValues(alpha: 0.05)
                              : Colors.black.withValues(alpha: 0.02),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                color: isOccupied
                                    ? CafeTheme.accent.withValues(alpha: 0.1)
                                    : const Color(0xFFF3F4F6),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Icon(
                                Icons.table_restaurant_rounded,
                                size: 16,
                                color: isOccupied
                                    ? CafeTheme.accent
                                    : CafeTheme.muted,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                'Table $padStr',
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: ink,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: isOccupied
                                    ? const Color(0xFFFEF2F2)
                                    : const Color(0xFFECFDF5),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: isOccupied
                                      ? const Color(0xFFFECACA)
                                      : const Color(0xFFA7F3D0),
                                ),
                              ),
                              child: Text(
                                isOccupied ? 'Occupied' : 'Available',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: isOccupied
                                      ? const Color(0xFFDC2626)
                                      : const Color(0xFF059669),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          seats,
                          style: const TextStyle(
                            fontSize: 12,
                            color: CafeTheme.muted,
                          ),
                        ),
                        const Spacer(),
                        if (isOccupied) ...[
                          if (working != null) ...[
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    'Draft #${working.id} · ${working.lines.fold(0, (s, l) => s + l.quantity)} items',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: ink,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  money(
                                    working.lines.fold(
                                      0,
                                      (s, l) => s + l.unitPrice * l.quantity,
                                    ),
                                  ),
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: CafeTheme.accent,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            SizedBox(
                              width: double.infinity,
                              height: 32,
                              child: FilledButton(
                                onPressed: busy
                                    ? null
                                    : () async {
                                        final idx = engine.workingOrders
                                            .indexWhere(
                                              (w) => w.id == working.id,
                                            );
                                        if (idx >= 0) {
                                          await switchDraft(idx);
                                          setState(() => screen = 0);
                                        }
                                      },
                                style: FilledButton.styleFrom(
                                  backgroundColor: CafeTheme.accent,
                                  foregroundColor: Colors.white,
                                  padding: EdgeInsets.zero,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                ),
                                child: const Text(
                                  'Open in Register',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                          ] else if (sentOrder != null) ...[
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    'Order #${sentOrder.id} · ${sentOrder.quantity} drinks',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: ink,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  money(sentOrder.totalCentavos),
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: CafeTheme.accent,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            SizedBox(
                              width: double.infinity,
                              height: 32,
                              child: OutlinedButton(
                                onPressed: () {
                                  setState(() => screen = 1);
                                },
                                style: OutlinedButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                ),
                                child: const Text(
                                  'View at Barista',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ] else ...[
                          SizedBox(
                            width: double.infinity,
                            height: 32,
                            child: OutlinedButton.icon(
                              onPressed: busy
                                  ? null
                                  : () async {
                                      if (cart.isEmpty &&
                                          tableNumber.text.trim().isEmpty) {
                                        setState(() {
                                          dineIn = true;
                                          tableNumber.text = padStr;
                                          screen = 0;
                                        });
                                        queueTableWrite(padStr);
                                      } else {
                                        await withOrderLock(() async {
                                          if (!await flushTable() || !mounted) {
                                            return;
                                          }
                                          String? id;
                                          final saved = await change(
                                            (e) =>
                                                id = e.reserveWorkingOrder().id,
                                          );
                                          if (saved && mounted) {
                                            final o = engine.workingOrders
                                                .firstWhere((w) => w.id == id);
                                            adoptOrder(o);
                                            setState(() {
                                              dineIn = true;
                                              tableNumber.text = padStr;
                                              screen = 0;
                                            });
                                            queueTableWrite(padStr);
                                          }
                                        });
                                      }
                                    },
                              icon: const Icon(Icons.add, size: 14),
                              label: const Text(
                                'Start Order',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: ink,
                                side: const BorderSide(color: CafeTheme.border),
                                padding: EdgeInsets.zero,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget wasteView(BuildContext context) => LayoutBuilder(
    builder: (context, c) => SingleChildScrollView(
      padding: EdgeInsets.all(c.maxWidth >= 900 ? 24 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Waste & dial-in',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w700,
              letterSpacing: -.6,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Keep ingredient use accounted for, even outside a sale.',
            style: TextStyle(color: CafeTheme.muted, fontSize: 15),
          ),
          const SizedBox(height: 24),
          if (c.maxWidth >= 900)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 3, child: wasteForm()),
                const SizedBox(width: 24),
                Expanded(flex: 2, child: wasteHistory()),
              ],
            )
          else ...[
            wasteForm(),
            const SizedBox(height: 20),
            wasteHistory(),
          ],
        ],
      ),
    ),
  );

  Widget wasteForm() => panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Log waste',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        const Text(
          'Choose a shortcut or enter the details below.',
          style: TextStyle(fontSize: 14, color: CafeTheme.muted),
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final preset in [
              ('Espresso dial-in', 'beans', 'Dial-in'),
              ('Milk spillage', 'milk', 'Spillage'),
              ('Other waste', 'syrup', 'Other'),
            ])
              ChoiceChip(
                label: Text(preset.$1),
                selected:
                    wasteIngredient == preset.$2 && wasteReason == preset.$3,
                onSelected: busy
                    ? null
                    : (_) => setState(() {
                        wasteIngredient = preset.$2;
                        wasteReason = preset.$3;
                        wasteAmountError = null;
                      }),
              ),
          ],
        ),
        const Divider(height: 32),
        DropdownButtonFormField<String>(
          value: wasteIngredient,
          decoration: const InputDecoration(
            labelText: 'Ingredient or packaging',
          ),
          items: engine.stock.keys
              .map(
                (id) => DropdownMenuItem(
                  value: id,
                  child: Text(ingredientNames[id] ?? id),
                ),
              )
              .toList(),
          onChanged: busy
              ? null
              : (id) => setState(() => wasteIngredient = id!),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: wasteAmount,
          onChanged: (_) {
            if (wasteAmountError != null) {
              setState(() => wasteAmountError = null);
            }
          },
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: 'Quantity (${unit(wasteIngredient)})',
            errorText: wasteAmountError,
            helperText: 'Use whole base units.',
          ),
        ),
        const SizedBox(height: 20),
        DropdownButtonFormField<String>(
          value: wasteReason,
          decoration: const InputDecoration(labelText: 'Reason'),
          items: [
            'Dial-in',
            'Spillage',
            'Expired',
            'Damage',
            'Other',
          ].map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
          onChanged: busy ? null : (s) => setState(() => wasteReason = s!),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: wasteNote,
          minLines: 2,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Note (optional)',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: busy
              ? null
              : () async {
                  final q = int.tryParse(wasteAmount.text.trim());
                  if (q == null || q <= 0) {
                    setState(
                      () =>
                          wasteAmountError = 'Enter a positive whole quantity.',
                    );
                    return;
                  }
                  if (await change(
                    (e) => e.logWaste(
                      wasteIngredient,
                      q,
                      reason: wasteReason,
                      note: wasteNote.text.trim(),
                    ),
                  )) {
                    wasteAmount.clear();
                    wasteNote.clear();
                    message('Waste saved locally.');
                  }
                },
          child: Text(busy ? 'Saving…' : 'Save waste entry'),
        ),
      ],
    ),
  );

  Widget wasteHistory() => panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Recent entries',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
            ),
            Text(
              '${engine.waste.length}',
              style: const TextStyle(fontSize: 14, color: CafeTheme.muted),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (engine.waste.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 28),
            child: Text(
              'No waste recorded yet. Your saved entries will appear here.',
              style: TextStyle(color: CafeTheme.muted),
            ),
          ),
        for (final w in engine.waste.take(10))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        ingredientNames[w['ingredient']] ?? w['ingredient'],
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${w['quantity']} ${unit(w['ingredient'])}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  w['reason'] as String,
                  style: const TextStyle(fontSize: 14, color: CafeTheme.muted),
                ),
                if ((w['note'] as String).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      w['note'] as String,
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                const Divider(height: 20),
              ],
            ),
          ),
      ],
    ),
  );

  void status(BuildContext context) => showSettingsDialog(context);
}
