class Product {
  final String id, name;
  final int priceCentavos;
  final Map<String, int> recipe;
  const Product(this.id, this.name, this.priceCentavos, this.recipe);
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'priceCentavos': priceCentavos,
    'recipe': recipe,
  };
  factory Product.fromJson(Map<String, dynamic> j) => Product(
    j['id'],
    j['name'],
    j['priceCentavos'],
    Map<String, int>.from(j['recipe']),
  );
}

class OrderLine {
  final String productId, name, note;
  final int quantity, unitPrice;
  final Map<String, int> recipe;
  OrderLine(
    this.productId,
    this.name,
    this.quantity,
    this.unitPrice,
    Map<String, int> recipe, {
    this.note = '16 oz · Regular',
  }) : recipe = Map.unmodifiable(recipe);
  Map<String, dynamic> toJson() => {
    'productId': productId,
    'name': name,
    'quantity': quantity,
    'unitPrice': unitPrice,
    'recipe': recipe,
    'note': note,
  };
  factory OrderLine.fromJson(Map<String, dynamic> j) => OrderLine(
    j['productId'],
    j['name'],
    j['quantity'],
    j['unitPrice'],
    Map<String, int>.from(j['recipe']),
    note: j['note'],
  );
}

class CafeOrder {
  final String id;
  final String table;
  final bool dineIn;
  final List<OrderLine> lines;
  final String createdAt;
  final List<Map<String, dynamic>> payments;
  bool released, ready;
  CafeOrder(
    this.id,
    this.dineIn,
    this.lines, {
    this.table = '',
    String? createdAt,
    List<Map<String, dynamic>>? payments,
    this.released = false,
    this.ready = false,
  }) : createdAt = createdAt ?? DateTime.now().toIso8601String(),
       payments = payments ?? [];
  String get productId => lines.first.productId;
  int get quantity => lines.fold(0, (s, l) => s + l.quantity);
  int get totalCentavos =>
      lines.fold(0, (s, l) => s + l.unitPrice * l.quantity);
  int get paidCentavos => payments
      .where((p) => p['verified'] == true)
      .fold(0, (s, p) => s + (p['amount'] as int));
  Map<String, dynamic> operational() => {
    'id': id,
    'productId': productId,
    'quantity': quantity,
    'dineIn': dineIn,
    'totalCentavos': totalCentavos,
    'paidCentavos': paidCentavos,
    'released': released,
    'ready': ready,
  };
  Map<String, dynamic> toJson() => {
    'id': id,
    'table': table,
    'dineIn': dineIn,
    'lines': lines.map((l) => l.toJson()).toList(),
    'createdAt': createdAt,
    'payments': payments,
    'released': released,
    'ready': ready,
  };
  factory CafeOrder.fromJson(Map<String, dynamic> j) => CafeOrder(
    j['id'],
    j['dineIn'],
    (j['lines'] as List)
        .map((l) => OrderLine.fromJson(Map<String, dynamic>.from(l)))
        .toList(),
    table: j['table'] as String? ?? '',
    createdAt: j['createdAt'],
    payments: (j['payments'] as List)
        .map((p) => Map<String, dynamic>.from(p))
        .toList(),
    released: j['released'],
    ready: j['ready'],
  );
}

/// An order being assembled on this device, with a reserved order number.
class WorkingOrder {
  final String id;
  final List<OrderLine> lines;
  final bool dineIn;
  final String table;

  WorkingOrder(
    this.id,
    List<OrderLine> lines, {
    this.dineIn = true,
    this.table = '',
  }) : lines = List.unmodifiable(lines);

  Map<String, dynamic> toJson() => {
    'id': id,
    'lines': lines.map((line) => line.toJson()).toList(),
    'dineIn': dineIn,
    'table': table,
  };

  factory WorkingOrder.fromJson(Map<String, dynamic> json) => WorkingOrder(
    json['id'] as String,
    (json['lines'] as List)
        .map((line) => OrderLine.fromJson(Map<String, dynamic>.from(line)))
        .toList(),
    dineIn: json['dineIn'] as bool,
    table: json['table'] as String,
  );
}

class CafeEngine {
  final List<Product> _products;
  final List<CafeOrder> _orders;
  final List<WorkingOrder> _workingOrders;
  final Map<String, int> _stock, _reservations;
  final List<Map<String, dynamic>> waste, printJobs;
  int _next;
  CafeEngine._(
    this._products,
    this._orders,
    this._stock,
    this._reservations,
    this._next,
    this.waste,
    this.printJobs,
    this._workingOrders,
  );
  factory CafeEngine.sample() => CafeEngine._(
    [
      const Product('spanish-latte', 'Iced Spanish Latte', 16500, {
        'beans': 18,
        'milk': 150,
        'syrup': 15,
        'cup': 1,
        'lid': 1,
      }),
      const Product('caramel-latte', 'Caramel Latte', 17500, {
        'beans': 18,
        'milk': 150,
        'syrup': 20,
        'cup': 1,
        'lid': 1,
      }),
      const Product('americano', 'Americano', 12500, {
        'beans': 18,
        'cup': 1,
        'lid': 1,
      }),
      const Product('matcha', 'Matcha Latte', 18000, {
        'matcha': 4,
        'milk': 150,
        'syrup': 15,
        'cup': 1,
        'lid': 1,
      }),
      const Product('mocha', 'Café Mocha', 17000, {
        'beans': 18,
        'milk': 150,
        'chocolate': 20,
        'cup': 1,
        'lid': 1,
      }),
      const Product('chocolate', 'Chocolate', 15000, {
        'milk': 150,
        'chocolate': 25,
        'cup': 1,
        'lid': 1,
      }),
    ],
    [],
    {
      'beans': 1200,
      'milk': 8000,
      'syrup': 3000,
      'cup': 220,
      'lid': 220,
      'matcha': 500,
      'chocolate': 1000,
    },
    {},
    24,
    [],
    [],
    [],
  );
  List<Product> get products => List.unmodifiable(_products);
  List<CafeOrder> get orders => List.unmodifiable(_orders);
  List<WorkingOrder> get workingOrders => List.unmodifiable(_workingOrders);
  Map<String, int> get stock => Map.unmodifiable(_stock);
  Map<String, int> get reservations => Map.unmodifiable(_reservations);
  Product product(String id) => _products.firstWhere(
    (p) => p.id == id,
    orElse: () => throw ArgumentError('Unknown product'),
  );
  CafeOrder order(String id) => _orders.firstWhere(
    (o) => o.id == id,
    orElse: () => throw ArgumentError('Unknown order'),
  );
  CafeOrder createOrder({
    required String productId,
    required int quantity,
    required bool dineIn,
  }) {
    final p = product(productId);
    return createTicket([
      OrderLine(p.id, p.name, quantity, p.priceCentavos, Map.from(p.recipe)),
    ], dineIn: dineIn);
  }

  CafeOrder createTicket(
    List<OrderLine> lines, {
    required bool dineIn,
    String table = '',
  }) {
    _validateLines(lines, requireItems: true);
    final o = CafeOrder(
      '${_next++}',
      dineIn,
      List.unmodifiable(lines),
      table: dineIn ? table.trim() : '',
    );
    _orders.add(o);
    return o;
  }

  void _validateLines(List<OrderLine> lines, {required bool requireItems}) {
    if ((requireItems && lines.isEmpty) ||
        lines.any((l) => l.quantity <= 0 || l.unitPrice < 0)) {
      throw ArgumentError('Choose an item and a positive quantity');
    }
    for (final l in lines) {
      product(l.productId);
      if (l.recipe.keys.any((k) => !_stock.containsKey(k)) ||
          l.recipe.values.any((v) => v <= 0)) {
        throw ArgumentError('Unknown ingredient');
      }
    }
  }

  WorkingOrder reserveWorkingOrder() {
    final order = WorkingOrder('${_next++}', []);
    _workingOrders.add(order);
    return order;
  }

  int _workingOrderIndex(String id) {
    final index = _workingOrders.indexWhere((order) => order.id == id);
    if (index < 0) throw ArgumentError('Unknown working order');
    return index;
  }

  void updateWorkingOrder(
    String id,
    List<OrderLine> lines, {
    required bool dineIn,
    String table = '',
  }) {
    final index = _workingOrderIndex(id);
    _validateLines(lines, requireItems: false);
    _workingOrders[index] = WorkingOrder(
      id,
      lines,
      dineIn: dineIn,
      table: table,
    );
  }

  void cancelWorkingOrder(String id) {
    _workingOrders.removeAt(_workingOrderIndex(id));
  }

  CafeOrder finalizeWorkingOrder(String id) {
    final index = _workingOrderIndex(id);
    final working = _workingOrders[index];
    _validateLines(working.lines, requireItems: true);
    final order = CafeOrder(
      working.id,
      working.dineIn,
      working.lines,
      table: working.dineIn ? working.table.trim() : '',
    );
    _orders.add(order);
    _workingOrders.removeAt(index);
    return order;
  }

  void sendOrder(String id) {
    final o = order(id);
    if (!o.dineIn && o.paidCentavos < o.totalCentavos) {
      throw StateError('Takeout requires full verified payment');
    }
    _release(o);
  }

  void _release(CafeOrder o) {
    if (o.released) return;
    for (final l in o.lines) {
      l.recipe.forEach(
        (k, v) => _reservations[k] = (_reservations[k] ?? 0) + v * l.quantity,
      );
    }
    o.released = true;
    for (var i = 0; i < o.quantity; i++) {
      printJobs.add({
        'id': 'label-${o.id}-$i',
        'order': o.id,
        'type': 'Cup label',
        'status': 'Unconfigured',
      });
    }
  }

  void addPayment(
    String id, {
    required int amountCentavos,
    required String method,
    required bool verified,
    String reference = '',
    String? paymentId,
  }) {
    final o = order(id);
    if (paymentId != null) {
      for (final prior in o.payments.where((p) => p['id'] == paymentId)) {
        if (prior['amount'] != amountCentavos ||
            prior['method'] != method ||
            prior['reference'] != reference ||
            prior['verified'] != (method == 'cash' || verified)) {
          throw StateError(
            'Payment retry does not match the original allocation',
          );
        }
        return;
      }
    }
    if (amountCentavos <= 0 || !['cash', 'gcash', 'card'].contains(method)) {
      throw ArgumentError(
        'Enter a positive amount and supported payment method',
      );
    }
    final confirmed = method == 'cash' || verified;
    if (confirmed &&
        method != 'cash' &&
        reference.trim().isNotEmpty &&
        _orders.any(
          (order) => order.payments.any(
            (p) =>
                p['verified'] == true &&
                p['method'] == method &&
                p['reference'] == reference,
          ),
        )) {
      throw StateError(
        'Payment reference already recorded; manager review required',
      );
    }
    if (confirmed && amountCentavos > o.totalCentavos - o.paidCentavos) {
      throw StateError('Payment exceeds remaining balance');
    }
    o.payments.add({
      'id': paymentId ?? '$id-payment-${o.payments.length}',
      'amount': amountCentavos,
      'method': method,
      'verified': confirmed,
      'reference': reference,
    });
    if (o.paidCentavos == o.totalCentavos) {
      _release(o);
    }
  }

  /// Records an explicit receipt request. No printer adapter is configured yet.
  void requestReceipt(String id) {
    final o = order(id);
    if (o.paidCentavos < o.totalCentavos) {
      throw StateError('Confirm full payment before printing a receipt');
    }
    if (printJobs.any((p) => p['id'] == 'receipt-${o.id}')) return;
    printJobs.add({
      'id': 'receipt-${o.id}',
      'order': o.id,
      'type': 'Payment slip',
      'status': 'Unconfigured',
    });
  }

  void markReady(String id) {
    final o = order(id);
    if (!o.released) {
      throw StateError('Send the order before marking it ready');
    }
    if (o.ready) return;
    for (final l in o.lines) {
      l.recipe.forEach((k, v) {
        final q = v * l.quantity;
        _stock[k] = _stock[k]! - q;
        _reservations[k] = (_reservations[k] ?? 0) - q;
      });
    }
    o.ready = true;
  }

  void logWaste(
    String ingredientId,
    int quantity, {
    String reason = 'Dial-in',
    String note = '',
  }) {
    if (!_stock.containsKey(ingredientId) || quantity <= 0) {
      throw ArgumentError('Choose an ingredient and a positive amount');
    }
    _stock[ingredientId] = _stock[ingredientId]! - quantity;
    waste.insert(0, {
      'ingredient': ingredientId,
      'quantity': quantity,
      'reason': reason,
      'note': note,
      'at': DateTime.now().toIso8601String(),
    });
  }

  Map<String, dynamic> staffSnapshot() => {
    'products': _products.map((p) => p.toJson()).toList(),
    'orders': _orders.map((o) => o.operational()).toList(),
    'stock': Map.from(_stock),
    'reservations': Map.from(_reservations),
  };
  Map<String, dynamic> toJson() => {
    'schema': 1,
    'products': _products.map((p) => p.toJson()).toList(),
    'orders': _orders.map((o) => o.toJson()).toList(),
    'stock': _stock,
    'reservations': _reservations,
    'next': _next,
    'waste': waste,
    'printJobs': printJobs,
    'workingOrders': _workingOrders.map((order) => order.toJson()).toList(),
  };
  factory CafeEngine.fromJson(Map<String, dynamic> j) {
    if (j['schema'] != 1) {
      throw const FormatException('Unsupported saved-data version');
    }
    return CafeEngine._(
      (j['products'] as List)
          .map((p) => Product.fromJson(Map<String, dynamic>.from(p)))
          .toList(),
      (j['orders'] as List)
          .map((o) => CafeOrder.fromJson(Map<String, dynamic>.from(o)))
          .toList(),
      Map<String, int>.from(j['stock']),
      Map<String, int>.from(j['reservations']),
      j['next'],
      (j['waste'] as List).map((w) => Map<String, dynamic>.from(w)).toList(),
      (j['printJobs'] as List)
          .map((w) => Map<String, dynamic>.from(w))
          .toList(),
      ((j['workingOrders'] as List?) ?? [])
          .map(
            (order) => WorkingOrder.fromJson(Map<String, dynamic>.from(order)),
          )
          .toList(),
    );
  }
}
