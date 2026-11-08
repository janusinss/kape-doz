import 'dart:ui' show ImageFilter;
import 'package:flutter/material.dart';

/// Presentation shared by staff sign-in, device enrollment and recovery.
class StaffAccessScreen extends StatelessWidget {
  static const wood = Color(0xffc88a36);
  static const amber = Color(0xfff5b841);
  static const alabaster = Color(0xfff4f1ea);
  static const concrete = Color(0xffd8d2c7);
  static const espresso = Color(0xff2a1e17);
  static const paper = Color(0xfffcfaf5);
  static const muted = Color(0xff62534a);
  static const control = Color(0xff8b786a);
  static const error = Color(0xff862d24);

  final String title;
  final String? description;
  final List<Widget> children;
  final bool modernSignIn;

  const StaffAccessScreen({
    super.key,
    required this.title,
    this.description,
    required this.children,
    this.modernSignIn = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(modernSignIn ? 7 : 12),
      borderSide: const BorderSide(color: control),
    );
    return Theme(
      data: theme.copyWith(
        colorScheme: const ColorScheme.light(
          primary: espresso,
          onPrimary: alabaster,
          secondary: wood,
          onSecondary: espresso,
          surface: paper,
          onSurface: espresso,
          onSurfaceVariant: muted,
          outline: control,
          error: error,
        ),
        textTheme: theme.textTheme.apply(
          fontFamily: modernSignIn ? 'Segoe UI' : null,
          bodyColor: espresso,
          displayColor: espresso,
        ),
        primaryTextTheme: modernSignIn
            ? theme.primaryTextTheme.apply(fontFamily: 'Segoe UI')
            : theme.primaryTextTheme,
        inputDecorationTheme: InputDecorationTheme(
          labelStyle: modernSignIn
              ? const TextStyle(fontFamily: 'Segoe UI', fontSize: 16, color: muted)
              : null,
          hintStyle: modernSignIn
              ? const TextStyle(fontFamily: 'Segoe UI', fontSize: 16, color: muted)
              : null,
          filled: true,
          fillColor: modernSignIn ? paper : alabaster,
          border: border,
          enabledBorder: border,
          focusedBorder: border.copyWith(
            borderSide: const BorderSide(color: espresso, width: 2),
          ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: espresso,
            foregroundColor: Colors.white,
            minimumSize: const Size(48, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(modernSignIn ? 7 : 12),
            ),
            textStyle: TextStyle(
              fontFamily: modernSignIn ? 'Segoe UI' : null,
              fontSize: modernSignIn ? 16 : 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
      child: Scaffold(
        backgroundColor: alabaster,
        appBar: modernSignIn ? null : AppBar(
          backgroundColor: paper,
          foregroundColor: espresso,
          title: Row(
            children: [
              ExcludeSemantics(
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: amber,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'KD',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              const Text(
                'KAPE DOZ',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
              const SizedBox(width: 12),
              const Text(
                'STAFF',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
        body: DecoratedBox(
          decoration: modernSignIn
              ? const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: [Color(0xfffcfaf6), Color(0xfff7ede1), Color(0xffebcda7)],
                    stops: [.28, .62, 1],
                  ),
                )
              : const BoxDecoration(color: alabaster),
          child: CustomPaint(
          painter: modernSignIn ? _AccessGridPainter() : null,
          child: SafeArea(
          child: LayoutBuilder(
            builder: (context, viewport) {
              final wide = viewport.maxWidth >= 720;
              final inset = wide ? 28.0 : 16.0;

              final panel = Padding(
                padding: EdgeInsets.all(wide ? (modernSignIn ? 48 : 36) : 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (modernSignIn) ...[
                      Wrap(
                        spacing: 10.4,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          ExcludeSemantics(
                            child: Container(
                              width: 30.4,
                              height: 30.4,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: amber,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text('KD', style: TextStyle(
                                fontFamily: 'LoginWordmark', shadows: [Shadow(color: espresso, offset: Offset(.35, 0)), Shadow(color: espresso, offset: Offset(-.35, 0))], color: espresso, fontSize: 11.68,
                                fontWeight: FontWeight.w900,
                              )),
                            ),
                          ),
                          const Text('KAPE DOZ', style: TextStyle(
                            fontFamily: 'LoginWordmark', shadows: [Shadow(color: espresso, offset: Offset(.35, 0)), Shadow(color: espresso, offset: Offset(-.35, 0))], color: espresso, fontSize: 16,
                            fontWeight: FontWeight.w900, letterSpacing: -.288,
                          )),
                          Container(
                            padding: const EdgeInsets.only(left: 10.4),
                            decoration: const BoxDecoration(
                              border: Border(left: BorderSide(color: control)),
                            ),
                            child: const Text('STAFF', style: TextStyle(
                              fontFamily: 'LoginWordmark', shadows: [Shadow(color: espresso, offset: Offset(.35, 0)), Shadow(color: espresso, offset: Offset(-.35, 0))], color: espresso, fontSize: 10.88,
                              fontWeight: FontWeight.w900, letterSpacing: .87,
                            )),
                          ),
                        ],
                      ),
                      const SizedBox(height: 36),
                    ],
                    if (!modernSignIn)
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: amber,
                              borderRadius: BorderRadius.circular(5),
                            ),
                            child: const Text(
                              'KD.',
                              style: TextStyle(
                                color: espresso,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Expanded(
                            child: Text(
                              'KAPE DOZ STAFF ACCESS',
                              style: TextStyle(
                                color: muted,
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 0.8,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    if (!modernSignIn) const SizedBox(height: 12),
                    Semantics(
                      header: true,
                      child: Text(
                        title,
                        style: TextStyle(
                          fontSize: modernSignIn ? (viewport.maxWidth * .04).clamp(35.2, 51.2) : 26,
                          height: modernSignIn ? 1.14 : null,
                          fontWeight: modernSignIn ? FontWeight.w700 : FontWeight.w800,
                          color: espresso,
                          letterSpacing: modernSignIn ? -1.2 : -0.5,
                        ),
                      ),
                    ),
                    if (description != null) ...[
                      SizedBox(height: modernSignIn ? 12 : 6),
                      Text(
                        description!,
                        style: TextStyle(
                          color: muted,
                          fontSize: modernSignIn ? 16 : 14,
                          height: modernSignIn ? 1.55 : 1.45,
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    ...children,
                    if (modernSignIn) ...[
                      const SizedBox(height: 24),
                      const Divider(color: concrete),
                      const SizedBox(height: 12),
                      const Text(
                        'For the KAPE DOZ team.',
                        style: TextStyle(color: muted, fontSize: 13.12),
                      ),
                    ],
                  ],
                ),
              );

              return SingleChildScrollView(
                padding: EdgeInsets.all(inset),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: (viewport.maxHeight - inset * 2)
                        .clamp(0.0, double.infinity)
                        .toDouble(),
                  ),
                  child: Align(
                    alignment: wide ? Alignment.center : Alignment.topCenter,
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: wide ? 1040 : 480),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(modernSignIn ? 16 : 24),
                          boxShadow: modernSignIn ? const [
                            BoxShadow(color: Color(0x2e492f1f), offset: Offset(0, 24), blurRadius: 56, spreadRadius: -18),
                            BoxShadow(color: Color(0x1f6b482d), offset: Offset(0, 6), blurRadius: 16, spreadRadius: -6),
                          ] : null,
                        ),
                        child: Material(
                        color: paper,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(
                            modernSignIn ? 16 : 24,
                          ),
                          side: modernSignIn
                              ? BorderSide.none
                              : const BorderSide(color: concrete),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: wide
                            ? IntrinsicHeight(
                                child: Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    if (!modernSignIn) Expanded(flex: 11, child: panel),
                                    Expanded(
                                      flex: 12,
                                      child: Padding(
                                        padding: const EdgeInsets.all(12),
                                        child: modernSignIn
                                            ? _modernHero()
                                            : _buildHeroShowcase(true),
                                      ),
                                    ),
                                    if (modernSignIn) Expanded(flex: 11, child: panel),
                                  ],
                                ),
                              )
                            : Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  if (!modernSignIn) _buildCompactHeroHeader(),
                                  panel,
                                ],
                              ),
                      ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        ),
        ),
      ),
    );
  }

  Widget _modernHero() => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 560),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/menu/caramel-latte.jpg',
            fit: BoxFit.cover,
            excludeFromSemantics: true,
          ),
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x0D2A1E17), Color(0xE62A1E17)],
              ),
            ),
          ),
          const Positioned(
            left: 36,
            right: 36,
            bottom: 40,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('KAPE DOZ', style: TextStyle(
                  color: paper, fontSize: 12,
                  fontWeight: FontWeight.w700, letterSpacing: 1.5,
                )),
                SizedBox(height: 18),
                Text('Ready for\nyour shift.', style: TextStyle(
                  color: paper, fontSize: 48, height: 1.08,
                  fontWeight: FontWeight.w700, letterSpacing: -1,
                )),
                SizedBox(height: 16),
                Text('Your station starts here.', style: TextStyle(color: paper, fontSize: 14)),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  Widget _buildHeroShowcase(bool wide) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(wide ? 18 : 14),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset('assets/menu/caramel-latte.jpg', fit: BoxFit.cover),
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0x382A1E17),
                  Color(0x732A1E17),
                  Color(0xEA2A1E17),
                ],
                stops: [0.0, 0.45, 1.0],
              ),
            ),
          ),
          Positioned(
            top: 16,
            left: 16,
            right: 16,
            child: Align(
              alignment: Alignment.topLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xB82A1E17),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.22),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: amber,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Flexible(
                      child: Text(
                        'KAPE DOZ SPECIALTY COFFEE',
                        style: TextStyle(
                          color: amber,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.6,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xB82A1E17),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.22),
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x38000000),
                        blurRadius: 18,
                        offset: Offset(0, 6),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: amber, width: 2),
                              image: const DecorationImage(
                                image: AssetImage('assets/avatar.png'),
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  'Danilo Santos',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                                Text(
                                  '@kape_doz · Store Manager',
                                  style: TextStyle(
                                    color: amber,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        '"Real-time ticket routing and live recipe availability make peak rush hours completely stress-free."',
                        style: TextStyle(
                          color: Color(0xFFF4F1EA),
                          fontSize: 12,
                          height: 1.35,
                        ),
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompactHeroHeader() {
    return SizedBox(
      height: 120,
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset('assets/menu/caramel-latte.jpg', fit: BoxFit.cover),
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x222A1E17), Color(0xCC2A1E17)],
                ),
              ),
            ),
            Positioned(
              bottom: 12,
              left: 16,
              right: 16,
              child: Row(
                children: [
                  _monogram(32),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'KAPE DOZ',
                          style: TextStyle(
                            color: amber,
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.8,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          'Counter & Bar Station',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _monogram(double size) => ExcludeSemantics(
    child: Text.rich(
      TextSpan(
        text: 'KD',
        children: const [
          TextSpan(
            text: '.',
            style: TextStyle(color: amber),
          ),
        ],
      ),
      style: TextStyle(
        color: alabaster,
        fontSize: size,
        height: 1,
        letterSpacing: -2,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class _AccessGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()..color = const Color(0x1a73533a)..strokeWidth = 1;
    for (double x = 0; x <= size.width; x += 64) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), line);
    }
    for (double y = 0; y <= size.height; y += 64) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
