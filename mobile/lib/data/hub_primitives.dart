enum HubRole { cashier, barista, manager, owner }

/// Safe identity returned by the authority. No credential or financial fields.
class HubActor {
  final String id, displayName, branchId;
  final HubRole role;

  const HubActor({
    required this.id,
    required this.displayName,
    required this.branchId,
    required this.role,
  });
}

const maxSafeInt = 9007199254740991;
const moneyCeiling = 100000000000;
const recordIdSource = r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}';
const validUnits = {'g', 'ml', 'piece'};
const storageUnavailableMessage =
    'Saved device state could not be opened. Retry or ask your administrator for recovery assistance.';

final idPattern = RegExp('^$recordIdSource\$');
final uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

bool exactMap(Object? value, Set<String> keys) =>
    value is Map<String, dynamic> &&
    value.length == keys.length &&
    keys.every(value.containsKey);

bool isPrivateLanHost(String host) {
  final lower = host.toLowerCase();
  if (lower.endsWith('.local')) return true;
  final ipv4 = RegExp(
    r'^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$',
  ).firstMatch(lower);
  if (ipv4 == null) return false;
  final octets = [
    int.parse(ipv4.group(1)!),
    int.parse(ipv4.group(2)!),
    int.parse(ipv4.group(3)!),
    int.parse(ipv4.group(4)!),
  ];
  if (octets.any((o) => o < 0 || o > 255)) return false;
  return octets[0] == 10 ||
      (octets[0] == 192 && octets[1] == 168) ||
      (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31);
}

Uri? validateHubOrigin(
  Uri? value, {
  bool allowInsecureLoopback = false,
  bool allowPrivateLanHttp = false,
}) {
  if (value == null) return null;
  final loopback = const {
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
  }.contains(value.host.toLowerCase());
  final lan = isPrivateLanHost(value.host);
  final transport =
      value.scheme == 'https' ||
      (value.scheme == 'http' && allowInsecureLoopback && loopback) ||
      (value.scheme == 'http' && allowPrivateLanHttp && lan);
  if (!transport ||
      value.host.isEmpty ||
      value.userInfo.isNotEmpty ||
      value.hasQuery ||
      value.hasFragment ||
      (value.path.isNotEmpty && value.path != '/')) {
    return null;
  }
  return Uri.parse(value.origin);
}

bool validateDeviceCredentials(String deviceId, String deviceSecret) =>
    idPattern.hasMatch(deviceId) &&
    deviceSecret.length >= 32 &&
    deviceSecret.length <= 128;

String formatCentavos(Object? amount) =>
    '₱${((amount as num? ?? 0) / 100).toStringAsFixed(2)}';

int? parseDecimalFixed(String text, int places, {int max = moneyCeiling}) {
  if (!RegExp('^\\d+(\\.\\d{1,$places})?\$').hasMatch(text.trim())) return null;
  final parts = text.trim().split('.');
  final value = int.tryParse(parts[0]);
  if (value == null) return null;
  var scale = 1;
  for (var i = 0; i < places; i++) {
    scale *= 10;
  }
  final fraction = parts.length > 1
      ? int.parse(parts[1].padRight(places, '0'))
      : 0;
  final result = value * scale + fraction;
  return result <= max ? result : null;
}

bool amendmentNeedsManagerReview(
  String? operation,
  int? oldQty,
  int? newQty,
) =>
    operation == 'remove' ||
    operation == 'replace' ||
    (operation == 'quantity' &&
        oldQty != null &&
        newQty != null &&
        newQty < oldQty);

bool orderHasActiveOrPendingTenders(Map<String, dynamic> order) =>
    order['paymentState'] == 'paid' ||
    (order['paidCentavos'] as int? ?? 0) > 0 ||
    order['hasPendingPayments'] == true ||
    (order['payments'] as List? ?? const []).any(
      (payment) => payment is Map && payment['status'] == 'pending',
    ) ||
    (order['discountCentavos'] as int? ?? 0) > 0 ||
    (order['loyaltyRedemptionCentavos'] as int? ?? 0) > 0;

bool orderCanChangePrice(Map<String, dynamic> order) =>
    order['cancelled'] != true &&
    (order['paymentState'] == null || order['paymentState'] == 'unpaid') &&
    !orderHasActiveOrPendingTenders(order);

const _cashierOrderActions = {
  'send': 'order.send',
  'receipt': 'order.receipt',
  'label': 'order.label',
  'payments': 'order.payment',
  'approvals': 'approval.request',
  'refunds': 'refund.request',
  'amendments': 'order.amendment.request',
  'replace-unavailable': 'order.replace-unavailable',
  'customer': 'order.customer.set',
};

({HubRole role, String Function(Map<String, dynamic> payload) action})?
matchStaffCommandRoute(String path) {
  if (!path.startsWith('/api/v1/')) return null;
  final parts = path.split('/').skip(3).toList();
  bool ids(Iterable<String> values) => values.every(idPattern.hasMatch);
  return switch (parts) {
    ['orders'] => (role: HubRole.cashier, action: (_) => 'order.create'),
    ['customers'] => (role: HubRole.cashier, action: (_) => 'customer.create'),
    ['customers', final customerId] when ids([customerId]) => (
      role: HubRole.cashier,
      action: (_) => 'customer.update',
    ),
    ['loyalty', 'sync'] => (
      role: HubRole.cashier,
      action: (_) => 'loyalty.sync',
    ),
    ['orders', final orderId, 'loyalty', 'redeem-request']
        when ids([orderId]) =>
      (role: HubRole.cashier, action: (_) => 'loyalty.redeem.request'),
    ['loyalty', 'redemptions', final redemptionId, 'validate-cloud']
        when ids([redemptionId]) =>
      (role: HubRole.cashier, action: (_) => 'loyalty.redeem.validate-cloud'),
    ['shifts', 'open'] => (role: HubRole.cashier, action: (_) => 'shift.open'),
    ['shifts', final shiftId, 'submit-count'] when ids([shiftId]) => (
      role: HubRole.cashier,
      action: (_) => 'shift.submit-count',
    ),
    ['orders', final orderId, final operation]
        when ids([orderId]) && _cashierOrderActions.containsKey(operation) =>
      (
        role: HubRole.cashier,
        action: (_) => _cashierOrderActions[operation]!,
      ),
    ['orders', final orderId, 'payments', final paymentId, final decision]
        when ids([orderId, paymentId]) &&
            (decision == 'verify' || decision == 'reject') =>
      (role: HubRole.cashier, action: (_) => 'order.payment.$decision'),
    ['refunds', final refundId, 'legs', final legId]
        when ids([refundId, legId]) =>
      (
        role: HubRole.cashier,
        action: (payload) => 'refund.leg.${payload['action']}',
      ),
    ['print-jobs', final jobId, 'retry'] when ids([jobId]) => (
      role: HubRole.cashier,
      action: (payload) => 'print-job.${payload['action'] ?? 'retry'}',
    ),
    ['waste'] => (role: HubRole.barista, action: (_) => 'inventory.waste'),
    ['waste', final wasteId, 'correct'] when ids([wasteId]) => (
      role: HubRole.barista,
      action: (_) => 'inventory.waste.correct',
    ),
    ['orders', final orderId, final operation]
        when ids([orderId]) &&
            (operation == 'ready' ||
                operation == 'prepare' ||
                operation == 'handover' ||
                operation == 'recall') =>
      (role: HubRole.barista, action: (_) => 'order.$operation'),
    ['orders', final orderId, 'cancellation', 'disposition']
        when ids([orderId]) =>
      (
        role: HubRole.barista,
        action: (_) => 'order.cancellation.disposition',
      ),
    ['orders', final orderId, 'amendments', final amendmentId, 'acknowledge']
        when ids([orderId, amendmentId]) =>
      (
        role: HubRole.barista,
        action: (_) => 'order.amendment.acknowledge',
      ),
    _ => null,
  };
}

bool isHubMutationPath(String path) {
  if (matchStaffCommandRoute(path) != null) return true;
  if (!path.startsWith('/api/v1/')) return false;
  return switch (path.split('/').skip(3).toList()) {
    ['ingredients'] || ['inventory', 'receipts'] || ['products'] || ['drawers'] =>
      true,
    ['devices', final id, 'revoke'] || ['shifts', final id, 'review'] =>
      idPattern.hasMatch(id),
    _ => false,
  };
}
