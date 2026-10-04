#import "NativeView.h"

static ghostty_input_mods_e modifiers(NSEventModifierFlags flags) {
    unsigned result = 0;
    if (flags & NSEventModifierFlagShift) result |= GHOSTTY_MODS_SHIFT;
    if (flags & NSEventModifierFlagControl) result |= GHOSTTY_MODS_CTRL;
    if (flags & NSEventModifierFlagOption) result |= GHOSTTY_MODS_ALT;
    if (flags & NSEventModifierFlagCommand) result |= GHOSTTY_MODS_SUPER;
    if (flags & NSEventModifierFlagCapsLock) result |= GHOSTTY_MODS_CAPS;
    return (ghostty_input_mods_e)result;
}

@implementation OFGhosttyView
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
- (void)updateLayer { if (self.surface) ghostty_surface_draw(self.surface); }
- (void)keyDown:(NSEvent *)event {
    if (!self.surface) return;
    NSString *text = event.characters ?: @"";
    NSData *plain = [event.charactersIgnoringModifiers dataUsingEncoding:NSUTF32LittleEndianStringEncoding];
    uint32_t scalar = 0;
    if (plain.length >= sizeof(scalar)) memcpy(&scalar, plain.bytes, sizeof(scalar));
    ghostty_input_key_s key = {};
    key.action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
    key.mods = modifiers(event.modifierFlags);
    key.keycode = event.keyCode;
    key.text = text.length && [text characterAtIndex:0] >= 0x20 ? text.UTF8String : NULL;
    key.unshifted_codepoint = scalar;
    ghostty_surface_key(self.surface, key);
}
- (void)keyUp:(NSEvent *)event {
    if (!self.surface) return;
    ghostty_input_key_s key = {};
    key.action = GHOSTTY_ACTION_RELEASE;
    key.mods = modifiers(event.modifierFlags);
    key.keycode = event.keyCode;
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
