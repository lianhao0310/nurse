Pod::Spec.new do |s|
  s.name = 'CapacitorLocalLlm'
  s.version = '0.1.0'
  s.summary = 'On-device LLM inference via llama.cpp'
  s.homepage = 'https://github.com/nurse/capacitor-local-llm'
  s.license = { :type => 'MIT' }
  s.author = { 'Nurse' => 'nurse@example.com' }
  s.source = { :path => '.' }
  s.source_files = 'ios/Plugin/*.{h,m,mm}'
  s.public_header_files = 'ios/Plugin/*.h'
  s.ios.deployment_target = '13.0'
  s.swift_version = '5.0'
  s.dependency 'Capacitor'
  s.vendored_libraries = 'ios/Plugin/llama/lib/*.a'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/Plugin/llama/include" "$(PODS_TARGET_SRCROOT)/ios/Plugin"',
    'OTHER_LDFLAGS' => '-lc++ -framework Foundation -framework Accelerate',
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES'
  }
end
