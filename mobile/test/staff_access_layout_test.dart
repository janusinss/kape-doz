import 'package:cafe_dos/connected/staff_access_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final modern in [false, true]) {
    for (final width in [375.0, 768.0, 1280.0]) {
      testWidgets(
        'staff access modern=$modern keeps long forms reachable at ${width.toInt()}px with enlarged text and keyboard',
        (tester) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = Size(width, 800);
          tester.view.viewInsets = const FakeViewPadding(bottom: 280);
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          addTearDown(tester.view.resetViewInsets);
          var submitted = false;

          await tester.pumpWidget(
            MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: const TextScaler.linear(2)),
                child: child!,
              ),
              home: StaffAccessScreen(
                modernSignIn: modern,
                title: 'Connect to café hub',
                description:
                    'Use the hub address and device credentials provided by your administrator.',
                children: [
                  Semantics(
                    liveRegion: true,
                    child: const Text(
                      'A saved operation needs confirmation. Sign in with the original account and hub before continuing. Contact the manager if saved state cannot be read.',
                    ),
                  ),
                  for (final label in [
                    'Hub address',
                    'Enrolled device ID',
                    'Device key',
                    'Pairing code or QR bundle',
                  ]) ...[
                    const SizedBox(height: 16),
                    TextField(
                      decoration: InputDecoration(labelText: label),
                      obscureText: label == 'Device key',
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => submitted = true,
                    child: const Text('Confirm access'),
                  ),
                ],
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);

          final submit = find.widgetWithText(FilledButton, 'Confirm access');
          await tester.ensureVisible(submit);
          await tester.pumpAndSettle();
          expect(submit.hitTestable(), findsOneWidget);
          expect(
            tester.getRect(submit).bottom,
            lessThanOrEqualTo(520),
            reason: 'The submit action must remain above the keyboard.',
          );
          await tester.tap(submit);
          expect(submitted, isTrue);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
