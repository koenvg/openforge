# Expose Task Browser DevTools through the browser-surface capability

Task Browser DevTools are available in packaged builds through typed controls on each Trusted Plugin's own Task Browser Surfaces rather than through an exception for the built-in Browser plugin. This keeps built-in and external Trusted Plugins on the same capability contract and preserves host-enforced surface ownership; opening DevTools only after an explicit user action remains a Trusted Plugin UX obligation because the host cannot reliably prove renderer gesture provenance across the plugin and IPC boundaries.
