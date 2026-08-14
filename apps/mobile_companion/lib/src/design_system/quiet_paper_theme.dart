import 'package:flutter/material.dart';

/// Semantic colors that are not represented directly by Material's ColorScheme.
@immutable
class QuietPaperColors extends ThemeExtension<QuietPaperColors> {
  const QuietPaperColors({
    required this.success,
    required this.onSuccess,
    required this.successContainer,
    required this.onSuccessContainer,
    required this.warning,
    required this.onWarning,
    required this.warningContainer,
    required this.onWarningContainer,
    required this.info,
    required this.onInfo,
    required this.infoContainer,
    required this.onInfoContainer,
    required this.terminalCanvas,
    required this.terminalSurface,
    required this.terminalForeground,
    required this.terminalMuted,
    required this.terminalCursor,
    required this.terminalSelection,
  });

  final Color success;
  final Color onSuccess;
  final Color successContainer;
  final Color onSuccessContainer;
  final Color warning;
  final Color onWarning;
  final Color warningContainer;
  final Color onWarningContainer;
  final Color info;
  final Color onInfo;
  final Color infoContainer;
  final Color onInfoContainer;
  final Color terminalCanvas;
  final Color terminalSurface;
  final Color terminalForeground;
  final Color terminalMuted;
  final Color terminalCursor;
  final Color terminalSelection;

  @override
  QuietPaperColors copyWith({
    Color? success,
    Color? onSuccess,
    Color? successContainer,
    Color? onSuccessContainer,
    Color? warning,
    Color? onWarning,
    Color? warningContainer,
    Color? onWarningContainer,
    Color? info,
    Color? onInfo,
    Color? infoContainer,
    Color? onInfoContainer,
    Color? terminalCanvas,
    Color? terminalSurface,
    Color? terminalForeground,
    Color? terminalMuted,
    Color? terminalCursor,
    Color? terminalSelection,
  }) => QuietPaperColors(
    success: success ?? this.success,
    onSuccess: onSuccess ?? this.onSuccess,
    successContainer: successContainer ?? this.successContainer,
    onSuccessContainer: onSuccessContainer ?? this.onSuccessContainer,
    warning: warning ?? this.warning,
    onWarning: onWarning ?? this.onWarning,
    warningContainer: warningContainer ?? this.warningContainer,
    onWarningContainer: onWarningContainer ?? this.onWarningContainer,
    info: info ?? this.info,
    onInfo: onInfo ?? this.onInfo,
    infoContainer: infoContainer ?? this.infoContainer,
    onInfoContainer: onInfoContainer ?? this.onInfoContainer,
    terminalCanvas: terminalCanvas ?? this.terminalCanvas,
    terminalSurface: terminalSurface ?? this.terminalSurface,
    terminalForeground: terminalForeground ?? this.terminalForeground,
    terminalMuted: terminalMuted ?? this.terminalMuted,
    terminalCursor: terminalCursor ?? this.terminalCursor,
    terminalSelection: terminalSelection ?? this.terminalSelection,
  );

  @override
  QuietPaperColors lerp(covariant QuietPaperColors? other, double t) {
    if (other == null) return this;
    return QuietPaperColors(
      success: Color.lerp(success, other.success, t)!,
      onSuccess: Color.lerp(onSuccess, other.onSuccess, t)!,
      successContainer: Color.lerp(
        successContainer,
        other.successContainer,
        t,
      )!,
      onSuccessContainer: Color.lerp(
        onSuccessContainer,
        other.onSuccessContainer,
        t,
      )!,
      warning: Color.lerp(warning, other.warning, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      warningContainer: Color.lerp(
        warningContainer,
        other.warningContainer,
        t,
      )!,
      onWarningContainer: Color.lerp(
        onWarningContainer,
        other.onWarningContainer,
        t,
      )!,
      info: Color.lerp(info, other.info, t)!,
      onInfo: Color.lerp(onInfo, other.onInfo, t)!,
      infoContainer: Color.lerp(infoContainer, other.infoContainer, t)!,
      onInfoContainer: Color.lerp(onInfoContainer, other.onInfoContainer, t)!,
      terminalCanvas: Color.lerp(terminalCanvas, other.terminalCanvas, t)!,
      terminalSurface: Color.lerp(terminalSurface, other.terminalSurface, t)!,
      terminalForeground: Color.lerp(
        terminalForeground,
        other.terminalForeground,
        t,
      )!,
      terminalMuted: Color.lerp(terminalMuted, other.terminalMuted, t)!,
      terminalCursor: Color.lerp(terminalCursor, other.terminalCursor, t)!,
      terminalSelection: Color.lerp(
        terminalSelection,
        other.terminalSelection,
        t,
      )!,
    );
  }
}

abstract final class QuietPaperSpacing {
  static const double compact = 8;
  static const double related = 12;
  static const double gutter = 16;
  static const double section = 24;
  static const double spacious = 32;
}

abstract final class QuietPaperShapes {
  static const double controlRadius = 12;
  static const double cardRadius = 16;
  static const double sheetRadius = 24;
}

abstract final class QuietPaperTypography {
  static const String monospaceFamily = 'monospace';

  static TextStyle identifier(TextTheme textTheme) =>
      (textTheme.labelMedium ?? const TextStyle()).copyWith(
        fontFamily: monospaceFamily,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.4,
      );
}

abstract final class QuietPaperTheme {
  static ThemeData get light => _build(
    brightness: Brightness.light,
    colors: _lightScheme,
    semanticColors: _lightSemanticColors,
  );

  static ThemeData get dark => _build(
    brightness: Brightness.dark,
    colors: _darkScheme,
    semanticColors: _darkSemanticColors,
  );

  static ThemeData _build({
    required Brightness brightness,
    required ColorScheme colors,
    required QuietPaperColors semanticColors,
  }) {
    final base = ThemeData(
      brightness: brightness,
      colorScheme: colors,
      scaffoldBackgroundColor: colors.surface,
      useMaterial3: true,
    );
    final textTheme = base.textTheme
        .apply(bodyColor: colors.onSurface, displayColor: colors.onSurface)
        .copyWith(
          headlineLarge: base.textTheme.headlineLarge?.copyWith(
            fontSize: 28,
            height: 1.2,
            fontWeight: FontWeight.w700,
            color: colors.onSurface,
          ),
          headlineMedium: base.textTheme.headlineMedium?.copyWith(
            fontSize: 26,
            height: 1.2,
            fontWeight: FontWeight.w700,
            color: colors.onSurface,
          ),
          headlineSmall: base.textTheme.headlineSmall?.copyWith(
            fontSize: 24,
            height: 1.25,
            fontWeight: FontWeight.w700,
            color: colors.onSurface,
          ),
          titleLarge: base.textTheme.titleLarge?.copyWith(
            fontSize: 20,
            height: 1.3,
            fontWeight: FontWeight.w700,
            color: colors.onSurface,
          ),
          titleMedium: base.textTheme.titleMedium?.copyWith(
            fontSize: 17,
            height: 1.35,
            fontWeight: FontWeight.w600,
            color: colors.onSurface,
          ),
          titleSmall: base.textTheme.titleSmall?.copyWith(
            fontSize: 15,
            height: 1.4,
            fontWeight: FontWeight.w600,
            color: colors.onSurface,
          ),
          bodyLarge: base.textTheme.bodyLarge?.copyWith(
            fontSize: 16,
            height: 1.5,
            color: colors.onSurface,
          ),
          bodyMedium: base.textTheme.bodyMedium?.copyWith(
            fontSize: 16,
            height: 1.5,
            color: colors.onSurface,
          ),
          bodySmall: base.textTheme.bodySmall?.copyWith(
            fontSize: 14,
            height: 1.45,
            color: colors.onSurfaceVariant,
          ),
          labelLarge: base.textTheme.labelLarge?.copyWith(
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
          labelMedium: base.textTheme.labelMedium?.copyWith(
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
          labelSmall: base.textTheme.labelSmall?.copyWith(
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        );
    const controlShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.all(
        Radius.circular(QuietPaperShapes.controlRadius),
      ),
    );
    final controlStyle = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll<Size>(Size(48, 48)),
      padding: const WidgetStatePropertyAll<EdgeInsetsGeometry>(
        EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      ),
      shape: const WidgetStatePropertyAll<OutlinedBorder>(controlShape),
      textStyle: WidgetStatePropertyAll<TextStyle?>(textTheme.labelLarge),
    );
    final outlinedStyle = controlStyle.copyWith(
      side: WidgetStatePropertyAll<BorderSide>(
        BorderSide(color: colors.outline),
      ),
    );

    return base.copyWith(
      colorScheme: colors,
      scaffoldBackgroundColor: colors.surface,
      canvasColor: colors.surface,
      textTheme: textTheme,
      extensions: <ThemeExtension<dynamic>>[semanticColors],
      visualDensity: VisualDensity.standard,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: AppBarThemeData(
        backgroundColor: colors.surface,
        foregroundColor: colors.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: _transparent,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
        shape: Border(bottom: BorderSide(color: colors.outlineVariant)),
      ),
      cardTheme: CardThemeData(
        color: colors.surfaceContainerLowest,
        surfaceTintColor: _transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.cardRadius),
          side: BorderSide(color: colors.outlineVariant),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: colors.surfaceContainerLowest,
        surfaceTintColor: _transparent,
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.cardRadius),
        ),
        titleTextStyle: textTheme.titleLarge,
        contentTextStyle: textTheme.bodyMedium,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: colors.surfaceContainerLowest,
        modalBackgroundColor: colors.surfaceContainerLowest,
        surfaceTintColor: _transparent,
        elevation: 0,
        modalElevation: 2,
        showDragHandle: true,
        modalBarrierColor: _modalScrim,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(QuietPaperShapes.sheetRadius),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(style: controlStyle),
      outlinedButtonTheme: OutlinedButtonThemeData(style: outlinedStyle),
      textButtonTheme: TextButtonThemeData(style: controlStyle),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: colors.primary,
        foregroundColor: colors.onPrimary,
        elevation: 1,
        focusElevation: 1,
        hoverElevation: 1,
        highlightElevation: 1,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(
            Radius.circular(QuietPaperShapes.cardRadius),
          ),
        ),
      ),
      tabBarTheme: TabBarThemeData(
        indicatorColor: colors.primary,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: colors.outlineVariant,
        labelColor: colors.primary,
        unselectedLabelColor: colors.onSurfaceVariant,
        labelStyle: textTheme.labelLarge,
        unselectedLabelStyle: textTheme.labelLarge,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: colors.surfaceContainerLow,
        selectedColor: colors.primaryContainer,
        disabledColor: colors.surfaceContainerLow,
        labelStyle: textTheme.labelMedium?.copyWith(
          color: colors.onSurfaceVariant,
        ),
        secondaryLabelStyle: textTheme.labelMedium?.copyWith(
          color: colors.onPrimaryContainer,
        ),
        side: BorderSide(color: colors.outlineVariant),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.controlRadius),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      ),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: colors.surfaceContainerLowest,
        contentPadding: const EdgeInsets.all(16),
        labelStyle: textTheme.bodyMedium?.copyWith(
          color: colors.onSurfaceVariant,
        ),
        hintStyle: textTheme.bodyMedium?.copyWith(
          color: colors.onSurfaceVariant,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.controlRadius),
          borderSide: BorderSide(color: colors.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.controlRadius),
          borderSide: BorderSide(color: colors.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.controlRadius),
          borderSide: BorderSide(color: colors.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.controlRadius),
          borderSide: BorderSide(color: colors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(QuietPaperShapes.controlRadius),
          borderSide: BorderSide(color: colors.error, width: 2),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: colors.outlineVariant,
        thickness: 1,
        space: 24,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colors.inverseSurface,
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: colors.onInverseSurface,
        ),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(
            Radius.circular(QuietPaperShapes.controlRadius),
          ),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: colors.primary,
        linearTrackColor: colors.surfaceContainerHighest,
        circularTrackColor: colors.surfaceContainerHighest,
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll<Size>(Size.square(48)),
          iconColor: WidgetStatePropertyAll<Color>(colors.onSurfaceVariant),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: colors.onSurfaceVariant,
        textColor: colors.onSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        minTileHeight: 48,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      ),
    );
  }
}

const _transparent = Color(0x00000000);
const _modalScrim = Color(0x99000000);

final _lightScheme =
    ColorScheme.fromSeed(
      seedColor: const Color(0xFF1457D9),
      brightness: Brightness.light,
    ).copyWith(
      primary: const Color(0xFF1457D9),
      onPrimary: const Color(0xFFFFFFFF),
      primaryContainer: const Color(0xFFE8F0FF),
      onPrimaryContainer: const Color(0xFF0B327F),
      secondary: const Color(0xFF566176),
      onSecondary: const Color(0xFFFFFFFF),
      secondaryContainer: const Color(0xFFFFF1D6),
      onSecondaryContainer: const Color(0xFF633A00),
      tertiary: const Color(0xFF257A4B),
      onTertiary: const Color(0xFFFFFFFF),
      tertiaryContainer: const Color(0xFFE5F3EA),
      onTertiaryContainer: const Color(0xFF184F32),
      error: const Color(0xFFB42332),
      onError: const Color(0xFFFFFFFF),
      errorContainer: const Color(0xFFFFE7E8),
      onErrorContainer: const Color(0xFF751722),
      surface: const Color(0xFFF7F6F2),
      onSurface: const Color(0xFF172033),
      surfaceContainerLowest: const Color(0xFFFFFFFF),
      surfaceContainerLow: const Color(0xFFF1F3F7),
      surfaceContainer: const Color(0xFFEDF0F5),
      surfaceContainerHigh: const Color(0xFFE8EBF1),
      surfaceContainerHighest: const Color(0xFFE2E6ED),
      onSurfaceVariant: const Color(0xFF566176),
      outline: const Color(0xFF8A93A5),
      outlineVariant: const Color(0xFFD7DCE5),
      inverseSurface: const Color(0xFF202A3D),
      onInverseSurface: const Color(0xFFF7F6F2),
      inversePrimary: const Color(0xFFAFC6FF),
      shadow: const Color(0xFF172033),
      scrim: const Color(0xFF000000),
      surfaceTint: _transparent,
    );

const _lightSemanticColors = QuietPaperColors(
  success: Color(0xFF257A4B),
  onSuccess: Color(0xFFFFFFFF),
  successContainer: Color(0xFFE5F3EA),
  onSuccessContainer: Color(0xFF184F32),
  warning: Color(0xFF9A5A00),
  onWarning: Color(0xFFFFFFFF),
  warningContainer: Color(0xFFFFF1D6),
  onWarningContainer: Color(0xFF633A00),
  info: Color(0xFF1457D9),
  onInfo: Color(0xFFFFFFFF),
  infoContainer: Color(0xFFE8F0FF),
  onInfoContainer: Color(0xFF0B327F),
  terminalCanvas: Color(0xFFFFFFFF),
  terminalSurface: Color(0xFFF7F6F2),
  terminalForeground: Color(0xFF000000),
  terminalMuted: Color(0xFF566176),
  terminalCursor: Color(0xFF000000),
  terminalSelection: Color(0xFFBBDEFB),
);

final _darkScheme =
    ColorScheme.fromSeed(
      seedColor: const Color(0xFF8FB2FF),
      brightness: Brightness.dark,
    ).copyWith(
      primary: const Color(0xFF9AB9FF),
      onPrimary: const Color(0xFF08245B),
      primaryContainer: const Color(0xFF183B75),
      onPrimaryContainer: const Color(0xFFDCE6FF),
      secondary: const Color(0xFFB7C0D2),
      onSecondary: const Color(0xFF263044),
      secondaryContainer: const Color(0xFF4A3618),
      onSecondaryContainer: const Color(0xFFFFDDA5),
      tertiary: const Color(0xFF83D7A6),
      onTertiary: const Color(0xFF073821),
      tertiaryContainer: const Color(0xFF174D31),
      onTertiaryContainer: const Color(0xFFB5F1CA),
      error: const Color(0xFFFFB3B8),
      onError: const Color(0xFF650F1D),
      errorContainer: const Color(0xFF742630),
      onErrorContainer: const Color(0xFFFFDADB),
      surface: const Color(0xFF0F1726),
      onSurface: const Color(0xFFF4F6FA),
      surfaceContainerLowest: const Color(0xFF151F31),
      surfaceContainerLow: const Color(0xFF1B273B),
      surfaceContainer: const Color(0xFF202D43),
      surfaceContainerHigh: const Color(0xFF26354D),
      surfaceContainerHighest: const Color(0xFF2E3E58),
      onSurfaceVariant: const Color(0xFFB7C0D2),
      outline: const Color(0xFF8793A8),
      outlineVariant: const Color(0xFF43516A),
      inverseSurface: const Color(0xFFF1F3F7),
      onInverseSurface: const Color(0xFF172033),
      inversePrimary: const Color(0xFF1457D9),
      shadow: const Color(0xFF000000),
      scrim: const Color(0xFF000000),
      surfaceTint: _transparent,
    );

const _darkSemanticColors = QuietPaperColors(
  success: Color(0xFF83D7A6),
  onSuccess: Color(0xFF073821),
  successContainer: Color(0xFF174D31),
  onSuccessContainer: Color(0xFFB5F1CA),
  warning: Color(0xFFFFC46B),
  onWarning: Color(0xFF4C2C00),
  warningContainer: Color(0xFF4A3618),
  onWarningContainer: Color(0xFFFFDDA5),
  info: Color(0xFF9AB9FF),
  onInfo: Color(0xFF08245B),
  infoContainer: Color(0xFF183B75),
  onInfoContainer: Color(0xFFDCE6FF),
  terminalCanvas: Color(0xFF050D19),
  terminalSurface: Color(0xFF0A1626),
  terminalForeground: Color(0xFFF0F4FA),
  terminalMuted: Color(0xFFB5C0D0),
  terminalCursor: Color(0xFFFFFFFF),
  terminalSelection: Color(0xFF385B82),
);
