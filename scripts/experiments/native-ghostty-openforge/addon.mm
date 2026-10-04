// Development-only, main-process N-API bridge. A native crash terminates Electron.
#import "NativeView.h"
#include <node_api.h>
#include <atomic>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include <unordered_set>
#include <uv.h>

namespace {
void check(napi_status status) { if (status != napi_ok) throw std::runtime_error("Invalid native bridge argument or N-API operation"); }
napi_value number(napi_env env, double value) { napi_value result; check(napi_create_double(env, value, &result)); return result; }
napi_value boolean(napi_env env, bool value) { napi_value result; check(napi_get_boolean(env, value, &result)); return result; }
napi_value object(napi_env env) { napi_value result; check(napi_create_object(env, &result)); return result; }
napi_value string(napi_env env, const char *value) { napi_value result; check(napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result)); return result; }
void put(napi_env env, napi_value obj, const char *key, napi_value value) { check(napi_set_named_property(env, obj, key, value)); }
napi_value get(napi_env env, napi_value obj, const char *key) { napi_value result; check(napi_get_named_property(env, obj, key, &result)); return result; }
double scalar(napi_env env, napi_value value) { double result; check(napi_get_value_double(env, value, &result)); if (!std::isfinite(result)) throw std::runtime_error("Expected finite number"); return result; }
uint64_t integer(napi_env env, napi_value value) { double result = scalar(env, value); if (result < 0 || result > 9007199254740991.0 || std::floor(result) != result) throw std::runtime_error("Expected safe unsigned integer"); return (uint64_t)result; }
struct Bytes { uint8_t *data; size_t size; };
Bytes bytes(napi_env env, napi_value value) { void *data; size_t size; check(napi_get_buffer_info(env, value, &data, &size)); return {(uint8_t *)data, size}; }
napi_value buffer(napi_env env, const void *data, size_t size) { napi_value result; check(napi_create_buffer_copy(env, size, data, nullptr, &result)); return result; }

struct Attachment {
    uint64_t id = 0, token = 0;
    ghostty_surface_t surface = nullptr;
    OFGhosttyView *__strong view = nil;
    napi_threadsafe_function events = nullptr;
    std::atomic<bool> inputFailed{false};
    std::atomic<bool> outputRunning{false};
    bool retiring = false; // Main-thread-only logical destruction.
    void close() {
        view.surface = nullptr;
        if (surface) { ghostty_surface_free(surface); surface = nullptr; }
        [view removeFromSuperview];
    }
    ~Attachment() { close(); }
};
struct OutputWork {
    std::shared_ptr<Attachment> attachment;
    std::vector<uint8_t> data;
    uint64_t token, offset;
    napi_async_work work = nullptr;
    napi_deferred deferred = nullptr;
    bool accepted = false;
};
struct State {
    ghostty_app_t app = nullptr;
    napi_threadsafe_function events = nullptr;
    uint64_t nextId = 1;
    std::unordered_map<uint64_t, std::shared_ptr<Attachment>> attachments;
    std::unordered_set<OutputWork *> pending;
    bool closing = false;
    napi_async_cleanup_hook_handle cleanupHook = nullptr;
    uv_loop_t *loop = nullptr;
    uv_async_t wakeup = {};
};
State *active = nullptr;
bool initializedOnce = false;
struct InputEvent { uint64_t id, token; std::vector<uint8_t> data; };
void deliver(napi_env env, napi_value callback, void *, void *payload) {
    std::unique_ptr<InputEvent> event((InputEvent *)payload);
    if (!env || !active || active->closing) return;
    auto found = active->attachments.find(event->id);
    if (found == active->attachments.end() || found->second->token != event->token || found->second->retiring) return;
    try {
        napi_value value = object(env), receiver, result;
        const bool failed = found->second->inputFailed.load();
        put(env, value, "kind", string(env, failed ? "error" : "input"));
        put(env, value, "id", number(env, event->id));
        put(env, value, "token", number(env, event->token));
        put(env, value, "data", buffer(env, event->data.data(), event->data.size()));
        check(napi_get_undefined(env, &receiver));
        check(napi_call_function(env, receiver, callback, 1, &value, &result));
    } catch (const std::exception &error) { napi_throw_error(env, nullptr, error.what()); }
}
void hostWrite(void *userdata, const uint8_t *data, size_t size) {
    auto *attachment = (Attachment *)userdata;
    if (attachment->inputFailed.load()) return;
    try {
        if (size > 65536) throw std::runtime_error("Native input chunk exceeds limit");
        auto event = std::make_unique<InputEvent>();
        event->id = attachment->id; event->token = attachment->token;
        event->data.assign(data, data + size);
        if (napi_call_threadsafe_function(attachment->events, event.get(), napi_tsfn_nonblocking) == napi_ok) event.release();
        else attachment->inputFailed.store(true);
    } catch (...) { attachment->inputFailed.store(true); }
}
void wakeup(void *userdata) { uv_async_send(&((State *)userdata)->wakeup); }
bool action(ghostty_app_t, ghostty_target_s target, ghostty_action_s value) {
    if (value.tag == GHOSTTY_ACTION_RENDER && target.tag == GHOSTTY_TARGET_SURFACE) {
        // Callbacks can run under native locks or off-main. Never reenter Ghostty.
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!active) return;
            for (auto &entry : active->attachments) {
                if (!entry.second->retiring) [entry.second->view setNeedsDisplay:YES];
            }
        });
        return true;
    }
    return false;
}
bool readClipboard(void *, ghostty_clipboard_e, void *) { return false; }
void confirmClipboard(void *, const char *, void *, ghostty_clipboard_request_e) {}
void writeClipboard(void *, ghostty_clipboard_e, const ghostty_clipboard_content_s *, size_t, bool) {}
void finishCleanup(State *state) {
    active = nullptr;
    state->attachments.clear();
    if (state->app) ghostty_app_free(state->app);
    state->app = nullptr;
    napi_release_threadsafe_function(state->events, napi_tsfn_abort);
    uv_close((uv_handle_t *)&state->wakeup, [](uv_handle_t *handle) {
        auto *finished = (State *)handle->data;
        if (finished->cleanupHook) napi_remove_async_cleanup_hook(finished->cleanupHook);
        delete finished;
    });
}
void cleanup(napi_async_cleanup_hook_handle, void *userdata) {
    auto *state = (State *)userdata;
    state->closing = true;
    for (auto &entry : state->attachments) {
        entry.second->retiring = true; entry.second->view.surface = nullptr; entry.second->view.hidden = YES;
    }
    // libuv keeps draining during Electron shutdown, after AppKit stops doing so.
    uv_ref((uv_handle_t *)&state->wakeup);
    uv_async_send(&state->wakeup);
}
struct Bounds { double x, y, width, height, scale; bool visible; };
Bounds bounds(napi_env env, napi_value value) {
    Bounds result;
    result.x = scalar(env, get(env, value, "x")); result.y = scalar(env, get(env, value, "y"));
    result.width = scalar(env, get(env, value, "width")); result.height = scalar(env, get(env, value, "height"));
    result.scale = scalar(env, get(env, value, "scale"));
    check(napi_get_value_bool(env, get(env, value, "visible"), &result.visible));
    if (result.scale <= 0 || result.scale > 4 || result.width < 1 || result.height < 1 || result.width * result.scale > 16384 || result.height * result.scale > 16384)
        throw std::runtime_error("Invalid native bounds");
    return result;
}
void place(Attachment &attachment, NSView *parent, Bounds rect) {
    attachment.view.frame = NSMakeRect(rect.x, parent.isFlipped ? rect.y : parent.bounds.size.height - rect.y - rect.height, rect.width, rect.height);
    attachment.view.hidden = !rect.visible;
    if (attachment.surface) {
        ghostty_surface_set_content_scale(attachment.surface, rect.scale, rect.scale);
        ghostty_surface_set_size(attachment.surface, (uint32_t)(rect.width * rect.scale), (uint32_t)(rect.height * rect.scale));
        ghostty_surface_set_occlusion(attachment.surface, rect.visible);
    }
}
Attachment &find(uint64_t id) {
    if (!active) throw std::runtime_error("Native bridge is not initialized");
    auto found = active->attachments.find(id);
    if (found == active->attachments.end()) throw std::runtime_error("Unknown native attachment");
    if (found->second->retiring) throw std::runtime_error("Native attachment destroyed");
    if (found->second->outputRunning.load()) throw std::runtime_error("Native output pending");
    if (found->second->inputFailed.load()) throw std::runtime_error("Native input queue failed; detach required");
    return *found->second;
}
void executeOutput(napi_env, void *payload) {
    auto *work = (OutputWork *)payload;
    work->accepted = ghostty_surface_hosted_output(work->attachment->surface, work->token, work->offset, work->data.data(), work->data.size());
    work->attachment->outputRunning.store(false);
}
void completeOutput(napi_env env, napi_status status, void *payload) {
    std::unique_ptr<OutputWork> work((OutputWork *)payload);
    if (active) {
        active->pending.erase(work.get());
        if (work->attachment->retiring) active->attachments.erase(work->attachment->id);
    }
    if (!env) { if (active && active->closing) uv_async_send(&active->wakeup); return; }
    if (active && active->closing) {
        napi_delete_async_work(env, work->work);
        uv_async_send(&active->wakeup);
        return;
    }
    try {
        napi_value result;
        if (status == napi_ok && work->accepted && !work->attachment->retiring) {
            check(napi_get_undefined(env, &result));
            check(napi_resolve_deferred(env, work->deferred, result));
        } else {
            check(napi_create_error(env, nullptr, string(env, work->attachment->retiring ? "Native attachment destroyed" : "Native output rejected"), &result));
            check(napi_reject_deferred(env, work->deferred, result));
        }
        check(napi_delete_async_work(env, work->work));
    } catch (const std::exception &error) { napi_throw_error(env, nullptr, error.what()); }
}

enum Operation { Initialize, Create, Append, Inspect, Snapshot, History, Destroy, SetBounds, SubmitText, Focus, AppendAsync, PressKey, Hide };
napi_value call(napi_env env, napi_callback_info info) {
    try {
        if (![NSThread isMainThread]) throw std::runtime_error("Native bridge requires Electron's main thread");
        napi_value args[4], result; size_t count = 4; void *operation;
        check(napi_get_cb_info(env, info, &count, args, nullptr, &operation));
        const Operation op = (Operation)(uintptr_t)operation;
        const size_t arity[] = {1, 4, 4, 1, 1, 1, 1, 2, 2, 1, 4, 2, 1};
        if (count != arity[op]) throw std::runtime_error("Wrong native bridge argument count");
        check(napi_get_undefined(env, &result));
        if (op == Initialize) {
            if (initializedOnce || !NSApp) throw std::runtime_error("Initialize once, after Electron app readiness");
            initializedOnce = true;
            napi_threadsafe_function events;
            check(napi_create_threadsafe_function(env, args[0], nullptr, string(env, "Ghostty input"), 1024, 1, nullptr, nullptr, nullptr, deliver, &events));
            char name[] = "openforge-native-experiment"; char *argv[] = {name, nullptr};
            if (ghostty_init(1, argv) != GHOSTTY_SUCCESS) {
                napi_release_threadsafe_function(events, napi_tsfn_abort);
                throw std::runtime_error("Ghostty initialization failed");
            }
            auto *state = new State(); state->events = events;
            if (napi_get_uv_event_loop(env, &state->loop) != napi_ok || uv_async_init(state->loop, &state->wakeup, [](uv_async_t *handle) {
                auto *current = (State *)handle->data;
                if (current->app) ghostty_app_tick(current->app);
                if (current->closing && current->pending.empty()) finishCleanup(current);
            }) != 0) {
                napi_release_threadsafe_function(events, napi_tsfn_abort); delete state;
                throw std::runtime_error("Cannot initialize native wakeup");
            }
            state->wakeup.data = state;
            uv_unref((uv_handle_t *)&state->wakeup);
            ghostty_runtime_config_s runtime = {}; runtime.userdata = state;
            runtime.wakeup_cb = wakeup; runtime.action_cb = action;
            runtime.read_clipboard_cb = readClipboard; runtime.confirm_read_clipboard_cb = confirmClipboard; runtime.write_clipboard_cb = writeClipboard;
            ghostty_config_t config = ghostty_config_new();
            ghostty_config_finalize(config);
            state->app = ghostty_app_new(&runtime, config);
            ghostty_config_free(config);
            if (!state->app) { finishCleanup(state); throw std::runtime_error("Ghostty app initialization failed"); }
            if (napi_add_async_cleanup_hook(env, cleanup, state, &state->cleanupHook) != napi_ok) {
                finishCleanup(state); throw std::runtime_error("Cannot register native cleanup");
            }
            active = state;
            return result;
        }
        if (!active || active->closing) throw std::runtime_error("Native bridge is not initialized");
        if (op == Create) {
            const Bytes handle = bytes(env, args[0]), snapshot = bytes(env, args[3]);
            if (handle.size != sizeof(void *) || snapshot.size > 128 * 1024 * 1024) throw std::runtime_error("Invalid native create buffer");
            void *pointer; memcpy(&pointer, handle.data, sizeof(pointer));
            NSView *parent = (__bridge NSView *)pointer; // Main-process-only Electron handle, never renderer-supplied.
            if (!parent || ![parent isKindOfClass:NSView.class] || !parent.window) throw std::runtime_error("Invalid Electron window handle");
            if (active->attachments.size() >= 16) throw std::runtime_error("Native surface limit reached");
            auto attachment = std::make_shared<Attachment>();
            attachment->id = active->nextId++; attachment->token = integer(env, args[1]); attachment->events = active->events;
            if (!attachment->token) throw std::runtime_error("Owner token must be nonzero");
            const Bounds rect = bounds(env, args[2]);
            attachment->view = [[OFGhosttyView alloc] initWithFrame:NSMakeRect(0, 0, rect.width, rect.height)];
            ghostty_surface_config_s config = ghostty_surface_config_new();
            config.platform_tag = GHOSTTY_PLATFORM_MACOS; config.platform.macos.nsview = (__bridge void *)attachment->view;
            config.scale_factor = rect.scale; config.userdata = attachment.get();
            bool hasFontSize = false; check(napi_has_named_property(env, args[2], "fontSize", &hasFontSize));
            if (hasFontSize) {
                double fontSize = scalar(env, get(env, args[2], "fontSize"));
                if (fontSize < 6 || fontSize > 288) throw std::runtime_error("Invalid native font size");
                config.font_size = (float)fontSize;
            }
            ghostty_host_config_s host = {};
            host.userdata = attachment.get(); host.owner_token = attachment->token;
            host.width_px = (uint32_t)(rect.width * rect.scale); host.height_px = (uint32_t)(rect.height * rect.scale);
            host.snapshot = snapshot.size ? snapshot.data : nullptr; host.snapshot_len = snapshot.size; host.write_cb = hostWrite;
            host.protocol_replies = false;
            attachment->surface = ghostty_surface_new_hosted(active->app, &config, &host);
            if (!attachment->surface) throw std::runtime_error("Cannot create native surface");
            attachment->view.surface = attachment->surface;
            place(*attachment, parent, rect);
            [parent addSubview:attachment->view];
            result = object(env); put(env, result, "id", number(env, attachment->id));
            active->attachments.emplace(attachment->id, std::move(attachment));
            return result;
        }
        const uint64_t id = integer(env, args[0]);
        if (op == Destroy) {
            auto found = active->attachments.find(id);
            if (found == active->attachments.end() || found->second->retiring) return boolean(env, false);
            auto &owner = *found->second;
            owner.retiring = true; owner.view.surface = nullptr; owner.view.hidden = YES;
            [owner.view removeFromSuperview];
            if (!owner.outputRunning.load()) active->attachments.erase(found);
            return boolean(env, true);
        }
        if (op == Hide) {
            auto found = active->attachments.find(id);
            if (found == active->attachments.end()) throw std::runtime_error("Unknown native attachment");
            found->second->view.hidden = YES;
            return result;
        }
        Attachment &attachment = find(id);
        switch (op) {
            case AppendAsync: {
                Bytes data = bytes(env, args[3]);
                if (data.size > 4 * 1024 * 1024) throw std::runtime_error("Native output exceeds limit");
                auto work = std::make_unique<OutputWork>();
                work->attachment = active->attachments.at(id);
                work->token = integer(env, args[1]); work->offset = integer(env, args[2]);
                work->data.assign(data.data, data.data + data.size);
                check(napi_create_promise(env, &work->deferred, &result));
                check(napi_create_async_work(env, nullptr, string(env, "Ghostty output"), executeOutput, completeOutput, work.get(), &work->work));
                active->pending.insert(work.get());
                attachment.outputRunning.store(true);
                const napi_status queued = napi_queue_async_work(env, work->work);
                if (queued != napi_ok) {
                    attachment.outputRunning.store(false); active->pending.erase(work.get());
                    napi_delete_async_work(env, work->work); check(queued);
                }
                work.release();
                break;
            }
            case Append: {
                Bytes data = bytes(env, args[3]);
                if (data.size > 4 * 1024 * 1024 || !ghostty_surface_hosted_output(attachment.surface, integer(env, args[1]), integer(env, args[2]), data.data, data.size))
                    throw std::runtime_error("Native output rejected");
                break;
            }
            case Inspect: {
                ghostty_selection_s selection = {};
                selection.top_left.tag = GHOSTTY_POINT_ACTIVE; selection.top_left.coord = GHOSTTY_POINT_COORD_TOP_LEFT;
                selection.bottom_right.tag = GHOSTTY_POINT_ACTIVE; selection.bottom_right.coord = GHOSTTY_POINT_COORD_BOTTOM_RIGHT;
                ghostty_text_s text = {};
                if (!ghostty_surface_read_text(attachment.surface, selection, &text)) throw std::runtime_error("Native text unavailable");
                napi_value content; napi_status status = napi_create_string_utf8(env, text.text, text.text_len, &content);
                ghostty_surface_free_text(attachment.surface, &text); check(status);
                auto size = ghostty_surface_size(attachment.surface);
                result = object(env); put(env, result, "text", content);
                put(env, result, "columns", number(env, size.columns)); put(env, result, "rows", number(env, size.rows));
                put(env, result, "cellWidth", number(env, size.cell_width_px)); put(env, result, "cellHeight", number(env, size.cell_height_px));
                ghostty_host_grid_s grid = {};
                if (!ghostty_surface_hosted_grid(attachment.surface, &grid)) throw std::runtime_error("Native grid unavailable");
                put(env, result, "terminalColumns", number(env, grid.columns)); put(env, result, "terminalRows", number(env, grid.rows));
                put(env, result, "visible", boolean(env, !attachment.view.hidden));
                break;
            }
            case Snapshot: {
                ghostty_string_s value = {};
                if (!ghostty_surface_hosted_snapshot(attachment.surface, &value)) throw std::runtime_error("Native checkpoint incomplete or image-bearing");
                napi_status status = napi_create_buffer_copy(env, value.len, value.ptr, nullptr, &result);
                ghostty_string_free(value); check(status); break;
            }
            case History: {
                ghostty_host_history_s history = {};
                if (!ghostty_surface_hosted_next_history(attachment.surface, &history)) throw std::runtime_error("Native history failed");
                result = object(env); put(env, result, "finished", boolean(env, history.finished));
                put(env, result, "rowsApplied", number(env, history.rows_applied)); put(env, result, "historyLost", boolean(env, history.history_lost)); break;
            }
            case PressKey: {
                const uint64_t keycode = integer(env, args[1]);
                if (keycode > 127) throw std::runtime_error("Invalid macOS key code");
                ghostty_input_key_s key = {}; key.action = GHOSTTY_ACTION_PRESS; key.keycode = (uint32_t)keycode;
                ghostty_surface_key(attachment.surface, key);
                break;
            }
            case Focus:
                if (!attachment.view.hidden) [attachment.view.window makeFirstResponder:attachment.view];
                break;
            case SetBounds: place(attachment, attachment.view.superview, bounds(env, args[1])); break;
            case SubmitText: {
                size_t length; check(napi_get_value_string_utf8(env, args[1], nullptr, 0, &length));
                if (length > 65536) throw std::runtime_error("Native text exceeds input limit");
                std::vector<char> text(length + 1); check(napi_get_value_string_utf8(env, args[1], text.data(), text.size(), &length));
                ghostty_surface_text(attachment.surface, text.data(), length); break;
            }
            default: throw std::runtime_error("Unknown native operation");
        }
        return result;
    } catch (const std::exception &error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
}
napi_value initializeModule(napi_env env, napi_value exports) {
    const char *names[] = {"initialize", "create", "append", "inspect", "snapshot", "nextHistory", "destroy", "setBounds", "submitText", "focus", "appendAsync", "pressKey", "hide"};
    for (uintptr_t index = 0; index < sizeof(names) / sizeof(names[0]); index++) {
        napi_property_descriptor property = {names[index], nullptr, call, nullptr, nullptr, nullptr, napi_default, (void *)index};
        if (napi_define_properties(env, exports, 1, &property) != napi_ok) return nullptr;
    }
    return exports;
}
} // namespace
NAPI_MODULE(openforge_ghostty, initializeModule)
