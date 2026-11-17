// DualSense Edge Studio — native macOS shell.
// Talks to the controller over USB with IOKit HID and hosts the UI in a WKWebView.
// The web UI (Resources/web) calls `window.webkit.messageHandlers.hid.postMessage({cmd, ...})`
// and receives events through `window.EdgeNative.onEvent(evt)`.

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <IOKit/hid/IOHIDManager.h>
#import <IOKit/hid/IOHIDKeys.h>
#import <GameController/GameController.h>
#import <UserNotifications/UserNotifications.h>

static const int kVendorSony = 0x054C;
static const int kProductEdge = 0x0DF2;
static const CFIndex kReportLen = 64;

#pragma mark - HID controller

@class EdgeHID;
@protocol EdgeHIDDelegate <NSObject>
- (void)edgeHID:(EdgeHID *)hid emit:(NSDictionary *)event;
@end

@interface EdgeHID : NSObject {
  @public
  uint8_t _inputBuf[kReportLen];
}
@property(nonatomic, weak) id<EdgeHIDDelegate> delegate;
@property(nonatomic) IOHIDManagerRef manager;
@property(nonatomic) IOHIDDeviceRef device;        // active USB device (retained)
@property(nonatomic, copy) NSString *transport;    // "USB" / "Bluetooth" / nil
@property(nonatomic) BOOL bluetoothOnly;
@property(nonatomic) CFAbsoluteTime lastInputEmit;
@property(nonatomic, strong) NSData *lastButtons;
@property(nonatomic) CFAbsoluteTime lastSample;
@property(nonatomic) double yaw;  // integrated yaw, degrees
// report-rate statistics over a ~1 s window (every report, not just the throttled UI stream)
@property(nonatomic) CFAbsoluteTime lastReport, rateStart;
@property(nonatomic) double rateN, rateSum, rateSumSq, rateMax;
@property(nonatomic, strong) NSDictionary *rate;
@end

static void HIDMatched(void *ctx, IOReturn res, void *sender, IOHIDDeviceRef dev);
static void HIDRemoved(void *ctx, IOReturn res, void *sender, IOHIDDeviceRef dev);
static void HIDInput(void *ctx, IOReturn res, void *sender, IOHIDReportType type, uint32_t rid,
                     uint8_t *report, CFIndex len);

@implementation EdgeHID

- (void)start {
  self.manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
  NSDictionary *match = @{@kIOHIDVendorIDKey : @(kVendorSony), @kIOHIDProductIDKey : @(kProductEdge)};
  IOHIDManagerSetDeviceMatching(self.manager, (__bridge CFDictionaryRef)match);
  IOHIDManagerRegisterDeviceMatchingCallback(self.manager, HIDMatched, (__bridge void *)self);
  IOHIDManagerRegisterDeviceRemovalCallback(self.manager, HIDRemoved, (__bridge void *)self);
  IOHIDManagerScheduleWithRunLoop(self.manager, CFRunLoopGetMain(), kCFRunLoopDefaultMode);
  IOHIDManagerOpen(self.manager, kIOHIDOptionsTypeNone);
}

static NSString *TransportOf(IOHIDDeviceRef dev) {
  id t = (__bridge id)IOHIDDeviceGetProperty(dev, CFSTR(kIOHIDTransportKey));
  return [t isKindOfClass:NSString.class] ? t : @"?";
}

- (void)deviceMatched:(IOHIDDeviceRef)dev {
  NSString *transport = TransportOf(dev);
  if (![transport isEqualToString:@"USB"]) {
    if (!self.device) {
      self.bluetoothOnly = YES;
      [self emitStatus];
    }
    return;
  }
  if (self.device) return;  // already attached to one USB controller
  IOReturn r = IOHIDDeviceOpen(dev, kIOHIDOptionsTypeNone);
  if (r != kIOReturnSuccess) {
    [self.delegate edgeHID:self emit:@{@"type" : @"error",
                                       @"code" : @(r),
                                       @"message" : (r == kIOReturnNotPermitted)
                                           ? @"O macOS bloqueou o acesso ao controle. Libere o app em Ajustes do Sistema › Privacidade e Segurança › Monitoramento de Entrada."
                                           : [NSString stringWithFormat:@"Falha ao abrir o controle (0x%08x).", r]}];
    return;
  }
  CFRetain(dev);
  self.device = dev;
  self.transport = transport;
  self.bluetoothOnly = NO;
  IOHIDDeviceRegisterInputReportCallback(dev, _inputBuf, kReportLen, HIDInput, (__bridge void *)self);
  [self emitStatus];
}

- (void)deviceRemoved:(IOHIDDeviceRef)dev {
  if (self.device && dev == self.device) {
    IOHIDDeviceRegisterInputReportCallback(dev, _inputBuf, kReportLen, NULL, NULL);
    CFRelease(self.device);
    self.device = NULL;
    self.transport = nil;
  }
  // Is there still something attached (e.g. a Bluetooth link, or a second USB node)?
  NSSet *devs = CFBridgingRelease(IOHIDManagerCopyDevices(self.manager));
  self.bluetoothOnly = NO;
  for (id o in devs) {
    IOHIDDeviceRef d = (__bridge IOHIDDeviceRef)o;
    if (d == dev) continue;
    if ([TransportOf(d) isEqualToString:@"USB"]) { [self deviceMatched:d]; return; }
    self.bluetoothOnly = YES;
  }
  [self emitStatus];
}

- (NSDictionary *)status {
  NSString *serial = nil;
  if (self.device) {
    id s = (__bridge id)IOHIDDeviceGetProperty(self.device, CFSTR(kIOHIDSerialNumberKey));
    if ([s isKindOfClass:NSString.class]) serial = s;
  }
  return @{
    @"type" : @"status",
    @"connected" : @(self.device != NULL),
    @"transport" : self.transport ?: (self.bluetoothOnly ? @"Bluetooth" : @""),
    @"bluetoothOnly" : @(self.bluetoothOnly && !self.device),
    @"serial" : serial ?: @""
  };
}

- (void)emitStatus {
  [self.delegate edgeHID:self emit:[self status]];
}

- (void)input:(uint8_t *)report length:(CFIndex)len {
  if (len < 12 || report[0] != 0x01) return;
  // Always forward button changes immediately (so FN+face combos are never missed),
  // otherwise throttle the analog stream to ~40 Hz.
  NSData *buttons = [NSData dataWithBytes:report + 8 length:4];
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();

  // Integrate the yaw gyro on every report (≈250 Hz) so the 3D view stays accurate even though
  // the UI only receives ~40 Hz. Raw gyro ≈ 16.4 LSB per °/s; a small dead band limits drift.
  if (len >= 22) {
    double dt = self.lastSample > 0 ? now - self.lastSample : 0;
    if (dt > 0.1) dt = 0;
    double dps = (int16_t)(report[18] | (report[19] << 8)) / 16.4;
    if (fabs(dps) > 1.5) self.yaw += dps * dt;
    self.lastSample = now;
  }

  if (self.lastReport > 0) {
    double dt = (now - self.lastReport) * 1000.0;  // ms
    if (dt < 1000) { self.rateN += 1; self.rateSum += dt; self.rateSumSq += dt * dt; if (dt > self.rateMax) self.rateMax = dt; }
  }
  self.lastReport = now;
  if (self.rateStart == 0) self.rateStart = now;
  if (now - self.rateStart >= 1.0) {
    double n = self.rateN, mean = n > 0 ? self.rateSum / n : 0;
    double sd = n > 1 ? sqrt(fmax(0, self.rateSumSq / n - mean * mean)) : 0;
    self.rate = @{@"hz" : @(n / (now - self.rateStart)), @"mean" : @(mean), @"jitter" : @(sd), @"max" : @(self.rateMax)};
    self.rateStart = now; self.rateN = self.rateSum = self.rateSumSq = self.rateMax = 0;
  }

  BOOL changed = ![buttons isEqualToData:self.lastButtons];
  if (!changed && now - self.lastInputEmit < 0.025) return;
  self.lastButtons = buttons;
  self.lastInputEmit = now;
  NSMutableArray *arr = [NSMutableArray arrayWithCapacity:len];
  for (CFIndex i = 0; i < len; i++) [arr addObject:@(report[i])];
  [self.delegate edgeHID:self emit:@{@"type" : @"input", @"data" : arr, @"yaw" : @(self.yaw), @"rate" : self.rate ?: @{}}];
}

- (NSArray *)getFeature:(uint8_t)rid error:(NSString **)err {
  uint8_t buf[kReportLen] = {0};
  CFIndex len = kReportLen;
  IOReturn r = IOHIDDeviceGetReport(self.device, kIOHIDReportTypeFeature, rid, buf, &len);
  if (r != kIOReturnSuccess) {
    if (err) *err = [NSString stringWithFormat:@"Falha ao ler report 0x%02X (0x%08x)", rid, r];
    return nil;
  }
  NSMutableArray *a = [NSMutableArray arrayWithCapacity:kReportLen];
  for (CFIndex i = 0; i < kReportLen; i++) [a addObject:@(i < len ? buf[i] : 0)];
  return a;
}

- (BOOL)setReport:(IOHIDReportType)type bytes:(NSArray *)bytes error:(NSString **)err {
  if (bytes.count != kReportLen) {
    if (err) *err = @"Report com tamanho inválido";
    return NO;
  }
  uint8_t buf[kReportLen];
  for (NSUInteger i = 0; i < kReportLen; i++) buf[i] = (uint8_t)[bytes[i] unsignedIntValue];
  IOReturn r = IOHIDDeviceSetReport(self.device, type, buf[0], buf, kReportLen);
  if (r != kIOReturnSuccess) {
    if (err) *err = [NSString stringWithFormat:@"Falha ao escrever report 0x%02X (0x%08x)", buf[0], r];
    return NO;
  }
  return YES;
}

@end

static void HIDMatched(void *ctx, IOReturn res, void *sender, IOHIDDeviceRef dev) {
  [(__bridge EdgeHID *)ctx deviceMatched:dev];
}
static void HIDRemoved(void *ctx, IOReturn res, void *sender, IOHIDDeviceRef dev) {
  [(__bridge EdgeHID *)ctx deviceRemoved:dev];
}
static void HIDInput(void *ctx, IOReturn res, void *sender, IOHIDReportType type, uint32_t rid,
                     uint8_t *report, CFIndex len) {
  [(__bridge EdgeHID *)ctx input:report length:len];
}

#pragma mark - Bridge / app

@interface AppDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandlerWithReply, EdgeHIDDelegate, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *web;
@property(nonatomic, strong) EdgeHID *hid;
@property(nonatomic) BOOL pageReady;
// menu bar
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSMenuItem *miBattery, *miProfile, *miKeep, *miWarn;
@property(nonatomic) int batLevel, batState;      // -1 = unknown; state 0 discharging, 1 charging, 2 full
@property(nonatomic) BOOL connected, warned20, warned10;
@property(nonatomic, copy) NSString *activeProfile;
@end

@implementation AppDelegate

- (NSURL *)supportDir {
  NSURL *base = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *dir = [base URLByAppendingPathComponent:@"DualSense Edge Studio" isDirectory:YES];
  [NSFileManager.defaultManager createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return dir;
}

- (void)buildMenu {
  NSMenu *bar = [NSMenu new];
  NSMenuItem *appItem = [NSMenuItem new];
  [bar addItem:appItem];
  NSMenu *appMenu = [NSMenu new];
  [appMenu addItemWithTitle:@"Sobre o DualSense Edge Studio" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
  [appMenu addItem:NSMenuItem.separatorItem];
  [appMenu addItemWithTitle:@"Ocultar" action:@selector(hide:) keyEquivalent:@"h"];
  [appMenu addItemWithTitle:@"Encerrar DualSense Edge Studio" action:@selector(terminate:) keyEquivalent:@"q"];
  appItem.submenu = appMenu;

  NSMenuItem *editItem = [NSMenuItem new];
  [bar addItem:editItem];
  NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Editar"];
  [edit addItemWithTitle:@"Desfazer" action:@selector(undo:) keyEquivalent:@"z"];
  [edit addItemWithTitle:@"Refazer" action:@selector(redo:) keyEquivalent:@"Z"];
  [edit addItem:NSMenuItem.separatorItem];
  [edit addItemWithTitle:@"Recortar" action:@selector(cut:) keyEquivalent:@"x"];
  [edit addItemWithTitle:@"Copiar" action:@selector(copy:) keyEquivalent:@"c"];
  [edit addItemWithTitle:@"Colar" action:@selector(paste:) keyEquivalent:@"v"];
  [edit addItemWithTitle:@"Selecionar Tudo" action:@selector(selectAll:) keyEquivalent:@"a"];
  editItem.submenu = edit;

  NSMenuItem *winItem = [NSMenuItem new];
  [bar addItem:winItem];
  NSMenu *win = [[NSMenu alloc] initWithTitle:@"Janela"];
  [win addItemWithTitle:@"Minimizar" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
  [win addItemWithTitle:@"Fechar" action:@selector(performClose:) keyEquivalent:@"w"];
  winItem.submenu = win;
  NSApp.windowsMenu = win;
  NSApp.mainMenu = bar;
}

- (void)applicationDidFinishLaunching:(NSNotification *)n {
  [self buildMenu];

  WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
  [cfg.userContentController addScriptMessageHandlerWithReply:self contentWorld:WKContentWorld.pageWorld name:@"hid"];
  self.web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1320, 860) configuration:cfg];
  self.web.navigationDelegate = self;
  [self.web setValue:@NO forKey:@"drawsBackground"];
#ifdef DEBUG
  if (@available(macOS 13.3, *)) self.web.inspectable = YES;
#endif

  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1320, 860)
                                            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                      NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.title = @"DualSense Edge Studio";
  self.window.titlebarAppearsTransparent = YES;
  self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.window.minSize = NSMakeSize(1180, 740);
  self.window.backgroundColor = [NSColor colorWithRed:0.055 green:0.063 blue:0.082 alpha:1];
  self.window.contentView = self.web;
  [self.window setFrameAutosaveName:@"MainWindow"];
  [self.window center];
  self.window.releasedWhenClosed = NO;
  self.window.delegate = (id<NSWindowDelegate>)self;
  [self.window makeKeyAndOrderFront:nil];
  [self buildStatusItem];
  if ([self warnBattery]) [self askNotificationPermission];

  NSURL *webDir = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"web" isDirectory:YES];
  [self.web loadFileURL:[webDir URLByAppendingPathComponent:@"index.html"] allowingReadAccessToURL:webDir];

  self.hid = [EdgeHID new];
  self.hid.delegate = self;
  [self.hid start];

  // macOS's own controller service (GameController) owns the light bar, player LEDs and adaptive
  // triggers: raw HID output for those gets overridden, so they go through GCDualSenseGamepad.
  __weak typeof(self) ws = self;
  for (NSString *name in @[ GCControllerDidConnectNotification, GCControllerDidDisconnectNotification ]) {
    [NSNotificationCenter.defaultCenter addObserverForName:name object:nil queue:NSOperationQueue.mainQueue
                                                usingBlock:^(NSNotification *note) {
      [ws edgeHID:ws.hid emit:@{@"type" : @"gc", @"available" : @([ws dualSense] != nil)}];
    }];
  }
  [NSApp activateIgnoringOtherApps:YES];
}

#pragma mark - Menu bar

- (BOOL)keepInMenuBar { return ![NSUserDefaults.standardUserDefaults boolForKey:@"quitOnClose"]; }
- (BOOL)warnBattery { return ![NSUserDefaults.standardUserDefaults boolForKey:@"noBatteryWarning"]; }

- (void)buildStatusItem {
  self.batLevel = -1;
  self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  NSMenu *menu = [NSMenu new];
  menu.autoenablesItems = NO;
  self.miBattery = [menu addItemWithTitle:@"Controle desconectado" action:nil keyEquivalent:@""];
  self.miBattery.enabled = NO;
  self.miProfile = [menu addItemWithTitle:@"" action:nil keyEquivalent:@""];
  self.miProfile.enabled = NO; self.miProfile.hidden = YES;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenuItem *open = [menu addItemWithTitle:@"Abrir DualSense Edge Studio" action:@selector(showMainWindow) keyEquivalent:@""];
  open.target = self;
  [menu addItem:NSMenuItem.separatorItem];
  self.miKeep = [menu addItemWithTitle:@"Continuar na barra de menus ao fechar a janela" action:@selector(toggleKeep) keyEquivalent:@""];
  self.miKeep.target = self;
  self.miWarn = [menu addItemWithTitle:@"Avisar quando a bateria estiver fraca" action:@selector(toggleWarn) keyEquivalent:@""];
  self.miWarn.target = self;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenuItem *quit = [menu addItemWithTitle:@"Encerrar" action:@selector(terminate:) keyEquivalent:@"q"];
  quit.target = NSApp;
  self.statusItem.menu = menu;
  [self refreshStatusItem];
}

- (void)toggleKeep {
  [NSUserDefaults.standardUserDefaults setBool:[self keepInMenuBar] forKey:@"quitOnClose"];
  [self refreshStatusItem];
}
- (void)toggleWarn {
  [NSUserDefaults.standardUserDefaults setBool:[self warnBattery] forKey:@"noBatteryWarning"];
  if ([self warnBattery]) [self askNotificationPermission];
  [self refreshStatusItem];
}

- (void)refreshStatusItem {
  NSStatusBarButton *b = self.statusItem.button;
  NSString *symbol = @"gamecontroller";
  NSString *title = @"";
  if (self.connected && self.batLevel >= 0) {
    title = [NSString stringWithFormat:@" %d%%", self.batLevel];
    if (self.batState == 1) symbol = @"gamecontroller.fill";
  }
  NSImage *img = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:@"DualSense Edge"];
  img.template = YES;
  b.image = img;
  b.imagePosition = NSImageLeft;
  NSMutableAttributedString *t = [[NSMutableAttributedString alloc] initWithString:title attributes:@{NSFontAttributeName : [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium]}];
  if (self.connected && self.batLevel >= 0 && self.batLevel <= 20 && self.batState == 0)
    [t addAttribute:NSForegroundColorAttributeName value:NSColor.systemRedColor range:NSMakeRange(0, t.length)];
  b.attributedTitle = t;
  b.toolTip = self.connected ? @"DualSense Edge conectado" : @"DualSense Edge desconectado";

  if (!self.connected) self.miBattery.title = @"Controle desconectado";
  else if (self.batLevel < 0) self.miBattery.title = @"DualSense Edge conectado";
  else {
    NSString *st = self.batState == 1 ? @" · carregando" : self.batState == 2 ? @" · carga completa" : @"";
    self.miBattery.title = [NSString stringWithFormat:@"Bateria: %d%%%@", self.batLevel, st];
  }
  self.miProfile.hidden = !(self.connected && self.activeProfile.length);
  self.miProfile.title = self.activeProfile.length ? [NSString stringWithFormat:@"Perfil ativo: %@", self.activeProfile] : @"";
  self.miKeep.state = [self keepInMenuBar] ? NSControlStateValueOn : NSControlStateValueOff;
  self.miWarn.state = [self warnBattery] ? NSControlStateValueOn : NSControlStateValueOff;
}

- (void)askNotificationPermission {
  [UNUserNotificationCenter.currentNotificationCenter requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
                                                                     completionHandler:^(BOOL granted, NSError *e) {}];
}

- (void)notify:(NSString *)title body:(NSString *)body {
  UNMutableNotificationContent *c = [UNMutableNotificationContent new];
  c.title = title; c.body = body; c.sound = UNNotificationSound.defaultSound;
  UNNotificationRequest *r = [UNNotificationRequest requestWithIdentifier:@"battery" content:c trigger:nil];
  [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:r withCompletionHandler:nil];
}

// battery from input report byte 53: low nibble = level/10, high nibble 1 = charging, 2 = full
- (void)trackBattery:(NSArray *)data {
  if (data.count < 54) return;
  int raw = [data[53] intValue];
  int level = MIN((raw & 0x0f) * 10 + 5, 100), st = (raw >> 4) & 0x0f;
  int state = st == 1 ? 1 : st == 2 ? 2 : 0;
  if (state == 2) level = 100;
  if (level == self.batLevel && state == self.batState) return;
  self.batLevel = level; self.batState = state;
  if (state != 0 || level > 30) self.warned20 = self.warned10 = NO;
  if (state == 0 && [self warnBattery]) {
    if (level <= 10 && !self.warned10) {
      self.warned10 = self.warned20 = YES;
      [self notify:@"Bateria do DualSense Edge quase no fim" body:[NSString stringWithFormat:@"Restam cerca de %d%%. Conecte o cabo para carregar.", level]];
    } else if (level <= 20 && !self.warned20) {
      self.warned20 = YES;
      [self notify:@"Bateria do DualSense Edge fraca" body:[NSString stringWithFormat:@"Restam cerca de %d%%.", level]];
    }
  }
  [self refreshStatusItem];
}

- (void)showMainWindow {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  if (!flag) [self showMainWindow];
  return YES;
}

- (void)windowWillClose:(NSNotification *)n {
  // keep running in the menu bar only (no Dock icon) until the window is opened again
  if ([self keepInMenuBar]) [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return ![self keepInMenuBar];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  self.pageReady = YES;
  [self edgeHID:self.hid emit:[self.hid status]];
}

- (void)edgeHID:(EdgeHID *)hid emit:(NSDictionary *)event {
  NSString *type = event[@"type"];
  if ([type isEqualToString:@"input"]) [self trackBattery:event[@"data"]];
  else if ([type isEqualToString:@"status"]) {
    self.connected = [event[@"connected"] boolValue];
    if (!self.connected) { self.batLevel = -1; self.activeProfile = nil; }
    [self refreshStatusItem];
  }
  if (!self.pageReady) return;
  NSData *json = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  NSString *js = [NSString stringWithFormat:@"window.EdgeNative && window.EdgeNative.onEvent(%@)",
                                            [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
  [self.web evaluateJavaScript:js completionHandler:nil];
}

- (GCController *)dualSense {
  GCController *best = nil;
  for (GCController *c in GCController.controllers) {
    if (![c.extendedGamepad isKindOfClass:GCDualSenseGamepad.class]) continue;
    if (!best || [c.vendorName containsString:@"Edge"]) best = c;
  }
  return best;
}

- (void)userContentController:(WKUserContentController *)ucc
      didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id _Nullable, NSString *_Nullable))reply {
  NSDictionary *m = [message.body isKindOfClass:NSDictionary.class] ? message.body : @{};
  NSString *cmd = m[@"cmd"];
  NSString *err = nil;

  if ([cmd isEqualToString:@"status"]) {
    reply([self.hid status], nil);
    return;
  }
  if ([cmd isEqualToString:@"menuInfo"]) {
    self.activeProfile = [m[@"profile"] isKindOfClass:NSString.class] ? m[@"profile"] : nil;
    [self refreshStatusItem];
    reply(@YES, nil);
    return;
  }
  if ([cmd isEqualToString:@"resetYaw"]) {
    self.hid.yaw = 0;
    reply(@YES, nil);
    return;
  }
  if ([cmd isEqualToString:@"log"]) {
    NSLog(@"[EdgeStudio] %@", m[@"text"]);
    reply(@YES, nil);
    return;
  }

  // ---- Library persistence (Application Support) ----
  NSURL *libURL = [[self supportDir] URLByAppendingPathComponent:@"library.json"];
  NSURL *stateURL = [[self supportDir] URLByAppendingPathComponent:@"state.json"];
  // app data files (fixed names only)
  NSURL *histURL = [[self supportDir] URLByAppendingPathComponent:@"history.json"];
  NSURL *(^fileFor)(NSString *) = ^NSURL *(NSString *name) {
    if ([name isEqualToString:@"state"]) return stateURL;
    if ([name isEqualToString:@"history"]) return histURL;
    return libURL;
  };
  if ([cmd isEqualToString:@"loadFile"]) {
    NSURL *u = fileFor(m[@"name"]);
    NSString *s = [NSString stringWithContentsOfURL:u encoding:NSUTF8StringEncoding error:nil];
    reply(s ?: @"", nil);
    return;
  }
  if ([cmd isEqualToString:@"saveFile"]) {
    NSURL *u = fileFor(m[@"name"]);
    NSError *e = nil;
    BOOL ok = [m[@"text"] ?: @"" writeToURL:u atomically:YES encoding:NSUTF8StringEncoding error:&e];
    reply(@(ok), ok ? nil : e.localizedDescription);
    return;
  }
  if ([cmd isEqualToString:@"exportJSON"]) {
    NSSavePanel *p = [NSSavePanel savePanel];
    p.nameFieldStringValue = m[@"filename"] ?: @"edge-profiles.json";
    p.allowedContentTypes = @[ UTTypeJSON ];
    [p beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) {
      if (r != NSModalResponseOK) { reply(@NO, nil); return; }
      NSError *e = nil;
      BOOL ok = [m[@"text"] writeToURL:p.URL atomically:YES encoding:NSUTF8StringEncoding error:&e];
      reply(@(ok), ok ? nil : e.localizedDescription);
    }];
    return;
  }
  if ([cmd isEqualToString:@"importJSON"]) {
    NSOpenPanel *p = [NSOpenPanel openPanel];
    p.allowedContentTypes = @[ UTTypeJSON ];
    p.allowsMultipleSelection = NO;
    [p beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) {
      if (r != NSModalResponseOK) { reply([NSNull null], nil); return; }
      NSString *s = [NSString stringWithContentsOfURL:p.URL encoding:NSUTF8StringEncoding error:nil];
      reply(s ?: [NSNull null], nil);
    }];
    return;
  }

  // ---- Controller I/O ----
  if (!self.hid.device) {
    reply(nil, self.hid.bluetoothOnly ? @"Conecte o DualSense Edge por cabo USB (Bluetooth não permite editar perfis)."
                                      : @"Controle não conectado.");
    return;
  }

  if ([cmd isEqualToString:@"readProfiles"]) {
    NSMutableArray *out = [NSMutableArray array];
    for (uint8_t rid = 0x70; rid <= 0x7B; rid++) {
      NSArray *a = [self.hid getFeature:rid error:&err];
      if (!a) { reply(nil, err); return; }
      [out addObject:a];
    }
    reply(out, nil);
    return;
  }

  if ([cmd isEqualToString:@"readFeature"]) {
    int rid = [m[@"id"] intValue];
    NSArray *a = [self.hid getFeature:(uint8_t)rid error:&err];
    reply(a, a ? nil : err);
    return;
  }

  if ([cmd isEqualToString:@"writeFeatures"]) {
    // Safety: only profile-slot writes (0x60–0x63) and slot clear (0x68) are allowed.
    NSArray *reports = m[@"reports"];
    for (NSArray *r in reports) {
      int rid = r.count ? [r[0] intValue] : -1;
      if (!((rid >= 0x60 && rid <= 0x63) || rid == 0x68)) {
        reply(nil, [NSString stringWithFormat:@"Report 0x%02X não permitido", rid]);
        return;
      }
    }
    for (NSArray *r in reports) {
      if (![self.hid setReport:kIOHIDReportTypeFeature bytes:r error:&err]) { reply(nil, err); return; }
    }
    reply(@YES, nil);
    return;
  }

  if ([cmd isEqualToString:@"rumble"]) {
    // Output report 0x02 (USB). Same short "confirmation" buzz edge-config.com uses.
    int strength = m[@"strength"] ? [m[@"strength"] intValue] : 127;
    double ms = m[@"ms"] ? [m[@"ms"] doubleValue] : 200;
    NSMutableArray *on = [NSMutableArray arrayWithCapacity:kReportLen];
    for (int i = 0; i < kReportLen; i++) [on addObject:@0];
    on[0] = @0x02; on[1] = @0x03; on[3] = @(strength); on[4] = @(strength);  // rumble only (keeps lights and trigger effects)
    NSMutableArray *off = [on mutableCopy];
    off[3] = @0; off[4] = @0;
    if (![self.hid setReport:kIOHIDReportTypeOutput bytes:on error:&err]) { reply(nil, err); return; }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
      if (self.hid.device) [self.hid setReport:kIOHIDReportTypeOutput bytes:off error:nil];
    });
    reply(@YES, nil);
    return;
  }

  if ([cmd isEqualToString:@"gc"]) {
    GCController *c = [self dualSense];
    if (!c) { reply(nil, @"O macOS ainda não liberou o controle para o app. Clique na janela do app e tente de novo."); return; }
    NSArray *light = m[@"light"];
    if ([light isKindOfClass:NSArray.class] && light.count == 3 && c.light) {
      c.light.color = [[GCColor alloc] initWithRed:[light[0] floatValue] green:[light[1] floatValue] blue:[light[2] floatValue]];
    }
    if (m[@"player"]) c.playerIndex = (GCControllerPlayerIndex)[m[@"player"] integerValue];
    NSDictionary *t = m[@"trigger"];
    if ([t isKindOfClass:NSDictionary.class]) {
      GCDualSenseGamepad *g = (GCDualSenseGamepad *)c.extendedGamepad;
      GCDualSenseAdaptiveTrigger *tr = [t[@"side"] isEqualToString:@"l2"] ? g.leftTrigger : g.rightTrigger;
      NSString *mode = t[@"mode"];
      float st = [t[@"start"] floatValue], en = [t[@"end"] floatValue], str = [t[@"strength"] floatValue];
      if ([mode isEqualToString:@"feedback"]) [tr setModeFeedbackWithStartPosition:st resistiveStrength:str];
      else if ([mode isEqualToString:@"weapon"]) [tr setModeWeaponWithStartPosition:st endPosition:en resistiveStrength:str];
      else if ([mode isEqualToString:@"vibration"]) [tr setModeVibrationWithStartPosition:st amplitude:[t[@"amplitude"] floatValue] frequency:[t[@"frequency"] floatValue]];
      else [tr setModeOff];
    }
    reply(@YES, nil);
    return;
  }

  if ([cmd isEqualToString:@"output"]) {
    // Live-only output report 0x02 (lights, rumble, adaptive triggers). Nothing here is stored on the
    // controller, so it is safe; still, only report 0x02 is accepted.
    NSArray *b = m[@"bytes"];
    if (![b isKindOfClass:[NSArray class]] || b.count < 2 || b.count > kReportLen || [b[0] intValue] != 0x02) {
      reply(nil, @"Só o report de saída 0x02 é permitido");
      return;
    }
    NSMutableArray *full = [b mutableCopy];
    while (full.count < kReportLen) [full addObject:@0];
    if (![self.hid setReport:kIOHIDReportTypeOutput bytes:full error:&err]) { reply(nil, err); return; }
    reply(@YES, nil);
    return;
  }

  reply(nil, [NSString stringWithFormat:@"Comando desconhecido: %@", cmd]);
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *app = NSApplication.sharedApplication;
    app.activationPolicy = NSApplicationActivationPolicyRegular;
    AppDelegate *d = [AppDelegate new];
    app.delegate = d;
    [app run];
  }
  return 0;
}
