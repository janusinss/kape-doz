import 'package:flutter/material.dart';

/// Separate visual prototype. All figures and controls are illustrative.
void main() => runApp(const AdminWireframeApp());

class AdminWireframeApp extends StatelessWidget {
  const AdminWireframeApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'KAPE DOZ · Admin wireframes',
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff393939),
        primary: const Color(0xff292929),
        surface: Colors.white,
      ),
      scaffoldBackgroundColor: const Color(0xfff1f1f1),
      dividerColor: const Color(0xffd4d4d4),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        isDense: false,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
    ),
    home: const AdminHome(),
  );
}

class AdminHome extends StatefulWidget {
  const AdminHome({super.key});
  @override
  State<AdminHome> createState() => _AdminHomeState();
}

class _AdminHomeState extends State<AdminHome> {
  int selected = 0;
  static const labels = [
    'Sales',
    'Recipes',
    'Inventory',
    'Customers',
    'Settings',
  ];
  static const icons = [
    Icons.bar_chart,
    Icons.menu_book_outlined,
    Icons.inventory_2_outlined,
    Icons.people_outline,
    Icons.settings_outlined,
  ];
  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'KAPE DOZ',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19),
        ),
        backgroundColor: const Color(0xff242424),
        foregroundColor: Colors.white,
        actions: const [
          Center(
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'ADMIN WIREFRAME',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Material(
              color: Colors.white,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (var i = 0; i < labels.length; i++)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 4,
                        ),
                        child: TextButton.icon(
                          onPressed: () => setState(() => selected = i),
                          style: TextButton.styleFrom(
                            foregroundColor: selected == i
                                ? Colors.white
                                : const Color(0xff444444),
                            backgroundColor: selected == i
                                ? const Color(0xff333333)
                                : Colors.transparent,
                            minimumSize: const Size(48, 48),
                          ),
                          icon: Icon(icons[i], size: 19),
                          label: Text(labels[i]),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(wide ? 24 : 16),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1500),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Illustrative figures · Visual prototype',
                          style: TextStyle(
                            color: Color(0xff666666),
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 10),
                        switch (selected) {
                          0 => SalesView(wide: wide),
                          1 => RecipesView(wide: wide),
                          2 => InventoryView(wide: wide),
                          3 => CustomersView(wide: wide),
                          _ => SettingsView(wide: wide),
                        },
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, this.subtitle, {super.key});
  final String title, subtitle;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w800,
          height: 1.2,
        ),
      ),
      const SizedBox(height: 6),
      Text(subtitle, style: const TextStyle(color: Color(0xff626262))),
      const SizedBox(height: 22),
    ],
  );
}

class Surface extends StatelessWidget {
  const Surface({super.key, required this.child, this.padding = 20});
  final Widget child;
  final double padding;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(padding),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xffd6d6d6)),
    ),
    child: child,
  );
}

Widget heading(String text, [String? extra]) => Row(
  children: [
    Expanded(
      child: Text(
        text,
        style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
      ),
    ),
    if (extra != null)
      Flexible(
        child: Text(
          extra,
          textAlign: TextAlign.end,
          style: const TextStyle(color: Color(0xff686868), fontSize: 13),
        ),
      ),
  ],
);
Widget item(String title, String trailing, {String? detail}) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 13),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (detail != null) ...[
              const SizedBox(height: 4),
              Text(
                detail,
                style: const TextStyle(color: Color(0xff666666), fontSize: 13),
              ),
            ],
          ],
        ),
      ),
      const SizedBox(width: 12),
      Flexible(
        child: Text(
          trailing,
          textAlign: TextAlign.end,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
    ],
  ),
);
Widget line() => const Divider(height: 1);
Widget field(String label, {String? hint}) => TextField(
  decoration: InputDecoration(labelText: label, hintText: hint),
);
Widget inactiveAction(String text, {IconData? icon}) => OutlinedButton.icon(
  onPressed: null,
  icon: Icon(icon ?? Icons.add),
  label: Text(text),
);

class SalesView extends StatelessWidget {
  const SalesView({super.key, required this.wide});
  final bool wide;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SectionTitle(
        'Sales & margin',
        'Sales performance and estimated profit',
      ),
      Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final metric in [
            ('Net sales', '₱128,400'),
            ('Estimated gross profit', '₱78,100'),
            ('Gross margin', '60.8%'),
          ])
            SizedBox(
              width: wide ? 245 : 164,
              child: Surface(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      metric.$1,
                      style: const TextStyle(color: Color(0xff626262)),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      metric.$2,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
      const SizedBox(height: 16),
      LayoutBuilder(
        builder: (context, c) {
          final chart = Surface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                heading('Sales and gross profit', 'This month'),
                const SizedBox(height: 8),
                const Text(
                  '● Net sales     ○ Estimated gross profit',
                  style: TextStyle(color: Color(0xff666666), fontSize: 13),
                ),
                const SizedBox(height: 24),
                const SizedBox(
                  height: 200,
                  width: double.infinity,
                  child: CustomPaint(painter: TrendPainter()),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Week 1                  Week 2                  Week 3                  Week 4',
                  maxLines: 1,
                  overflow: TextOverflow.fade,
                  style: TextStyle(fontSize: 12, color: Color(0xff666666)),
                ),
              ],
            ),
          );
          final profit = Surface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                heading('Profit breakdown'),
                const SizedBox(height: 12),
                item('Net sales', '₱128,400'),
                line(),
                item('Estimated COGS', '− ₱50,300'),
                line(),
                item('Gross profit', '₱78,100'),
                const SizedBox(height: 10),
                const Text(
                  'Gross profit excludes operating expenses. Recipe costs are estimates.',
                  style: TextStyle(color: Color(0xff666666), fontSize: 13),
                ),
              ],
            ),
          );
          return c.maxWidth >= 800
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 3, child: chart),
                    const SizedBox(width: 16),
                    Expanded(flex: 2, child: profit),
                  ],
                )
              : Column(children: [chart, const SizedBox(height: 16), profit]);
        },
      ),
    ],
  );
}

class TrendPainter extends CustomPainter {
  const TrendPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final guide = Paint()
      ..color = const Color(0xffe4e4e4)
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = size.height * i / 3;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), guide);
    }
    for (var series = 0; series < 2; series++) {
      final points = series == 0
          ? [0.78, 0.63, 0.69, 0.48, 0.54, 0.31, 0.37, 0.16]
          : [0.91, 0.84, 0.87, 0.75, 0.77, 0.66, 0.69, 0.58];
      final path = Path()..moveTo(0, size.height * points.first);
      for (var i = 1; i < points.length; i++) {
        path.lineTo(
          size.width * i / (points.length - 1),
          size.height * points[i],
        );
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = series == 0
              ? const Color(0xff292929)
              : const Color(0xff9d9d9d)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class RecipesView extends StatefulWidget {
  const RecipesView({super.key, required this.wide});
  final bool wide;
  @override
  State<RecipesView> createState() => _RecipesViewState();
}

class _RecipesViewState extends State<RecipesView> {
  String recipe = 'Iced Spanish Latte';
  static const examples = {
    'Iced Spanish Latte': (
      16500,
      [
        ('Espresso beans', '18 g', 1530),
        ('Whole milk', '150 ml', 2100),
        ('Syrup', '15 ml', 800),
        ('16 oz cup', '1 pc', 400),
        ('Lid', '1 pc', 200),
      ],
    ),
    'Caramel Latte': (
      17500,
      [
        ('Espresso beans', '18 g', 1530),
        ('Whole milk', '150 ml', 2100),
        ('Syrup', '20 ml', 1067),
        ('16 oz cup', '1 pc', 400),
        ('Lid', '1 pc', 200),
      ],
    ),
    'Americano': (
      12500,
      [
        ('Espresso beans', '18 g', 1530),
        ('16 oz cup', '1 pc', 400),
        ('Lid', '1 pc', 200),
      ],
    ),
    'Matcha Latte': (
      18000,
      [
        ('Matcha powder', '4 g', 1200),
        ('Whole milk', '150 ml', 2100),
        ('Syrup', '15 ml', 800),
        ('16 oz cup', '1 pc', 400),
        ('Lid', '1 pc', 200),
      ],
    ),
  };
  @override
  Widget build(BuildContext context) {
    final example = examples[recipe]!;
    final cost = example.$2.fold<int>(0, (sum, row) => sum + row.$3);
    final list = Surface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          heading('Recipes', '4 items'),
          const SizedBox(height: 16),
          const TextField(
            enabled: false,
            decoration: InputDecoration(labelText: 'Search recipes'),
          ),
          const SizedBox(height: 12),
          for (final name in [
            'Iced Spanish Latte',
            'Caramel Latte',
            'Americano',
            'Matcha Latte',
          ])
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 8),
              selected: recipe == name,
              selectedTileColor: const Color(0xffededed),
              title: Text(name),
              onTap: () => setState(() => recipe = name),
            ),
        ],
      ),
    );
    final details = Surface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          heading(recipe, '16 oz'),
          const SizedBox(height: 4),
          Text(
            'Selling price  ₱${(example.$1 / 100).toStringAsFixed(2)}',
            style: const TextStyle(color: Color(0xff666666)),
          ),
          const SizedBox(height: 20),
          heading('Ingredients', 'Amount · Estimated cost'),
          const SizedBox(height: 8),
          for (final row in example.$2) ...[
            item(row.$1, '${row.$2} · ₱${(row.$3 / 100).toStringAsFixed(2)}'),
            line(),
          ],
          const SizedBox(height: 18),
          inactiveAction('Add ingredient'),
          const SizedBox(height: 20),
          item('Estimated recipe cost', '₱${(cost / 100).toStringAsFixed(2)}'),
          item(
            'Estimated gross margin',
            '${((example.$1 - cost) * 100 / example.$1).toStringAsFixed(1)}%',
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionTitle(
          'Recipes & raw materials',
          'Build recipes and review ingredient estimates',
        ),
        split(context, list, details),
      ],
    );
  }
}

Widget split(BuildContext context, Widget left, Widget right) => LayoutBuilder(
  builder: (context, c) => c.maxWidth >= 760
      ? Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 2, child: left),
            const SizedBox(width: 16),
            Expanded(flex: 5, child: right),
          ],
        )
      : Column(children: [left, const SizedBox(height: 16), right]),
);

class InventoryView extends StatefulWidget {
  const InventoryView({super.key, required this.wide});
  final bool wide;
  @override
  State<InventoryView> createState() => _InventoryViewState();
}

class _InventoryViewState extends State<InventoryView> {
  String selected = 'Whole milk';
  static const examples = {
    'Whole milk': ('Low stock', '1.2 L', '2.0 L', 'ml'),
    'Espresso beans': ('In stock', '4.1 kg', '1.0 kg', 'g'),
    'Syrup': ('In stock', '3.0 L', '1.0 L', 'ml'),
    '16 oz cup': ('In stock', '220 pcs', '50 pcs', 'pcs'),
    'Lid': ('In stock', '220 pcs', '50 pcs', 'pcs'),
  };
  @override
  Widget build(BuildContext context) {
    final example = examples[selected]!;
    final left = Surface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          heading('Raw materials', '5 items'),
          const SizedBox(height: 16),
          const TextField(
            enabled: false,
            decoration: InputDecoration(labelText: 'Search materials'),
          ),
          const SizedBox(height: 12),
          for (final name in [
            'Whole milk',
            'Espresso beans',
            'Syrup',
            '16 oz cup',
            'Lid',
          ])
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 8),
              selected: name == selected,
              selectedTileColor: const Color(0xffededed),
              title: Text(name),
              onTap: () => setState(() => selected = name),
            ),
        ],
      ),
    );
    final right = Surface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          heading(selected, example.$1),
          const SizedBox(height: 6),
          const Text(
            'Stock overview and threshold',
            style: TextStyle(color: Color(0xff666666)),
          ),
          const SizedBox(height: 20),
          item('Current stock', example.$2),
          line(),
          item('Low-stock threshold', example.$3),
          line(),
          item('Unit', example.$4),
          const SizedBox(height: 20),
          Wrap(
            spacing: 10,
            children: [
              inactiveAction(
                'Record stock count',
                icon: Icons.fact_check_outlined,
              ),
              inactiveAction('Receive stock', icon: Icons.add),
            ],
          ),
          const SizedBox(height: 24),
          heading('Recent activity'),
          const SizedBox(height: 10),
          const Text(
            'Activity details are illustrative.',
            style: TextStyle(color: Color(0xff666666)),
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionTitle(
          'Inventory & thresholds',
          'Monitor materials and low-stock alerts',
        ),
        split(context, left, right),
      ],
    );
  }
}

class CustomersView extends StatelessWidget {
  const CustomersView({super.key, required this.wide});
  final bool wide;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SectionTitle('Customers', 'Customer activity and loyalty overview'),
      Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final m in [
            ('Customers', '248'),
            ('Active this month', '86'),
            ('Returning customers', '43%'),
          ])
            SizedBox(
              width: wide ? 235 : 164,
              child: Surface(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.$1),
                    const SizedBox(height: 12),
                    Text(
                      m.$2,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 24,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
      const SizedBox(height: 16),
      split(
        context,
        Surface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              heading('Activity'),
              const SizedBox(height: 12),
              item('Visits this month', '164'),
              line(),
              item('Repeat visits', '71'),
              line(),
              item('Points earned', '1,420'),
            ],
          ),
        ),
        Surface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              heading('Customer list'),
              const SizedBox(height: 16),
              field('Search customers'),
              const SizedBox(height: 10),
              item(
                'Customer 001',
                '12 visits',
                detail: 'Last visit · 2 days ago',
              ),
              line(),
              item(
                'Customer 002',
                '8 visits',
                detail: 'Last visit · 5 days ago',
              ),
              line(),
              item(
                'Customer 003',
                '4 visits',
                detail: 'Last visit · 9 days ago',
              ),
            ],
          ),
        ),
      ),
    ],
  );
}

class SettingsView extends StatelessWidget {
  const SettingsView({super.key, required this.wide});
  final bool wide;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SectionTitle(
        'Settings & migration',
        'Manage the café setup and prepare data imports',
      ),
      split(
        context,
        Surface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              heading('Settings'),
              const SizedBox(height: 12),
              for (final title in [
                'Business details',
                'Staff access',
                'Devices & printers',
                'Data migration',
              ])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(title),
                  trailing: const Icon(Icons.chevron_right),
                ),
            ],
          ),
        ),
        Surface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              heading('Import from CSV'),
              const SizedBox(height: 8),
              const Text(
                'Review your file and map columns before importing. Existing data is not changed during preview.',
                style: TextStyle(color: Color(0xff626262)),
              ),
              const SizedBox(height: 24),
              const Text(
                '1. Select data type',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              const InputDecorator(
                decoration: InputDecoration(labelText: 'Data type'),
                child: Text('Products'),
              ),
              const SizedBox(height: 24),
              const Text(
                '2. Choose a CSV file',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xffaaaaaa)),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Choose a CSV file to begin',
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 18),
              Wrap(
                spacing: 12,
                children: [
                  inactiveAction('Choose file', icon: Icons.upload_file),
                  inactiveAction(
                    'Preview mapping',
                    icon: Icons.table_chart_outlined,
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Text(
                'File selection and import will be available when migration is connected.',
                style: TextStyle(fontSize: 13, color: Color(0xff666666)),
              ),
            ],
          ),
        ),
      ),
    ],
  );
}
