#import <Capacitor/Capacitor.h>

@interface LocalLLMPlugin : CAPPlugin <CAPBridgedPlugin>
- (void)loadModel:(CAPPluginCall*)call;
- (void)generate:(CAPPluginCall*)call;
- (void)unload:(CAPPluginCall*)call;
- (void)isModelLoaded:(CAPPluginCall*)call;
@end
