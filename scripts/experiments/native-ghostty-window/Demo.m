// An isolated native-renderer fixture demo. No shell or OpenForge session.
#import <AppKit/AppKit.h>
#import <ghostty-hosted.h>

@class Demo;
@interface Attachment : NSObject
@property(nonatomic, weak) Demo *owner;
@property(nonatomic) uint64_t token;
@end
@implementation Attachment
@end

@interface TerminalView : NSView
@property(nonatomic) ghostty_surface_t surface;
@end

@interface Demo : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(nonatomic) ghostty_app_t app;
@property(nonatomic) ghostty_surface_t surface;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSStackView *stack;
@property(nonatomic, strong) TerminalView *terminal;
@property(nonatomic, strong) Attachment *attachment;
@property(nonatomic, strong) NSTextField *status;
@property(nonatomic, strong) NSButton *liveButton;
@property(nonatomic, strong) NSButton *stepButton;
@property(nonatomic, strong) NSButton *loadButton;
@property(nonatomic, strong) NSTimer *liveTimer;
@property(nonatomic, strong) NSTimer *historyTimer;
@property(nonatomic) uint64_t token;
@property(nonatomic) uint64_t offset;
@property(nonatomic) uint64_t liveSequence;
@property(nonatomic) NSUInteger inputBytes;
@property(nonatomic) uint64_t rowsLoaded;
@property(nonatomic) BOOL pendingHistory;
@property(nonatomic) BOOL selfTest;
@property(nonatomic) BOOL closed;
- (BOOL)feed:(NSString *)text;
- (void)setMessage:(NSString *)text;
- (void)fail:(NSString *)message;
- (BOOL)replaceWithSnapshot:(const ghostty_string_s *)snapshot;
- (BOOL)restoreCheckpoint;
- (BOOL)loadPage;
- (NSString *)activeText;
- (void)shutdown;
@end

static Demo *application;
static int exitCode;

static ghostty_input_mods_e modifiers(NSEventModifierFlags flags) {
    unsigned result = 0;
    if (flags & NSEventModifierFlagShift) result |= GHOSTTY_MODS_SHIFT;
    if (flags & NSEventModifierFlagControl) result |= GHOSTTY_MODS_CTRL;
    if (flags & NSEventModifierFlagOption) result |= GHOSTTY_MODS_ALT;
    if (flags & NSEventModifierFlagCommand) result |= GHOSTTY_MODS_SUPER;
    if (flags & NSEventModifierFlagCapsLock) result |= GHOSTTY_MODS_CAPS;
    return result;
}

@implementation TerminalView
- (BOOL)acceptsFirstResponder { return YES; }
- (BOOL)isFlipped { return YES; }
- (BOOL)wantsUpdateLayer { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { (void)event; return YES; }
- (BOOL)becomeFirstResponder {
    if (self.surface) ghostty_surface_set_focus(self.surface, true);
    return YES;
}
- (BOOL)resignFirstResponder {
    if (self.surface) ghostty_surface_set_focus(self.surface, false);
    return YES;
}
- (void)updateLayer {
    if (self.surface) ghostty_surface_draw(self.surface);
}
- (void)setFrameSize:(NSSize)size {
    [super setFrameSize:size];
    if (self.surface && size.width > 0 && size.height > 0) {
        double scale = self.window.backingScaleFactor ?: 2;
        ghostty_surface_set_size(self.surface, (uint32_t)(size.width * scale), (uint32_t)(size.height * scale));
    }
}
- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    if (self.surface) {
        double scale = self.window.backingScaleFactor;
        ghostty_surface_set_content_scale(self.surface, scale, scale);
        [self setFrameSize:self.frame.size];
    }
}
- (void)keyDown:(NSEvent *)event {
    if (!self.surface) return;
    NSString *text = event.characters ?: @"";
    NSString *plain = event.charactersIgnoringModifiers ?: @"";
    ghostty_input_key_s key = {
        .action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS,
        .mods = modifiers(event.modifierFlags),
        .keycode = event.keyCode,
        .text = text.length && [text characterAtIndex:0] >= 0x20 ? text.UTF8String : NULL,
        .unshifted_codepoint = plain.length ? [plain characterAtIndex:0] : 0,
    };
    ghostty_surface_key(self.surface, key);
}
- (void)keyUp:(NSEvent *)event {
    if (!self.surface) return;
    ghostty_input_key_s key = { .action = GHOSTTY_ACTION_RELEASE, .mods = modifiers(event.modifierFlags), .keycode = event.keyCode };
    ghostty_surface_key(self.surface, key);
}
- (void)mouseMoved:(NSEvent *)event {
    if (!self.surface) return;
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, modifiers(event.modifierFlags));
}
- (void)mouseDown:(NSEvent *)event {
    [self.window makeFirstResponder:self];
    [self mouseMoved:event];
    if (self.surface) ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, modifiers(event.modifierFlags));
}
- (void)mouseDragged:(NSEvent *)event { [self mouseMoved:event]; }
- (void)mouseUp:(NSEvent *)event {
    [self mouseMoved:event];
    if (self.surface) ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, modifiers(event.modifierFlags));
}
- (void)scrollWheel:(NSEvent *)event {
    if (self.surface) ghostty_surface_mouse_scroll(self.surface, event.scrollingDeltaX, event.scrollingDeltaY, event.hasPreciseScrollingDeltas ? 1 : 0);
}
@end

static void wakeup(void *userdata) {
    Demo *demo = (__bridge Demo *)userdata;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (demo.app && !demo.closed) ghostty_app_tick(demo.app);
    });
}
static bool action(ghostty_app_t app, ghostty_target_s target, ghostty_action_s value) {
    Demo *demo = (__bridge Demo *)ghostty_app_userdata(app);
    if (value.tag == GHOSTTY_ACTION_RENDER) {
        ghostty_surface_t surface = target.tag == GHOSTTY_TARGET_SURFACE ? target.target.surface : NULL;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!demo.closed && demo.surface == surface) demo.terminal.needsDisplay = YES;
        });
        return true;
    }
    if (value.tag == GHOSTTY_ACTION_RENDERER_HEALTH && value.action.renderer_health == GHOSTTY_RENDERER_HEALTH_UNHEALTHY) {
        ghostty_surface_t surface = target.tag == GHOSTTY_TARGET_SURFACE ? target.target.surface : NULL;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!demo.closed && demo.surface == surface) [demo fail:@"Metal reported an unhealthy frame. Inspect the launch log."];
        });
        return true;
    }
    return false;
}
static ghostty_clipboard_read_result_e readClipboard(void *userdata, ghostty_clipboard_e clipboard, void *request, const char *const *types, size_t count, bool list) {
    (void)userdata; (void)clipboard; (void)request; (void)types; (void)count; (void)list;
    return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED;
}
static void confirmClipboard(void *userdata, const ghostty_clipboard_confirm_s *contents, void *request, ghostty_clipboard_request_e kind) {
    (void)contents; (void)kind;
    Attachment *attachment = (__bridge Attachment *)userdata;
    Demo *demo = attachment.owner;
    if (demo.attachment == attachment && demo.surface) ghostty_surface_deny_clipboard_request(demo.surface, request);
}
static void writeClipboard(void *userdata, ghostty_clipboard_e clipboard, const ghostty_clipboard_content_s *contents, size_t count, bool confirm) {
    (void)userdata; (void)clipboard; (void)contents; (void)count; (void)confirm;
}
static void hostWrite(void *userdata, const uint8_t *bytes, size_t len) {
    (void)bytes;
    Attachment *attachment = (__bridge Attachment *)userdata;
    dispatch_async(dispatch_get_main_queue(), ^{
        Demo *demo = attachment.owner;
        if (!demo.closed && demo.attachment == attachment) {
            demo.inputBytes += len;
            [demo setMessage:[NSString stringWithFormat:@"Native input callback received %zu bytes. Fixture mode, not a shell.", len]];
        }
    });
}
static void hostResize(void *userdata, uint16_t columns, uint16_t rows, uint32_t width, uint32_t height) {
    (void)userdata; (void)columns; (void)rows; (void)width; (void)height;
}

@implementation Demo
- (NSButton *)button:(NSString *)title action:(SEL)selector {
    return [NSButton buttonWithTitle:title target:self action:selector];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1040, 690)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Ghostty native snapshot experiment";
    self.window.minSize = NSMakeSize(980, 480);
    self.window.delegate = self;
    self.window.releasedWhenClosed = NO;
    self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    self.window.acceptsMouseMovedEvents = YES;
    self.liveButton = [NSButton checkboxWithTitle:@"Live output" target:self action:@selector(toggleLive:)];
    self.liveButton.state = self.selfTest ? NSControlStateValueOff : NSControlStateValueOn;
    self.stepButton = [self button:@"Load one page" action:@selector(step:)];
    self.loadButton = [self button:@"Load remaining" action:@selector(loadAll:)];
    NSStackView *toolbar = [NSStackView stackViewWithViews:@[
        [self button:@"Reset fixture" action:@selector(reset:)],
        [self button:@"Checkpoint & restore" action:@selector(restore:)],
        self.stepButton, self.loadButton,
        [self button:@"Add image" action:@selector(addImage:)], self.liveButton
    ]];
    toolbar.spacing = 8;
    NSTextField *notice = [NSTextField labelWithString:@"Real Ghostty Metal rendering · synthetic host stream · no shell or OpenForge session · clipboard/IME not implemented"];
    notice.font = [NSFont systemFontOfSize:11];
    notice.textColor = NSColor.secondaryLabelColor;
    self.status = [NSTextField labelWithString:@"Starting native renderer…"];
    self.status.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
    self.status.lineBreakMode = NSLineBreakByTruncatingTail;
    self.terminal = [[TerminalView alloc] initWithFrame:NSMakeRect(0, 0, 1016, 590)];
    self.stack = [NSStackView stackViewWithViews:@[toolbar, notice, self.terminal, self.status]];
    self.stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    self.stack.alignment = NSLayoutAttributeLeading;
    self.stack.spacing = 8;
    self.stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.window.contentView addSubview:self.stack];
    [NSLayoutConstraint activateConstraints:@[
        [self.stack.leadingAnchor constraintEqualToAnchor:self.window.contentView.leadingAnchor constant:12],
        [self.stack.trailingAnchor constraintEqualToAnchor:self.window.contentView.trailingAnchor constant:-12],
        [self.stack.topAnchor constraintEqualToAnchor:self.window.contentView.topAnchor constant:12],
        [self.stack.bottomAnchor constraintEqualToAnchor:self.window.contentView.bottomAnchor constant:-12],
        [self.terminal.widthAnchor constraintEqualToAnchor:self.stack.widthAnchor],
        [self.terminal.heightAnchor constraintGreaterThanOrEqualToConstant:300],
        [self.status.widthAnchor constraintEqualToAnchor:self.stack.widthAnchor]
    ]];
    [self.terminal setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [self.window.contentView layoutSubtreeIfNeeded];
    ghostty_runtime_config_s runtime = {
        .userdata = (__bridge void *)self,
        .wakeup_cb = wakeup, .action_cb = action,
        .read_clipboard_cb = readClipboard,
        .confirm_read_clipboard_cb = confirmClipboard, .write_clipboard_cb = writeClipboard,
    };
    ghostty_config_t config = ghostty_config_new();
    ghostty_config_finalize(config);
    self.app = ghostty_app_new(&runtime, config);
    ghostty_config_free(config);
    if (!self.app || ![self replaceWithSnapshot:NULL]) {
        [self fail:@"Native surface creation failed; inspect the launch log."];
        return;
    }
    [self fillFixture];
    [NSApp activateIgnoringOtherApps:YES];
    printf("{\"event\":\"window-created\",\"windowNumber\":%ld,\"mode\":\"fixture\"}\n", (long)self.window.windowNumber);
    fflush(stdout);
    if (self.selfTest) [self performSelector:@selector(runSelfTest) withObject:nil afterDelay:0];
    else [self toggleLive:nil];
}
- (void)fail:(NSString *)message {
    fprintf(stderr, "%s\n", message.UTF8String);
    [self setMessage:message];
    exitCode = 1;
    if (self.selfTest) { [self shutdown]; exit(1); }
}
- (void)setMessage:(NSString *)text {
    self.status.stringValue = text;
    self.stepButton.enabled = self.pendingHistory;
    self.loadButton.enabled = self.pendingHistory && !self.historyTimer;
}
- (BOOL)feed:(NSString *)text {
    NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
    if (!ghostty_surface_hosted_output(self.surface, self.token, self.offset, data.bytes, data.length)) {
        [self fail:@"Host output was rejected. Reset the fixture before continuing."];
        return NO;
    }
    self.offset += data.length;
    return YES;
}
- (BOOL)replaceWithSnapshot:(const ghostty_string_s *)snapshot {
    __attribute__((objc_precise_lifetime)) TerminalView *oldView = self.terminal;
    ghostty_surface_t oldSurface = self.surface;
    // Retain the old callback context until surface_free joins its threads.
    __attribute__((objc_precise_lifetime)) Attachment *oldAttachment = self.attachment;
    TerminalView *view = [[TerminalView alloc] initWithFrame:oldView.frame];
    Attachment *attachment = [Attachment new];
    attachment.owner = self;
    attachment.token = self.token + 1;
    double scale = self.window.backingScaleFactor;
    ghostty_surface_config_s options = ghostty_surface_config_new();
    options.platform_tag = GHOSTTY_PLATFORM_MACOS;
    options.platform.macos.nsview = (__bridge void *)view;
    options.scale_factor = scale;
    options.userdata = (__bridge void *)attachment;
    ghostty_host_config_s host = {
        .userdata = (__bridge void *)attachment,
        .owner_token = attachment.token,
        .output_offset = snapshot ? self.offset : 0,
        .width_px = (uint32_t)(oldView.bounds.size.width * scale),
        .height_px = (uint32_t)(oldView.bounds.size.height * scale),
        .snapshot = snapshot ? (const uint8_t *)snapshot->ptr : NULL,
        .snapshot_len = snapshot ? snapshot->len : 0,
        .write_cb = hostWrite, .resize_cb = hostResize,
    };
    ghostty_surface_t replacement = ghostty_surface_new_hosted(self.app, &options, &host);
    if (!replacement) return NO;
    self.surface = replacement;
    self.token = attachment.token;
    self.offset = host.output_offset;
    self.attachment = attachment;
    self.terminal = view;
    view.surface = replacement;
    [self.stack removeArrangedSubview:oldView];
    [oldView removeFromSuperview];
    [self.stack insertArrangedSubview:view atIndex:2];
    [view.widthAnchor constraintEqualToAnchor:self.stack.widthAnchor].active = YES;
    [view.heightAnchor constraintGreaterThanOrEqualToConstant:300].active = YES;
    [view setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    [self.window.contentView layoutSubtreeIfNeeded];
    ghostty_surface_set_display_id(replacement, [self.window.screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue]);
    ghostty_surface_set_focus(replacement, true);
    [self.window makeFirstResponder:view];
    oldView.surface = NULL;
    if (oldSurface) ghostty_surface_free(oldSurface);
    (void)oldAttachment;
    view.needsDisplay = YES;
    return YES;
}
- (void)fillFixture {
    NSMutableString *fixture = [NSMutableString stringWithString:@"\033[2J\033[H"];
    for (unsigned i = 1; i <= 2000; i++) {
        [fixture appendFormat:@"\033[38;5;%umHISTORY %04u\033[0m  Ghostty native renderer  café  日本語\r\n", 33 + i % 6, i];
    }
    [fixture appendString:@"\033[1;32mREADY-MARKER\033[0m  Checkpoint this screen, then load older pages.\r\n"];
    [self feed:fixture];
    self.pendingHistory = NO;
    self.rowsLoaded = 0;
    [self setMessage:@"2,000 fixture lines. Scroll up, or checkpoint and restore while live output continues."];
}
- (void)reset:(id)sender {
    (void)sender;
    [self.historyTimer invalidate]; self.historyTimer = nil;
    if ([self replaceWithSnapshot:NULL]) [self fillFixture];
    else [self fail:@"Could not reset; the previous surface remains intact."];
}
- (BOOL)restoreCheckpoint {
    ghostty_string_s snapshot = {0};
    if (!ghostty_surface_hosted_snapshot(self.surface, &snapshot)) {
        [self setMessage:@"Snapshot refused: incomplete history or image resources. Load remaining history or reset the fixture."];
        return NO;
    }
    BOOL success = [self replaceWithSnapshot:&snapshot];
    ghostty_string_free(snapshot);
    if (!success) { [self fail:@"Restore failed; the previous surface remains intact."]; return NO; }
    self.pendingHistory = YES;
    self.rowsLoaded = 0;
    [self setMessage:@"READY restored. Live output is allowed; older history waits for Load one page / Load remaining."];
    return YES;
}
- (void)restore:(id)sender { (void)sender; [self restoreCheckpoint]; }
- (BOOL)loadPage {
    if (!self.pendingHistory) return YES;
    ghostty_host_history_s progress;
    if (!ghostty_surface_hosted_next_history(self.surface, &progress)) {
        self.pendingHistory = NO;
        [self.historyTimer invalidate]; self.historyTimer = nil;
        [self fail:@"History decoding failed. Current live state remains available; reset for a new checkpoint."];
        return NO;
    }
    self.rowsLoaded += progress.rows_applied;
    self.pendingHistory = !progress.finished;
    if (progress.finished) { [self.historyTimer invalidate]; self.historyTimer = nil; }
    [self setMessage:[NSString stringWithFormat:@"%@ · %llu history rows applied%@",
        progress.finished ? @"FINISH" : @"Loading", (unsigned long long)self.rowsLoaded,
        progress.history_lost ? @" · history incomplete after incompatible change" : @""]];
    return YES;
}
- (void)step:(id)sender { (void)sender; [self loadPage]; }
- (void)loadAll:(id)sender {
    (void)sender;
    if (!self.pendingHistory || self.historyTimer) return;
    __weak Demo *weakSelf = self;
    self.historyTimer = [NSTimer scheduledTimerWithTimeInterval:0.02 repeats:YES block:^(NSTimer *timer) {
        (void)timer; [weakSelf loadPage];
    }];
    self.loadButton.enabled = NO;
}
- (void)toggleLive:(id)sender {
    (void)sender;
    [self.liveTimer invalidate]; self.liveTimer = nil;
    if (self.liveButton.state != NSControlStateValueOn) return;
    __weak Demo *weakSelf = self;
    self.liveTimer = [NSTimer scheduledTimerWithTimeInterval:0.4 repeats:YES block:^(NSTimer *timer) {
        (void)timer;
        Demo *demo = weakSelf;
        if (!demo || demo.closed) return;
        demo.liveSequence++;
        [demo feed:[NSString stringWithFormat:@"\r\033[2K\033[36mLIVE %06llu\033[0m  Host output continues independently of history loading.", (unsigned long long)demo.liveSequence]];
    }];
}
- (void)addImage:(id)sender {
    (void)sender;
    NSMutableData *rgb = [NSMutableData dataWithLength:32 * 32 * 3];
    uint8_t *pixels = rgb.mutableBytes;
    for (unsigned y = 0; y < 32; y++) for (unsigned x = 0; x < 32; x++) {
        size_t i = (y * 32 + x) * 3;
        BOOL light = ((x / 4) ^ (y / 4)) & 1;
        pixels[i] = light ? 255 : 50; pixels[i + 1] = light ? 170 : 80; pixels[i + 2] = light ? 70 : 160;
    }
    [self feed:[NSString stringWithFormat:@"\r\n\033_Ga=T,f=24,s=32,v=32,c=8,r=4,i=7,q=2;%@\033\\\r\n", [rgb base64EncodedStringWithOptions:0]]];
    [self setMessage:@"Kitty image sent to the native renderer. Image checkpoint export is unsupported and must be refused."];
}
- (NSString *)activeText {
    ghostty_selection_s selection = {
        .top_left = { .tag = GHOSTTY_POINT_ACTIVE, .coord = GHOSTTY_POINT_COORD_TOP_LEFT },
        .bottom_right = { .tag = GHOSTTY_POINT_ACTIVE, .coord = GHOSTTY_POINT_COORD_BOTTOM_RIGHT },
    };
    ghostty_text_s text = {0};
    if (!ghostty_surface_read_text(self.surface, selection, &text)) return nil;
    NSString *result = [[NSString alloc] initWithBytes:text.text length:text.text_len encoding:NSUTF8StringEncoding];
    ghostty_surface_free_text(self.surface, &text);
    return result;
}
- (void)runSelfTest {
    NSString *before = [self activeText];
    if (![before containsString:@"READY-MARKER"]) { [self fail:@"self-test: fixture marker absent"]; return; }
    const char invalidByte = 0;
    ghostty_string_s invalid = { .ptr = &invalidByte, .len = 1, .sentinel = false };
    if ([self replaceWithSnapshot:&invalid] || ![[self activeText] isEqualToString:before]) { [self fail:@"self-test: invalid snapshot did not preserve the original surface"]; return; }
    uint64_t oldToken = self.token;
    if (![self restoreCheckpoint]) { [self fail:@"self-test: snapshot adoption failed"]; return; }
    if (![[self activeText] isEqualToString:before]) { [self fail:@"self-test: READY changed the active screen"]; return; }
    if (ghostty_surface_hosted_output(self.surface, oldToken, self.offset, (const uint8_t *)"BAD", 3)) { [self fail:@"self-test: stale owner accepted"]; return; }
    if (ghostty_surface_hosted_output(self.surface, self.token, self.offset + 1, (const uint8_t *)"GAP", 3)) { [self fail:@"self-test: gapped output accepted"]; return; }
    if (![self feed:@"LIVE-AFTER-READY"]) return;
    NSString *live = [self activeText];
    unsigned pages = 0;
    while (self.pendingHistory && pages++ < 1000) if (![self loadPage]) return;
    if (self.pendingHistory || self.rowsLoaded == 0 || ![[self activeText] isEqualToString:live]) { [self fail:@"self-test: history replaced live state or did not complete"]; return; }
    for (unsigned cycle = 0; cycle < 10; cycle++) {
        @autoreleasepool {
            if (![self restoreCheckpoint]) { [self fail:@"self-test: repeated adoption failed"]; return; }
            unsigned steps = 0;
            while (self.pendingHistory && steps++ < 1000) if (![self loadPage]) return;
            if (self.pendingHistory || ![[self activeText] isEqualToString:live]) { [self fail:@"self-test: repeated history loading changed live state"]; return; }
            // Service queued app/render callbacks between ownership changes.
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
        }
    }
    NSUInteger previousInput = self.inputBytes;
    ghostty_surface_text(self.surface, "probe-input", 11);
    NSDate *inputDeadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (self.inputBytes == previousInput && inputDeadline.timeIntervalSinceNow > 0) {
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    if (self.inputBytes != previousInput + 11) { [self fail:@"self-test: native I/O callback was not delivered exactly once"]; return; }
    if (![self restoreCheckpoint]) { [self fail:@"self-test: second restore failed"]; return; }
    ghostty_surface_hosted_cancel_history(self.surface);
    self.pendingHistory = NO;
    ghostty_string_s partial = {0};
    if (ghostty_surface_hosted_snapshot(self.surface, &partial)) { ghostty_string_free(partial); [self fail:@"self-test: cancelled history exported as complete"]; return; }
    [self reset:nil];
    [self addImage:nil];
    ghostty_string_s image = {0};
    if (ghostty_surface_hosted_snapshot(self.surface, &image)) { ghostty_string_free(image); [self fail:@"self-test: image-bearing export accepted"]; return; }
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    printf("{\"event\":\"self-test-passed\",\"scope\":\"real native Surface/C API state; not pixel or latency proof\",\"historySteps\":%u}\n", pages);
    fflush(stdout);
    [NSApp terminate:nil];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { (void)sender; return YES; }
- (void)applicationWillTerminate:(NSNotification *)notification { (void)notification; [self shutdown]; }
- (void)shutdown {
    if (self.closed) return;
    self.closed = YES;
    [self.liveTimer invalidate]; [self.historyTimer invalidate];
    self.terminal.surface = NULL;
    if (self.surface) { ghostty_surface_free(self.surface); self.surface = NULL; }
    self.attachment = nil;
    if (self.app) { ghostty_app_free(self.app); self.app = NULL; }
}
@end

int main(int argc, char **argv) {
    @autoreleasepool {
        if (ghostty_init(argc, argv) != GHOSTTY_SUCCESS) return 1;
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        NSMenu *menu = [NSMenu new];
        NSMenuItem *root = [NSMenuItem new];
        [menu addItem:root];
        NSMenu *submenu = [NSMenu new];
        [submenu addItemWithTitle:@"Quit experiment" action:@selector(terminate:) keyEquivalent:@"q"];
        root.submenu = submenu;
        app.mainMenu = menu;
        application = [Demo new];
        application.selfTest = argc > 1 && strcmp(argv[1], "--self-test") == 0;
        app.delegate = application;
        [app run];
        [application shutdown];
        return exitCode;
    }
}
