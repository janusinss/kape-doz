import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import '../data/hub_client.dart';
import '../data/hub_primitives.dart';
import '../data/staff_recovery.dart';
import '../data/stock_shortage.dart';
import '../data/product_availability.dart';

import 'staff_access_screen.dart';

part 'staff_amendments.dart';

/// Completes only after the route's exit transition has released its widgets.
/// Controller owners can then dispose without an exiting TextField rebuilding.
Future<T?> _showOwnedDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool barrierDismissible = true,
}) async {
  final navigator = Navigator.of(context, rootNavigator: true);
  final route = DialogRoute<T>(
    context: context,
    builder: builder,
    barrierDismissible: barrierDismissible,
  );
  final result = await navigator.push<T>(route);
  await route.completed;
  return result;
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

String _money(Object? amount) => formatCentavos(amount);
int? _decimal(String text, int places) => parseDecimalFixed(text, places);

class _RecipeDispositionFields {
  final List<Map<dynamic, dynamic>> recipe;
  final List<TextEditingController> controllers;
  final String verb;
  final String unitWord;

  _RecipeDispositionFields(
    List<dynamic> rawRecipe, {
    required this.verb,
    this.unitWord = 'amount',
  }) : recipe = rawRecipe.cast<Map<dynamic, dynamic>>(),
       controllers = [for (final _ in rawRecipe) TextEditingController()];

  bool get isNotEmpty => recipe.isNotEmpty;

  List<Widget> buildInputs({required bool enabled, double topPadding = 12}) => [
    for (var i = 0; i < recipe.length; i++)
      Padding(
        padding: EdgeInsets.only(top: topPadding),
        child: TextField(
          controller: controllers[i],
          enabled: enabled,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: '${recipe[i]['name']} $verb (${recipe[i]['unit']})',
          ),
        ),
      ),
  ];

  ({List<Map<String, dynamic>>? used, String? error}) parse() {
    final used = <Map<String, dynamic>>[];
    for (var i = 0; i < recipe.length; i++) {
      final input = controllers[i].text.trim();
      if (input.isEmpty) continue;
      final quantity = parseDecimalFixed(input, 3, max: 1000000000);
      if (quantity == null || quantity <= 0) {
        return (
          used: null,
          error:
              'Enter a positive $unitWord with up to 3 decimal places for ${recipe[i]['name']}.',
        );
      }
      used.add({
        'ingredientId': recipe[i]['ingredientId'],
        'quantityMilli': quantity,
      });
    }
    return (used: used, error: null);
  }

  void dispose() {
    for (final controller in controllers) {
      controller.dispose();
    }
  }
}

class _CartLine {
  final Map<String, dynamic> product;
  final int quantity;
  final String note;
  final String? sizeId;
  final String? substitutionId;
  final Map<String, int> addons;
  _CartLine(
    this.product,
    this.quantity,
    this.note, {
    this.sizeId,
    this.substitutionId,
    this.addons = const {},
  });

  Map<String, dynamic> resolvedProduct({required bool dineIn}) =>
      resolveCartLineProduct(
        product,
        dineIn: dineIn,
        sizeId: sizeId,
        substitutionId: substitutionId,
        addons: addons,
      );

  int get unitPriceCentavos =>
      resolvedProduct(dineIn: true)['priceCentavos'] as int;
}

class _StockShortageWarning extends StatelessWidget {
  final List<StockShortage> shortages;
  const _StockShortageWarning(this.shortages);

  @override
  Widget build(BuildContext context) => shortages.isEmpty
      ? const SizedBox.shrink()
      : Semantics(
          container: true,
          liveRegion: true,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Recorded stock is short',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                for (final item in shortages)
                  Text('${item.name}: short ${item.shortfallLabel}'),
                const SizedBox(height: 4),
                const Text('You can continue. Ask a manager to review stock.'),
              ],
            ),
          ),
        );
}

/// Staff UI backed only by the authenticated branch hub. No sample business data.
class ConnectedStaffApp extends StatelessWidget {
  final HubClient client;
  final String deviceId, deviceSecret;
  final String? authorityId;
  final StaffRecoveryStore? recoveryStore;
  final HubClient Function(Uri)? clientFactory;
  final void Function(HubClient)? onClientChanged;
  final void Function(StaffEnrollment)? onDeviceEnrolled;
  final VoidCallback? onUnpaired;
  final Future<void> Function(HubActor)? onAuthenticated;
  final bool pairingOnlyLogin;
  const ConnectedStaffApp({
    super.key,
    required this.client,
    required this.deviceId,
    required this.deviceSecret,
    this.authorityId,
    this.recoveryStore,
    this.clientFactory,
    this.onClientChanged,
    this.onDeviceEnrolled,
    this.onUnpaired,
    this.onAuthenticated,
    this.pairingOnlyLogin = false,
  });

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'KAPE DOZ',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: const ColorScheme.light(
        primary: Color(0xff303030),
        onPrimary: Colors.white,
        primaryContainer: Color(0xffe4e4e4),
        onPrimaryContainer: Color(0xff222222),
        secondary: Color(0xff555555),
        onSecondary: Colors.white,
        secondaryContainer: Color(0xffe4e4e4),
        onSecondaryContainer: Color(0xff222222),
        surface: Colors.white,
        onSurface: Color(0xff222222),
        outline: Color(0xffbdbdbd),
        surfaceTint: Colors.transparent,
        error: Color(0xff8b2020),
      ),
      scaffoldBackgroundColor: const Color(0xfff2f2f2),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        ),
      ),
    ),
    home: _StaffHome(
      client: client,
      deviceId: deviceId,
      deviceSecret: deviceSecret,
      authorityId: authorityId,
      recoveryStore: recoveryStore,
      clientFactory: clientFactory,
      onClientChanged: onClientChanged,
      onDeviceEnrolled: onDeviceEnrolled,
      onUnpaired: onUnpaired,
      onAuthenticated: onAuthenticated,
      pairingOnlyLogin: pairingOnlyLogin,
    ),
  );
}

class _StaffHome extends StatefulWidget {
  final HubClient client;
  final String deviceId, deviceSecret;
  final String? authorityId;
  final StaffRecoveryStore? recoveryStore;
  final HubClient Function(Uri)? clientFactory;
  final void Function(HubClient)? onClientChanged;
  final void Function(StaffEnrollment)? onDeviceEnrolled;
  final VoidCallback? onUnpaired;
  final Future<void> Function(HubActor)? onAuthenticated;
  final bool pairingOnlyLogin;
  const _StaffHome({
    required this.client,
    required this.deviceId,
    required this.deviceSecret,
    this.authorityId,
    this.recoveryStore,
    this.clientFactory,
    this.onClientChanged,
    this.onDeviceEnrolled,
    this.onUnpaired,
    this.onAuthenticated,
    this.pairingOnlyLogin = false,
  });
  @override
  State<_StaffHome> createState() => _StaffHomeState();
}

class _StaffHomeState extends State<_StaffHome> with WidgetsBindingObserver {
  final _account = TextEditingController();
  final _pin = TextEditingController();
  final _quickPairCode = TextEditingController();
  final _table = TextEditingController();
  final _search = TextEditingController();
  HubActor? _actor;
  List<Map<String, dynamic>> _products = [], _ingredients = [], _orders = [];
  List<Map<String, dynamic>> _approvals = [];
  List<Map<String, dynamic>> _refunds = [];
  final List<_CartLine> _cart = [];
  Map<String, dynamic>? _shift, _selected;
  bool _busy = false, _refreshing = false, _dineIn = true, _history = false;
  bool _quietRefresh = false;
  int _page = 0, _generation = 0;
  String? _error, _notice;
  PendingStaffCommand? _pending;
  late final StaffRecoveryStore _recoveryStore;
  bool _pendingLoaded = false;
  String? _recoveryError;
  Timer? _expiryTimer;
  Timer? _stationRefreshTimer;
  bool get _locked =>
      _busy ||
      _refreshing ||
      !_pendingLoaded ||
      _recoveryError != null ||
      _pending != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _recoveryStore =
        widget.recoveryStore ??
        StaffRecoveryStore(
          MemoryStaffRecoveryStorage(),
          allowInsecureLoopback: true,
        );
    _initHome();
    _stationRefreshTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _refreshStation(),
    );
  }

  Future<void> _initHome() async {
    final loaded = await _loadRecovery();
    if (!loaded || !mounted) return;
    final preSession = widget.client.session;
    if (preSession != null && _actor == null) {
      await widget.onAuthenticated?.call(preSession.actor);
      if (!mounted || !identical(widget.client.session, preSession)) return;
      setState(() {
        _actor = preSession.actor;
      });
      _scheduleExpiry();
      final refreshed = await _refresh();
      if (refreshed &&
          _pending != null &&
          _matchesPending(_pending!, preSession)) {
        await _reconcilePending(retryUnrecorded: false);
      }
    } else if (widget.pairingOnlyLogin && _actor == null) {
      unawaited(_autoConnectHotspotOnStartup());
    }
  }

  Future<void> _autoConnectHotspotOnStartup() async {
    try {
      await widget.client.hubInfo();
    } catch (_) {
      final discovered = await _findHotspotHubClient();
      if (discovered != null) {
        if (!mounted || _actor != null) {
          discovered.close();
          return;
        }
        widget.onClientChanged?.call(discovered);
      }
    }
  }

  Future<bool> _loadRecovery() async {
    try {
      final state = await _recoveryStore.load();
      if (!mounted) return false;
      setState(() {
        _pending = state.pending;
        _pendingLoaded = true;
        _recoveryError = null;
      });
      return true;
    } catch (error) {
      if (mounted) {
        setState(() {
          _pendingLoaded = true;
          _recoveryError = error is StaffRecoveryException
              ? error.message
              : storageUnavailableMessage;
        });
      }
      return false;
    }
  }

  bool _matchesPending(PendingStaffCommand command, HubSession? session) {
    return session != null &&
        identical(widget.client.session, session) &&
        identical(_actor, session.actor) &&
        command.matches(
          hubOrigin: widget.client.baseUri,
          deviceId: widget.deviceId,
          actor: session.actor,
        );
  }

  void _scheduleExpiry() {
    _expiryTimer?.cancel();
    final expiry = widget.client.session?.expiresAt;
    if (expiry == null) return;
    final remaining = expiry - DateTime.now().millisecondsSinceEpoch;
    if (remaining <= 0) {
      _lockSession('Your session expired. Sign in again to continue.');
      return;
    }
    _expiryTimer = Timer(
      Duration(milliseconds: min(remaining, 86400000)),
      _scheduleExpiry,
    );
  }

  void _lockSession(String message) {
    if (!mounted || _actor == null) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
    setState(() {
      _clear();
      _error = message;
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _scheduleExpiry();
      _refreshStation();
    }
  }

  void _refreshStation() {
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (!mounted ||
        _actor?.role != HubRole.barista ||
        _page != 0 ||
        _locked ||
        (lifecycle != null && lifecycle != AppLifecycleState.resumed) ||
        ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    unawaited(_refresh(quiet: true));
  }

  @override
  void dispose() {
    _generation++;
    _expiryTimer?.cancel();
    _stationRefreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    for (final controller in [
      _account,
      _pin,
      _quickPairCode,
      _table,
      _search,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _clearOrderDraft() {
    _cart.clear();
    _table.clear();
  }

  void _completePending(
    PendingStaffCommand action, {
    required String notice,
    bool rejected = false,
  }) {
    setState(() {
      _pending = null;
      if (!rejected && action.businessAction == 'order.create') {
        _clearOrderDraft();
      }
      _notice = notice;
    });
  }

  void _clear() {
    _generation++;
    _expiryTimer?.cancel();
    widget.client.clearSession();
    _actor = null;
    _products = [];
    _ingredients = [];
    _orders = [];
    _approvals = [];
    _refunds = [];
    _clearOrderDraft();
    _shift = null;
    _selected = null;
    _search.clear();
    _pin.clear();
    _page = 0;
    _history = false;
    _busy = false;
    _refreshing = false;
    _quietRefresh = false;
  }

  void _failure(Object error) {
    if (!mounted) return;
    final safe = error is HubException
        ? error.message
        : error is StaffRecoveryException
        ? error.message
        : 'The operation could not be completed. Refresh and try again.';
    if (error is HubException &&
        (error.status == 401 || error.code == 'session_changed')) {
      if (_actor != null) {
        _lockSession(safe);
        return;
      }
      widget.client.clearSession();
    }
    setState(() => _error = safe);
  }

  Future<void> _login() async {
    if (_busy || !_pendingLoaded || _recoveryError != null) return;
    if (_account.text.trim().isEmpty || _pin.text.isEmpty) {
      setState(() => _error = 'Enter your account ID and PIN.');
      return;
    }
    final generation = _generation;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final session = await widget.client.loginStaff(
        accountId: _account.text.trim(),
        pin: _pin.text,
        deviceId: widget.deviceId,
        deviceSecret: widget.deviceSecret,
      );
      if (!mounted) return;
      await _recoveryStore.saveValidatedEnrollment(
        StaffEnrollment(
          hubOrigin: widget.client.baseUri,
          deviceId: widget.deviceId,
          deviceSecret: widget.deviceSecret,
          authorityId: widget.authorityId,
        ),
      );
      if (!mounted || generation != _generation) return;
      if (!await _loadRecovery()) {
        widget.client.clearSession();
        return;
      }
      await widget.onAuthenticated?.call(session.actor);
      if (!mounted ||
          generation != _generation ||
          !identical(widget.client.session, session)) {
        return;
      }
      setState(() {
        _actor = session.actor;
        _pin.clear();
      });
      _scheduleExpiry();
      if (_actor == null) return;
      final refreshed = await _refresh();
      if (refreshed &&
          _pending != null &&
          _matchesPending(_pending!, session)) {
        await _reconcilePending(retryUnrecorded: false);
      }
    } catch (error) {
      if (mounted && generation == _generation) {
        if (_actor == null) widget.client.clearSession();
        _failure(error);
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  Future<void> _logout() async {
    if (_busy) return;
    final generation = _generation;
    setState(() => _busy = true);
    String? warning;
    try {
      await widget.client.logout();
    } on HubException catch (error) {
      warning =
          'Signed out on this device. ${error.message} Server sign-out could not be confirmed.';
    } catch (_) {
      warning =
          'Signed out on this device. Server sign-out could not be confirmed.';
    }
    if (mounted && generation == _generation) {
      setState(() {
        _clear();
        _error = warning;
        _notice = null;
      });
    }
  }

  Future<bool> _refresh({bool quiet = false}) async {
    final session = widget.client.session;
    if (session == null || _refreshing) return false;
    if (!identical(_actor, session.actor)) {
      _lockSession('The signed-in account changed. Sign in again to continue.');
      return false;
    }
    final generation = _generation;
    setState(() {
      _refreshing = true;
      _quietRefresh = quiet;
      if (!quiet) _error = null;
    });
    try {
      final cashier = session.actor.role == HubRole.cashier;
      final values = await Future.wait<Object?>([
        widget.client.ingredients(),
        widget.client.orders(
          status: cashier ? 'all' : (_history ? 'ready' : 'active'),
        ),
        if (cashier) widget.client.products(),
        if (cashier) widget.client.currentShift(),
        if (cashier) widget.client.approvals(),
        if (cashier) widget.client.refunds(),
      ]);
      if (!mounted || generation != _generation) return false;
      if (!identical(widget.client.session, session)) {
        _lockSession(
          'The signed-in session changed. Sign in again to continue.',
        );
        return false;
      }
      setState(() {
        _ingredients = values[0] as List<Map<String, dynamic>>;
        _orders = values[1] as List<Map<String, dynamic>>;
        if (cashier) {
          _products = values[2] as List<Map<String, dynamic>>;
          _shift = values[3] as Map<String, dynamic>?;
          _approvals = values[4] as List<Map<String, dynamic>>;
          _refunds = values[5] as List<Map<String, dynamic>>;
          final selection = _orders.where((o) => o['id'] == _selected?['id']);
          if (_selected != null) {
            _selected = selection.isEmpty ? null : selection.first;
          }
        }
      });
      return true;
    } catch (error) {
      if (mounted && generation == _generation) {
        if (identical(widget.client.session, session)) {
          _failure(error);
        } else {
          _lockSession(
            'The signed-in session changed. Sign in again to continue.',
          );
        }
      }
      return false;
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _refreshing = false;
          _quietRefresh = false;
        });
      }
    }
  }

  Future<Map<String, dynamic>?> _mutate(
    String label,
    String path, {
    Map<String, dynamic> payload = const {},
    int? expectedVersion,
    void Function(Map<String, dynamic>)? accepted,
  }) async {
    if (_locked || _actor == null) return null;
    final session = widget.client.session;
    if (session == null || !identical(_actor, session.actor)) return null;
    final actor = session.actor;
    final generation = _generation;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final action = PendingStaffCommand(
        commandId: _uuid(),
        label: label,
        path: path,
        payload: payload,
        expectedVersion: expectedVersion,
        hubOrigin: widget.client.baseUri,
        deviceId: widget.deviceId,
        actorId: actor.id,
        branchId: actor.branchId,
        role: actor.role,
        createdAt: DateTime.now().millisecondsSinceEpoch,
      );
      await _recoveryStore.savePending(action);
      if (!mounted || generation != _generation) return null;
      setState(() => _pending = action);
      if (!_matchesPending(action, session)) {
        _lockSession(
          'The signed-in account changed. Sign in again to continue.',
        );
        return null;
      }
      return await _sendPending(action, session, accepted: accepted);
    } on StaffRecoveryException catch (error) {
      if (mounted && generation == _generation) {
        await _loadRecovery();
        _failure(error);
      }
      return null;
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  Future<Map<String, dynamic>?> _sendPending(
    PendingStaffCommand action,
    HubSession session, {
    void Function(Map<String, dynamic>)? accepted,
  }) async {
    if (!_matchesPending(action, session)) return null;
    final generation = _generation;
    try {
      final result = await widget.client.mutate(
        action.path,
        commandId: action.commandId,
        expectedVersion: action.expectedVersion,
        payload: action.payload,
      );
      if (result['commandId'] != action.commandId) {
        throw const HubException('invalid_response', outcomeUnknown: true);
      }
      if (!mounted ||
          generation != _generation ||
          !identical(widget.client.session, session)) {
        return null;
      }
      await _recoveryStore.clearPending(action.commandId);
      if (!mounted ||
          generation != _generation ||
          !identical(widget.client.session, session)) {
        return null;
      }
      _completePending(action, notice: '${action.label} saved by the hub.');
      accepted?.call(result);
      await _refresh();
      return result;
    } catch (error) {
      if (!mounted || generation != _generation) return null;
      if (error is HubException &&
          !error.outcomeUnknown &&
          error.status != null &&
          error.status! >= 400 &&
          error.status! < 500 &&
          _matchesPending(action, session)) {
        await _reconcilePending(retryUnrecorded: false);
        if (mounted && error.code == 'product_unavailable') {
          setState(() => _error = error.message);
        }
        return null;
      }
      if (!identical(widget.client.session, session)) {
        _lockSession(
          'The signed-in session changed. Sign in again to continue.',
        );
      } else if (error is HubException && error.outcomeUnknown) {
        setState(() {
          _error =
              '${error.message} The outcome of ${action.label.toLowerCase()} is unknown.';
        });
      } else {
        _failure(error);
      }
      return null;
    }
  }

  Future<void> _reconcilePending({bool retryUnrecorded = true}) async {
    final action = _pending;
    final session = widget.client.session;
    if (action == null ||
        session == null ||
        !_matchesPending(action, session) ||
        _recoveryError != null) {
      return;
    }
    final generation = _generation;
    // Login owns the busy guard during its automatic status check.
    final wasBusy = _busy;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final status = await widget.client.commandStatus(action.commandId);
      if (!mounted ||
          generation != _generation ||
          !identical(widget.client.session, session)) {
        return;
      }
      if (status['status'] == 'accepted' || status['status'] == 'rejected') {
        if (status['action'] != action.businessAction) {
          throw const HubException('invalid_response');
        }
        final rejected = status['status'] == 'rejected';
        if (!await _refresh()) return;
        if (!mounted ||
            generation != _generation ||
            !_matchesPending(action, session)) {
          return;
        }
        await _recoveryStore.clearPending(action.commandId);
        if (!mounted ||
            generation != _generation ||
            !_matchesPending(action, session)) {
          return;
        }
        _completePending(
          action,
          rejected: rejected,
          notice: rejected
              ? 'Previous operation was not applied to the hub. Current records refreshed. Review before trying again.'
              : 'Previous operation confirmed by the hub. Current records refreshed.',
        );
      } else if (retryUnrecorded) {
        await _sendPending(action, session);
      } else {
        setState(
          () => _notice =
              'The previous operation is awaiting confirmation. Retry it using its saved command.',
        );
      }
    } catch (error) {
      if (mounted && generation == _generation) _failure(error);
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = wasBusy);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_actor == null) return _loginScreen();
    final cashier = _actor!.role == HubRole.cashier;
    final labels = cashier ? ['Cashier'] : ['Station', 'Waste'];
    final icons = cashier
        ? [Icons.point_of_sale]
        : [Icons.coffee, Icons.delete_outline];
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text(
              'KAPE DOZ',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(width: 12),
            Flexible(
              child: Text(labels[_page], style: const TextStyle(fontSize: 16)),
            ),
          ],
        ),
        actions: [
          if (wide) Center(child: Text(_actor!.displayName)),
          if (cashier)
            IconButton(
              tooltip: 'Customers & loyalty',
              onPressed: _locked ? null : _customersLoyaltyDialog,
              icon: const Icon(Icons.people_outline),
            ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _busy || _refreshing ? null : _refresh,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: _busy ? null : _logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      bottomNavigationBar: !wide && !cashier
          ? NavigationBar(
              selectedIndex: _page,
              onDestinationSelected: _locked
                  ? null
                  : (page) => setState(() => _page = page),
              destinations: [
                for (var i = 0; i < labels.length; i++)
                  NavigationDestination(icon: Icon(icons[i]), label: labels[i]),
              ],
            )
          : null,
      body: Column(
        children: [
          if (_busy || (_refreshing && !_quietRefresh))
            const LinearProgressIndicator(),
          if (_error != null ||
              _notice != null ||
              _pending != null ||
              _recoveryError != null)
            _status(),
          Expanded(
            child: Row(
              children: [
                if (wide && labels.length > 1)
                  NavigationRail(
                    selectedIndex: _page,
                    labelType: NavigationRailLabelType.all,
                    onDestinationSelected: _locked
                        ? null
                        : (page) => setState(() => _page = page),
                    destinations: [
                      for (var i = 0; i < labels.length; i++)
                        NavigationRailDestination(
                          icon: Icon(icons[i]),
                          label: Text(labels[i]),
                        ),
                    ],
                  ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: cashier
                        ? _cashier()
                        : (_page == 0 ? _station() : _waste()),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _status() => Container(
    width: double.infinity,
    color: const Color(0xffe6e6e6),
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_error ?? _notice ?? ''),
        if (_recoveryError != null) ...[
          Text(_recoveryError!),
          TextButton(
            onPressed: _busy ? null : _loadRecovery,
            child: const Text('Retry saved state'),
          ),
        ],
        if (_pending != null) ...[
          Text(
            _matchesPending(_pending!, widget.client.session)
                ? (_recoveryStore.durable
                      ? 'A saved operation needs confirmation before another change.'
                      : 'A pending operation needs confirmation. This preview keeps it for the current session.')
                : 'A saved operation belongs to another staff account. Sign out and use the original account to resolve it.',
            style: const TextStyle(fontSize: 12),
          ),
          if (_matchesPending(_pending!, widget.client.session))
            TextButton(
              onPressed: _busy || _refreshing || _recoveryError != null
                  ? null
                  : () => _reconcilePending(),
              child: const Text('Retry previous action'),
            ),
        ],
      ],
    ),
  );

  Future<void> _showSwitchHubDialog() async {
    if (_busy || _recoveryError != null) return;
    final urlController = TextEditingController(
      text: widget.client.baseUri.origin,
    );
    String? dialogError;
    bool probing = false;
    try {
      await _showOwnedDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: const Text('Switch or find hub address'),
            content: SizedBox(
              width: 380,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Enter the new hub address on your café network. The hub authority ID will be verified before updating.',
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: urlController,
                    enabled: !probing,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'New hub address',
                      hintText: 'http://192.168.1.50:8787',
                    ),
                  ),
                  if (dialogError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        dialogError!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: probing
                    ? null
                    : () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: probing
                    ? null
                    : () async {
                        final parsed = Uri.tryParse(urlController.text.trim());
                        if (parsed == null ||
                            validateHubOrigin(
                                  parsed,
                                  allowInsecureLoopback:
                                      _recoveryStore.allowInsecureLoopback,
                                  allowPrivateLanHttp:
                                      _recoveryStore.allowPrivateLanHttp,
                                ) ==
                                null) {
                          setDialogState(
                            () => dialogError = 'Enter a valid hub address.',
                          );
                          return;
                        }
                        setDialogState(() {
                          probing = true;
                          dialogError = null;
                        });
                        HubClient? candidate;
                        try {
                          candidate = widget.clientFactory != null
                              ? widget.clientFactory!(parsed)
                              : HubClient(
                                  baseUri: parsed,
                                  allowInsecureLoopback:
                                      _recoveryStore.allowInsecureLoopback,
                                  allowPrivateLanHttp:
                                      _recoveryStore.allowPrivateLanHttp,
                                );
                          final info = await candidate.hubInfo();
                          final remoteAuth = info['authorityId'] as String?;
                          final state = await _recoveryStore.relocateHubOrigin(
                            newHubOrigin: parsed,
                            verifiedAuthorityId: remoteAuth,
                          );
                          if (!mounted) {
                            candidate.close();
                            return;
                          }
                          final acceptedClient = candidate;
                          candidate = null;
                          setState(() {
                            _pending = state.pending;
                            _notice =
                                'Updated hub address to ${parsed.origin}.';
                            _error = null;
                          });
                          widget.onClientChanged?.call(acceptedClient);
                          if (dialogContext.mounted) {
                            Navigator.of(dialogContext).pop();
                          }
                        } catch (caught) {
                          candidate?.close();
                          setDialogState(() {
                            probing = false;
                            dialogError = caught is StaffRecoveryException
                                ? caught.message
                                : caught is HubException
                                ? caught.message
                                : 'Could not verify the hub at that address.';
                          });
                        }
                      },
                child: Text(probing ? 'Verifying…' : 'Verify & switch'),
              ),
            ],
          ),
        ),
      );
    } finally {
      urlController.dispose();
    }
  }

  List<String> _hotspotCandidates() => <String>[
    widget.client.baseUri.origin,
    'http://192.168.137.1:4000',
    'http://192.168.137.1:8787',
    'http://192.168.254.140:4000',
    'http://192.168.254.140:8787',
    'http://127.0.0.1:4000',
    'http://127.0.0.1:8787',
    'http://10.0.2.2:4000',
    'http://10.0.2.2:8787',
    'http://192.168.43.1:4000',
    'http://192.168.1.100:4000',
    'http://192.168.1.1:4000',
    'http://localhost:4000',
  ];

  Future<HubClient?> _findHotspotHubClient() async {
    final seen = <String>{};
    for (final raw in _hotspotCandidates()) {
      if (!seen.add(raw)) continue;
      final uri = Uri.tryParse(raw);
      if (uri == null) continue;
      HubClient? candidate;
      try {
        candidate = widget.clientFactory != null
            ? widget.clientFactory!(uri)
            : HubClient(
                baseUri: uri,
                allowInsecureLoopback: true,
                allowPrivateLanHttp: true,
              );
        await candidate.hubInfo();
        final found = candidate;
        candidate = null;
        return found;
      } catch (_) {
        // Try next hotspot/LAN candidate.
      } finally {
        candidate?.close();
      }
    }
    return null;
  }

  Future<void> _signInWithPairCode() async {
    if (_busy || !_pendingLoaded || _recoveryError != null) return;
    final raw = _quickPairCode.text.trim();
    if (raw.isEmpty) {
      setState(() => _error = 'Enter the 8-character pairing code.');
      return;
    }
    final generation = _generation;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      HubClient activeClient = widget.client;
      Map<String, dynamic> claimed;
      try {
        claimed = await activeClient.claimPairingCode(raw);
      } on HubException catch (err) {
        if (err.status != null) rethrow;
        final discovered = await _findHotspotHubClient();
        if (discovered == null) rethrow;
        if (!mounted || generation != _generation) {
          discovered.close();
          return;
        }
        activeClient = discovered;
        widget.onClientChanged?.call(activeClient);
        claimed = await activeClient.claimPairingCode(raw);
      }
      if (!mounted || generation != _generation) return;
      final claimedId = claimed['deviceId'] as String?;
      final claimedSecret = claimed['deviceSecret'] as String?;
      final claimedAuth =
          (claimed['authorityId'] as String?) ?? widget.authorityId;
      if (claimedId == null ||
          claimedSecret == null ||
          !validateDeviceCredentials(claimedId, claimedSecret)) {
        throw const HubException('invalid_response');
      }
      final enrollment = StaffEnrollment(
        hubOrigin: activeClient.baseUri,
        deviceId: claimedId,
        deviceSecret: claimedSecret,
        authorityId: claimedAuth != null && uuidPattern.hasMatch(claimedAuth)
            ? claimedAuth
            : null,
      );
      if (_pending == null) {
        await _recoveryStore.saveValidatedEnrollment(enrollment);
      }
      if (!mounted || generation != _generation) return;
      widget.onDeviceEnrolled?.call(enrollment);
      if (!identical(widget.client, activeClient)) {
        await WidgetsBinding.instance.endOfFrame;
        if (!mounted || generation != _generation) return;
      }
      final session = activeClient.session;
      if (session != null) {
        await widget.onAuthenticated?.call(session.actor);
        if (!mounted ||
            generation != _generation ||
            !identical(activeClient.session, session)) {
          return;
        }
        setState(() {
          _actor = session.actor;
          _quickPairCode.clear();
          _pin.clear();
        });
        _scheduleExpiry();
        final refreshed = await _refresh();
        if (refreshed &&
            _pending != null &&
            _matchesPending(_pending!, session)) {
          await _reconcilePending(retryUnrecorded: false);
        }
      } else {
        setState(() {
          _quickPairCode.clear();
          _notice =
              'Device paired as $claimedId. Ask your manager for a role-bound pairing code.';
        });
      }
    } catch (error) {
      if (mounted && generation == _generation) {
        if (_actor == null) widget.client.clearSession();
        _failure(error);
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  Future<void> _unpairDevice() async {
    if (_busy || !_pendingLoaded || _recoveryError != null) return;
    if (_pending != null) {
      setState(
        () => _error =
            'Resolve the saved operation before unpairing this device.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _recoveryStore.clearEnrollment();
      if (!mounted) return;
      widget.onUnpaired?.call();
    } on StaffRecoveryException catch (caught) {
      if (mounted) setState(() => _error = caught.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _loginScreen() {
    final signInDisabled = _busy || !_pendingLoaded || _recoveryError != null;
    return StaffAccessScreen(
      modernSignIn: true,
      title: 'Welcome back.',
      description: widget.pairingOnlyLogin
          ? 'Enter the 8-character pairing code from your manager or owner to sign in.'
          : 'Use your staff account and PIN on this device.',
      children: [
        if (!widget.pairingOnlyLogin) ...[
          _loginDevice(),
          const SizedBox(height: 16),
        ],
        if (!_pendingLoaded || _busy) ...[
          const LinearProgressIndicator(
            semanticsLabel: 'Checking staff access',
          ),
          const SizedBox(height: 12),
        ],
        if (!widget.pairingOnlyLogin && _pending != null)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              'Sign in with the original account to resolve a saved operation.',
            ),
          ),
        if (_recoveryError != null) ...[
          _loginAlert(_recoveryError!),
          TextButton(
            onPressed: _busy ? null : _loadRecovery,
            child: const Text('Retry saved state'),
          ),
          const SizedBox(height: 8),
        ],
        if (widget.pairingOnlyLogin)
          TextField(
            controller: _quickPairCode,
            enabled: !_busy,
            autocorrect: false,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Pairing code',
              hintText: 'JHB7-5HT2',
            ),
            onSubmitted: (_) => _signInWithPairCode(),
          )
        else ...[
          TextField(
            controller: _account,
            enabled: !_busy,
            decoration: const InputDecoration(labelText: 'Account ID'),
            autocorrect: false,
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _pin,
            enabled: !_busy,
            decoration: const InputDecoration(labelText: 'PIN'),
            obscureText: true,
            keyboardType: TextInputType.visiblePassword,
            onSubmitted: (_) => _login(),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          _loginAlert(_error!),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: signInDisabled
              ? null
              : widget.pairingOnlyLogin
              ? _signInWithPairCode
              : _login,
          child: Text(_busy ? 'Signing in.' : 'Sign in'),
        ),
        if (!widget.pairingOnlyLogin) ...[
          const SizedBox(height: 16),
          const Divider(),
          const SizedBox(height: 8),
          const Text(
            'Sign in with a code from your manager or owner.',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _quickPairCode,
            enabled: !_busy,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Manager pairing code',
              hintText: 'JHB7-5HT2',
            ),
            onSubmitted: (_) => _signInWithPairCode(),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: signInDisabled ? null : _signInWithPairCode,
            child: const Text('Sign in with pairing code'),
          ),
          const SizedBox(height: 12),
          const Text(
            'Forgot your PIN? Ask your manager.',
            style: TextStyle(color: StaffAccessScreen.muted),
          ),
        ],
      ],
    );
  }

  Widget _loginDevice() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: StaffAccessScreen.alabaster,
      border: Border.all(color: StaffAccessScreen.concrete),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Hub: ${widget.client.baseUri.origin} · Device: ${widget.deviceId}',
          style: const TextStyle(fontSize: 12),
        ),
        if (_notice != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(_notice!, style: const TextStyle(fontSize: 12)),
          ),
        if (widget.onClientChanged != null || widget.onUnpaired != null)
          Wrap(
            spacing: 8,
            children: [
              if (widget.onClientChanged != null)
                TextButton(
                  onPressed: _busy ? null : _showSwitchHubDialog,
                  child: const Text('Switch hub address'),
                ),
              if (widget.onUnpaired != null)
                TextButton(
                  onPressed: _busy || _pending != null ? null : _unpairDevice,
                  child: const Text('Unpair device'),
                ),
            ],
          ),
      ],
    ),
  );

  Widget _loginAlert(String message) => Semantics(
    liveRegion: true,
    child: Text(
      message,
      style: const TextStyle(color: StaffAccessScreen.error),
    ),
  );

  Widget _surface(Widget child) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xffcccccc)),
      borderRadius: BorderRadius.circular(6),
    ),
    padding: const EdgeInsets.all(16),
    child: child,
  );

  Widget _cashier() => Column(
    children: [
      _shiftStrip(),
      const SizedBox(height: 12),
      Expanded(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth >= 950) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(flex: 3, child: _menu()),
                  const SizedBox(width: 12),
                  Expanded(flex: 2, child: _ticket()),
                ],
              );
            }
            return DefaultTabController(
              length: 2,
              child: Column(
                children: [
                  const TabBar(
                    tabs: [
                      Tab(text: 'Menu'),
                      Tab(text: 'Ticket'),
                    ],
                  ),
                  Expanded(child: TabBarView(children: [_menu(), _ticket()])),
                ],
              ),
            );
          },
        ),
      ),
    ],
  );

  Widget _shiftStrip() => Wrap(
    spacing: 12,
    runSpacing: 6,
    crossAxisAlignment: WrapCrossAlignment.center,
    children: [
      Text(
        _shift == null ? 'No open drawer shift' : 'Shift: ${_shift!['status']}',
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      OutlinedButton(
        onPressed: _locked ? null : () => _shiftDialog(),
        child: Text(_shift == null ? 'Open shift' : 'Shift closing'),
      ),
    ],
  );

  Widget _menu() {
    final products = _products
        .where(
          (p) =>
              '${p['name']}'.toLowerCase().contains(_search.text.toLowerCase()),
        )
        .toList();
    return Column(
      children: [
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'Search products',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        const SizedBox(height: 12),
        Expanded(
          child: products.isEmpty
              ? const Center(
                  child: Text(
                    'No products available. Ask a manager to configure the catalogue.',
                  ),
                )
              : LayoutBuilder(
                  builder: (context, constraints) => GridView.builder(
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: constraints.maxWidth >= 480 ? 3 : 2,
                      mainAxisExtent: 160,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 10,
                    ),
                    itemCount: products.length,
                    itemBuilder: (context, index) {
                      final product = products[index];
                      return OutlinedButton(
                        onPressed:
                            _locked ||
                                _selected != null ||
                                !productIsAvailable(product)
                            ? null
                            : () => _customize(product),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: Colors.white,
                          padding: const EdgeInsets.all(12),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Expanded(
                              child: Text(
                                '${product['name']}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            Text(_money(product['priceCentavos'])),
                            const SizedBox(height: 8),
                            Text(
                              productIsAvailable(product)
                                  ? '+ Add'
                                  : 'Unavailable',
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }

  Future<void> _customize(Map<String, dynamic> product) async {
    final note = TextEditingController();
    var quantity = 1;
    String? sizeId;
    String? substitutionId;
    final addons = <String, int>{};
    final options = product['options'] is Map
        ? Map<String, dynamic>.from(product['options'] as Map)
        : const <String, dynamic>{};
    final sizes = (options['sizes'] as List? ?? const [])
        .whereType<Map>()
        .toList();
    final substitutions = (options['substitutions'] as List? ?? const [])
        .whereType<Map>()
        .toList();
    final addonList = (options['addons'] as List? ?? const [])
        .whereType<Map>()
        .toList();
    await _showOwnedDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) {
          final resolved = resolveCartLineProduct(
            product,
            dineIn: _dineIn,
            sizeId: sizeId,
            substitutionId: substitutionId,
            addons: addons,
          );
          return AlertDialog(
            title: Text('${product['name']}'),
            content: SizedBox(
              width: 380,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_money(resolved['priceCentavos'])),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Quantity'),
                        IconButton(
                          tooltip: 'Decrease quantity',
                          onPressed: quantity <= 1
                              ? null
                              : () => update(() => quantity--),
                          icon: const Icon(Icons.remove),
                        ),
                        Text('$quantity'),
                        IconButton(
                          tooltip: 'Increase quantity',
                          onPressed: quantity >= 99
                              ? null
                              : () => update(() => quantity++),
                          icon: const Icon(Icons.add),
                        ),
                      ],
                    ),
                    if (sizes.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String?>(
                        decoration: const InputDecoration(labelText: 'Size'),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Standard'),
                          ),
                          for (final size in sizes)
                            DropdownMenuItem<String?>(
                              value: size['id'] as String,
                              child: Text(
                                '${size['name']} (+${_money(size['priceDeltaCentavos'])})',
                              ),
                            ),
                        ],
                        onChanged: (value) => update(() => sizeId = value),
                      ),
                    ],
                    if (substitutions.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String?>(
                        decoration: const InputDecoration(
                          labelText: 'Substitution',
                        ),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('None'),
                          ),
                          for (final sub in substitutions)
                            DropdownMenuItem<String?>(
                              value: sub['id'] as String,
                              child: Text(
                                '${sub['name']} (+${_money(sub['priceDeltaCentavos'])})',
                              ),
                            ),
                        ],
                        onChanged: (value) =>
                            update(() => substitutionId = value),
                      ),
                    ],
                    for (final addon in addonList)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              '${addon['name']} (+${_money(addon['priceDeltaCentavos'])})',
                            ),
                          ),
                          IconButton(
                            tooltip: 'Decrease ${addon['name']}',
                            onPressed: (addons[addon['id'] as String] ?? 0) <= 0
                                ? null
                                : () => update(() {
                                    final id = addon['id'] as String;
                                    final next = (addons[id] ?? 0) - 1;
                                    if (next <= 0) {
                                      addons.remove(id);
                                    } else {
                                      addons[id] = next;
                                    }
                                  }),
                            icon: const Icon(Icons.remove),
                          ),
                          Text('${addons[addon['id'] as String] ?? 0}'),
                          IconButton(
                            tooltip: 'Increase ${addon['name']}',
                            onPressed:
                                (addons[addon['id'] as String] ?? 0) >= 10
                                ? null
                                : () => update(() {
                                    final id = addon['id'] as String;
                                    addons[id] = (addons[id] ?? 0) + 1;
                                  }),
                            icon: const Icon(Icons.add),
                          ),
                        ],
                      ),
                    TextField(
                      controller: note,
                      maxLength: 300,
                      decoration: const InputDecoration(
                        labelText: 'Preparation note',
                      ),
                    ),
                    const Text(
                      'Notes do not change the recipe or price. Recipe variants require catalogue configuration.',
                      style: TextStyle(fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Back'),
              ),
              FilledButton(
                onPressed: () {
                  setState(
                    () => _cart.add(
                      _CartLine(
                        product,
                        quantity,
                        note.text.trim(),
                        sizeId: sizeId,
                        substitutionId: substitutionId,
                        addons: Map<String, int>.unmodifiable(addons),
                      ),
                    ),
                  );
                  Navigator.pop(dialogContext);
                },
                child: const Text('Add to order'),
              ),
            ],
          );
        },
      ),
    );
    note.dispose();
  }

  Widget _ticket() {
    final order = _selected;
    final unavailable = (order?['unavailableLines'] as List? ?? const []);
    final cartUnavailable = _cart.any((line) {
      final matching = _products.where(
        (product) => product['id'] == line.product['id'],
      );
      return matching.isEmpty || !productIsAvailable(matching.first);
    });
    final cartAvailability = order == null
        ? cartStockShortages(
            _cart.map(
              (line) => (
                product: line.resolvedProduct(dineIn: _dineIn),
                quantity: line.quantity,
              ),
            ),
            _ingredients,
          )
        : null;
    final shortages =
        cartAvailability?.shortages ?? orderStockShortages(order!);
    final total = _cart.fold<int>(
      0,
      (sum, line) => sum + line.unitPriceCentavos * line.quantity,
    );
    return _surface(
      ListView(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  order == null ? 'New order' : 'Order #${order['orderNo']}',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (order != null && orderCanChangePrice(order))
                IconButton(
                  tooltip: order['customerId'] == null
                      ? 'Attach customer'
                      : 'Change customer',
                  onPressed: _locked
                      ? null
                      : () => _attachCustomerDialog(order),
                  icon: const Icon(Icons.person_add_alt_1_outlined),
                ),
              TextButton(
                onPressed: _locked
                    ? null
                    : () => setState(() => _selected = null),
                child: const Text('+ New order'),
              ),
            ],
          ),
          if (order == null) ...[
            const SizedBox(height: 12),
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: true, label: Text('Dine in')),
                ButtonSegment(value: false, label: Text('Takeout')),
              ],
              selected: {_dineIn},
              onSelectionChanged: _locked
                  ? null
                  : (value) => setState(() => _dineIn = value.first),
            ),
            if (_dineIn)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: TextField(
                  controller: _table,
                  enabled: !_locked,
                  maxLength: 12,
                  decoration: const InputDecoration(
                    labelText: 'Table number (optional)',
                  ),
                ),
              ),
            if (_cart.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 28),
                child: Text('Choose a product from the menu.'),
              ),
            for (var i = 0; i < _cart.length; i++)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  '${_cart[i].quantity} × ${_cart[i].product['name']}',
                ),
                subtitle: Text(
                  _products.any(
                        (product) =>
                            product['id'] == _cart[i].product['id'] &&
                            productIsAvailable(product),
                      )
                      ? _cart[i].note
                      : 'Unavailable · remove this item to continue',
                ),
                trailing: IconButton(
                  tooltip: 'Remove item',
                  onPressed: _locked
                      ? null
                      : () => setState(() => _cart.removeAt(i)),
                  icon: const Icon(Icons.close),
                ),
              ),
            _StockShortageWarning(shortages),
            if (cartAvailability?.incomplete == true)
              const Text(
                'Stock availability unavailable. Refresh to check stock.',
              ),
            const Divider(),
            Text(
              'Total ${_money(total)}',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _locked || _cart.isEmpty || cartUnavailable
                  ? null
                  : _createOrder,
              child: const Text('Create order'),
            ),
          ] else ...[
            Text(
              '${order['dineIn'] == true ? 'Dine in' : 'Takeout'} · ${order['table'] ?? ''}',
            ),
            for (final line in (order['lines'] as List))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${line['quantity']} × ${line['name']}'),
                subtitle: Text('${line['note'] ?? ''}'),
                trailing:
                    unavailable.any((item) => item['lineNo'] == line['lineNo'])
                    ? TextButton(
                        onPressed: _locked
                            ? null
                            : () => _replaceUnavailable(
                                order,
                                Map<String, dynamic>.from(line),
                              ),
                        child: const Text('Replace'),
                      )
                    : null,
              ),
            if (unavailable.isNotEmpty)
              const Text(
                'A menu item is unavailable. Replace it before sending or recording another payment.',
              ),
            _StockShortageWarning(shortages),
            Text(
              'Payment: ${order['paymentState']} · Kitchen: ${order['kitchenState']}',
            ),
            if (order['amendment'] case final Map amendment)
              _AmendmentSummary(amendment),
            if (order['released'] == true &&
                order['ready'] != true &&
                order['cancelled'] != true &&
                (order['lines'] as List).any((line) => line['lineNo'] is int))
              OutlinedButton(
                onPressed:
                    _locked ||
                        _stationReviewPending(order) ||
                        (order['amendment'] as Map?)?['status'] ==
                            'awaiting_approval'
                    ? null
                    : () => _changeSentOrder(order),
                child: const Text('Change sent order'),
              ),
            const SizedBox(height: 12),
            if (order['customerName'] case final String customerName
                when customerName.isNotEmpty)
              Text('Customer: $customerName'),
            if ((order['earnedPoints'] as int? ?? 0) > 0)
              Text('Earned points: ${order['earnedPoints']} pts'),
            if ((order['discountCentavos'] as int? ?? 0) > 0 ||
                (order['loyaltyRedemptionCentavos'] as int? ?? 0) > 0) ...[
              Text('Subtotal ${_money(order['subtotalCentavos'])}'),
              if ((order['discountCentavos'] as int? ?? 0) > 0)
                Text('Discount −${_money(order['discountCentavos'])}'),
              if ((order['loyaltyRedemptionCentavos'] as int? ?? 0) > 0)
                Text(
                  'Loyalty redemption −${_money(order['loyaltyRedemptionCentavos'])} (${order['redeemedPoints']} pts)',
                ),
              const SizedBox(height: 8),
            ],
            Text(
              'Total ${_money(order['totalCentavos'])} · Paid ${_money(order['paidCentavos'])}',
            ),
            if ((order['refundedCentavos'] as int? ?? 0) > 0)
              Text('Refunded ${_money(order['refundedCentavos'])}'),
            _loyaltyRedemptionStatus(order),
            if (order['customerId'] != null && orderCanChangePrice(order))
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _locked
                      ? null
                      : () => _requestLoyaltyRedemptionDialog(order),
                  child: const Text('Request points redemption'),
                ),
              ),
            _discountStatus(order),
            if (_canRequestDiscount(order))
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _locked
                      ? null
                      : () => _requestApproval(order, 'discount'),
                  child: Text(
                    _approvalFor(order)?['status'] == 'pending'
                        ? 'Replace discount request'
                        : 'Request discount',
                  ),
                ),
              ),
            _cancellationStatus(order),
            for (final refund in _refunds.where(
              (refund) => refund['orderId'] == order['id'],
            ))
              _refundSummary(refund),
            if (_canRequestRefund(order))
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _locked ? null : () => _requestRefund(order),
                  child: const Text('Request refund'),
                ),
              ),
            if (order['cancelled'] != true)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _locked
                      ? null
                      : () => _requestApproval(order, 'cancel'),
                  child: const Text('Request cancellation'),
                ),
              ),
            if (order['cancelled'] != true &&
                order['released'] != true &&
                order['dineIn'] == true)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton(
                  onPressed: _locked || unavailable.isNotEmpty
                      ? null
                      : () => _mutate(
                          'Order sent',
                          '/api/v1/orders/${order['id']}/send',
                          expectedVersion: order['version'],
                        ),
                  child: const Text('Send to bar'),
                ),
              ),
            const SizedBox(height: 12),
            if (_stagedPriceChange(order))
              const Text(
                'The station must review the order change before payment.',
              ),
            FilledButton(
              onPressed: _locked || _stagedPriceChange(order)
                  ? null
                  : () => _openPayment(order),
              child: Text(
                order['cancelled'] == true
                    ? 'Review payments'
                    : order['paymentState'] == 'paid'
                    ? 'Payment and receipt'
                    : 'Take payment',
              ),
            ),
          ],
          if (_refunds.any(
            (refund) =>
                refund['status'] == 'approved' &&
                refund['orderId'] != order?['id'],
          )) ...[
            const SizedBox(height: 24),
            const Text(
              'Approved refunds',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            for (final refund in _refunds.where(
              (refund) =>
                  refund['status'] == 'approved' &&
                  refund['orderId'] != order?['id'],
            ))
              _refundSummary(refund),
          ],
          const SizedBox(height: 24),
          const Text(
            'Saved orders',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          if (_orders.isEmpty) const Text('No saved orders.'),
          for (final item in _orders)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                'Order #${item['orderNo']} · ${item['paymentState']}',
              ),
              subtitle: Text('${item['kitchenState']}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _locked ? null : () => setState(() => _selected = item),
            ),
        ],
      ),
    );
  }

  bool _canRequestRefund(Map<String, dynamic> order) =>
      (order['paidCentavos'] as int? ?? 0) >
          (order['refundedCentavos'] as int? ?? 0) &&
      (order['cancelled'] == true ||
          (order['paidCentavos'] as int? ?? 0) >=
              (order['totalCentavos'] as int)) &&
      (order['lines'] as List).every((line) => line['lineNo'] is int);

  Widget _refundSummary(Map<String, dynamic> refund) {
    final legs = refund['legs'] as List;
    final completed =
        legs.isNotEmpty && legs.every((leg) => leg['status'] == 'completed');
    final label = completed
        ? 'Refund completed'
        : switch (refund['status']) {
            'pending' => 'Refund awaiting approval',
            'denied' => 'Refund denied',
            'stale' => 'Refund request expired',
            _ => 'Refund approved',
          };
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          Text(
            'Order #${refund['orderNo']} · ${_money(refund['amountCentavos'])}',
          ),
          Text('${refund['reason']}'),
          if (refund['decisionReason'] case final String reason
              when reason.isNotEmpty)
            Text('Manager response · $reason'),
          if (refund['status'] == 'pending')
            const Text('Refresh to check the manager’s decision.'),
          if (refund['status'] == 'stale')
            const Text('The order changed. Send a new request if needed.'),
          for (final leg in legs) ...[
            const SizedBox(height: 8),
            Text(
              '${leg['method']} · ${_money(leg['amountCentavos'])} · ${switch (leg['status']) {
                'completed' => 'Completed',
                'unknown' => 'Outcome unknown',
                'failed' => 'Failed',
                'voided' => 'Voided',
                _ => 'Awaiting payout',
              }}',
            ),
            if (leg['reference'] case final String reference
                when reference.isNotEmpty)
              Text('Reference $reference'),
            if (leg['note'] case final String note when note.isNotEmpty)
              Text(note),
            if (leg['status'] == 'unknown')
              const Text(
                'Ask a manager to check merchant records before retrying.',
              ),
            if (leg['method'] != 'cash' &&
                leg['status'] != 'completed' &&
                leg['status'] != 'voided')
              const Text(
                'Manager records the external refund using merchant evidence.',
              ),
            if (refund['status'] == 'approved' &&
                leg['method'] == 'cash' &&
                leg['status'] == 'pending') ...[
              OutlinedButton(
                onPressed: _locked || _shift?['status'] != 'open'
                    ? null
                    : () => _recordCashRefund(
                        refund,
                        Map<String, dynamic>.from(leg as Map),
                      ),
                child: const Text('Record cash payout'),
              ),
              if (_shift?['status'] != 'open')
                const Text(
                  'Open a drawer shift to record the cash handed back.',
                ),
            ],
          ],
        ],
      ),
    );
  }

  Future<void> _requestRefund(Map<String, dynamic> order) async {
    final lines = order['lines'] as List;
    final selected = <int>{};
    final amount = TextEditingController();
    final reason = TextEditingController();
    final replacing = _refunds.any(
      (refund) =>
          refund['orderId'] == order['id'] && refund['status'] == 'pending',
    );
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('Request refund · Order #${order['orderNo']}'),
          scrollable: true,
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Recorded payments ${_money(order['paidCentavos'])}'),
                Text('Already refunded ${_money(order['refundedCentavos'])}'),
                if (replacing)
                  const Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: Text(
                      'Sending this request replaces your previous pending refund request.',
                    ),
                  ),
                const SizedBox(height: 12),
                const Text(
                  'Select the relevant items. A manager reviews the amount and original payment methods.',
                ),
                for (final line in lines)
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${line['name']}'),
                    subtitle: Text(
                      '${line['quantity']} × ${_money(line['unitPriceCentavos'])}',
                    ),
                    value: selected.contains(line['lineNo']),
                    onChanged: saving
                        ? null
                        : (checked) => update(() {
                            if (checked == true) {
                              selected.add(line['lineNo'] as int);
                            } else {
                              selected.remove(line['lineNo']);
                            }
                          }),
                  ),
                const SizedBox(height: 12),
                TextField(
                  controller: amount,
                  enabled: !saving,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Refund amount (PHP)',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: reason,
                  enabled: !saving,
                  maxLength: 300,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Reason for refund',
                  ),
                ),
                if (error != null)
                  Semantics(liveRegion: true, child: Text(error!)),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: saving || _locked
                  ? null
                  : () async {
                      if (selected.isEmpty) {
                        update(() => error = 'Select at least one item.');
                        return;
                      }
                      final value = _decimal(amount.text, 2);
                      final remaining =
                          (order['paidCentavos'] as int) -
                          (order['refundedCentavos'] as int? ?? 0);
                      if (value == null || value <= 0 || value > remaining) {
                        update(
                          () => error =
                              'Enter a positive amount within the recorded payments.',
                        );
                        return;
                      }
                      if (reason.text.trim().isEmpty) {
                        update(() => error = 'Enter a reason for the manager.');
                        return;
                      }
                      update(() {
                        saving = true;
                        error = null;
                      });
                      final result = await _mutate(
                        'Refund request',
                        '/api/v1/orders/${order['id']}/refunds',
                        expectedVersion: order['version'],
                        payload: {
                          'amountCentavos': value,
                          'lineNumbers': selected.toList()..sort(),
                          'reason': reason.text.trim(),
                        },
                      );
                      if (!dialogContext.mounted) return;
                      if (result != null || _pending != null) {
                        Navigator.pop(dialogContext);
                      } else {
                        update(() {
                          saving = false;
                          error = _error;
                        });
                      }
                    },
              child: Text(saving ? 'Sending…' : 'Send refund request'),
            ),
          ],
        ),
      ),
    );
    amount.dispose();
    reason.dispose();
  }

  Future<void> _recordCashRefund(
    Map<String, dynamic> refund,
    Map<String, dynamic> initialLeg,
  ) async {
    if (!await _refresh() || !mounted || _locked) return;
    final matches = _refunds.where((item) => item['id'] == refund['id']);
    if (matches.isEmpty || _shift?['status'] != 'open') {
      setState(
        () => _error =
            'Refresh the refund and open the assigned drawer shift before a cash payout.',
      );
      return;
    }
    final currentRefund = matches.first;
    final matchesLeg = (currentRefund['legs'] as List).where(
      (leg) => leg['id'] == initialLeg['id'],
    );
    if (currentRefund['status'] != 'approved' ||
        matchesLeg.isEmpty ||
        matchesLeg.first['status'] != 'pending') {
      setState(
        () => _error =
            'The refund changed. Review its current status before a cash payout.',
      );
      return;
    }
    final leg = matchesLeg.first as Map;
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('Record cash payout · Order #${refund['orderNo']}'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Hand back ${_money(leg['amountCentavos'])} from drawer ${_shift!['drawerId']}.',
                ),
                const SizedBox(height: 12),
                const Text(
                  'Record this after the customer receives the cash. The payout belongs to the drawer’s current open shift.',
                ),
                if (error != null)
                  Semantics(liveRegion: true, child: Text(error!)),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: saving || _locked
                  ? null
                  : () async {
                      update(() {
                        saving = true;
                        error = null;
                      });
                      final result = await _mutate(
                        'Cash refund payout',
                        '/api/v1/refunds/${refund['id']}/legs/${leg['id']}',
                        expectedVersion: leg['version'] as int,
                        payload: const {'action': 'record_cash'},
                      );
                      if (!dialogContext.mounted) return;
                      if (result != null || _pending != null) {
                        Navigator.pop(dialogContext);
                      } else {
                        update(() {
                          saving = false;
                          error = _error;
                        });
                      }
                    },
              child: Text(saving ? 'Recording…' : 'Record cash handed back'),
            ),
          ],
        ),
      ),
    );
  }

  Map<String, dynamic>? _approvalFor(
    Map<String, dynamic> order, [
    String action = 'discount',
  ]) {
    for (final approval in _approvals) {
      if (approval['orderId'] == order['id'] && approval['action'] == action) {
        return approval;
      }
    }
    return null;
  }

  bool _canRequestDiscount(Map<String, dynamic> order) =>
      orderCanChangePrice(order);

  Widget _loyaltyRedemptionStatus(Map<String, dynamic> order) {
    final redemptions = (order['loyaltyRedemptions'] as List? ?? const [])
        .whereType<Map>()
        .map((r) => Map<String, dynamic>.from(r))
        .toList();
    if (redemptions.isEmpty) return const SizedBox.shrink();
    final active = redemptions.last;
    final status = active['status'];
    final cloudStatus = active['cloudStatus'];
    final label = switch ((status, cloudStatus)) {
      ('pending', _) => 'Loyalty redemption awaiting approval',
      ('approved', 'awaiting_cloud') => 'Loyalty redemption approved',
      (_, 'applied') => 'Loyalty redemption applied',
      (_, 'cloud_unknown') =>
        'Loyalty redemption outcome unknown · ask manager to reconcile',
      ('failed', _) => 'Loyalty redemption failed',
      ('denied', _) => 'Loyalty redemption denied',
      _ => 'Loyalty redemption expired',
    };
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          Text(
            'Requested ${active['requestedPoints']} pts (${_money(active['discountCentavos'])})',
          ),
          Text('${active['reason']}'),
          if (active['decisionReason'] case final String reason
              when reason.isNotEmpty)
            Text('Manager response · $reason'),
          if (status == 'approved' && cloudStatus == 'awaiting_cloud')
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton(
                onPressed: _locked
                    ? null
                    : () => _mutate(
                        'Cloud loyalty redemption',
                        '/api/v1/loyalty/redemptions/${active['id']}/validate-cloud',
                        expectedVersion: active['version'] as int,
                      ),
                child: const Text('Apply approved redemption'),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _customersLoyaltyDialog() async {
    final name = TextEditingController();
    final phone = TextEditingController();
    var loading = true;
    var saving = false;
    String? error;
    List<Map<String, dynamic>> customers = const [];
    Map<String, dynamic>? cloudState;
    await _showOwnedDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) {
          Future<void> loadData() async {
            update(() {
              loading = true;
              error = null;
            });
            try {
              final results = await Future.wait<Object?>([
                widget.client.customers(),
                widget.client.loyaltyCloudState(),
              ]);
              if (!dialogContext.mounted) return;
              update(() {
                customers = results[0] as List<Map<String, dynamic>>;
                cloudState = results[1] as Map<String, dynamic>;
                loading = false;
              });
            } catch (err) {
              if (!dialogContext.mounted) return;
              update(() {
                loading = false;
                error = err is HubException
                    ? err.message
                    : 'Could not load customers.';
              });
            }
          }

          if (loading &&
              customers.isEmpty &&
              cloudState == null &&
              error == null) {
            Future.microtask(loadData);
          }

          final rawCloud = cloudState?['cloudState'] is Map
              ? Map<String, dynamic>.from(cloudState!['cloudState'] as Map)
              : cloudState;
          final online = rawCloud?['loyaltyCloudMode'] == 'online';
          final pendingEntries = rawCloud?['pendingEntriesCount'] as int? ?? 0;

          return AlertDialog(
            title: const Text('Customers & loyalty'),
            scrollable: true,
            content: SizedBox(
              width: 440,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (rawCloud != null) ...[
                    Text(
                      'Cloud loyalty: ${online ? 'Online' : 'Offline'} · Pending entries: $pendingEntries',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    if (online && pendingEntries > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: OutlinedButton(
                          onPressed: saving || _locked
                              ? null
                              : () async {
                                  update(() {
                                    saving = true;
                                    error = null;
                                  });
                                  await _mutate(
                                    'Loyalty sync',
                                    '/api/v1/loyalty/sync',
                                  );
                                  if (!dialogContext.mounted) return;
                                  saving = false;
                                  await loadData();
                                },
                          child: const Text('Sync pending loyalty points'),
                        ),
                      ),
                    const Divider(height: 24),
                  ],
                  const Text(
                    'Enroll customer',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: name,
                    enabled: !saving,
                    decoration: const InputDecoration(
                      labelText: 'Customer name',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: phone,
                    enabled: !saving,
                    decoration: const InputDecoration(
                      labelText: 'Customer phone',
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: saving || _locked
                        ? null
                        : () async {
                            if (name.text.trim().isEmpty) {
                              update(() => error = 'Enter the customer name.');
                              return;
                            }
                            update(() {
                              saving = true;
                              error = null;
                            });
                            final result = await _mutate(
                              'Customer enrollment',
                              '/api/v1/customers',
                              payload: {
                                'displayName': name.text.trim(),
                                if (phone.text.trim().isNotEmpty)
                                  'phone': phone.text.trim(),
                              },
                            );
                            if (!dialogContext.mounted) return;
                            saving = false;
                            if (result != null) {
                              name.clear();
                              phone.clear();
                              await loadData();
                            } else {
                              update(() => error = _error);
                            }
                          },
                    child: Text(saving ? 'Saving…' : 'Enroll customer'),
                  ),
                  const Divider(height: 24),
                  const Text(
                    'Directory',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  if (loading) const LinearProgressIndicator(),
                  if (customers.isEmpty && !loading)
                    const Text('No customers enrolled.'),
                  for (final customer in customers)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('${customer['displayName']}'),
                      subtitle: Text(
                        'Available: ${customer['availablePoints']} pts · Pending: ${customer['pendingPoints']} pts',
                      ),
                    ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(error!),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(dialogContext),
                child: const Text('Close'),
              ),
            ],
          );
        },
      ),
    );
    name.dispose();
    phone.dispose();
  }

  Future<void> _attachCustomerDialog(Map<String, dynamic> order) async {
    var loading = true;
    var saving = false;
    String? selectedId = order['customerId'] as String?;
    String? error;
    List<Map<String, dynamic>> customers = const [];
    await _showOwnedDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) {
          Future<void> loadCustomers() async {
            try {
              final list = await widget.client.customers();
              if (!dialogContext.mounted) return;
              update(() {
                customers = list;
                loading = false;
              });
            } catch (err) {
              if (!dialogContext.mounted) return;
              update(() {
                loading = false;
                error = err is HubException
                    ? err.message
                    : 'Could not load customers.';
              });
            }
          }

          if (loading && customers.isEmpty && error == null) {
            Future.microtask(loadCustomers);
          }

          return AlertDialog(
            title: Text('Order #${order['orderNo']} customer'),
            content: SizedBox(
              width: 400,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (loading) const LinearProgressIndicator(),
                  if (!loading)
                    DropdownButtonFormField<String?>(
                      value: customers.any((c) => c['id'] == selectedId)
                          ? selectedId
                          : null,
                      decoration: const InputDecoration(
                        labelText: 'Select customer',
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Walk-in (no customer)'),
                        ),
                        for (final customer in customers)
                          DropdownMenuItem<String?>(
                            value: customer['id'] as String,
                            child: Text(
                              '${customer['displayName']} (${customer['availablePoints']} pts)',
                            ),
                          ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) => update(() => selectedId = value),
                    ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(error!),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(dialogContext),
                child: const Text('Back'),
              ),
              FilledButton(
                onPressed: saving || loading || _locked
                    ? null
                    : () async {
                        update(() {
                          saving = true;
                          error = null;
                        });
                        final result = await _mutate(
                          'Order customer',
                          '/api/v1/orders/${order['id']}/customer',
                          expectedVersion: order['version'] as int,
                          payload: {'customerId': selectedId},
                        );
                        if (!dialogContext.mounted) return;
                        if (result != null || _pending != null) {
                          Navigator.pop(dialogContext);
                        } else {
                          update(() {
                            saving = false;
                            error = _error;
                          });
                        }
                      },
                child: Text(saving ? 'Saving…' : 'Save customer'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _requestLoyaltyRedemptionDialog(
    Map<String, dynamic> order,
  ) async {
    final points = TextEditingController();
    final reason = TextEditingController();
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('Redeem loyalty points · Order #${order['orderNo']}'),
          content: SizedBox(
            width: 400,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Customer: ${order['customerName'] ?? ''}'),
                  Text('Order total: ${_money(order['totalCentavos'])}'),
                  const SizedBox(height: 12),
                  TextField(
                    controller: points,
                    enabled: !saving,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Points to redeem',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: reason,
                    enabled: !saving,
                    maxLength: 300,
                    decoration: const InputDecoration(
                      labelText: 'Reason for redemption',
                    ),
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(error!),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: saving || _locked
                  ? null
                  : () async {
                      final pts = int.tryParse(points.text.trim());
                      if (pts == null || pts <= 0) {
                        update(
                          () => error = 'Enter whole points greater than zero.',
                        );
                        return;
                      }
                      if (reason.text.trim().isEmpty) {
                        update(() => error = 'Enter a reason for the manager.');
                        return;
                      }
                      update(() {
                        saving = true;
                        error = null;
                      });
                      final result = await _mutate(
                        'Loyalty redemption request',
                        '/api/v1/orders/${order['id']}/loyalty/redeem-request',
                        expectedVersion: order['version'] as int,
                        payload: {'points': pts, 'reason': reason.text.trim()},
                      );
                      if (!dialogContext.mounted) return;
                      if (result != null || _pending != null) {
                        Navigator.pop(dialogContext);
                      } else {
                        update(() {
                          saving = false;
                          error = _error;
                        });
                      }
                    },
              child: Text(saving ? 'Sending…' : 'Send redemption request'),
            ),
          ],
        ),
      ),
    );
    points.dispose();
    reason.dispose();
  }

  Widget _discountStatus(Map<String, dynamic> order) {
    final approval = _approvalFor(order);
    if (approval == null) return const SizedBox.shrink();
    final stale =
        approval['status'] == 'pending' &&
        approval['orderVersion'] != order['version'];
    final status = stale ? 'stale' : approval['status'];
    final label = switch (status) {
      'pending' => 'Discount awaiting approval',
      'approved' => 'Discount approved',
      'denied' => 'Discount denied',
      _ => 'Discount request expired',
    };
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          Text('Requested ${_money(approval['amountCentavos'])}'),
          Text('${approval['reason']}'),
          if (approval['decisionReason'] case final String reason
              when reason.isNotEmpty)
            Text('Manager response · $reason'),
          if (status == 'pending')
            const Text(
              'Refresh to check the manager’s decision before payment.',
            ),
          if (status == 'stale')
            const Text('The order changed. Send a new request if needed.'),
        ],
      ),
    );
  }

  Widget _cancellationStatus(Map<String, dynamic> order) {
    final cancellation = order['cancellation'] as Map?;
    final request = _approvalFor(order, 'cancel');
    if (cancellation == null && request == null) return const SizedBox.shrink();
    final state =
        request?['status'] == 'pending' &&
            request?['orderVersion'] != order['version']
        ? 'stale'
        : request?['status'];
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            cancellation != null
                ? 'Order cancelled'
                : switch (state) {
                    'pending' => 'Cancellation awaiting approval',
                    'denied' => 'Cancellation denied',
                    'approved' => 'Cancellation approved',
                    _ => 'Cancellation request expired',
                  },
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          Text('${cancellation?['reason'] ?? request?['reason'] ?? ''}'),
          if (cancellation != null)
            Text(
              cancellation['status'] == 'awaiting_disposition'
                  ? 'Preparation disposition required'
                  : 'Disposition recorded',
            ),
          if (cancellation != null && (order['paidCentavos'] as int? ?? 0) > 0)
            const Text(
              'Collected payments remain recorded. Ask a manager to review any refund.',
            ),
          if (cancellation != null && order['hasPendingPayments'] == true)
            const Text(
              'Review pending external payments using merchant evidence.',
            ),
          if (request?['decisionReason'] case final String reason
              when reason.isNotEmpty)
            Text('Manager response · $reason'),
        ],
      ),
    );
  }

  Future<void> _requestApproval(
    Map<String, dynamic> order,
    String action,
  ) async {
    final cancellation = action == 'cancel';
    final replacement = _approvalFor(order, action)?['status'] == 'pending';
    final title = cancellation
        ? 'Request cancellation'
        : replacement
        ? 'Replace discount request'
        : 'Request discount';
    final amount = TextEditingController();
    final reason = TextEditingController();
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('$title · Order #${order['orderNo']}'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Order total ${_money(order['totalCentavos'])}'),
                  const SizedBox(height: 12),
                  if (cancellation) ...[
                    const Text(
                      'This requests cancellation of the whole order. A manager must approve it. Notify the barista to stop preparation once approved.',
                    ),
                    if ((order['paidCentavos'] as int? ?? 0) > 0)
                      Text(
                        'Collected ${_money(order['paidCentavos'])}. Any refund requires manager review.',
                      ),
                    const SizedBox(height: 12),
                  ],
                  if (replacement) ...[
                    const Text(
                      'Sending this request replaces your previous pending request.',
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (!cancellation)
                    TextField(
                      controller: amount,
                      enabled: !saving,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Discount amount (PHP)',
                      ),
                    ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: reason,
                    enabled: !saving,
                    minLines: 2,
                    maxLines: 3,
                    maxLength: 300,
                    decoration: InputDecoration(
                      labelText: cancellation
                          ? 'Reason for cancellation'
                          : 'Reason for discount',
                    ),
                  ),
                  if (error != null)
                    Semantics(liveRegion: true, child: Text(error!)),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: saving || _locked
                  ? null
                  : () async {
                      final value = _decimal(amount.text, 2);
                      if (!cancellation &&
                          (value == null ||
                              value <= 0 ||
                              value >= (order['totalCentavos'] as int))) {
                        update(
                          () => error =
                              'Enter a discount greater than ₱0.00 and below the order total.',
                        );
                        return;
                      }
                      if (reason.text.trim().isEmpty) {
                        update(() => error = 'Enter a reason for the manager.');
                        return;
                      }
                      update(() {
                        saving = true;
                        error = null;
                      });
                      final result = await _mutate(
                        cancellation
                            ? 'Cancellation request'
                            : 'Discount request',
                        '/api/v1/orders/${order['id']}/approvals',
                        expectedVersion: order['version'],
                        payload: {
                          'action': action,
                          if (!cancellation) 'amountCentavos': value,
                          'reason': reason.text.trim(),
                        },
                      );
                      if (!dialogContext.mounted) return;
                      if (result != null || _pending != null) {
                        Navigator.pop(dialogContext);
                      } else {
                        update(() {
                          saving = false;
                          error = _error;
                        });
                      }
                    },
              child: Text(
                saving
                    ? 'Sending…'
                    : cancellation
                    ? 'Send cancellation request'
                    : replacement
                    ? 'Replace request'
                    : 'Send request',
              ),
            ),
          ],
        ),
      ),
    );
    amount.dispose();
    reason.dispose();
  }

  Future<void> _openPayment(Map<String, dynamic> selected) async {
    if (!await _refresh() || !mounted || _locked) return;
    final orders = _orders.where((order) => order['id'] == selected['id']);
    if (orders.isNotEmpty && !_stagedPriceChange(orders.first)) {
      await _payment(orders.first);
    }
  }

  Future<void> _createOrder() async {
    final dineIn = _dineIn;
    final table = _table.text.trim();
    final items = _cart
        .map(
          (line) => <String, dynamic>{
            'productId': line.product['id'],
            'quantity': line.quantity,
            'note': line.note,
            if (line.sizeId != null) 'sizeId': line.sizeId,
            if (line.substitutionId != null)
              'substitutionId': line.substitutionId,
            if (line.addons.isNotEmpty)
              'addons': [
                for (final entry in line.addons.entries)
                  if (entry.value > 0)
                    {'addonId': entry.key, 'quantity': entry.value},
              ],
          },
        )
        .toList();
    await _mutate(
      'Order',
      '/api/v1/orders',
      payload: {'dineIn': dineIn, 'table': table, 'items': items},
      accepted: (result) {
        setState(() {
          _selected = Map<String, dynamic>.from(result['order'] as Map);
        });
      },
    );
  }

  Future<void> _replaceUnavailable(
    Map<String, dynamic> order,
    Map<String, dynamic> line,
  ) async {
    final hasTender = orderHasActiveOrPendingTenders(order);
    final replacements = _products
        .where(
          (product) =>
              productIsAvailable(product) &&
              product['id'] != line['productId'] &&
              (!hasTender ||
                  product['priceCentavos'] == line['unitPriceCentavos']),
        )
        .toList();
    final reason = TextEditingController();
    String? selected;
    final result = await _showOwnedDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('Replace ${line['name']}'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (hasTender)
                  const Text(
                    'Choose an item with the same price. For a different price, request manager cancellation or refund and enter a new order.',
                  ),
                if (replacements.isEmpty)
                  const Text(
                    'No eligible replacement is available. Ask a manager to review the order.',
                  ),
                if (replacements.isNotEmpty)
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(
                      labelText: 'Replacement item',
                    ),
                    items: replacements
                        .map(
                          (product) => DropdownMenuItem<String>(
                            value: product['id'] as String,
                            child: Text(
                              '${product['name']} · ${_money(product['priceCentavos'])}',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => update(() => selected = value),
                  ),
                TextField(
                  controller: reason,
                  maxLength: 160,
                  decoration: const InputDecoration(
                    labelText: 'Reason for replacement',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: selected == null
                  ? null
                  : () {
                      final value = reason.text.trim();
                      if (value.isNotEmpty) {
                        Navigator.pop(dialogContext, {
                          'productId': selected!,
                          'reason': value,
                        });
                      }
                    },
              child: const Text('Replace item'),
            ),
          ],
        ),
      ),
    );
    reason.dispose();
    if (result == null || !mounted) return;
    await _mutate(
      'Replacement',
      '/api/v1/orders/${order['id']}/replace-unavailable',
      expectedVersion: order['version'],
      payload: {'lineNo': line['lineNo'], ...result},
    );
  }

  Future<void> _shiftDialog() async {
    final amount = TextEditingController();
    final note = TextEditingController();
    final shift = _shift;
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(shift == null ? 'Open shift' : 'Shift closing'),
          content: SizedBox(
            width: 380,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (shift != null) Text('Status: ${shift['status']}'),
                  if (shift == null ||
                      [
                        'open',
                        'recount_required',
                      ].contains(shift['status'])) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: amount,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText: shift == null
                            ? 'Opening cash (PHP)'
                            : 'Counted cash (PHP)',
                        errorText: error,
                      ),
                    ),
                    if (shift != null) ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: note,
                        maxLength: 500,
                        decoration: const InputDecoration(
                          labelText: 'Closing note',
                        ),
                      ),
                    ],
                  ] else
                    const Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: Text(
                        'Your count is awaiting manager review. Cash transactions are locked.',
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            if (shift == null ||
                ['open', 'recount_required'].contains(shift['status']))
              FilledButton(
                onPressed: saving || _locked
                    ? null
                    : () async {
                        final value = _decimal(amount.text, 2);
                        if (value == null) {
                          update(() => error = 'Enter a valid cash amount.');
                          return;
                        }
                        update(() => saving = true);
                        await _mutate(
                          shift == null ? 'Shift opening' : 'Blind count',
                          shift == null
                              ? '/api/v1/shifts/open'
                              : '/api/v1/shifts/${shift['id']}/submit-count',
                          expectedVersion: shift == null
                              ? null
                              : shift['version'],
                          payload: shift == null
                              ? {'openingCashCentavos': value}
                              : {
                                  'countedCashCentavos': value,
                                  'note': note.text.trim(),
                                },
                          accepted: (_) {
                            if (dialogContext.mounted) {
                              Navigator.pop(dialogContext);
                            }
                          },
                        );
                        if (dialogContext.mounted) {
                          update(() {
                            saving = false;
                            error = _error;
                          });
                        }
                      },
                child: Text(shift == null ? 'Open shift' : 'Submit count'),
              ),
          ],
        ),
      ),
    );
    amount.dispose();
    note.dispose();
  }

  Future<void> _payment(Map<String, dynamic> initial) async {
    var order = initial;
    var method = 'cash', saving = false, verified = false, balanceReady = true;
    String? status, error;
    Map<String, dynamic>? lastPrintJob;
    final amount = TextEditingController(
      text:
          (((order['totalCentavos'] as int) - (order['paidCentavos'] as int)) /
                  100)
              .toStringAsFixed(2),
    );
    final reference = TextEditingController();
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) {
          final remaining =
              (order['totalCentavos'] as int) - (order['paidCentavos'] as int);
          final paid = remaining <= 0;
          final cancelled = order['cancelled'] == true;
          final held =
              (order['unavailableLines'] as List? ?? const []).isNotEmpty;
          final recordingPending = method != 'cash' && !verified;
          final pendingPayment =
              order['hasPendingPayments'] == true ||
              (order['payments'] as List? ?? []).any(
                (p) => p['status'] == 'pending',
              );
          Future<void> refreshBalance() async {
            update(() {
              saving = true;
              error = null;
              balanceReady = false;
            });
            final refreshed = await _refresh();
            if (!dialogContext.mounted) return;
            final matches = _orders.where(
              (value) => value['id'] == order['id'],
            );
            update(() {
              saving = false;
              balanceReady = refreshed && matches.isNotEmpty;
              if (balanceReady) {
                order = matches.first;
                amount.text =
                    (((order['totalCentavos'] as int) -
                                (order['paidCentavos'] as int)) /
                            100)
                        .toStringAsFixed(2);
                verified = false;
                status =
                    'Balance refreshed. Check the amount before confirming.';
              } else {
                error =
                    _error ??
                    'Refresh the order balance before confirming payment.';
              }
            });
          }

          Future<void> payAction(
            String label,
            String path, {
            int? overrideExpectedVersion,
            bool omitExpectedVersion = false,
            Map<String, dynamic> payload = const {},
          }) async {
            update(() {
              saving = true;
              error = null;
            });
            final result = await _mutate(
              label,
              path,
              expectedVersion: omitExpectedVersion
                  ? null
                  : (overrideExpectedVersion ?? order['version'] as int?),
              payload: payload,
              accepted: (result) {
                if (!dialogContext.mounted) return;
                update(() {
                  if (result['order'] is Map) {
                    order = Map<String, dynamic>.from(result['order'] as Map);
                  }
                  if (result['job'] is Map) {
                    lastPrintJob = Map<String, dynamic>.from(
                      result['job'] as Map,
                    );
                  }
                  status = switch (result) {
                    {'job': {'status': 'confirmed'}} =>
                      'Receipt print confirmed (simulated).',
                    {'job': {'status': 'failed'}} =>
                      'Printer failed. Retry receipt print when ready.',
                    {'job': {'status': 'unknown'}} =>
                      'Printer timed out (status unknown). Check printer before retrying.',
                    {'job': Map()} =>
                      'Printer not configured. No receipt was sent.',
                    {'payment': {'status': 'pending'}} =>
                      'Payment recorded. Merchant verification is pending.',
                    _ => '$label confirmed by the hub.',
                  };
                  reference.clear();
                  verified = false;
                  amount.text =
                      (((order['totalCentavos'] as int) -
                                  (order['paidCentavos'] as int)) /
                              100)
                          .toStringAsFixed(2);
                });
              },
            );
            final failure = _error;
            if (result == null && _pending == null && dialogContext.mounted) {
              await refreshBalance();
            }
            if (dialogContext.mounted) {
              update(() {
                saving = false;
                if (failure != null) error = failure;
              });
            }
          }

          return AlertDialog(
            title: Text('Payment · Order #${order['orderNo']}'),
            content: SizedBox(
              width: 420,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      cancelled
                          ? 'Recorded payments ${_money(order['paidCentavos'])}'
                          : 'Remaining ${_money(max(0, remaining))}',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if ((order['discountCentavos'] as int? ?? 0) > 0)
                      Text(
                        'Approved discount ${_money(order['discountCentavos'])}',
                      ),
                    TextButton.icon(
                      onPressed: saving || _locked ? null : refreshBalance,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Refresh balance'),
                    ),
                    if (cancelled)
                      const Text(
                        'Order cancelled. Review recorded payments and merchant evidence with a manager before any refund.',
                      ),
                    const SizedBox(height: 16),
                    if (!cancelled)
                      DropdownButtonFormField<String>(
                        value: method,
                        decoration: const InputDecoration(
                          labelText: 'Payment method',
                        ),
                        items: const [
                          DropdownMenuItem(value: 'cash', child: Text('Cash')),
                          DropdownMenuItem(
                            value: 'gcash',
                            child: Text('GCash'),
                          ),
                          DropdownMenuItem(value: 'card', child: Text('Card')),
                        ],
                        onChanged: paid || cancelled || saving || _locked
                            ? null
                            : (value) => update(() => method = value!),
                      ),
                    if (!cancelled) const SizedBox(height: 12),
                    if (!cancelled)
                      TextField(
                        controller: amount,
                        enabled: !paid && !cancelled && !saving && !_locked,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: method == 'cash'
                              ? 'Cash received (PHP)'
                              : 'Payment amount (PHP)',
                        ),
                      ),
                    if (!cancelled && method != 'cash') ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: reference,
                        enabled: !paid && !cancelled && !saving && !_locked,
                        decoration: const InputDecoration(
                          labelText: 'Merchant reference',
                        ),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: verified,
                        onChanged: paid || cancelled || saving || _locked
                            ? null
                            : (value) => update(() => verified = value!),
                        title: const Text(
                          'I verified success in the merchant app or terminal',
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    if (pendingPayment)
                      Text(
                        cancelled
                            ? 'Resolve each pending external payment using merchant evidence.'
                            : 'Resolve pending external payments using Verify or Reject before recording another payment.',
                      ),
                    if (held)
                      const Text(
                        'Replace the unavailable item before recording another payment. Pending payments can still be verified or rejected.',
                      ),
                    const Text(
                      'Recording a payment does not charge a card or transfer money.',
                      style: TextStyle(fontSize: 12),
                    ),
                    for (final payment
                        in (order['payments'] as List? ?? [])) ...[
                      const Divider(),
                      Text(
                        '${payment['method']} · ${_money(payment['amountCentavos'])} · ${payment['status']}',
                      ),
                      if (payment['status'] == 'pending')
                        Wrap(
                          spacing: 8,
                          children: [
                            TextButton(
                              onPressed: saving || _locked
                                  ? null
                                  : () async {
                                      final confirmed = await showDialog<bool>(
                                        context: dialogContext,
                                        builder: (c) => AlertDialog(
                                          title: const Text(
                                            'Verify external payment',
                                          ),
                                          content: const Text(
                                            'Confirm that this original transaction succeeded in the merchant app or terminal.',
                                          ),
                                          actions: [
                                            TextButton(
                                              onPressed: () =>
                                                  Navigator.pop(c, false),
                                              child: const Text('Back'),
                                            ),
                                            FilledButton(
                                              onPressed: () =>
                                                  Navigator.pop(c, true),
                                              child: const Text(
                                                'I verified success',
                                              ),
                                            ),
                                          ],
                                        ),
                                      );
                                      if (confirmed == true) {
                                        await payAction(
                                          'Payment verification',
                                          '/api/v1/orders/${order['id']}/payments/${payment['id']}/verify',
                                        );
                                      }
                                    },
                              child: const Text('Verify pending payment'),
                            ),
                            TextButton(
                              onPressed: saving || _locked
                                  ? null
                                  : () async {
                                      final reason = await _askReason();
                                      if (reason != null) {
                                        await payAction(
                                          'Payment rejection',
                                          '/api/v1/orders/${order['id']}/payments/${payment['id']}/reject',
                                          payload: {'reason': reason},
                                        );
                                      }
                                    },
                              child: const Text('Reject pending payment'),
                            ),
                          ],
                        ),
                    ],
                    if (status != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(status!),
                      ),
                    if (error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(error!),
                      ),
                    const SizedBox(height: 12),
                    if (!cancelled)
                      OutlinedButton.icon(
                        onPressed: !paid || saving || _locked
                            ? null
                            : () => payAction(
                                'Receipt request',
                                '/api/v1/orders/${order['id']}/receipt',
                              ),
                        icon: const Icon(Icons.print_outlined),
                        label: const Text('Print receipt'),
                      ),
                    if (!cancelled &&
                        lastPrintJob != null &&
                        (lastPrintJob!['status'] == 'failed' ||
                            lastPrintJob!['status'] == 'unknown'))
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: OutlinedButton.icon(
                          onPressed: saving || _locked
                              ? null
                              : () => payAction(
                                  'Receipt retry',
                                  '/api/v1/print-jobs/${lastPrintJob!['id']}/retry',
                                  omitExpectedVersion: true,
                                  payload: {
                                    'action': 'retry',
                                    'note': 'Cashier retried receipt print',
                                  },
                                ),
                          icon: const Icon(Icons.replay_outlined),
                          label: const Text('Retry receipt print'),
                        ),
                      ),
                    if (!paid && !cancelled)
                      const Text('Receipt available after full payment.'),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(dialogContext),
                child: Text(paid ? 'Return to cashier' : 'Back'),
              ),
              if (!cancelled)
                FilledButton(
                  onPressed:
                      paid ||
                          cancelled ||
                          pendingPayment ||
                          saving ||
                          _locked ||
                          !balanceReady ||
                          held
                      ? null
                      : () {
                          final value = _decimal(amount.text, 2);
                          if (value == null ||
                              value <= 0 ||
                              (method != 'cash' && value > remaining)) {
                            update(
                              () => error =
                                  'Enter a valid amount within the remaining balance.',
                            );
                            return;
                          }
                          if (method != 'cash' &&
                              reference.text.trim().isEmpty) {
                            update(
                              () => error = 'Enter the merchant reference.',
                            );
                            return;
                          }
                          final allocation = method == 'cash'
                              ? min(value, remaining)
                              : value;
                          final selectedMethod = method,
                              merchantReference = reference.text.trim(),
                              wasVerified = verified;
                          payAction(
                            recordingPending ? 'Pending payment' : 'Payment',
                            '/api/v1/orders/${order['id']}/payments',
                            payload: {
                              'method': selectedMethod,
                              'amountCentavos': allocation,
                              'verified':
                                  selectedMethod == 'cash' || wasVerified,
                              if (selectedMethod != 'cash')
                                'reference': merchantReference,
                              if (selectedMethod == 'cash')
                                'cashReceivedCentavos': value,
                            },
                          );
                        },
                  child: Text(
                    saving
                        ? 'Saving…'
                        : recordingPending
                        ? 'Record pending payment'
                        : 'Confirm payment',
                  ),
                ),
            ],
          );
        },
      ),
    );
    amount.dispose();
    reference.dispose();
  }

  Future<String?> _askReason() async {
    final reason = TextEditingController();
    final value = await _showOwnedDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Reason for rejection'),
        content: TextField(
          controller: reason,
          maxLength: 300,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Back'),
          ),
          FilledButton(
            onPressed: () {
              if (reason.text.trim().isNotEmpty) {
                Navigator.pop(c, reason.text.trim());
              }
            },
            child: const Text('Reject'),
          ),
        ],
      ),
    );
    reason.dispose();
    return value;
  }

  Future<void> _resolveCancellation(Map<String, dynamic> order) async {
    final cancellation = order['cancellation'] as Map;
    final disposition = _RecipeDispositionFields(
      cancellation['recipe'] as List? ?? const [],
      verb: 'used',
      unitWord: 'quantity',
    );
    final ready = order['ready'] == true;
    var outcome = ready ? 'already_consumed' : 'unprepared';
    final note = TextEditingController();
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('Resolve cancellation · Order #${order['orderNo']}'),
          scrollable: true,
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Stop preparation. ${cancellation['reason']}'),
                const SizedBox(height: 12),
                if (ready) ...[
                  const Text(
                    'Already consumed',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const Text(
                    'Record what happened to the finished drink. Its ingredients were recorded when it was marked ready.',
                  ),
                ] else ...[
                  for (final option in {
                    'unprepared': 'No ingredients used',
                    if (disposition.isNotEmpty) 'used': 'Ingredients used',
                  }.entries)
                    RadioListTile<String>(
                      title: Text(option.value),
                      value: option.key,
                      groupValue: outcome,
                      onChanged: saving
                          ? null
                          : (value) {
                              if (value != null) {
                                update(() {
                                  outcome = value;
                                  error = null;
                                });
                              }
                            },
                    ),
                  if (outcome == 'used') ...[
                    const Text(
                      'Enter the amounts actually used. Leave unused ingredients blank.',
                    ),
                    ...disposition.buildInputs(enabled: !saving),
                  ],
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: note,
                  enabled: !saving,
                  maxLength: 300,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Disposition note',
                  ),
                ),
                if (error != null)
                  Semantics(liveRegion: true, child: Text(error!)),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: saving || _locked
                  ? null
                  : () async {
                      var used = const <Map<String, dynamic>>[];
                      if (outcome == 'used') {
                        final parsed = disposition.parse();
                        if (parsed.error != null) {
                          update(() => error = parsed.error);
                          return;
                        }
                        used = parsed.used!;
                        if (used.isEmpty) {
                          update(
                            () => error = 'Enter at least one amount used.',
                          );
                          return;
                        }
                      }
                      if (note.text.trim().isEmpty) {
                        update(() => error = 'Enter a disposition note.');
                        return;
                      }
                      update(() {
                        saving = true;
                        error = null;
                      });
                      final result = await _mutate(
                        'Cancellation disposition',
                        '/api/v1/orders/${order['id']}/cancellation/disposition',
                        expectedVersion: order['version'],
                        payload: {
                          'outcome': outcome,
                          'used': used,
                          'note': note.text.trim(),
                        },
                      );
                      if (!dialogContext.mounted) return;
                      if (result != null || _pending != null) {
                        Navigator.pop(dialogContext);
                      } else {
                        update(() {
                          saving = false;
                          error = _error;
                        });
                      }
                    },
              child: Text(saving ? 'Recording…' : 'Record disposition'),
            ),
          ],
        ),
      ),
    );
    disposition.dispose();
    note.dispose();
  }

  Widget _station() => Column(
    children: [
      Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            '${_history ? 'Station history' : 'Active orders'} · ${_orders.length}',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
          OutlinedButton(
            onPressed: _locked
                ? null
                : () {
                    setState(() => _history = !_history);
                    _refresh();
                  },
            child: Text(_history ? 'Active orders' : 'Station history'),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Expanded(
        child: _orders.isEmpty
            ? Center(
                child: Text(
                  _history
                      ? 'No ready or resolved cancelled orders.'
                      : 'No active orders. Use Refresh to check for new orders.',
                ),
              )
            : LayoutBuilder(
                builder: (context, c) => GridView.builder(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: c.maxWidth >= 1000
                        ? 3
                        : c.maxWidth >= 650
                        ? 2
                        : 1,
                    mainAxisExtent: 300,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                  ),
                  itemCount: _orders.length,
                  itemBuilder: (context, index) {
                    final order = _orders[index];
                    final cancelled = order['cancelled'] == true;
                    final cancellation = order['cancellation'] as Map?;
                    final pendingChange = _stationReviewPending(order);
                    return _surface(
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Order #${order['orderNo']} · ${order['dineIn'] == true ? 'Dine in' : 'Takeout'}',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            'Table ${order['table'] ?? ''} · ${order['paymentState']}',
                          ),
                          if (cancelled)
                            Text(
                              cancellation?['status'] == 'awaiting_disposition'
                                  ? 'Cancelled. Stop preparation.'
                                  : 'Cancelled · disposition recorded',
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            )
                          else if (order['preparing'] == true && !_history)
                            const Text('Preparing'),
                          if (pendingChange)
                            const Text(
                              'Order changed. Review before continuing.',
                              style: TextStyle(fontWeight: FontWeight.w700),
                            ),
                          const Divider(),
                          Expanded(
                            child: ListView(
                              children: [
                                if (cancellation?['reason']
                                    case final String reason)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Text(reason),
                                  ),
                                if (cancellation?['dispositionNote']
                                    case final String note)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Text(note),
                                  ),
                                for (final line in order['lines'] as List)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Text(
                                      '${line['quantity']} × ${line['name']}\n${line['note'] ?? ''}',
                                    ),
                                  ),
                                _StockShortageWarning(
                                  orderStockShortages(order),
                                ),
                              ],
                            ),
                          ),
                          if (!_history &&
                              !cancelled &&
                              !pendingChange &&
                              order['preparing'] != true)
                            OutlinedButton(
                              onPressed: _locked
                                  ? null
                                  : () => _mutate(
                                      'Preparation started',
                                      '/api/v1/orders/${order['id']}/prepare',
                                      expectedVersion: order['version'],
                                    ),
                              child: const Text('Start preparation'),
                            ),
                          if (!_history && !cancelled && !pendingChange)
                            FilledButton(
                              onPressed: _locked
                                  ? null
                                  : () => _mutate(
                                      'Order ready',
                                      '/api/v1/orders/${order['id']}/ready',
                                      expectedVersion: order['version'],
                                    ),
                              child: const Text('Mark ready'),
                            ),
                          if (!_history && pendingChange)
                            FilledButton(
                              onPressed: _locked
                                  ? null
                                  : () => _reviewOrderChange(order),
                              child: const Text('Review order change'),
                            ),
                          if (!_history &&
                              !pendingChange &&
                              cancellation?['status'] == 'awaiting_disposition')
                            FilledButton(
                              onPressed: _locked
                                  ? null
                                  : () => _resolveCancellation(order),
                              child: const Text('Resolve cancellation'),
                            ),
                          if (_history &&
                              !cancelled &&
                              order['ready'] == true) ...[
                            if ((order['recalledCount'] as int? ?? 0) > 0)
                              Text(
                                'Recalled ${order['recalledCount']}×',
                                style: const TextStyle(fontSize: 12),
                              ),
                            if (order['handoverAt'] != null)
                              const Text(
                                'Handed over',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              )
                            else
                              FilledButton(
                                onPressed: _locked
                                    ? null
                                    : () => _mutate(
                                        'Order handed over',
                                        '/api/v1/orders/${order['id']}/handover',
                                        expectedVersion: order['version'],
                                      ),
                                child: const Text('Complete handover'),
                              ),
                            OutlinedButton(
                              onPressed: _locked
                                  ? null
                                  : () => _mutate(
                                      'Order recalled',
                                      '/api/v1/orders/${order['id']}/recall',
                                      expectedVersion: order['version'],
                                    ),
                              child: const Text('Recall order'),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
              ),
      ),
    ],
  );

  Widget _waste() => _WasteForm(
    ingredients: _ingredients,
    locked: _locked,
    save: (ingredient, quantity, reason, note) => _mutate(
      'Waste entry',
      '/api/v1/waste',
      payload: {
        'ingredientId': ingredient,
        'quantityMilli': quantity,
        'reason': reason,
        'note': note,
      },
    ),
  );
}

class _WasteForm extends StatefulWidget {
  final List<Map<String, dynamic>> ingredients;
  final bool locked;
  final Future<Map<String, dynamic>?> Function(String, int, String, String)
  save;
  const _WasteForm({
    required this.ingredients,
    required this.locked,
    required this.save,
  });
  @override
  State<_WasteForm> createState() => _WasteFormState();
}

class _WasteFormState extends State<_WasteForm> {
  final quantity = TextEditingController(), note = TextEditingController();
  String? ingredientId, error;
  String reason = 'Dial-in';
  bool saving = false;
  @override
  void dispose() {
    quantity.dispose();
    note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListView(
    children: [
      const Text(
        'Waste and dial-in',
        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 16),
      if (widget.ingredients.isEmpty)
        const Text(
          'No ingredients available. Ask a manager to configure inventory.',
        )
      else ...[
        DropdownButtonFormField<String>(
          value: ingredientId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Ingredient'),
          items: widget.ingredients
              .map(
                (item) => DropdownMenuItem(
                  value: '${item['id']}',
                  child: Text('${item['name']} (${item['unit']})'),
                ),
              )
              .toList(),
          onChanged: saving || widget.locked
              ? null
              : (value) => setState(() => ingredientId = value),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: quantity,
          enabled: !saving && !widget.locked,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(
            labelText: 'Quantity in ingredient units',
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: reason,
          decoration: const InputDecoration(labelText: 'Reason'),
          items: ['Dial-in', 'Spillage', 'Expiry', 'Damage']
              .map(
                (value) => DropdownMenuItem(value: value, child: Text(value)),
              )
              .toList(),
          onChanged: saving || widget.locked
              ? null
              : (value) => setState(() => reason = value!),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: note,
          enabled: !saving && !widget.locked,
          maxLength: 500,
          decoration: const InputDecoration(labelText: 'Note (optional)'),
        ),
        const Text(
          'Raw ingredients only. Ready-drink disposal must not deduct the same ingredients twice.',
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(error!),
          ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: saving || widget.locked
              ? null
              : () async {
                  final amount = _decimal(quantity.text, 3);
                  if (ingredientId == null ||
                      amount == null ||
                      amount <= 0 ||
                      amount > 1000000000) {
                    setState(
                      () => error =
                          'Choose an ingredient and enter a valid positive quantity.',
                    );
                    return;
                  }
                  setState(() {
                    saving = true;
                    error = null;
                  });
                  final result = await widget.save(
                    ingredientId!,
                    amount,
                    reason,
                    note.text.trim(),
                  );
                  if (!mounted) return;
                  setState(() {
                    saving = false;
                    if (result != null) {
                      quantity.clear();
                      note.clear();
                      error = 'Waste entry saved by the hub.';
                    }
                  });
                },
          child: Text(saving ? 'Saving…' : 'Save waste'),
        ),
      ],
    ],
  );
}
