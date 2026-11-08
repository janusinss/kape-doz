import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'hub_primitives.dart';
import 'order_amendment.dart';
import 'stock_shortage.dart';
import 'product_availability.dart';

export 'hub_primitives.dart' show HubRole, HubActor;

typedef _Tender = ({
  String id,
  String method,
  int amount,
  String status,
  String? reference,
  int? received,
  int? change,
});

/// Memory-only session. Token storage across app restarts is deliberately absent.
class HubSession {
  final HubActor actor;
  final int expiresAt;
  final String _token;

  const HubSession._(this.actor, this.expiresAt, this._token);

  @override
  String toString() =>
      'HubSession(role: ${actor.role.name}, expiresAt: $expiresAt)';
}

/// Errors expose controlled local text, never raw response/transport messages.
class HubException implements Exception {
  final String code;
  final int? status;
  final String? requestId;
  final bool outcomeUnknown;

  const HubException(
    this.code, {
    this.status,
    this.requestId,
    this.outcomeUnknown = false,
  });

  String get message => switch (code) {
    'unauthorized' => 'Sign in again to continue.',
    'forbidden' => 'Your account cannot perform this action.',
    'conflict' => 'The record changed. Refresh its status before continuing.',
    'product_unavailable' =>
      'A menu item is unavailable. Refresh and replace it before continuing.',
    'rate_limited' => 'Too many attempts. Try again later.',
    'not_found' => 'The requested record is unavailable.',
    'timeout' => 'The hub response timed out. Check the operation status.',
    'connection_failed' => 'The hub could not be reached. Check pending work.',
    'redirect_blocked' =>
      'The hub address redirected. Check its configuration.',
    'invalid_response' => 'The hub returned an unreadable response.',
    'invalid_request' => 'Check the information and try again.',
    'session_changed' => 'The signed-in session changed. Try again.',
    'client_closed' => 'The hub connection has been closed.',
    _ => 'The hub could not complete the request.',
  };

  @override
  String toString() =>
      'HubException($code, status: $status, requestId: $requestId, outcomeUnknown: $outcomeUnknown)';
}

/// Thin authority gateway used by the future integrated staff UI.
///
/// This client never retries a POST. If a mutation times out or loses its response,
/// its outcome is unknown: inspect hub state and reuse the original command ID.
/// The caller owns durable pending-command storage; this class does not pretend
/// that in-memory credentials or commands survive an application restart.
class HubClient {
  final Uri baseUri;
  final http.Client _client;
  final Duration timeout;
  HubSession? _session;
  bool _closed = false;
  int _authGeneration = 0;

  static final _tokenPattern = RegExp(r'^[A-Za-z0-9_-]{43}$');
  static const _safeCodes = {
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'product_unavailable',
    'rate_limited',
    'invalid_request',
    'request_failed',
    'payload_too_large',
  };
  static const _maxResponseBytes = 2 * 1024 * 1024;
  // Match the hub's JavaScript trim for merchant references.
  static const _referenceWhitespace =
      r'[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
  static final _referenceEdges = RegExp(
    '^$_referenceWhitespace+|$_referenceWhitespace+'
    r'$',
  );

  HubClient({
    required this.baseUri,
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
    bool allowInsecureLoopback = false,
    bool allowPrivateLanHttp = false,
  }) : _client = client ?? http.Client() {
    if (validateHubOrigin(
          baseUri,
          allowInsecureLoopback: allowInsecureLoopback,
          allowPrivateLanHttp: allowPrivateLanHttp,
        ) ==
        null) {
      throw ArgumentError(
        'Use an HTTPS hub origin. Insecure loopback requires an explicit development option.',
      );
    }
    if (timeout <= Duration.zero) {
      throw ArgumentError('The hub timeout must be positive.');
    }
  }

  HubSession? get session => _session;

  void clearSession() {
    _authGeneration++;
    _session = null;
  }

  void close() {
    if (_closed) return;
    clearSession();
    _closed = true;
    _client.close();
  }

  Future<HubSession> loginStaff({
    required String accountId,
    required String pin,
    required String deviceId,
    required String deviceSecret,
  }) => _login(
    '/api/v1/auth/staff',
    {
      'accountId': accountId,
      'pin': pin,
      'deviceId': deviceId,
      'deviceSecret': deviceSecret,
    },
    {HubRole.cashier, HubRole.barista},
  );

  Future<HubSession> loginAdmin({
    required String accountId,
    required String password,
  }) => _login(
    '/api/v1/auth/admin',
    {'accountId': accountId, 'password': password},
    {HubRole.manager, HubRole.owner},
  );

  Future<HubSession> _login(
    String path,
    Map<String, dynamic> payload,
    Set<HubRole> roles,
  ) async {
    clearSession();
    final generation = _authGeneration;
    final response = await _request(
      'POST',
      path,
      payload: payload,
      authenticated: false,
    );
    final parsed = _parseSession(response);
    if (!roles.contains(parsed.actor.role)) {
      throw const HubException('invalid_response');
    }
    if (generation != _authGeneration || _closed) {
      throw const HubException('session_changed');
    }
    _session = parsed;
    return parsed;
  }

  Future<void> logout() async {
    final sessionAtStart = _session;
    try {
      if (sessionAtStart != null) {
        await _request('POST', '/api/v1/auth/logout', payload: {});
      }
    } finally {
      if (identical(_session, sessionAtStart)) {
        clearSession();
      }
    }
  }

  Future<Map<String, dynamic>> me() => _request('GET', '/api/v1/me');

  Future<Map<String, dynamic>> hubInfo() =>
      _request('GET', '/api/v1/hub-info', authenticated: false);

  Future<Map<String, dynamic>> claimPairingCode(String pairingCode) async {
    clearSession();
    final generation = _authGeneration;
    final res = await _request(
      'POST',
      '/api/v1/devices/pair/claim',
      payload: {'pairingCode': pairingCode.trim()},
      authenticated: false,
    );
    final enrollment = res['enrollment'] is Map<String, dynamic>
        ? res['enrollment'] as Map<String, dynamic>
        : res;
    final rawSession = enrollment['session'];
    if (rawSession is Map<String, dynamic>) {
      final parsed = _parseSession(rawSession);
      if (!{HubRole.cashier, HubRole.barista}.contains(parsed.actor.role)) {
        throw const HubException('invalid_response');
      }
      if (generation == _authGeneration && !_closed) {
        _session = parsed;
      }
    }
    return enrollment;
  }
  Future<Map<String, dynamic>> commandStatus(String commandId) async {
    if (!uuidPattern.hasMatch(commandId)) {
      throw ArgumentError('A stable UUID command ID is required.');
    }
    final result = await _request('GET', '/api/v1/commands/$commandId');
    if (result['commandId'] != commandId) {
      throw const HubException('invalid_response');
    }
    if (result['status'] == 'unrecorded' &&
        exactMap(result, {'commandId', 'status'})) {
      return result;
    }
    final acceptedAt = result['acceptedAt'];
    final action = result['action'];
    final validAction =
        action is String && RegExp(r'^[a-z][a-z._-]{0,99}$').hasMatch(action);
    if (result['status'] == 'accepted' &&
        exactMap(result, {'commandId', 'status', 'action', 'acceptedAt'}) &&
        validAction &&
        acceptedAt is int &&
        acceptedAt >= 0 &&
        acceptedAt <= maxSafeInt) {
      return result;
    }
    final rejectedAt = result['rejectedAt'];
    final error = result['error'];
    if (result['status'] == 'rejected' &&
        exactMap(result, {
          'commandId',
          'status',
          'action',
          'rejectedAt',
          'error',
        }) &&
        validAction &&
        rejectedAt is int &&
        rejectedAt >= 0 &&
        rejectedAt <= maxSafeInt &&
        exactMap(error, {'code', 'message'}) &&
        {
          'invalid_request',
          'not_found',
          'conflict',
          'product_unavailable',
          'payload_too_large',
        }.contains((error as Map<String, dynamic>)['code']) &&
        error['message'] is String &&
        (error['message'] as String).trim().isNotEmpty &&
        (error['message'] as String).length <= 500) {
      return result;
    }
    throw const HubException('invalid_response');
  }

  Future<Map<String, dynamic>> staffContext() =>
      _request('GET', '/api/v1/staff/context');
  Future<Map<String, dynamic>> adminContext() =>
      _request('GET', '/api/v1/admin/context');
  Future<List<Map<String, dynamic>>> products() async {
    final products = await _list('/api/v1/products', 'products');
    if (!products.every(validProductAvailability)) {
      throw const HubException('invalid_response');
    }
    return products;
  }

  Future<List<Map<String, dynamic>>> ingredients() =>
      _list('/api/v1/ingredients', 'ingredients');
  Future<List<Map<String, dynamic>>> customers({String? q}) => _list(
    '/api/v1/customers',
    'customers',
    query: q == null || q.trim().isEmpty ? null : {'q': q.trim()},
  );
  Future<Map<String, dynamic>> loyaltyCloudState() =>
      _request('GET', '/api/v1/loyalty/cloud-state');
  Future<List<Map<String, dynamic>>> loyaltyRedemptions() =>
      _list('/api/v1/loyalty/redemptions', 'redemptions');
  Future<List<Map<String, dynamic>>> approvals() async {
    final values = await _list('/api/v1/approvals', 'approvals');
    for (final value in values) {
      if (!_validApproval(value)) throw const HubException('invalid_response');
    }
    return values;
  }

  Future<List<Map<String, dynamic>>> refunds() async {
    final values = await _list('/api/v1/refunds', 'refunds');
    if (!values.every(_validRefund)) {
      throw const HubException('invalid_response');
    }
    return values;
  }

  static bool _validRefund(Map<String, dynamic> value) {
    bool id(Object? value) => value is String && idPattern.hasMatch(value);
    bool number(Object? value, [int min = 0]) =>
        value is int && value >= min && value <= maxSafeInt;
    bool maybeText(Object? value) => value == null || value is String;
    bool records(Object? values, bool Function(Map<String, dynamic>) valid) =>
        values is List &&
        values.every((item) => item is Map<String, dynamic> && valid(item));
    const methods = {'cash', 'gcash', 'card'};
    return id(value['id']) &&
        id(value['orderId']) &&
        id(value['requesterId']) &&
        number(value['orderNo'], 1) &&
        number(value['orderVersion'], 1) &&
        number(value['requestedAt']) &&
        number(value['amountCentavos'], 1) &&
        value['requesterName'] is String &&
        value['reason'] is String &&
        {'pending', 'stale', 'denied', 'approved'}.contains(value['status']) &&
        (value['decidedAt'] == null || number(value['decidedAt'])) &&
        maybeText(value['decisionReason']) &&
        records(
          value['lines'],
          (line) =>
              number(line['lineNo']) &&
              line['name'] is String &&
              number(line['quantity'], 1) &&
              number(line['unitPriceCentavos'], 1),
        ) &&
        records(
          value['tenders'],
          (tender) =>
              id(tender['paymentId']) &&
              methods.contains(tender['method']) &&
              number(tender['amountCentavos'], 1) &&
              number(tender['refundableCentavos']) &&
              maybeText(tender['reference']),
        ) &&
        records(
          value['legs'],
          (leg) =>
              id(leg['id']) &&
              id(leg['paymentId']) &&
              methods.contains(leg['method']) &&
              number(leg['amountCentavos'], 1) &&
              number(leg['version'], 1) &&
              {
                'pending',
                'unknown',
                'failed',
                'completed',
                'voided',
              }.contains(leg['status']) &&
              maybeText(leg['reference']) &&
              maybeText(leg['note']) &&
              (leg['completedAt'] == null || number(leg['completedAt'])),
        );
  }

  static bool _validApproval(Map<String, dynamic> value) {
    bool recordId(Object? id) => id is String && idPattern.hasMatch(id);
    bool integer(Object? number, int min, int max) =>
        number is int && number >= min && number <= max;
    return recordId(value['id']) &&
        recordId(value['orderId']) &&
        recordId(value['requesterId']) &&
        integer(value['orderNo'], 1, maxSafeInt) &&
        integer(value['orderVersion'], 1, 1000000000) &&
        integer(value['subtotalCentavos'], 1, moneyCeiling) &&
        integer(
          value['amountCentavos'],
          1,
          (value['subtotalCentavos'] as int? ?? 1) -
              (value['action'] == 'discount' ? 1 : 0),
        ) &&
        {'discount', 'cancel'}.contains(value['action']) &&
        (value['action'] != 'cancel' ||
            (value['requestedKitchenState'] is String &&
                value['requestedPaymentState'] is String &&
                integer(value['collectedCentavos'], 0, maxSafeInt) &&
                integer(value['pendingCentavos'], 0, maxSafeInt) &&
                {
                  null,
                  'awaiting_disposition',
                  'resolved',
                }.contains(value['cancellationStatus']))) &&
        {'pending', 'approved', 'denied', 'stale'}.contains(value['status']) &&
        value['requesterName'] is String &&
        (value['requesterName'] as String).trim().isNotEmpty &&
        value['reason'] is String &&
        (value['reason'] as String).trim().isNotEmpty &&
        (value['reason'] as String).length <= 300 &&
        integer(value['requestedAt'], 0, maxSafeInt) &&
        (value['decidedAt'] == null ||
            integer(value['decidedAt'], 0, maxSafeInt)) &&
        (value['decisionReason'] == null ||
            (value['decisionReason'] is String &&
                (value['decisionReason'] as String).length <= 300));
  }

  Future<List<Map<String, dynamic>>> orders({String? status}) async {
    if (status != null && !{'active', 'ready', 'all'}.contains(status)) {
      throw ArgumentError('Unsupported order status.');
    }
    final orders = await _list(
      '/api/v1/orders',
      'orders',
      query: status == null ? null : {'status': status},
    );
    if (!orders.every(
      (order) =>
          _validAmendmentOnOrder(order) &&
          validOrderStockShortages(order) &&
          validUnavailableLines(order),
    )) {
      throw const HubException('invalid_response');
    }
    return orders;
  }

  Future<Map<String, dynamic>> order(String orderId) async {
    final order = _object(
      (await _request('GET', '/api/v1/orders/${_id(orderId)}'))['order'],
    );
    if (!_validAmendmentOnOrder(order) ||
        !validOrderStockShortages(order) ||
        !validUnavailableLines(order)) {
      throw const HubException('invalid_response');
    }
    return order;
  }

  bool _validAmendmentOnOrder(Map<String, dynamic> order) {
    final amendment = order['amendment'];
    return amendment == null ||
        amendment is Map<String, dynamic> &&
            validOrderAmendment(
              amendment,
              barista: _session?.actor.role == HubRole.barista,
            ) &&
            amendment['orderId'] == order['id'] &&
            amendment['orderNo'] == order['orderNo'] &&
            order['version'] is int &&
            (amendment['orderVersion'] as int) <= (order['version'] as int);
  }

  bool _matchesAmendmentRequest(
    Map<String, dynamic> amendment,
    int expectedVersion,
    Map<String, dynamic> payload,
  ) {
    final operation = payload['operation'];
    if (amendment['orderVersion'] != expectedVersion ||
        amendment['operation'] != operation ||
        amendment['reason'] != (payload['reason'] as String?)?.trim()) {
      return false;
    }
    final before = amendment['before'] as Map<String, dynamic>?;
    final after = amendment['after'] as Map<String, dynamic>?;
    final needsReview = amendmentNeedsManagerReview(
      operation as String?,
      before?['quantity'] as int?,
      after?['quantity'] as int?,
    );
    if (amendment['status'] !=
        (needsReview ? 'awaiting_approval' : 'awaiting_station')) {
      return false;
    }
    if (operation != 'add' && before?['lineNo'] != payload['lineNo']) {
      return false;
    }
    return switch (operation) {
      'add' || 'replace' =>
        after?['productId'] == payload['productId'] &&
            after?['quantity'] == payload['quantity'] &&
            after?['note'] == (payload['note'] as String?)?.trim(),
      'quantity' =>
        after?['quantity'] == payload['quantity'] &&
            after?['lineNo'] == before?['lineNo'],
      'note' =>
        after?['note'] == (payload['note'] as String?)?.trim() &&
            after?['lineNo'] == before?['lineNo'],
      'remove' => after == null,
      _ => false,
    };
  }

  bool _matchesAmendmentAcknowledgment(
    Map<String, dynamic> amendment,
    String amendmentId,
    int expectedVersion,
    Map<String, dynamic> payload,
  ) {
    final dispositionNote = (payload['note'] as String?)?.trim() ?? '';
    return amendment['id'] == amendmentId &&
        amendment['status'] == 'resolved' &&
        (amendment['orderVersion'] as int) < expectedVersion &&
        (amendment['dispositionNote'] ?? '') == dispositionNote;
  }

  Future<Map<String, dynamic>?> currentShift() async {
    final response = await _request('GET', '/api/v1/shifts/current');
    if (!response.containsKey('shift')) {
      throw const HubException('invalid_response');
    }
    return response['shift'] == null ? null : _object(response['shift']);
  }

  static _Tender? _parseTender(Object? value) {
    if (!exactMap(value, {
      'id',
      'method',
      'amountCentavos',
      'status',
      'reference',
      'cashReceivedCentavos',
      'changeCentavos',
    })) {
      return null;
    }
    final map = value as Map<String, dynamic>;
    final id = map['id'];
    final method = map['method'];
    final amount = map['amountCentavos'];
    final status = map['status'];
    final reference = map['reference'];
    final received = map['cashReceivedCentavos'];
    final change = map['changeCentavos'];
    if (id is! String ||
        !idPattern.hasMatch(id) ||
        method is! String ||
        !const {'cash', 'gcash', 'card'}.contains(method) ||
        amount is! int ||
        amount <= 0 ||
        amount > moneyCeiling ||
        status is! String ||
        !const {'confirmed', 'pending', 'rejected'}.contains(status)) {
      return null;
    }
    if (method == 'cash') {
      if (status != 'confirmed' ||
          reference != null ||
          received is! int ||
          received < amount ||
          received > moneyCeiling ||
          change is! int ||
          change != received - amount) {
        return null;
      }
      return (
        id: id,
        method: method,
        amount: amount,
        status: status,
        reference: null,
        received: received,
        change: change,
      );
    }
    if (reference is! String ||
        reference.isEmpty ||
        reference.length > 120 ||
        _referenceEdges.hasMatch(reference) ||
        received != null ||
        change != null) {
      return null;
    }
    return (
      id: id,
      method: method,
      amount: amount,
      status: status,
      reference: reference,
      received: null,
      change: null,
    );
  }

  static bool _matchesPaymentAcknowledgment(
    Map<String, dynamic> result,
    List<String> parts,
    String commandId,
    int? expectedVersion,
    Map<String, dynamic> request,
  ) {
    final order = result['order'];
    final payment = _parseTender(result['payment']);
    if (!exactMap(result, {'commandId', 'order', 'payment'}) ||
        result['commandId'] != commandId ||
        payment == null ||
        order is! Map<String, dynamic> ||
        order['id'] != parts[4] ||
        expectedVersion == null ||
        order['version'] is! int ||
        order['version'] != expectedVersion + 1) {
      return false;
    }
    final orderNo = order['orderNo'];
    final payments = order['payments'];
    final total = order['totalCentavos'];
    final paid = order['paidCentavos'];
    final cancelled = order['cancelled'];
    final released = order['released'];
    final dineIn = order['dineIn'];
    if (orderNo is! int ||
        orderNo <= 0 ||
        orderNo > maxSafeInt ||
        payments is! List ||
        total is! int ||
        total <= 0 ||
        total > moneyCeiling ||
        paid is! int ||
        paid < 0 ||
        paid > maxSafeInt ||
        cancelled is! bool ||
        released is! bool ||
        dineIn is! bool) {
      return false;
    }

    var confirmed = 0;
    var pending = false;
    var matched = false;
    final ids = <String>{};
    for (final entry in payments) {
      final tender = _parseTender(entry);
      if (tender == null || !ids.add(tender.id)) return false;
      if (tender.status == 'confirmed') confirmed += tender.amount;
      if (confirmed > maxSafeInt) return false;
      if (tender.status == 'pending') pending = true;
      if (tender == payment) matched = true;
    }
    final paymentState = confirmed >= total
        ? 'paid'
        : pending
        ? 'pending_verification'
        : confirmed > 0
        ? 'partially_paid'
        : 'unpaid';
    if (!matched ||
        confirmed != paid ||
        order['hasPendingPayments'] != pending ||
        order['paymentState'] != paymentState ||
        (!cancelled &&
            (paid > total ||
                (paid == total &&
                    !released &&
                    !(validUnavailableLines(order) &&
                        order['unavailableLines'] is List &&
                        (order['unavailableLines'] as List).isNotEmpty)) ||
                (!dineIn && paid < total && released)))) {
      return false;
    }

    if (parts.length == 8) {
      return payment.id == parts[6] &&
          payment.method != 'cash' &&
          payment.status == (parts[7] == 'verify' ? 'confirmed' : 'rejected');
    }
    final verified = request['verified'];
    if (cancelled ||
        payment.method != request['method'] ||
        request['amountCentavos'] is! int ||
        payment.amount != request['amountCentavos'] ||
        verified is! bool) {
      return false;
    }
    if (payment.method == 'cash') {
      return verified &&
          request['cashReceivedCentavos'] is int &&
          payment.received == request['cashReceivedCentavos'];
    }
    final reference = request['reference'];
    return reference is String &&
        payment.reference == reference.replaceAll(_referenceEdges, '') &&
        payment.status == (verified ? 'confirmed' : 'pending');
  }

  Future<Map<String, dynamic>> mutate(
    String path, {
    required String commandId,
    int? expectedVersion,
    Map<String, dynamic> payload = const {},
  }) async {
    if (!isHubMutationPath(path)) {
      throw ArgumentError('Unsupported hub mutation route.');
    }
    if (!uuidPattern.hasMatch(commandId)) {
      throw ArgumentError('A stable UUID command ID is required.');
    }
    if (expectedVersion != null &&
        (expectedVersion < 1 || expectedVersion > 1000000000)) {
      throw ArgumentError('Invalid expected version.');
    }
    if (payload.containsKey('commandId') ||
        payload.containsKey('expectedVersion')) {
      throw ArgumentError('Command identity must use its named arguments.');
    }
    final request = {
      'commandId': commandId,
      if (expectedVersion != null) 'expectedVersion': expectedVersion,
      ...payload,
    };
    final result = await _request('POST', path, payload: request);
    if (result['order'] case final Map<String, dynamic> order) {
      if (!validOrderStockShortages(order) || !validUnavailableLines(order)) {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
    }
    final pathParts = path.split('/');
    if (path.endsWith('/replace-unavailable')) {
      final order = result['order'];
      final lines = order is Map<String, dynamic> ? order['lines'] : null;
      if (result['commandId'] != commandId ||
           order is! Map<String, dynamic> ||
          order['id'] != pathParts[4] ||
          expectedVersion == null ||
          order['version'] != expectedVersion + 1 ||
          !validUnavailableLines(order) ||
          lines is! List ||
          lines.any(
            (line) => line is Map && line['lineNo'] == payload['lineNo'],
          ) ||
          !lines.any(
            (line) => line is Map && line['productId'] == payload['productId'],
          )) {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
    }
    if (pathParts.length >= 6 &&
        pathParts[3] == 'orders' &&
        pathParts[5] == 'payments' &&
        !_matchesPaymentAcknowledgment(
          result,
          pathParts,
          commandId,
          expectedVersion,
          request,
        )) {
      throw const HubException('invalid_response', outcomeUnknown: true);
    }
    if (path.endsWith('/amendments') || path.endsWith('/acknowledge')) {
      final parts = path.split('/');
      final amendment = result['amendment'];
      final acknowledging = path.endsWith('/acknowledge');
      if (result['commandId'] != commandId ||
          amendment is! Map<String, dynamic> ||
          !validOrderAmendment(amendment, barista: acknowledging) ||
          amendment['orderId'] != parts[4] ||
          expectedVersion == null ||
          (acknowledging
              ? !_matchesAmendmentAcknowledgment(
                  amendment,
                  parts[6],
                  expectedVersion,
                  payload,
                )
              : !_matchesAmendmentRequest(
                  amendment,
                  expectedVersion,
                  payload,
                ))) {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
    }
    if (path.endsWith('/approvals')) {
      final approval = result['approval'];
      if (result['commandId'] != commandId ||
          approval is! Map<String, dynamic> ||
          !_validApproval(approval) ||
          approval['orderId'] != path.split('/')[4] ||
          approval['orderVersion'] != expectedVersion ||
          approval['action'] != payload['action'] ||
          (payload['action'] == 'discount' &&
              approval['amountCentavos'] != payload['amountCentavos']) ||
          approval['reason'] != (payload['reason'] as String?)?.trim() ||
          approval['status'] != 'pending') {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
    }
    if (path.endsWith('/prepare') ||
        path.endsWith('/cancellation/disposition')) {
      final order = result['order'];
      if (result['commandId'] != commandId ||
          order is! Map<String, dynamic> ||
          order['id'] != path.split('/')[4] ||
          order['version'] is! int ||
          (path.endsWith('/prepare') &&
              (order['preparing'] != true || order['cancelled'] == true))) {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
      if (path.endsWith('/cancellation/disposition')) {
        final cancellation = order['cancellation'];
        if (order['cancelled'] != true ||
            cancellation is! Map<String, dynamic> ||
            cancellation['status'] != 'resolved' ||
            cancellation['outcome'] != payload['outcome'] ||
            cancellation['dispositionNote'] !=
                (payload['note'] as String?)?.trim()) {
          throw const HubException('invalid_response', outcomeUnknown: true);
        }
      }
    }
    if (path.endsWith('/refunds') || path.startsWith('/api/v1/refunds/')) {
      final refund = result['refund'];
      final parts = path.split('/');
      if (result['commandId'] != commandId ||
          refund is! Map<String, dynamic> ||
          !_validRefund(refund)) {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
      if (path.endsWith('/refunds')) {
        final lineNumbers = (payload['lineNumbers'] as List).toSet();
        final actualLines = (refund['lines'] as List)
            .map((line) => line['lineNo'])
            .toSet();
        if (refund['orderId'] != parts[4] ||
            refund['requesterId'] != _session?.actor.id ||
            refund['orderVersion'] != expectedVersion ||
            refund['amountCentavos'] != payload['amountCentavos'] ||
            refund['reason'] != (payload['reason'] as String?)?.trim() ||
            refund['status'] != 'pending' ||
            actualLines.length != lineNumbers.length ||
            !actualLines.containsAll(lineNumbers)) {
          throw const HubException('invalid_response', outcomeUnknown: true);
        }
      } else {
        final matchedLeg = (refund['legs'] as List).any(
          (leg) =>
              leg['id'] == parts[6] &&
              leg['method'] == 'cash' &&
              leg['status'] == 'completed' &&
              leg['completedAt'] is int &&
              leg['version'] == (expectedVersion ?? 0) + 1,
        );
        if (refund['id'] != parts[4] ||
            refund['status'] != 'approved' ||
            !matchedLeg) {
          throw const HubException('invalid_response', outcomeUnknown: true);
        }
      }
    }
    return result;
  }

  Future<Map<String, dynamic>> createOrder({
    required String commandId,
    required bool dineIn,
    String table = '',
    String? customerId,
    required List<Map<String, dynamic>> items,
  }) => mutate(
    '/api/v1/orders',
    commandId: commandId,
    payload: {
      'dineIn': dineIn,
      'table': table,
      if (customerId != null) 'customerId': customerId,
      'items': items,
    },
  );
  Future<Map<String, dynamic>> createCustomer({
    required String commandId,
    required String displayName,
    String? phone,
    String? email,
    String note = '',
  }) => mutate(
    '/api/v1/customers',
    commandId: commandId,
    payload: {
      'displayName': displayName,
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
      'note': note,
    },
  );
  Future<Map<String, dynamic>> setOrderCustomer({
    required String orderId,
    required String commandId,
    required int expectedVersion,
    required String? customerId,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/customer',
    commandId: commandId,
    expectedVersion: expectedVersion,
    payload: {'customerId': customerId},
  );
  Future<Map<String, dynamic>> requestLoyaltyRedemption({
    required String orderId,
    required String commandId,
    required int expectedVersion,
    required int points,
    required String reason,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/loyalty/redeem-request',
    commandId: commandId,
    expectedVersion: expectedVersion,
    payload: {'points': points, 'reason': reason},
  );
  Future<Map<String, dynamic>> validateLoyaltyRedemptionCloud({
    required String redemptionId,
    required String commandId,
    String? outcome,
  }) => mutate(
    '/api/v1/loyalty/redemptions/${_id(redemptionId)}/validate-cloud',
    commandId: commandId,
    payload: {if (outcome != null) 'outcome': outcome},
  );
  Future<Map<String, dynamic>> syncLoyalty({required String commandId}) =>
      mutate('/api/v1/loyalty/sync', commandId: commandId);
  Future<Map<String, dynamic>> openShift({
    required String commandId,
    required int openingCashCentavos,
  }) => mutate(
    '/api/v1/shifts/open',
    commandId: commandId,
    payload: {'openingCashCentavos': openingCashCentavos},
  );
  Future<Map<String, dynamic>> submitCount({
    required String shiftId,
    required String commandId,
    required int expectedVersion,
    required int countedCashCentavos,
    String note = '',
  }) => mutate(
    '/api/v1/shifts/${_id(shiftId)}/submit-count',
    commandId: commandId,
    expectedVersion: expectedVersion,
    payload: {'countedCashCentavos': countedCashCentavos, 'note': note},
  );
  Future<Map<String, dynamic>> sendOrder({
    required String orderId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/send',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> addPayment({
    required String orderId,
    required String commandId,
    required int expectedVersion,
    required String method,
    required int amountCentavos,
    required bool verified,
    String? reference,
    int? cashReceivedCentavos,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/payments',
    commandId: commandId,
    expectedVersion: expectedVersion,
    payload: {
      'method': method,
      'amountCentavos': amountCentavos,
      'verified': verified,
      if (reference != null) 'reference': reference,
      if (cashReceivedCentavos != null)
        'cashReceivedCentavos': cashReceivedCentavos,
    },
  );
  Future<Map<String, dynamic>> verifyPayment({
    required String orderId,
    required String paymentId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/payments/${_id(paymentId)}/verify',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> rejectPayment({
    required String orderId,
    required String paymentId,
    required String commandId,
    required int expectedVersion,
    required String reason,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/payments/${_id(paymentId)}/reject',
    commandId: commandId,
    expectedVersion: expectedVersion,
    payload: {'reason': reason},
  );
  Future<Map<String, dynamic>> markReady({
    required String orderId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/ready',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> handoverOrder({
    required String orderId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/handover',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> recallOrder({
    required String orderId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/recall',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> requestReceipt({
    required String orderId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/receipt',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> requestLabel({
    required String orderId,
    required String commandId,
    required int expectedVersion,
  }) => mutate(
    '/api/v1/orders/${_id(orderId)}/label',
    commandId: commandId,
    expectedVersion: expectedVersion,
  );
  Future<Map<String, dynamic>> retryPrintJob({
    required String jobId,
    required String commandId,
    String action = 'retry',
    String note = '',
  }) => mutate(
    '/api/v1/print-jobs/${_id(jobId)}/retry',
    commandId: commandId,
    payload: {'action': action, if (note.isNotEmpty) 'note': note},
  );
  Future<Map<String, dynamic>> logWaste({
    required String commandId,
    required String ingredientId,
    required int quantityMilli,
    required String reason,
    String note = '',
  }) => mutate(
    '/api/v1/waste',
    commandId: commandId,
    payload: {
      'ingredientId': ingredientId,
      'quantityMilli': quantityMilli,
      'reason': reason,
      'note': note,
    },
  );
  Future<Map<String, dynamic>> correctWaste({
    required String wasteId,
    required String commandId,
    required int correctedQuantityMilli,
    required String reason,
  }) => mutate(
    '/api/v1/waste/${_id(wasteId)}/correct',
    commandId: commandId,
    payload: {
      'correctedQuantityMilli': correctedQuantityMilli,
      'reason': reason,
    },
  );

  Future<List<Map<String, dynamic>>> _list(
    String path,
    String key, {
    Map<String, String>? query,
  }) async {
    final response = await _request('GET', path, query: query);
    final values = response[key];
    if (values is! List) throw const HubException('invalid_response');
    return List.unmodifiable(values.map(_object));
  }

  static String _id(String value) {
    if (!idPattern.hasMatch(value)) {
      throw ArgumentError('Invalid hub record identifier.');
    }
    return value;
  }

  static Map<String, dynamic> _object(Object? value) {
    if (value is! Map<String, dynamic>) {
      throw const HubException('invalid_response');
    }
    return Map.unmodifiable(value);
  }

  static HubSession _parseSession(Map<String, dynamic> value) {
    if (!exactMap(value, {'token', 'expiresAt', 'actor'})) {
      throw const HubException('invalid_response');
    }
    final token = value['token'];
    final expiry = value['expiresAt'];
    final actor = _object(value['actor']);
    if (token is! String ||
        !_tokenPattern.hasMatch(token) ||
        expiry is! int ||
        expiry <= 0 ||
        expiry > maxSafeInt ||
        !exactMap(actor, {'id', 'displayName', 'role', 'branchId'})) {
      throw const HubException('invalid_response');
    }
    final id = actor['id'];
    final branchId = actor['branchId'];
    final displayName = actor['displayName'];
    final matchingRole = HubRole.values.where(
      (role) => role.name == actor['role'],
    );
    if (id is! String ||
        !idPattern.hasMatch(id) ||
        branchId is! String ||
        !idPattern.hasMatch(branchId) ||
        displayName is! String ||
        displayName.trim().isEmpty ||
        displayName.length > 100 ||
        matchingRole.length != 1) {
      throw const HubException('invalid_response');
    }
    return HubSession._(
      HubActor(
        id: id,
        displayName: displayName,
        branchId: branchId,
        role: matchingRole.single,
      ),
      expiry,
      token,
    );
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? payload,
    Map<String, String>? query,
    bool authenticated = true,
  }) async {
    if (_closed) throw const HubException('client_closed');
    final sessionAtStart = _session;
    final authGenerationAtStart = _authGeneration;
    if (authenticated && sessionAtStart == null) {
      throw const HubException('unauthorized', status: 401);
    }
    final uri = baseUri.resolve(path).replace(queryParameters: query);
    final request = http.Request(method, uri)
      ..followRedirects = false
      ..maxRedirects = 0;
    request.headers['accept'] = 'application/json';
    if (authenticated) {
      request.headers['authorization'] = 'Bearer ${sessionAtStart!._token}';
    }
    if (payload != null) {
      request.headers['content-type'] = 'application/json';
      try {
        request.body = jsonEncode(payload);
      } on JsonUnsupportedObjectError {
        throw ArgumentError('The hub request must contain JSON data.');
      }
      if (utf8.encode(request.body).length > 32 * 1024) {
        throw ArgumentError('The hub request is too large.');
      }
    }
    final mutation = method != 'GET';
    void requireCurrentSession() {
      if (authenticated &&
          (_closed ||
              authGenerationAtStart != _authGeneration ||
              !identical(_session, sessionAtStart))) {
        throw HubException('session_changed', outcomeUnknown: mutation);
      }
    }

    try {
      return await (() async {
        final response = await _client.send(request);
        if (response.statusCode == 401 && identical(_session, sessionAtStart)) {
          clearSession();
        }
        if (response.statusCode >= 300 && response.statusCode < 400) {
          throw HubException(
            'redirect_blocked',
            status: response.statusCode,
            outcomeUnknown: mutation,
          );
        }
        final success = response.statusCode >= 200 && response.statusCode < 300;
        if (success) {
          requireCurrentSession();
        }
        final builder = BytesBuilder(copy: false);
        await for (final part in response.stream) {
          if (builder.length + part.length > _maxResponseBytes) {
            throw HubException(
              'invalid_response',
              status: response.statusCode,
              outcomeUnknown: mutation,
            );
          }
          builder.add(part);
        }
        if (success) {
          requireCurrentSession();
        }
        if (response.statusCode == 204) return <String, dynamic>{};
        Map<String, dynamic>? body;
        try {
          final decoded = jsonDecode(utf8.decode(builder.takeBytes()));
          if (decoded is Map<String, dynamic>) body = decoded;
        } on FormatException {
          /* Converted to a safe response below. */
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          final error = body?['error'];
          final remoteCode = error is Map ? error['code'] : null;
          final code = remoteCode is String && _safeCodes.contains(remoteCode)
              ? remoteCode
              : 'request_failed';
          final remoteId = body?['requestId'];
          throw HubException(
            code,
            status: response.statusCode,
            requestId: remoteId is String && uuidPattern.hasMatch(remoteId)
                ? remoteId
                : null,
            outcomeUnknown: mutation && response.statusCode >= 500,
          );
        }
        if (body == null) {
          throw HubException(
            'invalid_response',
            status: response.statusCode,
            outcomeUnknown: mutation,
          );
        }
        return body;
      })().timeout(timeout);
    } on TimeoutException {
      throw HubException('timeout', outcomeUnknown: mutation);
    } on http.ClientException {
      throw HubException('connection_failed', outcomeUnknown: mutation);
    }
  }
}
