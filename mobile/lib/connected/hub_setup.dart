import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../data/hub_client.dart';
import '../data/hub_primitives.dart';
import '../data/platform_recovery_storage.dart';
import '../data/staff_recovery.dart';
import 'staff_access_screen.dart';
import 'staff_app.dart';

/// Restores the encrypted device record before opening an individual sign-in.
class HubSetupApp extends StatefulWidget {
  final StaffRecoveryStore? recoveryStore;
  final HubClient Function(Uri)? clientFactory;
  final bool? pairingOnlyLogin;
  const HubSetupApp({
    super.key,
    this.recoveryStore,
    this.clientFactory,
    this.pairingOnlyLogin,
  });
  @override
  State<HubSetupApp> createState() => _HubSetupAppState();
}

class _HubSetupAppState extends State<HubSetupApp> {
  final address = TextEditingController();
  final deviceId = TextEditingController();
  final deviceKey = TextEditingController();
  final pairingInput = TextEditingController();
  HubClient? client;
  String? error, discoveryNotice;
  String? enrolledId, enrolledKey, enrolledAuthorityId;
  late final StaffRecoveryStore recoveryStore;
  bool loading = true, storageUnavailable = false, busy = false;

  bool get pairingOnlyMode =>
      widget.pairingOnlyLogin ??
      (widget.recoveryStore == null && widget.clientFactory == null);

  Uri _defaultHotspotHubOrigin() {
    const envHub = String.fromEnvironment('KAPE_DOZ_HUB_URL');
    if (envHub.isNotEmpty) {
      final parsed = Uri.tryParse(envHub);
      if (parsed != null && parsed.hasScheme && parsed.host.isNotEmpty) {
        return Uri.parse(parsed.origin);
      }
    }
    if (kIsWeb && Uri.base.host.isNotEmpty) {
      return Uri.parse('http://${Uri.base.host}:4000');
    }
    return Uri.parse('http://192.168.137.1:4000');
  }

  @override
  void initState() {
    super.initState();
    recoveryStore = widget.recoveryStore ?? createPlatformRecoveryStore();
    restore();
  }

  HubClient connection(Uri origin) =>
      widget.clientFactory?.call(origin) ??
      HubClient(
        baseUri: origin,
        allowInsecureLoopback:
            recoveryStore.allowInsecureLoopback ||
            pairingOnlyMode ||
            !kReleaseMode,
        allowPrivateLanHttp:
            recoveryStore.allowPrivateLanHttp || pairingOnlyMode,
      );

  Future<void> restore() async {
    setState(() {
      loading = true;
      error = null;
      discoveryNotice = null;
    });
    try {
      final saved = await recoveryStore.load();
      final enrollment = saved.enrollment;
      final Uri? initialOrigin =
          enrollment?.hubOrigin ??
          (pairingOnlyMode ? _defaultHotspotHubOrigin() : null);
      final next = initialOrigin == null ? null : connection(initialOrigin);
      if (!mounted) {
        next?.close();
        return;
      }
      setState(() {
        client = next;
        enrolledId =
            enrollment?.deviceId ??
            (pairingOnlyMode ? 'unpaired-tablet' : null);
        enrolledKey =
            enrollment?.deviceSecret ??
            (pairingOnlyMode ? 'pending-pairing-code-enrollment-key' : null);
        enrolledAuthorityId = enrollment?.authorityId;
        storageUnavailable = false;
      });
    } catch (_) {
      if (!mounted) return;
      if (pairingOnlyMode && widget.recoveryStore == null) {
        final fallback = connection(_defaultHotspotHubOrigin());
        setState(() {
          client = fallback;
          enrolledId = 'unpaired-tablet';
          enrolledKey = 'pending-pairing-code-enrollment-key';
          enrolledAuthorityId = null;
          storageUnavailable = false;
          error = null;
        });
      } else {
        setState(() {
          storageUnavailable = true;
          error = storageUnavailableMessage;
        });
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    client?.close();
    address.dispose();
    deviceId.dispose();
    deviceKey.dispose();
    pairingInput.dispose();
    super.dispose();
  }

  void connect() {
    final uri = Uri.tryParse(address.text.trim());
    final id = deviceId.text.trim();
    final key = deviceKey.text;
    try {
      if (uri == null ||
          validateHubOrigin(
                uri,
                allowInsecureLoopback:
                    recoveryStore.allowInsecureLoopback || !kReleaseMode,
                allowPrivateLanHttp: recoveryStore.allowPrivateLanHttp,
              ) ==
              null ||
          !validateDeviceCredentials(id, key)) {
        throw ArgumentError('Enrollment required.');
      }
      final next = connection(uri);
      setState(() {
        enrolledId = id;
        enrolledKey = key;
        enrolledAuthorityId = null;
        client = next;
        error = null;
        discoveryNotice = null;
        deviceKey.clear();
      });
    } on ArgumentError {
      setState(
        () => error =
            'Enter an HTTPS hub address and the enrolled device credentials.',
      );
    }
  }

  Future<void> discoverLanHub() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
      discoveryNotice = null;
    });
    final typed = address.text.trim();
    final candidates = <String>[
      if (typed.isNotEmpty) typed,
      'http://127.0.0.1:4000',
      'http://127.0.0.1:8787',
      'http://localhost:4000',
      'http://localhost:8787',
      'http://kape-doz.local:8787',
      'http://192.168.1.100:8787',
      'http://192.168.1.10:8787',
      'http://192.168.0.100:8787',
      'http://10.0.2.2:4000',
      'http://10.0.2.2:8787',
    ];
    try {
      for (final raw in candidates) {
        final uri = Uri.tryParse(raw);
        if (uri == null) continue;
        HubClient? probe;
        try {
          probe = connection(uri);
          final info = await probe.hubInfo();
          final displayName = info['displayName'] as String? ?? 'KAPE DOZ Hub';
          final branchId = info['branchId'] as String? ?? '';
          if (!mounted) return;
          setState(() {
            address.text = uri.origin;
            discoveryNotice =
                'Found $displayName${branchId.isNotEmpty ? ' ($branchId)' : ''} at ${uri.origin}.';
          });
          return;
        } catch (_) {
          // Try next candidate.
        } finally {
          probe?.close();
        }
      }
      if (mounted) {
        setState(
          () => error =
              'No hub responded automatically. Enter the hub address or paste an enrollment bundle.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> pairWithCodeOrBundle() async {
    if (busy) return;
    final raw = pairingInput.text.trim();
    if (raw.isEmpty) {
      setState(
        () => error =
            'Enter the 8-character pairing code or paste the QR bundle.',
      );
      return;
    }
    String code = raw;
    String? bundleHubOrigin;
    String? bundleAuthorityId;
    if (raw.startsWith('{')) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) {
          final parsedCode = decoded['pairingCode'] ?? decoded['code'];
          final parsedHub = decoded['hubOrigin'] ?? decoded['hub'];
          final parsedAuth = decoded['authorityId'];
          if (parsedCode is String && parsedCode.trim().isNotEmpty) {
            code = parsedCode.trim();
          }
          if (parsedHub is String && parsedHub.trim().isNotEmpty) {
            bundleHubOrigin = parsedHub.trim();
          }
          if (parsedAuth is String && uuidPattern.hasMatch(parsedAuth.trim())) {
            bundleAuthorityId = parsedAuth.trim();
          }
        }
      } catch (_) {
        setState(() => error = 'The enrollment bundle is not valid JSON.');
        return;
      }
    }

    final targetOriginText = address.text.trim().isNotEmpty
        ? address.text.trim()
        : bundleHubOrigin;
    final uri = targetOriginText == null
        ? null
        : Uri.tryParse(targetOriginText);
    if (uri == null ||
        validateHubOrigin(
              uri,
              allowInsecureLoopback:
                  recoveryStore.allowInsecureLoopback || !kReleaseMode,
              allowPrivateLanHttp: recoveryStore.allowPrivateLanHttp,
            ) ==
            null) {
      setState(
        () => error =
            'Enter a valid hub address or paste an enrollment bundle containing the hub address.',
      );
      return;
    }

    setState(() {
      busy = true;
      error = null;
      discoveryNotice = null;
    });
    HubClient? next;
    try {
      next = connection(uri);
      final claimed = await next.claimPairingCode(code);
      final claimedId = claimed['deviceId'] as String?;
      final claimedSecret = claimed['deviceSecret'] as String?;
      final claimedAuth =
          (claimed['authorityId'] as String?) ?? bundleAuthorityId;
      if (claimedId == null ||
          claimedSecret == null ||
          !validateDeviceCredentials(claimedId, claimedSecret)) {
        throw const HubException('invalid_response');
      }
      final enrollment = StaffEnrollment(
        hubOrigin: uri,
        deviceId: claimedId,
        deviceSecret: claimedSecret,
        authorityId: claimedAuth != null && uuidPattern.hasMatch(claimedAuth)
            ? claimedAuth
            : null,
      );
      await recoveryStore.saveValidatedEnrollment(enrollment);
      if (!mounted) {
        next.close();
        return;
      }
      final connected = next;
      next = null;
      setState(() {
        enrolledId = enrollment.deviceId;
        enrolledKey = enrollment.deviceSecret;
        enrolledAuthorityId = enrollment.authorityId;
        client = connected;
        pairingInput.clear();
        deviceKey.clear();
      });
    } catch (caught) {
      next?.close();
      if (mounted) {
        setState(() {
          error = caught is HubException
              ? caught.message
              : caught is StaffRecoveryException
              ? caught.message
              : 'Device pairing could not be completed. Check the hub address and pairing code.';
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void handleClientChanged(HubClient nextClient) {
    final previous = client;
    setState(() {
      client = nextClient;
    });
    if (previous != null && !identical(previous, nextClient)) {
      previous.close();
    }
  }

  void handleUnpaired() {
    final previous = client;
    setState(() {
      client = null;
      enrolledId = null;
      enrolledKey = null;
      enrolledAuthorityId = null;
      error = null;
      discoveryNotice =
          'Device unpaired. Enter a new hub address or pairing code.';
    });
    previous?.close();
  }

  void handleDeviceEnrolled(StaffEnrollment enrollment) {
    setState(() {
      enrolledId = enrollment.deviceId;
      enrolledKey = enrollment.deviceSecret;
      enrolledAuthorityId = enrollment.authorityId;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (client != null) {
      return ConnectedStaffApp(
        client: client!,
        deviceId: enrolledId!,
        deviceSecret: enrolledKey!,
        authorityId: enrolledAuthorityId,
        recoveryStore: recoveryStore,
        clientFactory: connection,
        onClientChanged: handleClientChanged,
        onDeviceEnrolled: handleDeviceEnrolled,
        onUnpaired: handleUnpaired,
        pairingOnlyLogin: pairingOnlyMode,
      );
    }
    return MaterialApp(
      title: 'KAPE DOZ',
      debugShowCheckedModeBanner: false,
      home: StaffAccessScreen(
        title: loading
            ? 'Staff access'
            : storageUnavailable
            ? 'Device recovery'
            : 'Connect to café hub',
        description: loading || storageUnavailable
            ? null
            : 'Use the hub address and device credentials provided by your administrator.',
        children: [
          if (loading) ...[
            const LinearProgressIndicator(),
            const SizedBox(height: 16),
            const Text('Opening saved device state.'),
          ] else if (storageUnavailable) ...[
            Semantics(liveRegion: true, child: Text(error!)),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: restore,
              child: const Text('Retry saved state'),
            ),
          ] else ...[
            TextField(
              controller: address,
              enabled: !busy,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'Hub address',
                hintText: 'https://hub.example',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: deviceId,
              enabled: !busy,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'Enrolled device ID',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: deviceKey,
              enabled: !busy,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(labelText: 'Device key'),
            ),
            const SizedBox(height: 16),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  error!,
                  style: TextStyle(color: StaffAccessScreen.error),
                ),
              ),
            FilledButton(
              onPressed: busy ? null : connect,
              child: const Text('Connect'),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Divider(),
            ),
            const Text(
              'Or pair with a one-time code / QR bundle:',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: busy ? null : discoverLanHub,
                icon: const Icon(Icons.radar, size: 18),
                label: const Text('Discover LAN hub'),
              ),
            ),
            if (discoveryNotice != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(discoveryNotice!),
              ),
            const SizedBox(height: 8),
            TextField(
              controller: pairingInput,
              enabled: !busy,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'Pairing code or QR bundle',
                hintText: 'ABCD-1234 or JSON bundle',
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: busy ? null : pairWithCodeOrBundle,
              child: Text(busy ? 'Pairing…' : 'Pair with code'),
            ),
            const SizedBox(height: 16),
            Text(
              recoveryStore.durable
                  ? 'Device enrollment is saved after successful staff sign-in.'
                  : 'This browser preview keeps enrollment and pending work for the current session.',
            ),
          ],
        ],
      ),
    );
  }
}
