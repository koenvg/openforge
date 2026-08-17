use super::*;

mod callbacks;
mod lifecycle;
mod transport;

fn build_plugin_host() -> PluginHost {
    PluginHost::new(AppHandle::new())
}
