import 'package:flutter/material.dart';

/// Native equivalents of the semantic tokens in DESIGN.md.
abstract final class CafeTheme {
  static const ink = Color(0xff1f242e);
  static const canvas = Color(0xfffef5f1);
  static const muted = Color(0xff7c828d);
  static const border = Color(0xffe5e7eb);
  static const controlBorder = Color(0xffd1d5db);
  static const field = Color(0xfff3f4f6);
  static const warm = Color(0xfffddcd4);
  static const accent = Color(0xffff5722);
  static const onWarmAccent = Color(0xffd04214);
  static const error = Color(0xffdc2626);
  static const selected = accent;
  static const panelRadius = 16.0;
  static const controlRadius = 12.0;

  static ThemeData get light {
    final base = ThemeData(useMaterial3: true);
    final text = base.textTheme.apply(bodyColor: ink, displayColor: ink);
    final outline = OutlineInputBorder(
      borderRadius: BorderRadius.circular(controlRadius),
      borderSide: const BorderSide(color: controlBorder),
    );
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(controlRadius),
    );
    return base.copyWith(
      scaffoldBackgroundColor: canvas,
      colorScheme: const ColorScheme.light(
        primary: ink,
        onPrimary: Colors.white,
        secondary: accent,
        onSecondary: Colors.white,
        surface: Colors.white,
        onSurface: ink,
        onSurfaceVariant: muted,
        outline: controlBorder,
        outlineVariant: border,
        error: error,
        onError: Colors.white,
      ),
      textTheme: text.copyWith(
        bodyLarge: text.bodyLarge?.copyWith(
          fontSize: 16,
          height: 1.4,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
        bodyMedium: text.bodyMedium?.copyWith(
          fontSize: 16,
          height: 1.4,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
        titleLarge: text.titleLarge?.copyWith(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.4,
        ),
        titleMedium: text.titleMedium?.copyWith(
          fontSize: 17,
          fontWeight: FontWeight.w600,
        ),
        labelLarge: text.labelLarge?.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: field,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        labelStyle: const TextStyle(color: muted),
        hintStyle: const TextStyle(color: muted),
        border: outline,
        enabledBorder: outline,
        focusedBorder: outline.copyWith(
          borderSide: const BorderSide(color: accent, width: 2),
        ),
        errorBorder: outline.copyWith(
          borderSide: const BorderSide(color: error),
        ),
        focusedErrorBorder: outline.copyWith(
          borderSide: const BorderSide(color: error, width: 2),
        ),
        disabledBorder: outline.copyWith(
          borderSide: const BorderSide(color: border),
        ),
        errorMaxLines: 3,
        helperMaxLines: 3,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style:
            FilledButton.styleFrom(
              minimumSize: const Size(48, 48),
              shape: shape,
              backgroundColor: ink,
              foregroundColor: Colors.white,
              disabledBackgroundColor: border,
              disabledForegroundColor: muted,
            ).copyWith(
              overlayColor: WidgetStateProperty.resolveWith(
                (states) => states.contains(WidgetState.focused)
                    ? const Color(0x33ffffff)
                    : null,
              ),
            ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style:
            OutlinedButton.styleFrom(
              minimumSize: const Size(48, 48),
              shape: shape,
              foregroundColor: ink,
            ).copyWith(
              side: WidgetStateProperty.resolveWith(
                (states) => BorderSide(
                  color: states.contains(WidgetState.focused)
                      ? accent
                      : states.contains(WidgetState.disabled)
                      ? border
                      : controlBorder,
                  width: states.contains(WidgetState.focused) ? 2 : 1,
                ),
              ),
            ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: shape,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
      textSelectionTheme: const TextSelectionThemeData(
        cursorColor: accent,
        selectionColor: warm,
        selectionHandleColor: accent,
      ),
      dividerTheme: const DividerThemeData(
        color: border,
        thickness: 1,
        space: 24,
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: ink,
        contentTextStyle: TextStyle(color: Colors.white, fontSize: 15),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: Colors.white,
        selectedColor: warm,
        checkmarkColor: ink,
        labelStyle: const TextStyle(color: ink, fontSize: 15),
        side: const BorderSide(color: controlBorder),
        shape: shape,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      ),
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
    );
  }
}
