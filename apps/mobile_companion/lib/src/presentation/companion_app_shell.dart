import 'package:flutter/material.dart';

import '../design_system/quiet_paper_theme.dart';

class CompanionAppShell extends StatelessWidget {
  const CompanionAppShell({
    required this.navigatorKey,
    required this.home,
    super.key,
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final Widget home;

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: navigatorKey,
    debugShowCheckedModeBanner: false,
    title: 'OpenForge Companion',
    theme: QuietPaperTheme.light,
    darkTheme: QuietPaperTheme.dark,
    themeMode: ThemeMode.system,
    home: home,
  );
}
