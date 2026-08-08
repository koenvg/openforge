import 'package:flutter/material.dart';

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
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      useMaterial3: true,
    ),
    darkTheme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: Colors.indigo,
        brightness: Brightness.dark,
      ),
      useMaterial3: true,
    ),
    themeMode: ThemeMode.system,
    home: home,
  );
}
