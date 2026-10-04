// Exercises native Surface input and reply separation. No PTY and no pixel claim.
#import <AppKit/AppKit.h>
#import "ghostty-hosted.h"
#include <string.h>

static ghostty_app_t app;
static NSMutableData *writes;
static void wakeup(void *userdata) {
    (void)userdata;
    dispatch_async(dispatch_get_main_queue(), ^{ if (app) ghostty_app_tick(app); });
}
static bool action(ghostty_app_t owner, ghostty_target_s target, ghostty_action_s value) {
    (void)owner; (void)target; (void)value;
    return false;
}
static bool readClipboard(void *userdata, ghostty_clipboard_e kind, void *request) {
    (void)userdata; (void)kind; (void)request;
    return false;
}
static void confirmClipboard(void *userdata, const char *text, void *request, ghostty_clipboard_request_e kind) {
    (void)userdata; (void)text; (void)request; (void)kind;
}
static void writeClipboard(void *userdata, ghostty_clipboard_e kind, const ghostty_clipboard_content_s *contents, size_t count, bool confirm) {
    (void)userdata; (void)kind; (void)contents; (void)count; (void)confirm;
}
static void hostWrite(void *userdata, const uint8_t *bytes, size_t count) {
    (void)userdata;
    @synchronized (writes) { [writes appendBytes:bytes length:count]; }
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (ghostty_init(argc, argv) != GHOSTTY_SUCCESS) return 1;
        [NSApplication sharedApplication];
        writes = [NSMutableData new];
        ghostty_runtime_config_s runtime = {
            .wakeup_cb = wakeup, .action_cb = action,
            .read_clipboard_cb = readClipboard,
            .confirm_read_clipboard_cb = confirmClipboard,
            .write_clipboard_cb = writeClipboard,
        };
        ghostty_config_t config = ghostty_config_new();
        ghostty_config_finalize(config);
        app = ghostty_app_new(&runtime, config);
        ghostty_config_free(config);
        if (!app) return 2;
        NSView *view __attribute__((objc_precise_lifetime)) = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 640, 400)];
        ghostty_surface_config_s options = ghostty_surface_config_new();
        options.platform_tag = GHOSTTY_PLATFORM_MACOS;
        options.platform.macos.nsview = (__bridge void *)view;
        options.scale_factor = 1;
        ghostty_host_config_s host = {
            .owner_token = 1, .width_px = 640, .height_px = 400,
            .write_cb = hostWrite, .protocol_replies = false,
        };
        ghostty_surface_t surface = ghostty_surface_new_hosted(app, &options, &host);
        if (!surface) { ghostty_app_free(app); app = NULL; return 3; }
        const char *queries = "\x1b[6n\x1b[c\x1b[>c\x1b]10;?\x07\x1b[21t\x1b[?1004h\x1b[?2048h";
        __block bool accepted = false;
        dispatch_group_t output = dispatch_group_create();
        dispatch_group_async(output, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            accepted = ghostty_surface_hosted_output(surface, 1, 0, (const uint8_t *)queries, strlen(queries));
        });
        NSDate *outputDeadline = [NSDate dateWithTimeIntervalSinceNow:5];
        while (dispatch_group_wait(output, DISPATCH_TIME_NOW) != 0) {
            if (outputDeadline.timeIntervalSinceNow <= 0) { fprintf(stderr, "native-authority: output timed out\n"); _Exit(5); }
            ghostty_app_tick(app);
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
        }
        ghostty_surface_set_focus(surface, true);
        ghostty_surface_set_size(surface, 650, 410);
        ghostty_surface_text(surface, "typed", 5);
        ghostty_input_key_s key = { .action = GHOSTTY_ACTION_PRESS, .keycode = 0, .text = "a", .unshifted_codepoint = 'a' };
        ghostty_surface_key(surface, key);
        // Service native app callbacks. This is neither a frame fence nor a presentation test.
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
        while (deadline.timeIntervalSinceNow > 0) {
            ghostty_app_tick(app);
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        }
        ghostty_surface_free(surface); // Joins I/O before inspecting the final callback buffer.
        ghostty_app_free(app);
        app = NULL;
        NSData *expected = [@"typeda" dataUsingEncoding:NSUTF8StringEncoding];
        bool passed = accepted && [writes isEqualToData:expected];
        fprintf(stderr, "native-authority: %s; callback bytes=%lu, expected=6\n", passed ? "PASS" : "FAIL", (unsigned long)writes.length);
        return passed ? 0 : 4;
    }
}
