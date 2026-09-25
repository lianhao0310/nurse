#import "LocalLLMPlugin.h"
#import "llama_bridge.h"
#import <Capacitor/Capacitor-Swift.h>
#import <Capacitor/CAPBridgedJSTypes.h>

@interface CAPPluginCall (LocalLLMHelpers)
- (NSString* _Nullable)getString:(NSString* _Nonnull)key;
- (int)getInt:(NSString* _Nonnull)key defaultValue:(int)defaultValue;
- (double)getDouble:(NSString* _Nonnull)key defaultValue:(double)defaultValue;
- (NSArray* _Nullable)getArray:(NSString* _Nonnull)key defaultValue:(NSArray* _Nonnull)defaultValue;
- (void)reject:(NSString* _Nonnull)message;
- (void)resolve;
- (void)resolve:(NSDictionary* _Nullable)data;
@end

static void token_callback(const char* token, void* user_data) {
    LocalLLMPlugin* plugin = (__bridge LocalLLMPlugin*)user_data;
    NSString* tokenStr = [NSString stringWithUTF8String:token];
    [plugin notifyListeners:@"local-llm-token" data:@{@"token": tokenStr}];
}

@implementation LocalLLMPlugin

- (NSString *)identifier { return @"LocalLLM"; }
- (NSString *)jsName { return @"LocalLLM"; }
- (NSArray<CAPPluginMethod *> *)pluginMethods {
    NSMutableArray *methods = [NSMutableArray new];
    [methods addObject:[[CAPPluginMethod alloc] initWithName:@"loadModel" returnType:CAPPluginReturnPromise]];
    [methods addObject:[[CAPPluginMethod alloc] initWithName:@"generate" returnType:CAPPluginReturnPromise]];
    [methods addObject:[[CAPPluginMethod alloc] initWithName:@"unload" returnType:CAPPluginReturnPromise]];
    [methods addObject:[[CAPPluginMethod alloc] initWithName:@"isModelLoaded" returnType:CAPPluginReturnPromise]];
    return methods;
}

- (NSString*)resolveAbsolutePath:(NSString*)path {
    if ([path hasPrefix:@"/"]) return path;
    NSString* docsDir = [NSHomeDirectory() stringByAppendingPathComponent:@"Documents"];
    return [docsDir stringByAppendingPathComponent:path];
}

- (void)loadModel:(CAPPluginCall*)call {
    NSString* ggufPath = [call getString:@"ggufPath"];
    if (!ggufPath) {
        [call reject:@"ggufPath is required"];
        return;
    }
    int contextLength = [call getInt:@"contextLength" defaultValue:2048];

    NSString* absPath = [self resolveAbsolutePath:ggufPath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:absPath]) {
        [call reject:[NSString stringWithFormat:@"Model file not found: %@", absPath]];
        return;
    }

    llama_model_handle model = llama_bridge_load_model([absPath UTF8String], contextLength);
    if (!model) {
        [call reject:@"Failed to load model (file may be corrupted or memory insufficient)"];
        return;
    }
    [call resolve];
}

- (void)generate:(CAPPluginCall*)call {
    if (!llama_bridge_is_loaded()) {
        [call reject:@"Model not loaded"];
        return;
    }

    NSString* prompt = [call getString:@"prompt" defaultValue:@""];
    int maxTokens = [call getInt:@"maxTokens" defaultValue:512];
    double temperature = [call getDouble:@"temperature" defaultValue:0.7];

    NSArray* messages = [call getArray:@"messages" defaultValue:@[]];
    NSMutableString* fullPrompt = [NSMutableString string];
    for (NSDictionary* msg in messages) {
        NSString* role = [msg objectForKey:@"role"];
        NSString* content = [msg objectForKey:@"content"];
        if ([role isEqualToString:@"system"]) {
            [fullPrompt appendFormat:@"%@\n\n", content];
        } else if ([role isEqualToString:@"user"]) {
            [fullPrompt appendFormat:@"User: %@\n", content];
        } else if ([role isEqualToString:@"assistant"]) {
            [fullPrompt appendFormat:@"Assistant: %@\n", content];
        }
    }
    if (prompt.length > 0) {
        [fullPrompt appendString:prompt];
    }
    [fullPrompt appendString:@"Assistant: "];

    void* userData = (__bridge void*)self;
    int generated = llama_bridge_generate(
        NULL, NULL,
        [fullPrompt UTF8String],
        maxTokens,
        (float)temperature,
        token_callback,
        userData
    );

    if (generated < 0) {
        [call reject:@"Generation failed"];
        return;
    }
    [call resolve:@{@"text": @"", @"tokens": @(generated)}];
}

- (void)unload:(CAPPluginCall*)call {
    llama_bridge_free_model(NULL);
    [call resolve];
}

- (void)isModelLoaded:(CAPPluginCall*)call {
    [call resolve:@{@"loaded": @(llama_bridge_is_loaded())}];
}

@end
