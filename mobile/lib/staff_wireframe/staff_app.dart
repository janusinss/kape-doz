import 'package:flutter/material.dart';

/// A self-contained, illustrative staff wireframe. It never touches saved orders.
class StaffWireframeApp extends StatelessWidget {
  const StaffWireframeApp({super.key, this.onAdmin});
  final VoidCallback? onAdmin;

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff454545),
        brightness: Brightness.light,
      ).copyWith(
        primary: const Color(0xff262626),
        secondaryContainer: const Color(0xffdedede),
        onSecondaryContainer: const Color(0xff262626),
      ),
      scaffoldBackgroundColor: const Color(0xffededed),
      fontFamily: 'Roboto',
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          foregroundColor: const Color(0xff262626),
          side: const BorderSide(color: Color(0xffaaaaaa)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          backgroundColor: const Color(0xff262626),
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        filled: true,
        fillColor: Colors.white,
      ),
    ),
    home: _StaffHome(onAdmin: onAdmin),
  );
}

class _StaffHome extends StatefulWidget {
  const _StaffHome({this.onAdmin});
  final VoidCallback? onAdmin;
  @override
  State<_StaffHome> createState() => _StaffHomeState();
}

class _StaffHomeState extends State<_StaffHome> {
  int screen = 0;
  int selectedOrder = 0;
  int nextOrder = 26;
  String category = 'All items';
  String query = '';
  final services = <int, String>{24: 'Dine in', 25: 'Dine in'};
  final tables = <int, String>{};
  final table = TextEditingController();
  String ingredient = 'Espresso beans';
  String reason = 'Dial-in';
  final amount = TextEditingController();
  final note = TextEditingController();
  final orders = <int, Map<String, int>>{24: {}, 25: {}};
  final activeOrders = <int>[24, 25, 26, 27, 28, 29];
  final entries = <String>[
    'Espresso beans · 18 g · Dial-in',
    'Whole milk · 100 ml · Spillage',
  ];
  final products = const <(String, int, String)>[
    ('Iced Spanish Latte', 165, 'Coffee'),
    ('Caramel Latte', 175, 'Coffee'),
    ('Americano', 125, 'Coffee'),
    ('Matcha Latte', 180, 'Non-coffee'),
    ('Café Mocha', 170, 'Coffee'),
    ('Chocolate', 150, 'Non-coffee'),
  ];
  @override
  void dispose() {
    amount.dispose();
    note.dispose();
    table.dispose();
    super.dispose();
  }

  Map<String, int> get ticket => orders.values.elementAt(selectedOrder);
  int get orderId => orders.keys.elementAt(selectedOrder);
  String get service => services[orderId] ?? 'Dine in';
  void selectOrder(int index) {
    setState(() {
      selectedOrder = index;
      table.text = tables[orderId] ?? '';
    });
  }

  int get total => ticket.entries.fold(
    0,
    (sum, e) => sum + products.firstWhere((p) => p.$1 == e.key).$2 * e.value,
  );
  Widget button(String label, VoidCallback? action, {bool primary = false}) =>
      primary
      ? FilledButton(onPressed: action, child: Text(label))
      : OutlinedButton(onPressed: action, child: Text(label));
  Widget panel(
    Widget child, {
    Key? key,
    EdgeInsets padding = const EdgeInsets.all(18),
  }) => Container(
    key: key,
    padding: padding,
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xffbdbdbd)),
      borderRadius: BorderRadius.circular(8),
    ),
    child: child,
  );
  Widget sectionTitle(String title, {String? detail}) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
        ),
      ),
      if (detail != null)
        Text(detail, style: const TextStyle(color: Color(0xff606060))),
    ],
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: const Color(0xff262626),
      foregroundColor: Colors.white,
      title: const Text(
        'KAPE DOZ',
        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
      ),
      actions: [
        if (widget.onAdmin != null)
          TextButton(
            onPressed: widget.onAdmin,
            child: const Text('Admin', style: TextStyle(color: Colors.white)),
          ),
        const SizedBox(width: 12),
      ],
    ),
    body: SafeArea(
      child: Column(
        children: [
          Container(
            color: Colors.white,
            child: Row(
              children: [
                for (var i = 0; i < 3; i++)
                  Expanded(
                    child: TextButton(
                      onPressed: () => setState(() => screen = i),
                      style: TextButton.styleFrom(
                        minimumSize: const Size(48, 52),
                        foregroundColor: const Color(0xff262626),
                        backgroundColor: i == screen
                            ? const Color(0xffdddddd)
                            : Colors.white,
                      ),
                      child: Text(
                        ['Register', 'Barista station', 'Waste'][i],
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontWeight: i == screen
                              ? FontWeight.w700
                              : FontWeight.w400,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
            color: const Color(0xffd8d8d8),
            child: const Text(
              'WIREFRAME PREVIEW  ·  Illustrative orders and values',
              style: TextStyle(fontSize: 12, color: Color(0xff333333)),
            ),
          ),
          Expanded(child: [register(), kitchen(), waste()][screen]),
        ],
      ),
    ),
  );

  Widget register() => LayoutBuilder(
    builder: (context, box) {
      final wide = box.maxWidth >= 900;
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (var i = 0; i < orders.length; i++)
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: OutlinedButton(
                              onPressed: () => selectOrder(i),
                              style: OutlinedButton.styleFrom(
                                backgroundColor: i == selectedOrder
                                    ? const Color(0xffd6d6d6)
                                    : Colors.white,
                              ),
                              child: Text('Order #${orders.keys.elementAt(i)}'),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                button(
                  '+ New order',
                  () => setState(() {
                    orders[nextOrder++] = {};
                    selectedOrder = orders.length - 1;
                    table.clear();
                  }),
                  primary: true,
                ),
              ],
            ),
          ),
          Expanded(
            child: wide
                ? Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(flex: 6, child: catalog()),
                        const SizedBox(width: 12),
                        Expanded(flex: 4, child: orderPanel()),
                      ],
                    ),
                  )
                : DefaultTabController(
                    length: 2,
                    child: Column(
                      children: [
                        TabBar(
                          tabs: [
                            const Tab(text: 'Menu'),
                            Tab(
                              text:
                                  'Ticket (${ticket.values.fold(0, (a, b) => a + b)})',
                            ),
                          ],
                        ),
                        Expanded(
                          child: TabBarView(
                            children: [
                              Padding(
                                padding: const EdgeInsets.all(12),
                                child: catalog(),
                              ),
                              Padding(
                                padding: const EdgeInsets.all(12),
                                child: orderPanel(),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
        ],
      );
    },
  );

  Widget catalog() {
    final filtered = products
        .where(
          (p) =>
              (category == 'All items' || p.$3 == category) &&
              p.$1.toLowerCase().contains(query.toLowerCase()),
        )
        .toList();
    return panel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          sectionTitle('Menu', detail: '${filtered.length} items'),
          const SizedBox(height: 14),
          TextField(
            onChanged: (v) => setState(() => query = v),
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              labelText: 'Search menu',
              isDense: true,
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final c in ['All items', 'Coffee', 'Non-coffee'])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: OutlinedButton(
                      onPressed: () => setState(() => category = c),
                      style: OutlinedButton.styleFrom(
                        backgroundColor: c == category
                            ? const Color(0xffd5d5d5)
                            : Colors.white,
                      ),
                      child: Text(c),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: LayoutBuilder(
              builder: (context, c) => GridView.builder(
                itemCount: filtered.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: c.maxWidth >= 590 ? 3 : 2,
                  mainAxisExtent: 126,
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                ),
                itemBuilder: (context, i) {
                  final p = filtered[i];
                  return OutlinedButton(
                    onPressed: () =>
                        setState(() => ticket[p.$1] = (ticket[p.$1] ?? 0) + 1),
                    style: OutlinedButton.styleFrom(
                      alignment: Alignment.topLeft,
                      padding: const EdgeInsets.all(12),
                      backgroundColor: const Color(0xfff4f4f4),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            p.$1,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Row(
                          children: [
                            Expanded(child: Text('₱ ${p.$2}')),
                            const Icon(Icons.add_circle_outline, size: 20),
                          ],
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget orderPanel() => panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        sectionTitle(
          'Current ticket',
          detail: '#${orders.keys.elementAt(selectedOrder)}',
        ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'Dine in', label: Text('Dine in')),
            ButtonSegment(value: 'Takeout', label: Text('Takeout')),
          ],
          selected: {service},
          onSelectionChanged: (v) =>
              setState(() => services[orderId] = v.first),
          showSelectedIcon: false,
        ),
        if (service == 'Dine in') ...[
          const SizedBox(height: 10),
          TextField(
            controller: table,
            onChanged: (value) => tables[orderId] = value,
            decoration: const InputDecoration(
              labelText: 'Table number',
              isDense: true,
            ),
          ),
        ],
        const Divider(height: 26),
        Expanded(
          child: ticket.isEmpty
              ? const Center(
                  child: Text(
                    'Select an item to start this order.',
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView(
                  children: [
                    for (final e in ticket.entries)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          '${e.value} × ${e.key}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: const Text('16 oz · Regular'),
                        trailing: IconButton(
                          tooltip: 'Remove ${e.key}',
                          onPressed: () => setState(() => ticket.remove(e.key)),
                          icon: const Icon(Icons.close),
                        ),
                      ),
                  ],
                ),
        ),
        const Divider(),
        Row(
          children: [
            const Expanded(
              child: Text(
                'TOTAL',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            Text(
              '₱ $total',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
            ),
          ],
        ),
        const SizedBox(height: 12),
        button(
          'Charge  ·  ₱ $total',
          ticket.isEmpty
              ? null
              : () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Payment preview')),
                ),
          primary: true,
        ),
      ],
    ),
  );

  Widget kitchen() => LayoutBuilder(
    builder: (context, c) {
      final columns = c.maxWidth >= 1050
          ? 3
          : c.maxWidth >= 650
          ? 2
          : 1;
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: sectionTitle(
                    'Active orders',
                    detail: '${activeOrders.length}',
                  ),
                ),
                const SizedBox(width: 12),
                button(
                  'Recall',
                  () => ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('No completed orders to recall'),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Expanded(
              child: GridView.builder(
                itemCount: activeOrders.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  mainAxisExtent: c.maxHeight >= 620 && columns == 3
                      ? (c.maxHeight - 100) / 2
                      : 260,
                ),
                itemBuilder: (context, i) {
                  final id = activeOrders[i];
                  final p = products[(id - 24) % products.length];
                  return panel(
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '#$id  ·  ${id.isEven ? 'TABLE 0${i + 1}' : 'TAKEOUT'}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const Text('02:14'),
                          ],
                        ),
                        const Divider(height: 28),
                        Text(
                          '1 × ${p.$1}',
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text('16 oz  ·  Regular'),
                        const SizedBox(height: 10),
                        const Text(
                          'Less sweet',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const Spacer(),
                        button(
                          'Mark ready',
                          () => setState(() => activeOrders.remove(id)),
                          primary: true,
                        ),
                      ],
                    ),
                    key: const ValueKey('barista-order-card'),
                    padding: const EdgeInsets.all(16),
                  );
                },
              ),
            ),
          ],
        ),
      );
    },
  );

  Widget waste() => LayoutBuilder(
    builder: (context, c) {
      final wide = c.maxWidth >= 850;
      final form = wasteForm();
      final history = wasteHistory();
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            sectionTitle('Waste & dial-in'),
            const SizedBox(height: 6),
            const Text('Record ingredient use outside customer orders.'),
            const SizedBox(height: 16),
            if (wide)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 3, child: form),
                  const SizedBox(width: 12),
                  Expanded(flex: 2, child: history),
                ],
              )
            else ...[
              form,
              const SizedBox(height: 12),
              history,
            ],
          ],
        ),
      );
    },
  );
  Widget wasteForm() => panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        sectionTitle('Log waste'),
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final preset in [
              'Espresso dial-in',
              'Milk spillage',
              'Other waste',
            ])
              OutlinedButton(
                onPressed: () => setState(() {
                  ingredient = preset == 'Milk spillage'
                      ? 'Whole milk'
                      : 'Espresso beans';
                  reason = preset == 'Milk spillage'
                      ? 'Spillage'
                      : preset == 'Other waste'
                      ? 'Other'
                      : 'Dial-in';
                }),
                child: Text(preset),
              ),
          ],
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          value: ingredient,
          decoration: const InputDecoration(
            labelText: 'Ingredient or packaging',
          ),
          items: [
            'Espresso beans',
            'Whole milk',
            'Syrup',
            'Cup',
          ].map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
          onChanged: (v) => setState(() => ingredient = v!),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: amount,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Quantity'),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: reason,
          decoration: const InputDecoration(labelText: 'Reason'),
          items: [
            'Dial-in',
            'Spillage',
            'Other',
          ].map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
          onChanged: (v) => setState(() => reason = v!),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: note,
          decoration: const InputDecoration(labelText: 'Note (optional)'),
        ),
        const SizedBox(height: 16),
        button('Save entry', () {
          final value = amount.text.trim();
          if (value.isEmpty) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('Enter a quantity.')));
            return;
          }
          setState(() {
            entries.insert(0, '$ingredient · $value · $reason');
            amount.clear();
            note.clear();
          });
        }, primary: true),
      ],
    ),
  );
  Widget wasteHistory() => panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        sectionTitle('Recent entries', detail: '${entries.length}'),
        const SizedBox(height: 12),
        for (final entry in entries)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(entry),
            subtitle: const Text('Today'),
            leading: const Icon(Icons.receipt_long_outlined),
          ),
      ],
    ),
  );
}
